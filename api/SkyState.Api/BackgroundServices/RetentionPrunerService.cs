using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.BackgroundServices;

public class RetentionPrunerService(
    IServiceScopeFactory scopeFactory,
    IOptions<TierSettings> tierSettings,
    ILogger<RetentionPrunerService> logger) : BackgroundService
{
    private static readonly TimeOnly RunAt = new(3, 0, 0);
    private static readonly TimeSpan GracePeriod = TimeSpan.FromDays(7);
    private static readonly TimeSpan BetweenUserSleep = TimeSpan.FromMilliseconds(100);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var initialDelay = ComputeDelayUntilNextRun(RunAt);
            logger.LogInformation("Retention pruner scheduled. First run in {Delay:hh\\:mm\\:ss}", initialDelay);
            await Task.Delay(initialDelay, stoppingToken);

            using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
            do
            {
                await RunPruningCycleAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation("Retention pruner stopping.");
        }
    }

    internal async Task RunPruningCycleAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Retention pruner cycle starting at {Timestamp:u}", DateTime.UtcNow);

        await using var scope = scopeFactory.CreateAsyncScope();
        var userRepo = scope.ServiceProvider.GetRequiredService<IUserRepository>();
        var stateRepo = scope.ServiceProvider.GetRequiredService<IProjectConfigRepository>();

        System.Collections.Generic.IEnumerable<User> users;
        try
        {
            users = await userRepo.GetAllAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Retention pruner failed to load users -- aborting cycle");
            return;
        }

        var pruned = 0;
        var skipped = 0;
        var errors = 0;

        foreach (var user in users)
        {
            if (stoppingToken.IsCancellationRequested)
                break;

            var config = GetTierConfig(user.SubscriptionTier);
            var effectiveRetentionDays = user.CustomRetentionDays ?? config.RetentionDays;

            if (effectiveRetentionDays is null)
            {
                skipped++;
                continue;
            }

            if (IsInGracePeriod(user))
            {
                skipped++;
                continue;
            }

            var cutoffDate = effectiveRetentionDays.Value == 0
                ? DateTime.UtcNow
                : DateTime.UtcNow.AddDays(-effectiveRetentionDays.Value);

            try
            {
                var deleted = await stateRepo.PruneExpiredVersionsAsync(user.UserId, cutoffDate);
                if (deleted > 0)
                    logger.LogInformation("Pruned {Deleted} versions for user {UserId}", deleted, user.UserId);
                pruned++;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Retention pruner error for user {UserId}", user.UserId);
                errors++;
            }

            await Task.Delay(BetweenUserSleep, stoppingToken);
        }

        logger.LogInformation(
            "Retention pruner cycle complete. Pruned: {Pruned}, Skipped: {Skipped}, Errors: {Errors}",
            pruned, skipped, errors);
    }

    private TierLimitConfig GetTierConfig(string tier)
    {
        if (tierSettings.Value.Tiers.TryGetValue(tier, out var config))
            return config;

        return tierSettings.Value.Tiers["free"];
    }

    private static bool IsInGracePeriod(User user) =>
        user.PaymentFailedAt.HasValue && DateTime.UtcNow - user.PaymentFailedAt.Value < GracePeriod;

    private static TimeSpan ComputeDelayUntilNextRun(TimeOnly targetTime)
    {
        var now = DateTime.UtcNow;
        var nextRun = now.Date.Add(targetTime.ToTimeSpan());
        if (nextRun <= now)
            nextRun = nextRun.AddDays(1);
        return nextRun - now;
    }
}
