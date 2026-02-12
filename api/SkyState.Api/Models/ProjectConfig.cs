using System;

namespace SkyState.Api.Models;

public record ProjectConfig
{
    public Guid ProjectStateId { get; init; }  // KEEP this name -- matches DB column project_state_id via Dapper MatchNamesWithUnderscores
    public Guid ProjectId { get; init; }        // Direct FK to project
    public string Environment { get; init; } = "";  // 'development'|'staging'|'production'
    public int Major { get; init; }
    public int Minor { get; init; }
    public int Patch { get; init; }
    public string State { get; init; } = "";
    public string? Comment { get; init; }
    public DateTime CreatedAt { get; init; }
    public int StateSizeBytes { get; init; }

    public Version Version => new(Major, Minor, Patch);
}

public record CreateProjectConfig(int Major, int Minor, int Patch, string State, string? Comment = null)
{
    public Version Version => new(Major, Minor, Patch);
}
