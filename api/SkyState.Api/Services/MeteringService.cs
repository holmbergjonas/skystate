using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

/// <summary>
/// Resolves project slug to owner, increments monthly counter, returns enforcement decision.
/// Never throws — infrastructure failures return MeterResult.Error.
/// </summary>
public interface IMeteringService
{
    Task<MeterResult> MeterAsync(string projectSlug);
}

public class MeteringService(
    IApiRequestCounterRepository counterRepo,
    IUserRepository userRepo,
    IOptions<TierSettings> tierSettings,
    IOptions<MeteringSettings> meteringSettings,
    ILogger<MeteringService> logger) : IMeteringService
{
    public async Task<MeterResult> MeterAsync(string projectSlug)
    {
        // Step 1: Resolve slug → owner
        Guid? userId;
        try
        {
            userId = await counterRepo.GetOwnerByProjectSlugAsync(projectSlug);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to resolve owner for slug {ProjectSlug}", projectSlug);
            return new MeterResult.Error();
        }

        if (userId is null)
            return new MeterResult.NotFound();

        // Step 2: Load user for tier + boost
        User? user;
        try
        {
            user = await userRepo.GetByIdAsync(userId.Value);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to load user {UserId} for metering", userId.Value);
            return new MeterResult.Error();
        }

        if (user is null)
            return new MeterResult.NotFound();

        // Step 3: Compute effective limit
        var config = GetTierConfig(user.SubscriptionTier);
        var effectiveLimit = ComputeEffectiveLimit(config.MaxApiRequestsPerMonth, user.BoostMultiplier);

        // Step 4: Increment counter (always, even for unlimited users)
        int newCount;
        try
        {
            newCount = await counterRepo.IncrementAsync(userId.Value);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to increment counter for user {UserId}", userId.Value);
            return new MeterResult.Error();
        }

        // Step 5: Enforce
        if (effectiveLimit is null)
            return new MeterResult.Ok(newCount, null, user.SubscriptionTier);

        var blockThreshold = meteringSettings.Value.BlockThresholdMultiplier;
        if (newCount > effectiveLimit.Value * blockThreshold)
            return new MeterResult.OverLimit(newCount, effectiveLimit.Value);

        return new MeterResult.Ok(newCount, effectiveLimit.Value, user.SubscriptionTier);
    }

    private TierLimitConfig GetTierConfig(string tier)
    {
        if (tierSettings.Value.Tiers.TryGetValue(tier, out var config))
            return config;
        return tierSettings.Value.Tiers["free"];
    }

    private static int? ComputeEffectiveLimit(int? baseLimit, int boostMultiplier)
        => baseLimit.HasValue ? baseLimit.Value * boostMultiplier : null;
}
