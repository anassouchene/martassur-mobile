using System.Net.Http.Json;
using System.Text.Json;

namespace SmartAssur.Api.Services;

public record AntigravityAssessment(string Status, bool Accepted, string? Provider, JsonElement? Result, string? Reason, string? RejectionCode = null);

public interface IAntigravityVisionService
{
    Task<AntigravityAssessment> EvaluateAsync(string path, string side, string? brand, string? model, CancellationToken cancellationToken);
    /// <summary>Lecture de l'identité (IMEI, modèle, capacités) sur une boîte, un écran *#06#, une facture…</summary>
    Task<JsonElement?> ExtractAsync(string path, CancellationToken cancellationToken);
}

public sealed class AntigravityVisionService : IAntigravityVisionService
{
    private readonly HttpClient _client;
    public AntigravityVisionService(HttpClient client) => _client = client;

    public async Task<AntigravityAssessment> EvaluateAsync(string path, string side, string? brand, string? model, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _client.PostAsJsonAsync("evaluate", new { path, side, brand, model }, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
            return new AntigravityAssessment(
                payload.TryGetProperty("status", out var status) ? status.GetString() ?? "ERROR" : "ERROR",
                payload.TryGetProperty("accepted", out var accepted) && accepted.GetBoolean(),
                payload.TryGetProperty("provider", out var provider) ? provider.GetString() : null,
                payload.TryGetProperty("result", out var result) ? result.Clone() : null,
                payload.TryGetProperty("reason", out var reason) ? reason.GetString() : null,
                payload.TryGetProperty("rejection_code", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null);
        }
        catch (Exception error)
        {
            return new AntigravityAssessment("UNAVAILABLE", false, null, null, error.Message);
        }
    }

    public async Task<JsonElement?> ExtractAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _client.PostAsJsonAsync("extract", new { path }, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
            return payload.TryGetProperty("status", out var status) && status.GetString() == "EXTRACTED" && payload.TryGetProperty("result", out var result)
                ? result.Clone()
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
