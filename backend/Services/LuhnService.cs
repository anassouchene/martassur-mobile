using System;
using System.Security.Cryptography;
using System.Text;

namespace SmartAssur.Api.Services
{
    public interface ILuhnService
    {
        bool ValidateLuhn(string imei);
        string ExtractTac(string imei);
        string ComputeHmacIndex(string imei);
        string MaskImei(string imei);
    }

    public class LuhnService : ILuhnService
    {
        // Clé de l'index anti-doublon : la changer rend méconnaissables les IMEI déjà enregistrés.
        private readonly string HmacKey;

        public LuhnService(Microsoft.Extensions.Configuration.IConfiguration configuration)
        {
            HmacKey = configuration["Security:ImeiHmacKey"] is { Length: >= 16 } key
                ? key
                : throw new InvalidOperationException("Security:ImeiHmacKey manquant : renseignez appsettings.Local.json.");
        }

        public bool ValidateLuhn(string imei)
        {
            if (string.IsNullOrWhiteSpace(imei)) return false;
            imei = imei.Replace(" ", "").Replace("-", "");

            if (imei.Length != 15 || !long.TryParse(imei, out _)) return false;

            int sum = 0;
            for (int i = 0; i < 15; i++)
            {
                int digit = imei[i] - '0';
                // For odd positions (0-indexed 1, 3, 5, 7, 9, 11, 13), double the digit
                if (i % 2 == 1)
                {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
            }

            return (sum % 10 == 0);
        }

        public string ExtractTac(string imei)
        {
            if (string.IsNullOrWhiteSpace(imei)) return string.Empty;
            imei = imei.Replace(" ", "").Replace("-", "");
            return imei.Length >= 8 ? imei.Substring(0, 8) : string.Empty;
        }

        public string ComputeHmacIndex(string imei)
        {
            if (string.IsNullOrWhiteSpace(imei)) return string.Empty;
            imei = imei.Replace(" ", "").Replace("-", "");

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(HmacKey));
            byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(imei));
            return Convert.ToHexString(hash).ToLowerInvariant();
        }

        public string MaskImei(string imei)
        {
            if (string.IsNullOrWhiteSpace(imei)) return "***************";
            imei = imei.Replace(" ", "").Replace("-", "");
            if (imei.Length < 15) return imei;
            return $"{imei.Substring(0, 2)}************{imei.Substring(14, 1)}";
        }
    }
}

