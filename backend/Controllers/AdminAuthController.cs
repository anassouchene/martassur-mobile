using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SmartAssur.Api.Data;
using SmartAssur.Api.Services;

namespace SmartAssur.Api.Controllers
{
    [ApiController]
    [Route("api/admin/auth")]
    public class AdminAuthController : ControllerBase
    {
        private readonly SmartAssurDbContext _db;
        private readonly ILogger<AdminAuthController> _logger;

        public AdminAuthController(SmartAssurDbContext db, ILogger<AdminAuthController> logger)
        {
            _db = db;
            _logger = logger;
        }

        public record LoginRequest(string? Username, string? Password);

        [HttpPost("login")]
        [AllowAnonymous]
        [EnableRateLimiting("admin-login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest req)
        {
            var username = (req.Username ?? "").Trim().ToLowerInvariant();
            var password = req.Password ?? "";
            var user = username.Length == 0 ? null : await _db.AdminUsers.FirstOrDefaultAsync(u => u.Username == username);

            // Vérification toujours exécutée (hash factice si compte inconnu) pour ne pas révéler les identifiants valides.
            bool passwordOk = AdminPasswordHasher.Verify(password, user?.PasswordHash);
            if (user == null || !user.IsActive || !passwordOk)
            {
                _logger.LogWarning("Échec de connexion gestionnaire pour {Username} depuis {Ip}", username, ClientIp.Resolve(HttpContext));
                return Unauthorized(new { message = "Identifiant ou mot de passe incorrect." });
            }

            user.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.Username),
                new("display_name", user.DisplayName),
                new(ClaimTypes.Role, user.Role),
            };
            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);

            return Ok(new { username = user.Username, displayName = user.DisplayName, role = user.Role });
        }

        [HttpPost("logout")]
        [AllowAnonymous]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Ok(new { message = "Déconnecté." });
        }

        [HttpGet("me")]
        [Authorize]
        public IActionResult Me() => Ok(new
        {
            username = User.Identity?.Name,
            displayName = User.FindFirstValue("display_name"),
            role = User.FindFirstValue(ClaimTypes.Role)
        });
    }
}
