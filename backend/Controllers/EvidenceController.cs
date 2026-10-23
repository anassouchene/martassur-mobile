using System.Linq;
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Data;
using SmartAssur.Api.Models;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/evidence")]
    public class EvidenceController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly IAntigravityVisionService _antigravity;
        private readonly string _uploadDir;

        public EvidenceController(SmartAssurDbContext db, IAntigravityVisionService antigravity)
        {
            _db = db;
            _antigravity = antigravity;
            _uploadDir = Path.Combine(Directory.GetCurrentDirectory(), "storage", "uploads");
            if (!Directory.Exists(_uploadDir))
            {
                Directory.CreateDirectory(_uploadDir);
            }
        }

        public record EvaluateQualityRequest(int Width, int Height, long FileSize, string MimeType);
        public sealed class UploadEvidenceForm
        {
            public IFormFile File { get; set; } = default!;
            public string EvidenceType { get; set; } = string.Empty;
            public string? SessionToken { get; set; }
            public string? AnalysisJson { get; set; }
            public bool ExternalAiConsent { get; set; }
            public string? ExpectedBrand { get; set; }
            public string? ExpectedModel { get; set; }
            /// <summary>TAC de l'IMEI déclaré : référence pour comparer le numéro de modèle lu sur la photo.</summary>
            public string? ExpectedTac { get; set; }
            /// <summary>Le client affirme que la photo montre bien son téléphone malgré une marque/un modèle jugé différent.</summary>
            public bool ConfirmDeviceMismatch { get; set; }
        }

        /// <summary>Constat visuel de l'état (afficheur, dos, objectifs) renvoyé par l'analyse de la photo.</summary>
        private static object? Condition(JsonElement? result)
        {
            if (result is not JsonElement r || r.ValueKind != JsonValueKind.Object) return null;
            string[] List(string name) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
                ? v.EnumerateArray().Select(e => e.GetString() ?? "").Where(e => e.Length > 0).ToArray() : Array.Empty<string>();
            bool? Bool(string name) => r.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;
            return new
            {
                screenOn = Bool("screen_on"),
                screenDamage = List("screen_damage"),
                backDamage = List("back_damage"),
                cameraLensDamage = Bool("camera_lens_damage"),
                overallCondition = ResultString(result, "overall_condition"),
                notes = ResultString(result, "damage_notes")
            };
        }

        private static string? ResultString(JsonElement? result, string name) =>
            result is JsonElement r && r.ValueKind == JsonValueKind.Object && r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        [HttpPost("upload")]
        [ApiExplorerSettings(IgnoreApi = true)] // Swashbuckle 6 cannot describe this multipart IFormFile action reliably.
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(15 * 1024 * 1024)] // 15MB limit
        public async Task<IActionResult> UploadEvidence([FromForm] UploadEvidenceForm form)
        {
            var file = form.File;
            var evidenceType = form.EvidenceType;
            var sessionToken = form.SessionToken;
            var analysisJson = form.AnalysisJson;
            if (file == null || file.Length == 0)
            {
                return BadRequest(new { message = "Aucun fichier transmis." });
            }

            var allowedMimes = new[] { "image/jpeg", "image/png", "image/webp" };
            if (Array.IndexOf(allowedMimes, file.ContentType.ToLowerInvariant()) < 0)
            {
                return BadRequest(new { message = "Format de fichier non autorisé. JPEG, PNG ou WebP uniquement." });
            }
            if (evidenceType is not ("PHOTO_FRONT" or "PHOTO_BACK" or "DOCUMENT_IMEI"))
            {
                return BadRequest(new { message = "Type de preuve non autorisé." });
            }

            await using (var signatureStream = file.OpenReadStream())
            {
                var signature = new byte[12];
                var read = await signatureStream.ReadAsync(signature);
                bool jpeg = read >= 3 && signature[0] == 0xFF && signature[1] == 0xD8 && signature[2] == 0xFF;
                bool png = read >= 8 && signature.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
                bool webp = read >= 12 && System.Text.Encoding.ASCII.GetString(signature, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(signature, 8, 4) == "WEBP";
                if (!(jpeg || png || webp)) return BadRequest(new { message = "Le contenu du fichier ne correspond pas à une image autorisée." });
            }

            // Calculate SHA-256 hash of original stream
            string sha256Hex;
            using (var sha = SHA256.Create())
            using (var stream = file.OpenReadStream())
            {
                byte[] hashBytes = await sha.ComputeHashAsync(stream);
                sha256Hex = Convert.ToHexString(hashBytes).ToLowerInvariant();
            }

            // Link session if token provided
            Guid? sessionId = null;
            if (!string.IsNullOrEmpty(sessionToken))
            {
                var sessionHash = SessionTokenService.Hash(sessionToken);
                var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == sessionHash);
                if (session != null) sessionId = session.Id;
            }
            if (sessionId == null)
            {
                return BadRequest(new { code = "SESSION_INVALID", message = "Session valide requise pour enregistrer une preuve." });
            }

            // Check duplicate photo hash across database to prevent fraud
            var duplicate = await _db.DeviceEvidences.FirstOrDefaultAsync(e => e.Sha256Hash == sha256Hex);
            bool isDuplicate = duplicate != null;
            if (isDuplicate)
            {
                // Même session : le client a renvoyé la même image pour l'autre côté. Sinon : photo d'un autre dossier
                // (sans dire lequel, pour ne rien divulguer du premier client).
                bool sameSession = duplicate!.SessionId == sessionId;
                return Conflict(new
                {
                    isDuplicate = true,
                    code = sameSession ? (duplicate.EvidenceType == evidenceType ? "DUPLICATE_SAME_SLOT" : "DUPLICATE_OTHER_SIDE") : "DUPLICATE_IMAGE",
                    message = "Cette image a déjà été utilisée. Prenez une nouvelle photo du téléphone."
                });
            }

            // Generate unique filename with extension
            string extension = file.ContentType.ToLowerInvariant() switch { "image/png" => ".png", "image/webp" => ".webp", _ => ".jpg" };
            string storedFileName = $"{Guid.NewGuid()}_{DateTime.UtcNow.Ticks}{extension}";
            string destinationPath = Path.Combine(_uploadDir, storedFileName);

            using (var fileStream = new FileStream(destinationPath, FileMode.Create))
            {
                await file.CopyToAsync(fileStream);
            }

            int width = 0, height = 0, brightness = 0, sharpness = 0, phoneConfidence = 0, phoneAreaPercent = 0;
            bool phoneDetected = false;
            if (!string.IsNullOrWhiteSpace(analysisJson))
            {
                try
                {
                    using var analysis = JsonDocument.Parse(analysisJson);
                    var root = analysis.RootElement;
                    width = root.TryGetProperty("width", out var w) ? w.GetInt32() : 0;
                    height = root.TryGetProperty("height", out var h) ? h.GetInt32() : 0;
                    brightness = root.TryGetProperty("brightness", out var b) ? b.GetInt32() : 0;
                    sharpness = root.TryGetProperty("sharpness", out var s) ? s.GetInt32() : 0;
                    phoneDetected = root.TryGetProperty("phoneDetected", out var pd) && pd.GetBoolean();
                    phoneConfidence = root.TryGetProperty("phoneConfidence", out var pc) ? pc.GetInt32() : 0;
                    phoneAreaPercent = root.TryGetProperty("phoneAreaPercent", out var pa) ? pa.GetInt32() : 0;
                }
                catch (JsonException) { }
            }
            int score = 40;
            if (width >= 640 && height >= 480) score += 20;
            if (brightness >= 35 && brightness <= 225) score += 20;
            if (sharpness >= 18) score += 20;
            // Google Antigravity is the authoritative phone/side verification.
            // The previous browser COCO model frequently missed phone backs and
            // made uploads appear frozen while downloading its large model.
            AntigravityAssessment? antigravity = await _antigravity.EvaluateAsync(destinationPath, evidenceType, form.ExpectedBrand, form.ExpectedModel, HttpContext.RequestAborted);
            if (antigravity.Status != "EVALUATED")
            {
                System.IO.File.Delete(destinationPath);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "ANALYSIS_UNAVAILABLE", message = "La vérification automatique est momentanément indisponible. Réessayez." });
            }
            // Contrôle déterministe : le numéro de modèle imprimé sur l'appareil (lu par l'analyse) est comparé
            // au TAC de l'IMEI déclaré par le serveur, pas par l'IA. Des modèles différents partagent le même
            // boîtier (Redmi Note 10 Pro M2101K6G / Note 12 Pro 4G 2209116AG) : seul ce numéro les distingue.
            string modelCheck = "UNCONFIRMED";
            string? observedName = null;
            string? codeRejection = null;
            var codeRead = ResultString(antigravity.Result, "model_code_read");
            var expectedTac = (form.ExpectedTac ?? "").Trim();
            var tacEntry = expectedTac.Length == 8 ? await _db.TacCatalog.AsNoTracking().FirstOrDefaultAsync(t => t.Tac == expectedTac) : null;
            if (!string.IsNullOrWhiteSpace(codeRead) && DevicesController.Normalize(codeRead).Length >= 4 && tacEntry != null)
            {
                var catalogRead = await DevicesController.LookupModelCodeAsync(_db, codeRead);
                observedName = catalogRead != null ? $"{catalogRead.MarketName} ({codeRead})" : codeRead;
                // Clé de modèle : sans marque ni suffixe réseau (« Galaxy A54 » = « Galaxy A54 5G »).
                string Key(string? brand, string? name)
                {
                    var key = DevicesController.Normalize(name);
                    var brandKey = DevicesController.Normalize(brand);
                    if (brandKey.Length > 0 && key.StartsWith(brandKey)) key = key[brandKey.Length..];
                    return System.Text.RegularExpressions.Regex.Replace(key, "(5g|4g|lte|ds|dualsim)+$", "");
                }
                // Famille de code : sans le suffixe régional final (SM-A546B / SM-A546E → sma546 ; M2101K6G → m2101k6).
                string Family(string code) => System.Text.RegularExpressions.Regex.Replace(DevicesController.Normalize(code), "[a-z]+$", "");
                var tacText = DevicesController.Normalize(tacEntry.Model);
                var family = Family(codeRead);
                bool sameCode = tacText.Contains(DevicesController.Normalize(codeRead)) || (family.Length >= 5 && tacText.Contains(family));
                bool sameModel = catalogRead != null && Key(catalogRead.Brand, catalogRead.MarketName) == Key(tacEntry.Brand, tacEntry.MarketName ?? tacEntry.Model);
                if (sameCode || sameModel)
                {
                    modelCheck = "CODE_MATCH";
                }
                else if (catalogRead != null)
                {
                    // Numéro connu qui désigne un autre modèle : seule situation de refus sur le numéro.
                    modelCheck = "CODE_MISMATCH";
                    codeRejection = DevicesController.BrandGroup(catalogRead.Brand) != DevicesController.BrandGroup(tacEntry.Brand)
                        ? "BRAND_MISMATCH" : "MODEL_MISMATCH";
                }
                // Numéro absent du catalogue : impossible de conclure, le modèle reste « non confirmé ».
            }

            // Le numéro de modèle fait foi sur l'appréciation visuelle de l'IA, dans les deux sens.
            string? rejection = !antigravity.Accepted ? antigravity.RejectionCode ?? "NOT_A_PHONE" : codeRejection;
            if (modelCheck == "CODE_MATCH" && rejection is "BRAND_MISMATCH" or "MODEL_MISMATCH") rejection = null;
            if (modelCheck == "CODE_MISMATCH" && rejection is null or "BRAND_MISMATCH" or "MODEL_MISMATCH") rejection = codeRejection;

            // Marque/modèle différents : le client peut affirmer que c'est son téléphone ; la photo est alors
            // gardée mais le dossier part en revue humaine (voir InsuranceApplicationsController).
            string? confirmedMismatch = null;
            bool deviceMismatch = rejection is "BRAND_MISMATCH" or "MODEL_MISMATCH";
            if (rejection != null && deviceMismatch && form.ConfirmDeviceMismatch)
            {
                confirmedMismatch = rejection;
            }
            else if (rejection != null)
            {
                System.IO.File.Delete(destinationPath);
                return UnprocessableEntity(new
                {
                    code = rejection,
                    message = modelCheck == "CODE_MISMATCH"
                        ? $"Le numéro de modèle lu sur le téléphone ({codeRead}) correspond à un {observedName ?? codeRead}, pas au {form.ExpectedBrand} {form.ExpectedModel} de l’IMEI saisi."
                        : ResultString(antigravity.Result, "reason") ?? "La photo ne montre pas un smartphone réel du bon côté. Elle a été supprimée.",
                    observedBrand = modelCheck == "CODE_MISMATCH" ? null : ResultString(antigravity.Result, "observed_brand"),
                    observedModel = observedName ?? ResultString(antigravity.Result, "observed_model"),
                    modelCodeRead = codeRead,
                    expectedBrand = form.ExpectedBrand,
                    expectedModel = form.ExpectedModel,
                    canConfirm = deviceMismatch
                });
            }
            phoneDetected = true;
            phoneConfidence = antigravity.Result is JsonElement acceptedResult && acceptedResult.TryGetProperty("confidence", out var confidence)
                ? confidence.GetInt32()
                : 90;
            score = Math.Max(score, 80);
            if (isDuplicate) score = 15;

            var flags = new
            {
                blur = sharpness >= 18 ? "acceptable" : "warning",
                lighting = brightness >= 35 && brightness <= 225 ? "acceptable" : "warning",
                framing = width >= 640 && height >= 480 ? "resolution_acceptable" : "warning",
                width,
                height,
                brightness,
                sharpness,
                phoneDetected,
                phoneConfidence,
                phoneAreaPercent,
                antigravity,
                duplicateDetected = isDuplicate,
                clientConfirmedMismatch = confirmedMismatch,
                modelCheck,
                modelCodeRead = codeRead,
                observedName,
                observedBrand = ResultString(antigravity.Result, "observed_brand"),
                observedModel = ResultString(antigravity.Result, "observed_model")
            };

            var evidence = new DeviceEvidence
            {
                Id = Guid.NewGuid(),
                SessionId = sessionId,
                EvidenceType = evidenceType ?? "PHOTO_FRONT",
                FilePath = destinationPath,
                Sha256Hash = sha256Hex,
                MimeType = file.ContentType,
                FileSize = file.Length,
                QualityScore = score,
                QualityFlags = JsonSerializer.Serialize(flags),
                Source = "WEB_CAMERA",
                CapturedAt = DateTime.UtcNow
            };

            _db.DeviceEvidences.Add(evidence);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                evidenceId = evidence.Id,
                evidenceType = evidence.EvidenceType,
                sha256 = evidence.Sha256Hash,
                fileSize = evidence.FileSize,
                qualityScore = evidence.QualityScore,
                qualityFlags = flags,
                isDuplicate = isDuplicate,
                clientConfirmedMismatch = confirmedMismatch,
                modelCheck,
                modelCodeRead = codeRead,
                condition = Condition(antigravity.Result),
                antigravity,
                message = isDuplicate ? "Attention: Photo identique déjà détectée dans une autre session." : "Capture validée avec succès."
            });
        }

        [HttpPost("evaluate")]
        public IActionResult EvaluateQuality([FromBody] EvaluateQualityRequest req)
        {
            bool ok = req.Width >= 640 && req.Height >= 480 && req.FileSize >= 30 * 1024;
            int score = ok ? 95 : 50;

            return Ok(new
            {
                isAcceptable = ok,
                qualityScore = score,
                recommendations = ok ? new string[0] : new[] { "Augmentez l'éclairage", "Rapprochez le smartphone du cadre" }
            });
        }

        // Photos privées : réservées aux gestionnaires connectés.
        [HttpGet("{id}/preview")]
        [Microsoft.AspNetCore.Authorization.Authorize]
        public async Task<IActionResult> GetPreview(Guid id)
        {
            var evidence = await _db.DeviceEvidences.FindAsync(id);
            if (evidence == null || !System.IO.File.Exists(evidence.FilePath))
            {
                return NotFound(new { message = "Capture introuvable." });
            }

            var stream = System.IO.File.OpenRead(evidence.FilePath);
            return File(stream, evidence.MimeType);
        }
    }
}

