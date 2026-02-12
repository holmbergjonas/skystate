using System;

namespace SkyState.Api.Models;

public record BillingStatusResponse(
    string Tier,
    int BoostMultiplier,
    ResourceUsage Projects,
    ResourceUsage Environments,
    StorageUsage Storage,
    int? RetentionDays,
    int? CustomRetentionDays,
    DateTime? CurrentPeriodEnd,
    string[] OverLimit,
    ApiRequestUsage ApiRequests,
    string? LastStripeError
);

public record ResourceUsage(int Count, int? Limit);
public record StorageUsage(long Bytes, long? Limit);
public record ApiRequestUsage(int Count, int? Limit, DateTime ResetDate);
