using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Data;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/devices")]
    public class DevicesController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly ILuhnService _luhnService;
        private readonly IAntigravityVisionService _antigravity;

        public DevicesController(SmartAssurDbContext db, ILuhnService luhnService, IAntigravityVisionService antigravity)
        {
            _db = db;
            _luhnService = luhnService;
            _antigravity = antigravity;
        }

        public sealed class ScanDeviceForm
        {
            public IFormFile File { get; set; } = default!;
            public string? SessionToken { get; set; }
        }

        private static readonly Dictionary<string, string> ScanSourceLabels = new()
        {
            ["box_label"] = "Lu sur la boîte (scan)",
            ["imei_screen"] = "Lu sur l’écran *#06# (scan)",
            ["invoice"] = "Lu sur la facture (scan)",
            ["settings_screen"] = "Lu dans « À propos du téléphone » (scan)",
        };

        private static string? JsonString(JsonElement element, string name) =>
            element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()) ? v.GetString()!.Trim() : null;

        private static int? JsonInt(JsonElement element, string name) =>
            element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) && n > 0 ? n : null;

        /// <summary>
        /// Scan automatique : une photo (boîte, *#06#, facture, « À propos ») → IMEI, modèle, stockage, RAM.
        /// La photo est analysée puis supprimée ; seules les empreintes HMAC des IMEI lus sont gardées dans la session.
        /// </summary>
        [HttpPost("scan")]
        [ApiExplorerSettings(IgnoreApi = true)]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(15 * 1024 * 1024)]
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("device-scan")]
        public async Task<IActionResult> ScanDevice([FromForm] ScanDeviceForm form)
        {
            if (form.File == null || form.File.Length == 0) return BadRequest(new { code = "NO_FILE", message = "Aucune photo reçue." });
            var session = string.IsNullOrWhiteSpace(form.SessionToken) ? null
                : await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == SessionTokenService.Hash(form.SessionToken));
            if (session == null || DateTime.UtcNow > session.ExpiresAt)
                return BadRequest(new { code = "SESSION_INVALID", message = "Session expirée : revenez à l’étape 1." });

            byte[] signature = new byte[12];
            await using (var stream = form.File.OpenReadStream()) await stream.ReadAsync(signature);
            string? extension = signature[0] == 0xFF && signature[1] == 0xD8 ? ".jpg"
                : signature.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? ".png"
                : System.Text.Encoding.ASCII.GetString(signature, 8, 4) == "WEBP" ? ".webp" : null;
            if (extension == null) return BadRequest(new { code = "BAD_FORMAT", message = "Photo JPEG, PNG ou WebP uniquement." });

            var uploadDir = System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), "storage", "uploads");
            System.IO.Directory.CreateDirectory(uploadDir);
            var path = System.IO.Path.Combine(uploadDir, $"scan_{Guid.NewGuid():N}{extension}");
            JsonElement? result;
            try
            {
                await using (var target = System.IO.File.Create(path)) await form.File.CopyToAsync(target);
                result = await _antigravity.ExtractAsync(path, HttpContext.RequestAborted);
            }
            finally
            {
                System.IO.File.Delete(path);
            }
            if (result is not JsonElement r)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "SCAN_UNAVAILABLE", message = "La lecture automatique est momentanément indisponible. Réessayez." });

            // Seuls les IMEI au bon format et à la clé Luhn valide sont gardés : une lecture douteuse n'est jamais proposée.
            var imeis = (r.TryGetProperty("imeis", out var list) && list.ValueKind == JsonValueKind.Array ? list.EnumerateArray() : Enumerable.Empty<JsonElement>())
                .Select(e => Regex.Replace(e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : "", "[^0-9]", ""))
                .Where(i => i.Length == 15 && _luhnService.ValidateLuhn(i))
                .Distinct()
                .Take(2)
                .ToList();
            var documentType = JsonString(r, "document_type") ?? "other";
            var modelCode = JsonString(r, "model_code");
            var catalog = await LookupModelCodeAsync(_db, modelCode) ?? await LookupModelCodeAsync(_db, JsonString(r, "model_name"));
            var storageGb = JsonInt(r, "storage_gb");
            var ramGb = JsonInt(r, "ram_gb");

            JsonNode? info = null;
            try { info = JsonNode.Parse(string.IsNullOrWhiteSpace(session.PairedDeviceInfo) ? "{}" : session.PairedDeviceInfo); } catch (JsonException) { }
            var root = info as JsonObject ?? new JsonObject();
            root["scan"] = new JsonObject
            {
                ["documentType"] = documentType,
                ["imeiHmacs"] = new JsonArray(imeis.Select(i => (JsonNode)JsonValue.Create(_luhnService.ComputeHmacIndex(i))!).ToArray()),
                ["modelCode"] = modelCode,
                ["storageGb"] = storageGb,
                ["ramGb"] = ramGb,
                ["scannedAt"] = DateTime.UtcNow
            };
            session.PairedDeviceInfo = root.ToJsonString();
            await _db.SaveChangesAsync();

            return Ok(new
            {
                documentType,
                sourceLabel = ScanSourceLabels.GetValueOrDefault(documentType, "Lu par scan"),
                imeis,
                brand = catalog?.Brand ?? JsonString(r, "brand"),
                marketName = catalog?.MarketName ?? JsonString(r, "model_name"),
                modelCode,
                storageGb,
                ramGb,
                confidence = JsonInt(r, "confidence"),
                message = imeis.Count > 0 ? null : (JsonString(r, "reason") ?? "Aucun IMEI lisible sur cette photo.")
            });
        }

        public record ResolveImeiRequest(string Imei, string? SessionToken = null);
        public record UsbEvidenceRequest(string SessionToken, string Brand, string Model, string SerialNumber, string BuildProps, JsonElement? Diagnostic = null, string[]? Imeis = null);

        /// <summary>Preuves matérielles rattachées à la session (USB ADB ou navigateur du téléphone).</summary>
        public record SessionDeviceEvidence(string[] UsbImeiHmacs, string? Brand, string? Manufacturer, string? Model, string? MarketName, string[]? ModelCandidates = null);

        public static SessionDeviceEvidence ReadSessionEvidence(string? pairedDeviceInfo)
        {
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(pairedDeviceInfo) ? "{}" : pairedDeviceInfo);
                var root = doc.RootElement;
                var hmacs = root.TryGetProperty("usbImeiHmacs", out var h) && h.ValueKind == JsonValueKind.Array
                    ? h.EnumerateArray().Select(e => e.GetString() ?? "").Where(v => v.Length > 0).ToArray()
                    : Array.Empty<string>();
                string? Field(string name) =>
                    root.TryGetProperty("diagnostic", out var d) && d.ValueKind == JsonValueKind.Object &&
                    d.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                // Apple : liste de modèles compatibles avec l'écran (Safari ne publie pas le modèle).
                var candidates = root.TryGetProperty("diagnostic", out var diag) && diag.ValueKind == JsonValueKind.Object
                    && diag.TryGetProperty("modelCandidates", out var c) && c.ValueKind == JsonValueKind.Array
                    ? c.EnumerateArray().Select(e => e.GetString() ?? "").Where(v => v.Length > 0).ToArray()
                    : null;
                return new SessionDeviceEvidence(hmacs, Field("brand"), Field("manufacturer"), Field("model"), candidates == null ? Field("marketName") : null, candidates);
            }
            catch (JsonException)
            {
                return new SessionDeviceEvidence(Array.Empty<string>(), null, null, null, null);
            }
        }

        public record CatalogDevice(string Brand, string MarketName);

        // « SAMSUNG GALAXY S23 » → « Samsung Galaxy S23 » ; les noms déjà en casse mixte sont gardés.
        private static readonly Dictionary<string, string> NameWords = new(StringComparer.OrdinalIgnoreCase)
        {
            ["iphone"] = "iPhone", ["ipad"] = "iPad", ["mini"] = "mini", ["gen)"] = "gen)", ["(2nd"] = "(2nd", ["(3rd"] = "(3rd",
        };

        /// <summary>« SAMSUNG GALAXY S23 » → « Samsung Galaxy S23 », « APPLE IPHONE XR » → « Apple iPhone XR » ; casse mixte gardée.</summary>
        private static string Display(string value)
        {
            if (value.Any(char.IsLower)) return value;
            return string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(word =>
                NameWords.TryGetValue(word, out var known) ? known
                : Regex.IsMatch(word, "^[0-9]+E$") ? word[..^1] + "e"                 // 16E → 16e
                : word.Length <= 2 || word.Any(char.IsDigit) ? word                      // XR, SE, FE, S23, A54
                : char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()));
        }

        /// <summary>Nom commercial sans la marque répétée : (« Samsung », « SAMSUNG GALAXY S23 ») → « Galaxy S23 ».</summary>
        public static string MarketNameWithoutBrand(string brand, string marketName)
        {
            var name = Display(marketName.Trim());
            return name.StartsWith(brand + " ", StringComparison.OrdinalIgnoreCase) ? name[(brand.Length + 1)..] : name;
        }

        /// <summary>
        /// Code modèle publié par l'appareil (SM-S911U, 2209116AG…) → marque et nom commercial, d'après la base TAC
        /// (dont les fiches citent ces codes). Null si le code est trop court ou inconnu : on ne devine pas.
        /// </summary>
        public static async Task<CatalogDevice?> LookupModelCodeAsync(SmartAssurDbContext db, string? code)
        {
            code = (code ?? "").Trim();
            if (code.Length < 5 || code.Length > 40 || !Regex.IsMatch(code, "^[A-Za-z0-9][A-Za-z0-9 ._/+-]*$")) return null;
            var pattern = "%" + code.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            var best = await db.TacCatalog.AsNoTracking()
                .Where(t => EF.Functions.ILike(t.Model, pattern))
                .GroupBy(t => new { t.Brand, t.MarketName })
                .Select(g => new { g.Key.Brand, g.Key.MarketName, Count = g.Count() })
                .OrderByDescending(g => g.Count)
                .FirstOrDefaultAsync();
            if (best == null || string.IsNullOrWhiteSpace(best.MarketName)) return null;
            return new CatalogDevice(Display(best.Brand), Display(best.MarketName));
        }

        /// <summary>Complète la marque / le nom commercial manquants (mode QR : le navigateur ne donne que le code).</summary>
        public static async Task<SessionDeviceEvidence> EnrichEvidenceAsync(SmartAssurDbContext db, SessionDeviceEvidence evidence)
        {
            if (!string.IsNullOrWhiteSpace(evidence.Brand) && !string.IsNullOrWhiteSpace(evidence.MarketName)) return evidence;
            var catalog = await LookupModelCodeAsync(db, evidence.Model);
            if (catalog == null) return evidence;
            return evidence with
            {
                Brand = string.IsNullOrWhiteSpace(evidence.Brand) ? catalog.Brand : evidence.Brand,
                MarketName = string.IsNullOrWhiteSpace(evidence.MarketName) ? catalog.MarketName : evidence.MarketName
            };
        }

        public static string Normalize(string? value) => Regex.Replace((value ?? "").ToLowerInvariant(), "[^a-z0-9]+", "");

        // Sous-marques publiées par getprop sous leur propre nom alors que le TAC est attribué au groupe.
        private static readonly Dictionary<string, string> BrandGroups = new()
        {
            ["redmi"] = "xiaomi", ["poco"] = "xiaomi", ["mi"] = "xiaomi",
            ["honor"] = "huawei", ["iqoo"] = "vivo", ["realme"] = "oppo", ["oneplus"] = "oppo",
        };

        public static string BrandGroup(string? brand)
        {
            var n = Normalize(brand);
            return BrandGroups.TryGetValue(n, out var group) ? group : n;
        }

        /// <summary>MATCH : le code modèle lu sur l'appareil figure dans la fiche TAC ; MISMATCH : marques incompatibles.</summary>
        public static string DeviceCoherence(SessionDeviceEvidence evidence, string tacBrand, string tacModel, string? tacMarketName = null)
        {
            // Modèles possibles (iPhone/iPad d'après l'écran) : l'IMEI doit désigner l'un d'eux.
            if (evidence.ModelCandidates is { Length: > 0 } candidates && !string.IsNullOrWhiteSpace(tacMarketName)
                && BrandGroup(tacBrand) == BrandGroup(evidence.Brand))
            {
                static string Key(string name) => Normalize(Regex.Replace(name, @"\([^)]*\)", ""));
                var tacKey = Key(tacMarketName);
                var brandKey = Normalize(tacBrand);
                if (tacKey.StartsWith(brandKey)) tacKey = tacKey[brandKey.Length..];
                return candidates.Any(candidate => Key(candidate) == tacKey) ? "MATCH" : "MISMATCH";
            }

            var model = Normalize(evidence.Model);
            if (model.Length < 4 && string.IsNullOrEmpty(evidence.Brand)) return "UNKNOWN";
            var tacText = Normalize(tacModel);
            if (model.Length >= 4 && tacText.Contains(model)) return "MATCH";
            var market = Normalize(evidence.MarketName);
            if (market.Length >= 6 && tacText.Contains(market)) return "MATCH";
            var tacGroup = BrandGroup(tacBrand);
            var deviceGroups = new[] { evidence.Brand, evidence.Manufacturer }.Where(b => !string.IsNullOrWhiteSpace(b)).Select(BrandGroup).ToList();
            if (deviceGroups.Count > 0 && tacGroup.Length > 0 && !deviceGroups.Contains(tacGroup)) return "MISMATCH";
            return "UNKNOWN";
        }

        [HttpPost("imei/resolve")]
        public async Task<IActionResult> ResolveImei([FromBody] ResolveImeiRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Imei))
            {
                return BadRequest(new { valid = false, message = "Le numéro IMEI est requis." });
            }

            string cleanImei = req.Imei.Trim().Replace(" ", "").Replace("-", "");
            bool isLuhnValid = _luhnService.ValidateLuhn(cleanImei);

            if (!isLuhnValid)
            {
                return Ok(new
                {
                    valid = false,
                    cleanImei = cleanImei,
                    maskedImei = _luhnService.MaskImei(cleanImei),
                    message = "Format IMEI ou clé de contrôle Luhn non valide. Veuillez vérifier les 15 chiffres.",
                    error = "INVALID_LUHN"
                });
            }

            string tac = _luhnService.ExtractTac(cleanImei);
            string hmacIndex = _luhnService.ComputeHmacIndex(cleanImei);

            // Check if IMEI already insured in active applications
            var duplicate = await _db.MobileDevices
                .FirstOrDefaultAsync(d => d.ImeiHmacIndex == hmacIndex);

            bool alreadyRegistered = duplicate != null;

            // Lookup TAC in database
            var tacEntry = await _db.TacCatalog.FirstOrDefaultAsync(t => t.Tac == tac);

            // Preuves de la session : IMEI lu via USB (empreinte) et modèle publié par l'appareil.
            SessionDeviceEvidence? evidence = null;
            if (!string.IsNullOrWhiteSpace(req.SessionToken))
            {
                var sessionHash = SessionTokenService.Hash(req.SessionToken);
                var session = await _db.InsuranceSessions.AsNoTracking().FirstOrDefaultAsync(s => s.SessionToken == sessionHash);
                if (session != null) evidence = await EnrichEvidenceAsync(_db, ReadSessionEvidence(session.PairedDeviceInfo));
            }
            string usbImeiStatus = evidence == null || evidence.UsbImeiHmacs.Length == 0
                ? "NOT_READ"
                : evidence.UsbImeiHmacs.Contains(hmacIndex) ? "MATCH" : "MISMATCH";
            string? scanLabel = null;
            if (usbImeiStatus == "NOT_READ" && !string.IsNullOrWhiteSpace(req.SessionToken))
            {
                var scanSession = await _db.InsuranceSessions.AsNoTracking().FirstOrDefaultAsync(s => s.SessionToken == SessionTokenService.Hash(req.SessionToken));
                try
                {
                    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(scanSession?.PairedDeviceInfo) ? "{}" : scanSession!.PairedDeviceInfo);
                    if (doc.RootElement.TryGetProperty("scan", out var scan) && scan.TryGetProperty("imeiHmacs", out var hmacs) && hmacs.ValueKind == JsonValueKind.Array
                        && hmacs.EnumerateArray().Any(h => h.GetString() == hmacIndex))
                        scanLabel = ScanSourceLabels.GetValueOrDefault(JsonString(scan, "documentType") ?? "", "Lu par scan");
                }
                catch (JsonException) { }
            }
            string imeiBadge = usbImeiStatus switch
            {
                "MATCH" => "Lu sur l’appareil via USB (concordant)",
                "MISMATCH" => "Différent de l’IMEI lu via USB",
                _ => scanLabel ?? "Déclaré par le client (validé Luhn)"
            };
            string deviceCoherence = evidence == null || tacEntry == null ? "UNKNOWN" : DeviceCoherence(evidence, tacEntry.Brand, tacEntry.Model, tacEntry.MarketName);
            // Téléphone qui a scanné le QR / été branché en USB, pour l'expliquer au client en cas d'écart.
            var detectedDevice = evidence == null || (evidence.Model == null && evidence.Brand == null) ? null : new
            {
                brand = evidence.Brand,
                model = evidence.Model,
                marketName = evidence.MarketName
            };

            if (tacEntry != null)
            {
                return Ok(new
                {
                    valid = true,
                    isLuhnValid = true,
                    tac = tac,
                    maskedImei = _luhnService.MaskImei(cleanImei),
                    brand = tacEntry.Brand,
                    model = tacEntry.Model,
                    marketName = MarketNameWithoutBrand(tacEntry.Brand, tacEntry.MarketName ?? tacEntry.Model),
                    ramOptions = tacEntry.RamOptions.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).ToList(),
                    storageOptions = tacEntry.StorageOptions.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).ToList(),
                    batteryMah = tacEntry.BatteryNominalMah,
                    isDuplicate = alreadyRegistered,
                    usbImeiStatus,
                    deviceCoherence,
                    detectedDevice,
                    sourceBadges = new
                    {
                        brand = "via TAC (catalogue local)",
                        model = "via TAC (catalogue local)",
                        specs = tacEntry.BatteryNominalMah.HasValue ? "Catalogue technique local" : "Non disponible automatiquement",
                        imei = imeiBadge
                    }
                });
            }
            else
            {
                // TAC not found in database: fallback to manual mode with review
                return Ok(new
                {
                    valid = true,
                    isLuhnValid = true,
                    tac = tac,
                    maskedImei = _luhnService.MaskImei(cleanImei),
                    brand = "Non reconnu",
                    model = "Modèle à préciser",
                    marketName = "Smartphone non répertorié",
                    ramOptions = new[] { "4 Go", "6 Go", "8 Go", "12 Go", "16 Go" },
                    storageOptions = new[] { "64 Go", "128 Go", "256 Go", "512 Go", "1 To" },
                    batteryMah = (int?)null,
                    isDuplicate = alreadyRegistered,
                    usbImeiStatus,
                    deviceCoherence,
                    detectedDevice,
                    sourceBadges = new
                    {
                        brand = "Déclaré par le client",
                        model = "Déclaré par le client",
                        specs = "Sélection manuelle",
                        imei = imeiBadge
                    },
                    requiresManualReview = true,
                    message = "TAC valide mais non répertorié. Vous pouvez sélectionner manuellement votre marque et modèle."
                });
            }
        }

        [HttpGet("model-lookup")]
        public async Task<IActionResult> ModelLookup([FromQuery] string? code)
        {
            var device = await LookupModelCodeAsync(_db, code);
            return device == null ? NotFound(new { message = "Code modèle absent du catalogue." }) : Ok(new { brand = device.Brand, marketName = device.MarketName });
        }

        [HttpPost("specs/resolve")]
        public async Task<IActionResult> ResolveSpecs([FromBody] ResolveImeiRequest req)
        {
            string cleanImei = req.Imei.Trim().Replace(" ", "").Replace("-", "");
            string tac = _luhnService.ExtractTac(cleanImei);

            var entry = await _db.TacCatalog.FirstOrDefaultAsync(t => t.Tac == tac);
            if (entry == null)
            {
                return Ok(new
                {
                    ramOptions = new[] { "4 Go", "6 Go", "8 Go", "12 Go" },
                    storageOptions = new[] { "128 Go", "256 Go", "512 Go" },
                    batteryMah = 4500
                });
            }

            return Ok(new
            {
                brand = entry.Brand,
                model = entry.Model,
                ramOptions = entry.RamOptions.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).ToList(),
                storageOptions = entry.StorageOptions.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).ToList(),
                batteryMah = entry.BatteryNominalMah
            });
        }

        [HttpPost("usb-evidence")]
        public async Task<IActionResult> RecordUsbEvidence([FromBody] UsbEvidenceRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.SessionToken)) return BadRequest(new { message = "Session requise." });
            var sessionHash = SessionTokenService.Hash(req.SessionToken);
            var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == sessionHash);
            if (session == null) return NotFound(new { message = "Session introuvable." });
            if (DateTime.UtcNow > session.ExpiresAt) return BadRequest(new { message = "La session a expiré. Régénérez-la." });

            // IMEI lus par ADB : jamais stockés en clair, seulement l'empreinte HMAC pour la comparaison.
            var imeis = (req.Imeis ?? Array.Empty<string>())
                .Select(i => (i ?? "").Trim())
                .Where(i => _luhnService.ValidateLuhn(i))
                .Distinct()
                .Take(2)
                .ToList();
            var masked = imeis.Select(_luhnService.MaskImei).ToArray();

            session.Status = "USB_CONNECTED";
            session.DeviceType = "android_usb";
            session.PairedDeviceInfo = JsonSerializer.Serialize(new
            {
                source = "USB_ADB",
                recordedAt = DateTime.UtcNow,
                brand = req.Brand,
                model = req.Model,
                diagnostic = req.Diagnostic,
                usbImeiHmacs = imeis.Select(_luhnService.ComputeHmacIndex).ToArray(),
                usbImeisMasked = masked
            });
            await _db.SaveChangesAsync();

            return Ok(new
            {
                message = imeis.Count > 0
                    ? "Diagnostic USB enregistré. IMEI lu sur l’appareil (empreinte conservée)."
                    : "Diagnostic USB enregistré. Android n’a pas autorisé la lecture de l’IMEI.",
                brand = req.Brand,
                model = req.Model,
                badge = "via USB (lu sur l’appareil)",
                confidence = "MEDIUM",
                imeiRead = imeis.Count > 0,
                imeisMasked = masked,
                imeiConfirmed = false
            });
        }
    }
}

