using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Data;
using SmartAssur.Api.Models;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/insurance-applications")]
    public class InsuranceApplicationsController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly ILuhnService _luhnService;
        private readonly IRiskEngineService _riskEngine;
        private readonly IDataProtector _imeiProtector;

        public InsuranceApplicationsController(SmartAssurDbContext db, ILuhnService luhnService, IRiskEngineService riskEngine, IDataProtectionProvider protectionProvider)
        {
            _db = db;
            _luhnService = luhnService;
            _riskEngine = riskEngine;
            _imeiProtector = protectionProvider.CreateProtector("SmartAssur.Mobile.IMEI.v1");
        }

        public record CreateApplicationRequest(
            string? SessionToken,
            string ClientName,
            string ClientEmail,
            string ClientPhone,
            string Imei,
            string Brand,
            string Model,
            string? RamGb,
            string? StorageGb,
            int? BatteryMah,
            Guid? FrontPhotoEvidenceId,
            Guid? BackPhotoEvidenceId,
            string VerificationMode, // WEB_QR, WEB_DIRECT, USB_ADB
            bool ConsentCndp
        );

        // « Anas Khatim » → « Anas K. » : reconnaissable par le client, inutile pour un tiers.
        private static string MaskName(string? name)
        {
            var parts = (name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return "";
            return parts.Length == 1 ? parts[0] : $"{parts[0]} {string.Join(" ", parts.Skip(1).Select(p => p[0] + "."))}";
        }

        [HttpPost]
        public async Task<IActionResult> CreateApplication([FromBody] CreateApplicationRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.Imei) || !_luhnService.ValidateLuhn(req.Imei))
            {
                return BadRequest(new { message = "Numéro IMEI invalide selon la clé Luhn." });
            }

            if (string.IsNullOrWhiteSpace(req.ClientName) || string.IsNullOrWhiteSpace(req.ClientEmail) || string.IsNullOrWhiteSpace(req.ClientPhone))
            {
                return BadRequest(new { message = "Les coordonnées du souscripteur sont obligatoires." });
            }
            if (!req.ConsentCndp)
            {
                return BadRequest(new { message = "Le consentement au traitement des données est requis." });
            }

            var allowedModes = new[] { "WEB_QR", "WEB_DIRECT", "USB_ADB" };
            if (!allowedModes.Contains(req.VerificationMode))
            {
                return BadRequest(new { message = "Mode de vérification non reconnu." });
            }

            string cleanImei = req.Imei.Trim().Replace(" ", "").Replace("-", "");
            string tac = _luhnService.ExtractTac(cleanImei);
            string hmacIndex = _luhnService.ComputeHmacIndex(cleanImei);

            // Check duplicate IMEI
            var existingDevice = await _db.MobileDevices.FirstOrDefaultAsync(d => d.ImeiHmacIndex == hmacIndex);
            bool isDuplicate = existingDevice != null;

            // Session check
            Guid? sessionId = null;
            bool isMobilePaired = false;
            bool isUsbUsed = req.VerificationMode == "USB_ADB";
            var sessionEvidence = DevicesController.ReadSessionEvidence(null);

            if (!string.IsNullOrEmpty(req.SessionToken))
            {
                var sessionHash = SessionTokenService.Hash(req.SessionToken);
                var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == sessionHash);
                if (session != null)
                {
                    if (DateTime.UtcNow > session.ExpiresAt || session.Status == "EXPIRED")
                        return BadRequest(new { message = "La session a expiré. Recommencez l’étape de détection." });
                    sessionId = session.Id;
                    sessionEvidence = await DevicesController.EnrichEvidenceAsync(_db, DevicesController.ReadSessionEvidence(session.PairedDeviceInfo));
                    isMobilePaired = session.Status == "PAIRED" || session.DeviceType == "mobile";
                    session.Status = "COMPLETED";
                }
            }
            if (req.VerificationMode == "WEB_DIRECT")
            {
                isMobilePaired = true;
            }

            // Evidence checks
            DeviceEvidence? frontEvidence = null;
            DeviceEvidence? backEvidence = null;
            if (req.FrontPhotoEvidenceId.HasValue)
            {
                frontEvidence = await _db.DeviceEvidences.FindAsync(req.FrontPhotoEvidenceId.Value);
            }
            if (req.BackPhotoEvidenceId.HasValue)
            {
                backEvidence = await _db.DeviceEvidences.FindAsync(req.BackPhotoEvidenceId.Value);
            }

            if (frontEvidence?.EvidenceType != "PHOTO_FRONT" || backEvidence?.EvidenceType != "PHOTO_BACK")
                return BadRequest(new { message = "Deux preuves distinctes recto et verso sont obligatoires." });
            if (sessionId.HasValue && (frontEvidence.SessionId != sessionId || backEvidence.SessionId != sessionId))
                return BadRequest(new { message = "Les photos ne correspondent pas à cette session." });

            bool hasFront = frontEvidence != null;
            bool hasBack = backEvidence != null;
            int avgQuality = (hasFront && hasBack) ? (frontEvidence!.QualityScore + backEvidence!.QualityScore) / 2 : 50;

            // TAC check
            var tacCatalog = await _db.TacCatalog.FirstOrDefaultAsync(t => t.Tac == tac);
            bool isTacMatched = tacCatalog != null;

            // IMEI lu via USB : null = non lu, true/false = comparaison avec l'IMEI déclaré.
            bool? usbImeiMatch = sessionEvidence.UsbImeiHmacs.Length == 0 ? null : sessionEvidence.UsbImeiHmacs.Contains(hmacIndex);
            string deviceCoherence = tacCatalog == null ? "UNKNOWN" : DevicesController.DeviceCoherence(sessionEvidence, tacCatalog.Brand, tacCatalog.Model, tacCatalog.MarketName);

            // Risk Engine
            var riskResult = _riskEngine.Evaluate(
                isLuhnValid: true,
                isTacMatched: isTacMatched,
                isMobilePaired: isMobilePaired,
                isUsbAdbUsed: isUsbUsed,
                hasFrontPhoto: hasFront,
                hasBackPhoto: hasBack,
                isDuplicateImei: isDuplicate,
                photoQualityScore: avgQuality
            );
            // Photos gardées alors que l'analyse voyait une autre marque / un autre modèle (le client a confirmé).
            static string? ConfirmedMismatch(DeviceEvidence? evidence)
            {
                try
                {
                    using var flags = JsonDocument.Parse(string.IsNullOrWhiteSpace(evidence?.QualityFlags) ? "{}" : evidence!.QualityFlags);
                    return flags.RootElement.TryGetProperty("clientConfirmedMismatch", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                }
                catch (JsonException) { return null; }
            }
            var photoMismatches = new[] { ConfirmedMismatch(frontEvidence), ConfirmedMismatch(backEvidence) }.Where(m => m != null).Distinct().ToList();
            bool photoBrandMismatch = photoMismatches.Contains("BRAND_MISMATCH");
            bool photoModelMismatch = photoMismatches.Contains("MODEL_MISMATCH");
            if (photoBrandMismatch || photoModelMismatch)
            {
                riskResult.Factors.Add(photoBrandMismatch
                    ? "Les photos semblent montrer une autre marque que l’appareil déclaré (le client affirme le contraire)."
                    : "Les photos semblent montrer un autre modèle que l’appareil déclaré (le client affirme le contraire).");
                riskResult.Recommendations.Add("Comparer visuellement les photos au modèle déclaré ; demander une photo de *#06# ou la facture.");
                riskResult = photoBrandMismatch
                    ? riskResult with { RiskLevel = "INCOHERENT", ConfidenceLabel = "Incohérent", Score = Math.Min(riskResult.Score, 20) }
                    : riskResult.RiskLevel is "INCOHERENT" ? riskResult : riskResult with { RiskLevel = "HIGH", ConfidenceLabel = "Élevé (revue obligatoire)", Score = Math.Min(riskResult.Score, 45) };
            }

            // Dommages préexistants constatés sur les photos (écran fissuré, pixels morts, dos cassé…).
            static List<string> Damages(DeviceEvidence? evidence)
            {
                var found = new List<string>();
                try
                {
                    using var flags = JsonDocument.Parse(string.IsNullOrWhiteSpace(evidence?.QualityFlags) ? "{}" : evidence!.QualityFlags);
                    if (!flags.RootElement.TryGetProperty("antigravity", out var ag) || !ag.TryGetProperty("Result", out var result) && !ag.TryGetProperty("result", out result)) return found;
                    if (result.ValueKind != JsonValueKind.Object) return found;
                    foreach (var key in new[] { "screen_damage", "back_damage" })
                        if (result.TryGetProperty(key, out var list) && list.ValueKind == JsonValueKind.Array)
                            found.AddRange(list.EnumerateArray().Select(e => $"{(key == "screen_damage" ? "écran" : "dos")}:{e.GetString()}"));
                    if (result.TryGetProperty("camera_lens_damage", out var lens) && lens.ValueKind == JsonValueKind.True) found.Add("objectif photo");
                }
                catch (JsonException) { }
                return found;
            }
            var damages = Damages(frontEvidence).Concat(Damages(backEvidence)).Distinct().ToList();
            // Tests de fonctionnement lancés sur le téléphone : un composant « Défaillant » est un dommage préexistant.
            if (!string.IsNullOrEmpty(req.SessionToken))
            {
                var testedSession = await _db.InsuranceSessions.AsNoTracking().FirstOrDefaultAsync(s => s.SessionToken == SessionTokenService.Hash(req.SessionToken));
                try
                {
                    using var info = JsonDocument.Parse(string.IsNullOrWhiteSpace(testedSession?.PairedDeviceInfo) ? "{}" : testedSession!.PairedDeviceInfo);
                    if (info.RootElement.TryGetProperty("functionalTests", out var report) && report.TryGetProperty("tests", out var tests) && tests.ValueKind == JsonValueKind.Array)
                        damages.AddRange(tests.EnumerateArray()
                            .Where(t => t.TryGetProperty("status", out var st) && st.GetString() == "fail")
                            .Select(t => $"test : {(t.TryGetProperty("label", out var l) ? l.GetString() : "?")} défaillant"));
                }
                catch (JsonException) { }
            }
            if (damages.Count > 0)
            {
                riskResult.Factors.Add($"Dommages ou pannes préexistants constatés (photos / tests) : {string.Join(", ", damages)}.");
                riskResult.Recommendations.Add("Exclure ou refuser la couverture des dommages préexistants ; demander une réparation ou des photos complémentaires.");
                if (riskResult.RiskLevel is "LOW" or "MEDIUM")
                    riskResult = riskResult with { RiskLevel = "HIGH", ConfidenceLabel = "Élevé (dommages préexistants)", Score = Math.Min(riskResult.Score, 50) };
            }

            bool photoModelProven = new[] { frontEvidence, backEvidence }.Any(e =>
            {
                try
                {
                    using var f = JsonDocument.Parse(string.IsNullOrWhiteSpace(e?.QualityFlags) ? "{}" : e!.QualityFlags);
                    return f.RootElement.TryGetProperty("modelCheck", out var v) && v.GetString() == "CODE_MATCH";
                }
                catch (JsonException) { return false; }
            });
            if (photoModelProven)
            {
                riskResult.Factors.Add("Numéro de modèle lu sur la photo concordant avec le TAC de l’IMEI.");
            }
            else if (usbImeiMatch != true)
            {
                riskResult.Factors.Add("Modèle non prouvé : numéro de modèle illisible sur les photos et IMEI non lu sur l’appareil.");
                riskResult.Recommendations.Add("Vérifier le modèle exact (étiquette au dos, Réglages › À propos du téléphone, *#06#).");
                if (riskResult.RiskLevel == "LOW")
                    riskResult = riskResult with { RiskLevel = "MEDIUM", ConfidenceLabel = "Moyen (modèle à vérifier)", Score = Math.Min(riskResult.Score, 70) };
            }

            if (usbImeiMatch == true)
            {
                riskResult.Factors.Add("IMEI déclaré identique à l’IMEI lu sur l’appareil via USB.");
            }
            if (usbImeiMatch == false || deviceCoherence == "MISMATCH")
            {
                var reason = usbImeiMatch == false
                    ? "IMEI déclaré différent de l’IMEI lu sur l’appareil via USB."
                    : "Marque lue sur l’appareil incompatible avec le TAC de l’IMEI déclaré.";
                riskResult.Factors.Add(reason);
                riskResult.Recommendations.Add("Revue humaine obligatoire : vérifier que l’IMEI correspond au téléphone présenté.");
                riskResult = riskResult with { RiskLevel = "INCOHERENT", ConfidenceLabel = "Incohérent", Score = Math.Min(riskResult.Score, 20) };
            }

            // Create MobileDevice entity
            // Encrypt / mask IMEI
            string masked = _luhnService.MaskImei(cleanImei);
            var device = new MobileDevice
            {
                Id = Guid.NewGuid(),
                ImeiEncrypted = _imeiProtector.Protect(cleanImei),
                ImeiHmacIndex = hmacIndex,
                Tac = tac,
                Brand = req.Brand,
                Model = req.Model,
                RamGb = req.RamGb ?? "8 Go",
                StorageGb = req.StorageGb ?? "256 Go",
                BatteryNominalMah = req.BatteryMah,
                CreatedAt = DateTime.UtcNow
            };
            _db.MobileDevices.Add(device);

            // Record provenance of each field as demanded by specifications
            _db.DeviceFieldSources.AddRange(new[]
            {
                new DeviceFieldSource
                {
                    DeviceId = device.Id,
                    FieldName = "imei",
                    SourceType = usbImeiMatch == true ? "USB_ADB" : "CLIENT_INPUT",
                    SourceRef = usbImeiMatch == true ? "Lu sur l’appareil via USB (concordant)" : "Contrôle Luhn validé",
                    ConfidenceLevel = usbImeiMatch == true ? "HIGH" : "MEDIUM"
                },
                new DeviceFieldSource
                {
                    DeviceId = device.Id,
                    FieldName = "brand",
                    SourceType = isTacMatched ? "TAC_LOOKUP" : "CLIENT_INPUT",
                    SourceRef = isTacMatched ? $"TAC: {tac}" : "Déclaration client",
                    ConfidenceLevel = isTacMatched ? "HIGH" : "MEDIUM"
                },
                new DeviceFieldSource
                {
                    DeviceId = device.Id,
                    FieldName = "model",
                    SourceType = isTacMatched ? "TAC_LOOKUP" : (isUsbUsed ? "USB_ADB" : "CLIENT_INPUT"),
                    SourceRef = isTacMatched ? $"TAC: {tac}" : (isUsbUsed ? "Lecture USB" : "Déclaration client"),
                    ConfidenceLevel = isTacMatched || isUsbUsed ? "HIGH" : "MEDIUM"
                },
                new DeviceFieldSource
                {
                    DeviceId = device.Id,
                    FieldName = "storage_ram",
                    SourceType = "CATALOGUE",
                    SourceRef = "Sélection variante client",
                    ConfidenceLevel = "HIGH"
                }
            });

            // Application Reference Number (e.g. SMA-2026-78421)
            int randomNum = RandomNumberGenerator.GetInt32(10000, 99999);
            string appRef = $"SMA-{DateTime.UtcNow:yyyy}-{randomNum}";

            string status = riskResult.RiskLevel is "INCOHERENT" or "HIGH" ? "MORE_DOCS_NEEDED" : "PENDING_REVIEW";

            var app = new InsuranceApplication
            {
                Id = Guid.NewGuid(),
                ApplicationRef = appRef,
                SessionId = sessionId,
                DeviceId = device.Id,
                ClientName = req.ClientName,
                ClientEmail = req.ClientEmail,
                ClientPhone = req.ClientPhone,
                Status = status,
                RiskLevel = riskResult.RiskLevel,
                VerificationMode = req.VerificationMode ?? "WEB_QR",
                ConsentCndp = req.ConsentCndp,
                Notes = $"Score initial : {riskResult.Score}/100. Niveau : {riskResult.ConfidenceLabel}.",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.InsuranceApplications.Add(app);

            // Link evidence to application
            if (frontEvidence != null)
            {
                frontEvidence.ApplicationId = app.Id;
            }
            if (backEvidence != null)
            {
                backEvidence.ApplicationId = app.Id;
            }

            // Record initial checks
            _db.DeviceChecks.Add(new DeviceCheck
            {
                ApplicationId = app.Id,
                CheckKind = "LUHN_ALGORITHM",
                Outcome = "PASSED",
                Details = JsonSerializer.Serialize(new { imeiMasked = masked, valid = true })
            });

            _db.DeviceChecks.Add(new DeviceCheck
            {
                ApplicationId = app.Id,
                CheckKind = "TAC_CONSISTENCY",
                Outcome = isTacMatched ? "PASSED" : "MANUAL_CHECK",
                Details = JsonSerializer.Serialize(new { tac = tac, brand = req.Brand, model = req.Model, matched = isTacMatched })
            });

            if (usbImeiMatch.HasValue)
            {
                _db.DeviceChecks.Add(new DeviceCheck
                {
                    ApplicationId = app.Id,
                    CheckKind = "IMEI_USB_READ",
                    Outcome = usbImeiMatch.Value ? "PASSED" : "FAILED",
                    Details = JsonSerializer.Serialize(new { imeiMasked = masked, matchesUsbRead = usbImeiMatch.Value })
                });
            }
            if (deviceCoherence != "UNKNOWN")
            {
                _db.DeviceChecks.Add(new DeviceCheck
                {
                    ApplicationId = app.Id,
                    CheckKind = "DEVICE_MODEL_TAC",
                    Outcome = deviceCoherence == "MATCH" ? "PASSED" : "FAILED",
                    Details = JsonSerializer.Serialize(new { tac, deviceBrand = sessionEvidence.Brand, deviceModel = sessionEvidence.Model, tacModel = tacCatalog?.Model })
                });
            }
            // Aucune photo n'a permis de lire un numéro de modèle concordant : modèle non prouvé visuellement.
            if (!photoModelProven && usbImeiMatch != true)
            {
                _db.RiskEvents.Add(new RiskEvent
                {
                    ApplicationId = app.Id,
                    Code = "MODEL_NOT_CONFIRMED",
                    Severity = "WARNING",
                    Reason = "Aucune preuve que le téléphone photographié est le modèle de l’IMEI (numéro de modèle illisible sur les photos, IMEI non lu par USB). À vérifier : étiquette au dos, Réglages › À propos, ou *#06#."
                });
            }
            if (damages.Count > 0)
            {
                _db.RiskEvents.Add(new RiskEvent
                {
                    ApplicationId = app.Id,
                    Code = "PRE_EXISTING_DAMAGE",
                    Severity = "WARNING",
                    Reason = $"Dommages ou pannes constatés au moment de la souscription (photos / tests de fonctionnement) : {string.Join(", ", damages)}."
                });
            }
            if (photoBrandMismatch || photoModelMismatch)
            {
                _db.RiskEvents.Add(new RiskEvent
                {
                    ApplicationId = app.Id,
                    Code = photoBrandMismatch ? "PHOTO_BRAND_MISMATCH" : "PHOTO_MODEL_MISMATCH",
                    Severity = photoBrandMismatch ? "CRITICAL" : "WARNING",
                    Reason = photoBrandMismatch
                        ? "L’analyse visuelle voit une autre marque que l’appareil déclaré ; le client a confirmé qu’il s’agit de son téléphone."
                        : "L’analyse visuelle voit un autre modèle que l’appareil déclaré ; le client a confirmé qu’il s’agit de son téléphone."
                });
            }
            if (usbImeiMatch == false || deviceCoherence == "MISMATCH")
            {
                _db.RiskEvents.Add(new RiskEvent
                {
                    ApplicationId = app.Id,
                    Code = usbImeiMatch == false ? "USB_IMEI_MISMATCH" : "DEVICE_TAC_MISMATCH",
                    Severity = "CRITICAL",
                    Reason = usbImeiMatch == false
                        ? "L’IMEI déclaré ne correspond pas à l’IMEI lu sur l’appareil via USB."
                        : "La marque lue sur l’appareil ne correspond pas au TAC de l’IMEI déclaré."
                });
            }

            if (isDuplicate)
            {
                _db.RiskEvents.Add(new RiskEvent
                {
                    ApplicationId = app.Id,
                    Code = "DUPLICATE_IMEI",
                    Severity = "CRITICAL",
                    Reason = "Le numéro IMEI est déjà souscrit sur un dossier existant."
                });
            }

            // Initial audit log
            _db.ReviewLogs.Add(new ReviewLog
            {
                ApplicationId = app.Id,
                ReviewerId = "SYSTEM_AUTOMATION",
                Action = "DOSSIER_CREE",
                DecisionReason = $"Dossier reçu et initialisé. Confiance : {riskResult.ConfidenceLabel}."
            });

            await _db.SaveChangesAsync();

            return Ok(new
            {
                applicationId = app.Id,
                applicationRef = app.ApplicationRef,
                status = app.Status,
                statusLabel = app.Status == "PENDING_REVIEW" ? "À examiner" : "Pièces supplémentaires nécessaires",
                riskLevel = app.RiskLevel,
                confidenceScore = riskResult.Score,
                confidenceLabel = riskResult.ConfidenceLabel,
                maskedImei = masked,
                factors = riskResult.Factors,
                recommendations = riskResult.Recommendations,
                message = "Votre dossier a été transmis avec succès. Le numéro de suivi ci-dessus vous permet de suivre l'avancement."
            });
        }

        /// <summary>Suivi public par numéro de dossier : statut et contrôles, sans coordonnées ni preuves.</summary>
        [HttpGet("{idOrRef}")]
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("public-tracking")]
        public async Task<IActionResult> GetApplication(string idOrRef)
        {
            InsuranceApplication? app = null;
            if (Guid.TryParse(idOrRef, out var guid))
            {
                app = await _db.InsuranceApplications
                    .Include(a => a.Device)
                    .Include(a => a.Evidences)
                    .Include(a => a.Checks)
                    .Include(a => a.RiskEvents)
                    .Include(a => a.ReviewLogs)
                    .FirstOrDefaultAsync(a => a.Id == guid);
            }

            if (app == null)
            {
                app = await _db.InsuranceApplications
                    .Include(a => a.Device)
                    .Include(a => a.Evidences)
                    .Include(a => a.Checks)
                    .Include(a => a.RiskEvents)
                    .Include(a => a.ReviewLogs)
                    .FirstOrDefaultAsync(a => a.ApplicationRef == idOrRef);
            }

            if (app == null) return NotFound(new { message = "Dossier introuvable." });

            var fieldSources = await _db.DeviceFieldSources
                .Where(s => s.DeviceId == app.DeviceId)
                .ToListAsync();

            return Ok(new
            {
                applicationId = app.Id,
                applicationRef = app.ApplicationRef,
                clientName = MaskName(app.ClientName),
                status = app.Status,
                riskLevel = app.RiskLevel,
                verificationMode = app.VerificationMode,
                createdAt = app.CreatedAt,
                device = app.Device != null ? new
                {
                    brand = app.Device.Brand,
                    model = app.Device.Model,
                    tac = app.Device.Tac,
                    ram = app.Device.RamGb,
                    storage = app.Device.StorageGb,
                    batteryMah = app.Device.BatteryNominalMah,
                    sources = fieldSources.Select(fs => new
                    {
                        field = fs.FieldName,
                        source = fs.SourceType,
                        detail = fs.SourceRef,
                        confidence = fs.ConfidenceLevel
                    })
                } : null,
                evidences = app.Evidences.Select(e => new
                {
                    type = e.EvidenceType,
                    sha256 = e.Sha256Hash,
                    quality = e.QualityScore,
                    capturedAt = e.CapturedAt
                }),
                checks = app.Checks.Select(c => new
                {
                    kind = c.CheckKind,
                    outcome = c.Outcome,
                    createdAt = c.CreatedAt
                }),
                logs = app.ReviewLogs.OrderBy(l => l.CreatedAt).Select(l => new
                {
                    reviewer = l.ReviewerId == "SYSTEM_AUTOMATION" ? "Système" : "Gestionnaire",
                    action = l.Action,
                    reason = l.DecisionReason,
                    date = l.CreatedAt
                })
            });
        }
    }
}

