using System;

namespace SkyState.Api.Models;

public record User
{
    public Guid UserId { get; init; }
    public string SsoProvider { get; init; } = "";
    public string SsoUserId { get; init; } = "";
    public string? Email { get; init; }
    public string? DisplayName { get; init; }
    public string? AvatarUrl { get; init; }
    public string? StripeUserId { get; init; }
    public string SubscriptionTier { get; init; } = "free";
    public int BoostMultiplier { get; init; } = 1;
    public DateTime? PaymentFailedAt { get; init; }
    public DateTime? CurrentPeriodEnd { get; init; }
    public string? StripeSubscriptionId { get; init; }
    public string? LastStripeError { get; init; }
    public int? CustomRetentionDays { get; init; }
    public DateTime? LastLoginAt { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateUser(
    string SsoProvider,
    string SsoUserId,
    string? Email = null,
    string? DisplayName = null,
    string? AvatarUrl = null,
    string? StripeUserId = null
);

public record UpdateUser(
    string? DisplayName,
    string? AvatarUrl
);
