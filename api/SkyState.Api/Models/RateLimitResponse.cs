namespace SkyState.Api.Models;

/// <summary>
/// Structured response body for 429 rate limit exceeded responses.
/// </summary>
public record RateLimitResponse(
    string Code,
    string Message,
    int Limit,
    int Current,
    string ResetAt,
    string UpgradeUrl);
