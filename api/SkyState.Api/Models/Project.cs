using System;

namespace SkyState.Api.Models;

public record Project
{
    public Guid ProjectId { get; init; }
    public Guid UserId { get; init; }
    public string Name { get; init; } = "";
    public string Slug { get; init; } = "";
    public string ApiKeyHash { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateProject(string Name, string Slug, string ApiKeyHash);
public record UpdateProject(string Name, string ApiKeyHash);
