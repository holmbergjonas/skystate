using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

public interface IBillingService
{
    Task<ServiceResult<BillingStatusResponse>> GetStatusAsync(Guid userId);

    /// <summary>Check*LimitAsync methods return ServiceResult.OverLimit with structured LimitResponse (not string).</summary>
    Task<ServiceResult<bool>> CheckProjectLimitAsync(Guid userId);
    Task<ServiceResult<bool>> CheckEnvironmentLimitAsync(Guid userId, Guid projectId);
    Task<ServiceResult<bool>> CheckStorageLimitAsync(Guid userId);

    /// <summary>Returns the computed effective limit (base * boost), or null for unlimited / grace period.</summary>
    Task<int?> GetEffectiveProjectLimitAsync(Guid userId);
    Task<int?> GetEffectiveEnvironmentLimitAsync(Guid userId);
}

public class BillingService(
    IUserRepository userRepo,
    IProjectRepository projectRepo,
    IProjectConfigRepository configRepo,
    IApiRequestCounterRepository counterRepo,
    IOptions<TierSettings> tierSettings,
    ILogger<BillingService> logger) : IBillingService
{
    private static readonly TimeSpan GracePeriod = TimeSpan.FromDays(7);

    public async Task<ServiceResult<BillingStatusResponse>> GetStatusAsync(Guid userId)
    {
        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
        {
            logger.LogWarning("Billing status: user {UserId} not found", userId);
            return new ServiceResult<BillingStatusResponse>.NotFound();
        }

        logger.LogInformation("Billing status for user {UserId}: tier={Tier}, boost={Boost}, stripeCustomerId={StripeCustomerId}",
            userId, user.SubscriptionTier, user.BoostMultiplier, user.StripeUserId ?? "(none)");

        var config = GetTierConfig(user.SubscriptionTier);
        var boost = user.BoostMultiplier;

        var projectCountTask = projectRepo.GetCountByUserIdAsync(userId);
        var totalStorageBytesTask = configRepo.GetTotalStorageBytesAsync(userId);
        var apiRequestCountTask = counterRepo.GetCurrentCountAsync(userId);
        await Task.WhenAll(projectCountTask, totalStorageBytesTask, apiRequestCountTask);

        var projectCount = projectCountTask.Result;
        // Environments are now fixed per tier (not user-managed), so count is derived from projects
        var environmentsPerProject = config.MaxEnvironments.HasValue
            ? Math.Min(config.MaxEnvironments.Value, 3) : 3;
        var environmentCount = projectCount * environmentsPerProject;
        var totalStorageBytes = totalStorageBytesTask.Result;
        var apiRequestCount = apiRequestCountTask.Result;

        var projectLimit = ComputeEffectiveLimit(config.MaxProjects, boost);
        var envLimit = ComputeEffectiveLimit(config.MaxEnvironments, boost);
        var storageLimit = ComputeEffectiveLimit(config.MaxStorageBytes, boost);
        var apiRequestLimit = ComputeEffectiveLimit(config.MaxApiRequestsPerMonth, boost);

        // Compute overLimit array -- reports factual state regardless of grace period
        var overLimitResources = new List<string>();
        if (projectLimit.HasValue && projectCount >= projectLimit.Value)
            overLimitResources.Add("projects");
        if (envLimit.HasValue && environmentCount >= envLimit.Value)
            overLimitResources.Add("environments");
        if (storageLimit.HasValue && totalStorageBytes >= storageLimit.Value)
            overLimitResources.Add("storage");
        if (apiRequestLimit.HasValue && apiRequestCount >= apiRequestLimit.Value)
            overLimitResources.Add("api_requests");

        return new ServiceResult<BillingStatusResponse>.Success(new BillingStatusResponse(
            Tier: user.SubscriptionTier,
            BoostMultiplier: boost,
            Projects: new ResourceUsage(projectCount, projectLimit),
            Environments: new ResourceUsage(environmentCount, envLimit),
            Storage: new StorageUsage(totalStorageBytes, storageLimit),
            RetentionDays: ComputeEffectiveLimit(config.RetentionDays, boost),
            CustomRetentionDays: user.CustomRetentionDays,
            CurrentPeriodEnd: user.CurrentPeriodEnd,
            OverLimit: overLimitResources.ToArray(),
            ApiRequests: new ApiRequestUsage(apiRequestCount, apiRequestLimit, GetNextMonthReset()),
            LastStripeError: user.LastStripeError
        ));
    }

    public async Task<ServiceResult<bool>> CheckProjectLimitAsync(Guid userId)
    {
        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<bool>.NotFound();

        // Grace period check
        if (user.PaymentFailedAt.HasValue
            && DateTime.UtcNow - user.PaymentFailedAt.Value < GracePeriod)
            return new ServiceResult<bool>.Success(true);

        var config = GetTierConfig(user.SubscriptionTier);
        var effectiveLimit = ComputeEffectiveLimit(config.MaxProjects, user.BoostMultiplier);

        if (effectiveLimit is null)
            return new ServiceResult<bool>.Success(true);

        var count = await projectRepo.GetCountByUserIdAsync(userId);
        if (count >= effectiveLimit.Value)
        {
            var upgradeTier = GetNextTier(user.SubscriptionTier);
            return new ServiceResult<bool>.OverLimit(new LimitResponse(
                Resource: "projects",
                Current: count,
                Limit: effectiveLimit.Value,
                Tier: user.SubscriptionTier,
                UpgradeTier: upgradeTier,
                CheckoutUrl: BuildCheckoutUrl(upgradeTier),
                Code: "LIMIT_PROJECTS"
            ));
        }

        return new ServiceResult<bool>.Success(true);
    }

    public Task<ServiceResult<bool>> CheckEnvironmentLimitAsync(Guid userId, Guid projectId)
    {
        // Environments are now fixed per tier (development, staging, production)
        // and are not user-managed resources, so this check always passes.
        return Task.FromResult<ServiceResult<bool>>(new ServiceResult<bool>.Success(true));
    }

    public async Task<ServiceResult<bool>> CheckStorageLimitAsync(Guid userId)
    {
        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<bool>.NotFound();

        // Grace period check
        if (user.PaymentFailedAt.HasValue
            && DateTime.UtcNow - user.PaymentFailedAt.Value < GracePeriod)
            return new ServiceResult<bool>.Success(true);

        var config = GetTierConfig(user.SubscriptionTier);
        var effectiveLimit = ComputeEffectiveLimit(config.MaxStorageBytes, user.BoostMultiplier);

        if (effectiveLimit is null)
            return new ServiceResult<bool>.Success(true);

        var totalBytes = await configRepo.GetTotalStorageBytesAsync(userId);
        if (totalBytes >= effectiveLimit.Value)
        {
            var upgradeTier = GetNextTier(user.SubscriptionTier);
            return new ServiceResult<bool>.OverLimit(new LimitResponse(
                Resource: "storage",
                Current: totalBytes,
                Limit: effectiveLimit.Value,
                Tier: user.SubscriptionTier,
                UpgradeTier: upgradeTier,
                CheckoutUrl: BuildCheckoutUrl(upgradeTier),
                Code: "LIMIT_STORAGE"
            ));
        }

        return new ServiceResult<bool>.Success(true);
    }

    public async Task<int?> GetEffectiveProjectLimitAsync(Guid userId)
    {
        var user = await userRepo.GetByIdAsync(userId);
        if (user is null) return null;
        if (user.PaymentFailedAt.HasValue && DateTime.UtcNow - user.PaymentFailedAt.Value < GracePeriod)
            return null;
        var config = GetTierConfig(user.SubscriptionTier);
        return ComputeEffectiveLimit(config.MaxProjects, user.BoostMultiplier);
    }

    public async Task<int?> GetEffectiveEnvironmentLimitAsync(Guid userId)
    {
        var user = await userRepo.GetByIdAsync(userId);
        if (user is null) return null;
        if (user.PaymentFailedAt.HasValue && DateTime.UtcNow - user.PaymentFailedAt.Value < GracePeriod)
            return null;
        var config = GetTierConfig(user.SubscriptionTier);
        return ComputeEffectiveLimit(config.MaxEnvironments, user.BoostMultiplier);
    }

    private TierLimitConfig GetTierConfig(string tier)
        => tierSettings.Value.Tiers.TryGetValue(tier, out var config)
            ? config
            : tierSettings.Value.Tiers["free"];

    private static DateTime GetNextMonthReset()
    {
        var now = DateTime.UtcNow;
        return new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
    }

    private static int? ComputeEffectiveLimit(int? baseLimit, int boostMultiplier)
        => baseLimit.HasValue ? baseLimit.Value * boostMultiplier : null;

    private static long? ComputeEffectiveLimit(long? baseLimit, int boostMultiplier)
        => baseLimit.HasValue ? baseLimit.Value * boostMultiplier : null;

    private static string? GetNextTier(string tier) => tier switch
    {
        "free" => "hobby",
        "hobby" => "pro",
        _ => null
    };

    private static string BuildCheckoutUrl(string? upgradeTier)
        => upgradeTier is not null ? $"/upgrade/{upgradeTier}" : "/upgrade/boost";
}
