namespace SkyState.Api.Models;

/// <summary>
/// Discriminated union for API request metering decisions.
/// Returned by MeteringService.MeterAsync to indicate whether a request should be served or blocked.
/// </summary>
public abstract record MeterResult
{
    /// <summary>Request counted and within limit (including grace zone 100-110%), or unlimited.</summary>
    public sealed record Ok(int NewCount, int? EffectiveLimit, string Tier = "free") : MeterResult;

    /// <summary>Request count exceeds 110% of effective limit. Caller returns 429.</summary>
    public sealed record OverLimit(int NewCount, int EffectiveLimit) : MeterResult;

    /// <summary>Project slug unknown. Counter was NOT incremented.</summary>
    public sealed record NotFound() : MeterResult;

    /// <summary>Infrastructure failure. Counter state unknown. Caller should fail open.</summary>
    public sealed record Error() : MeterResult;
}
