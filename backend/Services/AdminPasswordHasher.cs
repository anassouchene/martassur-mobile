using System;
using System.Security.Cryptography;
using System.Text;

namespace SmartAssur.Api.Services
{
    /// <summary>
    /// Format : pbkdf2_sha256$itérations$sel_base64$hash_base64 (reproduit par database/create_admin.py).
    /// </summary>
    public static class AdminPasswordHasher
    {
        private const int Iterations = 210_000;
        private const int SaltSize = 16;
        private const int HashSize = 32;

        // Hash factice : un identifiant inconnu coûte le même temps qu'un mauvais mot de passe.
        private static readonly string DummyHash = Hash("smartassur-dummy-password");

        public static string Hash(string password)
        {
            var salt = RandomNumberGenerator.GetBytes(SaltSize);
            var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, HashSize);
            return $"pbkdf2_sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
        }

        public static bool Verify(string password, string? storedHash)
        {
            var parts = (storedHash ?? DummyHash).Split('$');
            if (parts.Length != 4 || parts[0] != "pbkdf2_sha256" || !int.TryParse(parts[1], out var iterations)) return false;
            try
            {
                var salt = Convert.FromBase64String(parts[2]);
                var expected = Convert.FromBase64String(parts[3]);
                var actual = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
                return CryptographicOperations.FixedTimeEquals(actual, expected) && storedHash != null;
            }
            catch (FormatException)
            {
                return false;
            }
        }
    }
}
