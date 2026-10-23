using System.IO;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using SmartAssur.Api.Data;
using SmartAssur.Api.Hubs;
using SmartAssur.Api.Services;

var builder = WebApplication.CreateBuilder(args);
// Secrets (mot de passe base, clé HMAC IMEI) : appsettings.Local.json, hors git (voir appsettings.Local.example.json).
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    // Swashbuckle 6 cannot safely infer this multipart endpoint; the runtime API remains available.
    options.DocInclusionPredicate((_, description) =>
        !string.Equals(description.RelativePath, "api/evidence/upload", System.StringComparison.OrdinalIgnoreCase));
});
builder.Services.AddDataProtection();

// Espace gestionnaire : cookie de session HttpOnly, réservé au domaine du site.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "smartassur_admin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        // API JSON : pas de redirection vers une page de login.
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // 5 tentatives de connexion par minute et par IP.
    options.AddPolicy("admin-login", context => RateLimitPartition.GetFixedWindowLimiter(
        ClientIp.Resolve(context),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Scan d'identité (Antigravity, ~10 s par photo) : 10 par minute et par IP.
    options.AddPolicy("device-scan", context => RateLimitPartition.GetFixedWindowLimiter(
        ClientIp.Resolve(context),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Suivi public par référence : freine l'énumération des numéros de dossier.
    options.AddPolicy("public-tracking", context => RateLimitPartition.GetFixedWindowLimiter(
        ClientIp.Resolve(context),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// SignalR for live session pairing
builder.Services.AddSignalR();

// Database Context (PostgreSQL)
builder.Services.AddDbContext<SmartAssurDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("SmartAssurDb")));

// Application Services
builder.Services.AddScoped<ILuhnService, LuhnService>();
builder.Services.AddScoped<IRiskEngineService, RiskEngineService>();
builder.Services.AddHttpClient<IAntigravityVisionService, AntigravityVisionService>(client =>
{
    client.BaseAddress = new Uri("http://127.0.0.1:5060/");
    client.Timeout = TimeSpan.FromSeconds(90);
});

// CORS configuration (allow frontend Next.js dev & prod)
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAllOrigins", policy =>
    {
        // Le navigateur passe par le proxy Next (même origine) ; seules ces origines sont acceptées en direct.
        policy.WithOrigins("https://smartassur.kooralink.ma", "https://smartassur.assurport.com", "http://localhost:3050")
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment() || true)
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "SmartAssur Mobile API v3");
        c.RoutePrefix = "swagger";
    });
}

app.UseCors("AllowAllOrigins");

// Private upload directory. Files are only returned through controlled API endpoints.
var storagePath = Path.Combine(Directory.GetCurrentDirectory(), "storage", "uploads");
if (!Directory.Exists(storagePath))
{
    Directory.CreateDirectory(storagePath);
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<SessionHub>("/hubs/session");

app.Run();
