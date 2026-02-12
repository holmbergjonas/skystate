namespace SkyState.Api.Models;

/// <summary>
/// Configurable thresholds for API request metering enforcement.
/// Bound from appsettings.json "MeteringSettings" section.
/// </summary>
public class MeteringSettings
{
    /// <summary>Fraction of limit at which warning zone begins. Default: 1.0 (100%).</summary>
    public double WarningThresholdMultiplier { get; set; } = 1.0;

    /// <summary>Fraction of limit above which requests are hard-blocked. Default: 1.1 (110%).</summary>
    public double BlockThresholdMultiplier { get; set; } = 1.1;
}
