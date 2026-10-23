using System;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Data;
using SmartAssur.Api.Models;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/admin")]
    [Authorize]
    public class AdminController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly IDataProtector _imeiProtector;
        private readonly ILuhnService _luhnService;

        public AdminController(SmartAssurDbContext db, IDataProtectionProvider protectionProvider, ILuhnService luhnService)
        {
            _db = db;
            _imeiProtector = protectionProvider.CreateProtector("SmartAssur.Mobile.IMEI.v1");
            _luhnService = luhnService;
        }

        public record ReviewDecisionRequest(
            string Action, // APPROVED, REJECTED, MORE_DOCS_NEEDED
            string? DecisionReason
        );

        private static int? ParseScore(string? notes)
        {
            var match = Regex.Match(notes ?? "", @"Score initial : (\d+)/100");
            return match.Success ? int.Parse(match.Groups[1].Value) : null;
        }

        private static object? ParseJson(string? json)
        {
            try { return string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json); }
            catch (JsonException) { return null; }
        }

        private string ReviewerName => User.FindFirstValue("display_name") is { Length: > 0 } name
            ? $"{name} ({User.Identity?.Name})"
            : User.Identity?.Name ?? "GESTIONNAIRE";

        [HttpGet("insurance-applications")]
        public async Task<IActionResult> ListApplications([FromQuery] string? status, [FromQuery] string? riskLevel)
        {
            var query = _db.InsuranceApplications
                .Include(a => a.Device)
                .Include(a => a.Evidences)
                .Include(a => a.RiskEvents)
                .AsQueryable();

            if (!string.IsNullOrEmpty(status))
            {
                query = query.Where(a => a.Status == status);
            }
            if (!string.IsNullOrEmpty(riskLevel))
            {
                query = query.Where(a => a.RiskLevel == riskLevel);
            }

            var list = await query
                .OrderByDescending(a => a.CreatedAt)
                .Select(a => new
                {
                    id = a.Id,
                    applicationRef = a.ApplicationRef,
                    clientName = a.ClientName,
                    clientEmail = a.ClientEmail,
                    clientPhone = a.ClientPhone,
                    status = a.Status,
                    riskLevel = a.RiskLevel,
                    verificationMode = a.VerificationMode,
                    device = a.Device != null ? $"{a.Device.Brand} {a.Device.Model} ({a.Device.StorageGb})" : "N/A",
                    tac = a.Device != null ? a.Device.Tac : null,
                    evidenceCount = a.Evidences.Count,
                    riskEventCodes = a.RiskEvents.Select(r => r.Code).ToList(),
                    notes = a.Notes,
                    createdAt = a.CreatedAt,
                    updatedAt = a.UpdatedAt
                })
                .ToListAsync();

            return Ok(list.Select(a => new
            {
                a.id, a.applicationRef, a.clientName, a.clientEmail, a.clientPhone, a.status, a.riskLevel,
                a.verificationMode, a.device, a.tac, a.evidenceCount, a.riskEventCodes, a.createdAt, a.updatedAt,
                score = ParseScore(a.notes)
            }));
        }

        [HttpGet("insurance-applications/{id:guid}")]
        public async Task<IActionResult> GetApplicationDetail(Guid id)
        {
            var app = await _db.InsuranceApplications
                .AsNoTracking()
                .Include(a => a.Device)
                .Include(a => a.Evidences)
                .Include(a => a.Checks)
                .Include(a => a.RiskEvents)
                .Include(a => a.ReviewLogs)
                .FirstOrDefaultAsync(a => a.Id == id);
            if (app == null) return NotFound(new { message = "Dossier introuvable." });

            var fieldSources = await _db.DeviceFieldSources.AsNoTracking().Where(s => s.DeviceId == app.DeviceId).ToListAsync();

            string? imei = null;
            if (app.Device != null)
            {
                try { imei = _imeiProtector.Unprotect(app.Device.ImeiEncrypted); }
                catch (System.Security.Cryptography.CryptographicException) { imei = null; }
            }

            // Diagnostic de la session (USB ou navigateur), sans les empreintes IMEI ni le code de défi.
            object? sessionInfo = null;
            if (app.SessionId.HasValue)
            {
                var session = await _db.InsuranceSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == app.SessionId.Value);
                if (session != null)
                {
                    JsonNode? paired = null;
                    try { paired = JsonNode.Parse(string.IsNullOrWhiteSpace(session.PairedDeviceInfo) ? "{}" : session.PairedDeviceInfo); }
                    catch (JsonException) { }
                    if (paired is JsonObject obj)
                    {
                        obj.Remove("usbImeiHmacs");
                        (obj["scan"] as JsonObject)?.Remove("imeiHmacs");
                        obj.Remove("challengeCode");
                    }
                    sessionInfo = new
                    {
                        deviceType = session.DeviceType,
                        status = session.Status,
                        createdAt = session.CreatedAt,
                        paired
                    };
                }
            }

            int? duplicateCount = null;
            if (app.Device != null)
            {
                duplicateCount = await _db.MobileDevices.CountAsync(d => d.ImeiHmacIndex == app.Device.ImeiHmacIndex && d.Id != app.Device.Id);
            }

            return Ok(new
            {
                id = app.Id,
                applicationRef = app.ApplicationRef,
                clientName = app.ClientName,
                clientEmail = app.ClientEmail,
                clientPhone = app.ClientPhone,
                status = app.Status,
                riskLevel = app.RiskLevel,
                score = ParseScore(app.Notes),
                notes = app.Notes,
                verificationMode = app.VerificationMode,
                consentCndp = app.ConsentCndp,
                createdAt = app.CreatedAt,
                updatedAt = app.UpdatedAt,
                device = app.Device == null ? null : new
                {
                    brand = app.Device.Brand,
                    model = app.Device.Model,
                    tac = app.Device.Tac,
                    imei,
                    maskedImei = imei != null ? _luhnService.MaskImei(imei) : null,
                    ram = app.Device.RamGb,
                    storage = app.Device.StorageGb,
                    batteryMah = app.Device.BatteryNominalMah,
                    otherApplicationsWithSameImei = duplicateCount,
                    sources = fieldSources.Select(fs => new { field = fs.FieldName, source = fs.SourceType, detail = fs.SourceRef, confidence = fs.ConfidenceLevel })
                },
                evidences = app.Evidences.OrderBy(e => e.EvidenceType).Select(e => new
                {
                    id = e.Id,
                    type = e.EvidenceType,
                    sha256 = e.Sha256Hash,
                    mimeType = e.MimeType,
                    fileSize = e.FileSize,
                    quality = e.QualityScore,
                    qualityFlags = ParseJson(e.QualityFlags),
                    source = e.Source,
                    capturedAt = e.CapturedAt,
                    previewUrl = $"/api/evidence/{e.Id}/preview"
                }),
                checks = app.Checks.OrderBy(c => c.CreatedAt).Select(c => new { kind = c.CheckKind, outcome = c.Outcome, details = ParseJson(c.Details), createdAt = c.CreatedAt }),
                riskEvents = app.RiskEvents.OrderBy(r => r.CreatedAt).Select(r => new { code = r.Code, severity = r.Severity, reason = r.Reason, createdAt = r.CreatedAt }),
                logs = app.ReviewLogs.OrderBy(l => l.CreatedAt).Select(l => new { reviewer = l.ReviewerId, action = l.Action, reason = l.DecisionReason, date = l.CreatedAt }),
                session = sessionInfo
            });
        }

        [HttpGet("stats")]
        public async Task<IActionResult> GetStats()
        {
            int total = await _db.InsuranceApplications.CountAsync();
            int pending = await _db.InsuranceApplications.CountAsync(a => a.Status == "PENDING_REVIEW");
            int approved = await _db.InsuranceApplications.CountAsync(a => a.Status == "APPROVED");
            int rejected = await _db.InsuranceApplications.CountAsync(a => a.Status == "REJECTED");
            int moreDocs = await _db.InsuranceApplications.CountAsync(a => a.Status == "MORE_DOCS_NEEDED");

            var byRisk = await _db.InsuranceApplications.GroupBy(a => a.RiskLevel).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync();
            var byMode = await _db.InsuranceApplications.GroupBy(a => a.VerificationMode).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync();
            var riskEvents = await _db.RiskEvents.GroupBy(r => r.Code).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync();
            var imeiUsbChecks = await _db.DeviceChecks.Where(c => c.CheckKind == "IMEI_USB_READ").GroupBy(c => c.Outcome).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync();

            // Volume quotidien sur 30 jours (heure de Casablanca).
            var casablanca = TimeZoneInfo.FindSystemTimeZoneById("Africa/Casablanca");
            var since = DateTime.UtcNow.AddDays(-30);
            var recentDates = await _db.InsuranceApplications.Where(a => a.CreatedAt >= since).Select(a => a.CreatedAt).ToListAsync();
            var today = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, casablanca).Date;
            var daily = Enumerable.Range(0, 30)
                .Select(offset => today.AddDays(offset - 29))
                .Select(day => new
                {
                    date = day.ToString("yyyy-MM-dd"),
                    count = recentDates.Count(d => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(d, DateTimeKind.Utc), casablanca).Date == day)
                });

            // Délai moyen entre le dépôt et la première décision humaine.
            var firstDecisions = await _db.ReviewLogs
                .Where(l => l.ReviewerId != "SYSTEM_AUTOMATION")
                .GroupBy(l => l.ApplicationId)
                .Select(g => new { applicationId = g.Key, decidedAt = g.Min(l => l.CreatedAt) })
                .Join(_db.InsuranceApplications, d => d.applicationId, a => a.Id, (d, a) => new { d.decidedAt, a.CreatedAt })
                .ToListAsync();
            double? avgDecisionHours = firstDecisions.Count == 0 ? null : Math.Round(firstDecisions.Average(d => (d.decidedAt - d.CreatedAt).TotalHours), 1);

            var notes = await _db.InsuranceApplications.Select(a => a.Notes).ToListAsync();
            var scores = notes.Select(ParseScore).Where(s => s.HasValue).Select(s => s!.Value).ToList();

            return Ok(new
            {
                total,
                pending,
                approved,
                rejected,
                moreDocs,
                byRisk,
                byMode,
                riskEvents,
                imeiUsbChecks,
                daily,
                avgDecisionHours,
                avgScore = scores.Count == 0 ? (double?)null : Math.Round(scores.Average(), 0)
            });
        }

        /// <summary>Historique global : dernières actions (dépôts automatiques et décisions des gestionnaires).</summary>
        [HttpGet("activity")]
        public async Task<IActionResult> GetActivity([FromQuery] int limit = 30)
        {
            limit = Math.Clamp(limit, 1, 200);
            var activity = await _db.ReviewLogs
                .OrderByDescending(l => l.CreatedAt)
                .Take(limit)
                .Join(_db.InsuranceApplications, l => l.ApplicationId, a => a.Id, (l, a) => new
                {
                    applicationId = a.Id,
                    applicationRef = a.ApplicationRef,
                    clientName = a.ClientName,
                    reviewer = l.ReviewerId,
                    action = l.Action,
                    reason = l.DecisionReason,
                    date = l.CreatedAt
                })
                .OrderByDescending(x => x.date)
                .ToListAsync();
            return Ok(activity);
        }

        [HttpPatch("insurance-applications/{id}/review")]
        public async Task<IActionResult> ReviewApplication(Guid id, [FromBody] ReviewDecisionRequest req)
        {
            var app = await _db.InsuranceApplications
                .Include(a => a.ReviewLogs)
                .FirstOrDefaultAsync(a => a.Id == id);

            if (app == null) return NotFound(new { message = "Dossier introuvable." });

            string? newStatus = (req.Action ?? "").ToUpperInvariant() switch
            {
                "APPROVED" => "APPROVED",
                "REJECTED" => "REJECTED",
                "MORE_DOCS_NEEDED" => "MORE_DOCS_NEEDED",
                _ => null
            };
            if (newStatus == null) return BadRequest(new { message = "Décision non reconnue." });

            app.Status = newStatus;
            app.UpdatedAt = DateTime.UtcNow;

            // Le gestionnaire est celui de la session authentifiée, jamais une valeur envoyée par le client.
            _db.ReviewLogs.Add(new ReviewLog
            {
                ApplicationId = app.Id,
                ReviewerId = ReviewerName.Length > 100 ? ReviewerName[..100] : ReviewerName,
                Action = newStatus,
                DecisionReason = string.IsNullOrWhiteSpace(req.DecisionReason) ? "Action opérée par le gestionnaire." : req.DecisionReason.Trim(),
                CreatedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync();

            return Ok(new
            {
                message = "Décision enregistrée avec succès.",
                applicationId = app.Id,
                status = app.Status,
                updatedAt = app.UpdatedAt
            });
        }
    }
}
