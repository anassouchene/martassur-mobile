using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Data;
using SmartAssur.Api.Hubs;
using SmartAssur.Api.Models;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/insurance-sessions")]
    public class InsuranceSessionsController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly IHubContext<SessionHub> _hubContext;

        public InsuranceSessionsController(SmartAssurDbContext db, IHubContext<SessionHub> hubContext)
        {
            _db = db;
            _hubContext = hubContext;
        }

        public record CreateSessionRequest(string? DeviceType, string? UserAgent);
        public record FunctionalTestsRequest(string? ChallengeCode, JsonElement Report);
        public record PairSessionRequest(string? ChallengeCode, string? DeviceModel, string? Os, string? Browser, string? ScreenResolution, double? BatteryLevel, JsonElement? Diagnostic);

        // Robots qui exécutent les pages (lecture vocale Google, aperçus de liens, scanners de sécurité…) :
        // ils ne doivent jamais consommer la session à usage unique destinée au téléphone.
        private static readonly System.Text.RegularExpressions.Regex BotUserAgent = new(
            @"[a-z]bot/|\(compatible;[^)]*\+?https?://|crawl|spider|slurp|Google-Read-Aloud|Googlebot|Google-InspectionTool|HeadlessChrome|PhantomJS|facebookexternalhit|WhatsApp|TelegramBot|Slackbot|Discordbot|Lighthouse|Chrome-Lighthouse|Bingbot|BingPreview|SkypeUriPreview|Applebot|YandexBot|Baiduspider|python-requests|curl/|wget/",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

        private static string HashValue(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

        [HttpPost]
        public async Task<IActionResult> CreateSession([FromBody] CreateSessionRequest? req)
        {
            var rawBytes = new byte[24];
            RandomNumberGenerator.Fill(rawBytes);
            string token = Convert.ToHexString(rawBytes).ToLowerInvariant();

            string challengeCode = RandomNumberGenerator.GetInt32(1000, 10000).ToString();
            string nonceHash = HashValue(challengeCode);

            var session = new InsuranceSession
            {
                Id = Guid.NewGuid(),
                SessionToken = SessionTokenService.Hash(token),
                NonceHash = nonceHash,
                DeviceType = req?.DeviceType ?? "desktop",
                Status = "PENDING",
                UserAgent = req?.UserAgent ?? Request.Headers["User-Agent"].ToString(),
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
                ExpiresAt = DateTime.UtcNow.AddMinutes(15),
                CreatedAt = DateTime.UtcNow
            };

            _db.InsuranceSessions.Add(session);
            await _db.SaveChangesAsync();

            // Direct pairing link and challenge code
            string pairUrl = $"/verify?session={token}&code={challengeCode}";

            return Ok(new
            {
                sessionId = session.Id,
                sessionToken = token,
                challengeCode = challengeCode,
                pairUrl = pairUrl,
                expiresAt = session.ExpiresAt,
                status = session.Status
            });
        }

        [HttpGet("{token}")]
        public async Task<IActionResult> GetSession(string token)
        {
            var tokenHash = SessionTokenService.Hash(token);
            var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == tokenHash);
            if (session == null) return NotFound(new { message = "Session introuvable ou expirée." });

            bool isExpired = DateTime.UtcNow > session.ExpiresAt;
            if (isExpired && session.Status == "PENDING")
            {
                session.Status = "EXPIRED";
                await _db.SaveChangesAsync();
            }

            return Ok(new
            {
                sessionId = session.Id,
                deviceType = session.DeviceType,
                status = session.Status,
                isExpired = isExpired,
                pairedDeviceInfo = JsonSerializer.Deserialize<object>(session.PairedDeviceInfo),
                createdAt = session.CreatedAt,
                expiresAt = session.ExpiresAt
            });
        }

        /// <summary>
        /// Rapport des tests de fonctionnement lancés sur le téléphone (caméras, micro, haut-parleur, capteurs, tactile).
        /// Même preuve que l'appairage : jeton de session + code de défi du QR.
        /// </summary>
        [HttpPost("{token}/functional-tests")]
        [RequestSizeLimit(64 * 1024)]
        public async Task<IActionResult> SaveFunctionalTests(string token, [FromBody] FunctionalTestsRequest req)
        {
            if (BotUserAgent.IsMatch(Request.Headers["User-Agent"].ToString()))
                return StatusCode(StatusCodes.Status403Forbidden, new { code = "BOT", message = "Non autorisé." });
            var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == SessionTokenService.Hash(token));
            if (session == null) return NotFound(new { message = "Session introuvable." });
            if (string.IsNullOrWhiteSpace(req.ChallengeCode) ||
                !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(session.NonceHash), Convert.FromHexString(HashValue(req.ChallengeCode))))
                return BadRequest(new { message = "Code de session invalide." });
            // QR scanné (PAIRED) ou téléphone branché en USB (USB_CONNECTED) : les tests complètent le diagnostic.
            if (session.Status is not ("PAIRED" or "USB_CONNECTED")) return Conflict(new { message = "Le téléphone doit d’abord être associé à la demande." });
            // Les tests suivent l'appairage : 30 minutes de marge après l'expiration du QR.
            if (DateTime.UtcNow > session.ExpiresAt.AddMinutes(30)) return BadRequest(new { message = "Session expirée : rescannez le QR code." });
            if (req.Report.ValueKind != JsonValueKind.Object || !req.Report.TryGetProperty("tests", out var tests) || tests.ValueKind != JsonValueKind.Array)
                return BadRequest(new { message = "Rapport de diagnostic invalide." });

            JsonNode? info = null;
            try { info = JsonNode.Parse(string.IsNullOrWhiteSpace(session.PairedDeviceInfo) ? "{}" : session.PairedDeviceInfo); } catch (JsonException) { }
            var root = info as JsonObject ?? new JsonObject();
            root["functionalTests"] = JsonNode.Parse(req.Report.GetRawText());
            session.PairedDeviceInfo = root.ToJsonString();
            await _db.SaveChangesAsync();

            await _hubContext.Clients.Group(token).SendAsync("FunctionalTestsReady", new { sessionToken = token });
            return Ok(new { message = "Résultats du diagnostic enregistrés." });
        }

        [HttpPost("{token}/pair")]
        public async Task<IActionResult> PairSession(string token, [FromBody] PairSessionRequest req)
        {
            var tokenHash = SessionTokenService.Hash(token);
            var session = await _db.InsuranceSessions.FirstOrDefaultAsync(s => s.SessionToken == tokenHash);
            if (session == null) return NotFound(new { message = "Session introuvable." });

            if (DateTime.UtcNow > session.ExpiresAt)
            {
                session.Status = "EXPIRED";
                await _db.SaveChangesAsync();
                return BadRequest(new { message = "La session a expiré. Veuillez relancer la demande." });
            }

            var userAgent = Request.Headers["User-Agent"].ToString();
            if (BotUserAgent.IsMatch(userAgent) || BotUserAgent.IsMatch(req.Browser ?? ""))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { code = "BOT", message = "Ouvrez ce lien avec l’appareil photo de votre téléphone." });
            }

            if (session.Status != "PENDING")
            {
                return Conflict(new { message = "Cette session a déjà été utilisée. Régénérez un nouveau QR code." });
            }

            if (string.IsNullOrWhiteSpace(req.ChallengeCode) ||
                !CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(session.NonceHash),
                    Convert.FromHexString(HashValue(req.ChallengeCode))))
            {
                return BadRequest(new { message = "Code de session invalide." });
            }

            session.Status = "PAIRED";
            // camelCase comme les réponses API ; le code de défi n'a pas à être conservé.
            session.PairedDeviceInfo = JsonSerializer.Serialize(req with { ChallengeCode = null }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await _db.SaveChangesAsync();

            // Real-time broadcast to desktop browser via SignalR
            await _hubContext.Clients.Group(token).SendAsync("PhonePaired", new
            {
                sessionToken = token,
                device = req with { ChallengeCode = null },
                pairedAt = DateTime.UtcNow
            });

            return Ok(new
            {
                message = "Téléphone associé avec succès à la session.",
                status = session.Status,
                sessionId = session.Id
            });
        }
    }
}

