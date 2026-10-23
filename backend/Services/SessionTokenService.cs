using System;
using System.Security.Cryptography;
using System.Text;

namespace SmartAssur.Api.Services
{
    public static class SessionTokenService
    {
        public static string Hash(string token) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
    }
}
