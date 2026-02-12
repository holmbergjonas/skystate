using System.Collections.Generic;

namespace SkyState.Api.Models;

public class TierSettings
{
    public Dictionary<string, TierLimitConfig> Tiers { get; set; } = new(System.StringComparer.OrdinalIgnoreCase);
}

public class TierLimitConfig
{
    /// <summary>Max projects a user can create. Null = unlimited.</summary>
    public int? MaxProjects { get; set; }

    /// <summary>Max total environments across all projects. Null = unlimited.</summary>
    public int? MaxEnvironments { get; set; }

    /// <summary>Max total storage in bytes across all versions. Null = unlimited.</summary>
    public long? MaxStorageBytes { get; set; }

    /// <summary>Version retention in days. Null = unlimited (no pruning).</summary>
    public int? RetentionDays { get; set; }

    /// <summary>Max API requests per calendar month. Null = unlimited.</summary>
    public int? MaxApiRequestsPerMonth { get; set; }
}
