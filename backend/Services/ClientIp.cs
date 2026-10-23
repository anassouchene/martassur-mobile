using Microsoft.AspNetCore.Http;

namespace SmartAssur.Api.Services
{
    /// <summary>
    /// IP du visiteur derrière Cloudflare → Next.js → API (le port 5050 n'est joignable qu'en local).
    /// </summary>
    public static class ClientIp
    {
        public static string Resolve(HttpContext context)
        {
            var cf = context.Request.Headers["CF-Connecting-IP"].ToString();
            if (!string.IsNullOrWhiteSpace(cf)) return cf.Trim();
            var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
            if (!string.IsNullOrWhiteSpace(forwarded)) return forwarded.Split(',')[0].Trim();
            return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        }
    }
}
