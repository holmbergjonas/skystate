using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using SkyState.Api.BackgroundServices;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Unit tests for <see cref="RetentionPrunerService.RunPruningCycleAsync"/> covering:
/// unlimited-retention skip, grace-period skip, eligible prune with correct cutoff,
/// error isolation (per-user), post-grace prune, and unknown tier fallback.
/// </summary>
public class RetentionPrunerServiceTests
{
    private static IOptions<TierSettings> CreateTierSettings() =>
        Options.Create(new TierSettings
        {
            Tiers = new Dictionary<string, TierLimitConfig>(StringComparer.OrdinalIgnoreCase)
            {
                ["free"] = new() { RetentionDays = 30 },
                ["hobby"] = new() { RetentionDays = 90 },
                ["pro"] = new() { RetentionDays = null },
                ["dev"] = new() { RetentionDays = null }
            }
        });

    private static User MakeUser(string tier, DateTime? paymentFailedAt = null, int? customRetentionDays = null) =>
        new()
        {
            UserId = Guid.NewGuid(),
            SsoProvider = "github",
            SsoUserId = Guid.NewGuid().ToString(),
            Email = "test@test.com",
            DisplayName = "Test User",
            SubscriptionTier = tier,
            BoostMultiplier = 1,
            PaymentFailedAt = paymentFailedAt,
            CustomRetentionDays = customRetentionDays,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

    /// <summary>
    /// Creates the service and all required mocks. Returns the service and the two repository mocks.
    /// The userRepo is pre-configured to return the given users from GetAllAsync.
    /// </summary>
    private static (RetentionPrunerService Service, IProjectConfigRepository StateRepo)
        BuildService(IEnumerable<User> users)
    {
        var userRepo = Substitute.For<IUserRepository>();
        userRepo.GetAllAsync().Returns(Task.FromResult<IEnumerable<User>>(new List<User>(users)));

        var stateRepo = Substitute.For<IProjectConfigRepository>();
        stateRepo.PruneExpiredVersionsAsync(Arg.Any<Guid>(), Arg.Any<DateTime>()).Returns(0);

        var scopeFactory = Substitute.For<IServiceScopeFactory>();
        var scope = Substitute.For<IServiceScope>();
        var serviceProvider = Substitute.For<IServiceProvider>();

        serviceProvider.GetService(typeof(IUserRepository)).Returns(userRepo);
        serviceProvider.GetService(typeof(IProjectConfigRepository)).Returns(stateRepo);
        scope.ServiceProvider.Returns(serviceProvider);
        scopeFactory.CreateScope().Returns(scope);

        var service = new RetentionPrunerService(
            scopeFactory,
            CreateTierSettings(),
            NullLogger<RetentionPrunerService>.Instance);

        return (service, stateRepo);
    }

    [Fact]
    public async Task SkipsUnlimitedRetentionUsers()
    {
        var users = new[]
        {
            MakeUser("pro"),
            MakeUser("dev")
        };
        var (service, stateRepo) = BuildService(users);

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.DidNotReceiveWithAnyArgs().PruneExpiredVersionsAsync(default, default);
    }

    [Fact]
    public async Task SkipsUsersInGracePeriod()
    {
        var user = MakeUser("free", paymentFailedAt: DateTime.UtcNow.AddDays(-3));
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.DidNotReceiveWithAnyArgs().PruneExpiredVersionsAsync(default, default);
    }

    [Fact]
    public async Task PrunesEligibleFreeUser()
    {
        var user = MakeUser("free");
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow.AddDays(-30))));
    }

    [Fact]
    public async Task PrunesEligibleHobbyUser()
    {
        var user = MakeUser("hobby");
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow.AddDays(-90))));
    }

    [Fact]
    public async Task ContinuesAfterSingleUserError()
    {
        var user1 = MakeUser("free");
        var user2 = MakeUser("free");

        var userRepo = Substitute.For<IUserRepository>();
        userRepo.GetAllAsync().Returns(Task.FromResult<IEnumerable<User>>(new List<User> { user1, user2 }));

        var stateRepo = Substitute.For<IProjectConfigRepository>();
        stateRepo.PruneExpiredVersionsAsync(user1.UserId, Arg.Any<DateTime>())
            .ThrowsAsync(new Exception("DB error"));
        stateRepo.PruneExpiredVersionsAsync(user2.UserId, Arg.Any<DateTime>())
            .Returns(5);

        var scopeFactory = Substitute.For<IServiceScopeFactory>();
        var scope = Substitute.For<IServiceScope>();
        var serviceProvider = Substitute.For<IServiceProvider>();
        serviceProvider.GetService(typeof(IUserRepository)).Returns(userRepo);
        serviceProvider.GetService(typeof(IProjectConfigRepository)).Returns(stateRepo);
        scope.ServiceProvider.Returns(serviceProvider);
        scopeFactory.CreateScope().Returns(scope);

        var service = new RetentionPrunerService(
            scopeFactory,
            CreateTierSettings(),
            NullLogger<RetentionPrunerService>.Instance);

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(user1.UserId, Arg.Any<DateTime>());
        await stateRepo.Received(1).PruneExpiredVersionsAsync(user2.UserId, Arg.Any<DateTime>());
    }

    [Fact]
    public async Task PrunesUserAfterGracePeriodExpires()
    {
        var user = MakeUser("free", paymentFailedAt: DateTime.UtcNow.AddDays(-10));
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Any<DateTime>());
    }

    [Fact]
    public async Task FallsBackToFreeTierForUnknownTier()
    {
        var user = MakeUser("unknown");
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow.AddDays(-30))));
    }

    [Fact]
    public async Task UsesCustomRetentionDaysOverTierDefault()
    {
        var user = MakeUser("free", customRetentionDays: 10);
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow.AddDays(-10))));
    }

    [Fact]
    public async Task CustomRetentionDaysZeroPrunesAllOldVersions()
    {
        var user = MakeUser("free", customRetentionDays: 0);
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow)));
    }

    [Fact]
    public async Task NullCustomRetentionDaysFallsBackToTier()
    {
        var user = MakeUser("free", customRetentionDays: null);
        var (service, stateRepo) = BuildService(new[] { user });

        await service.RunPruningCycleAsync(CancellationToken.None);

        await stateRepo.Received(1).PruneExpiredVersionsAsync(
            user.UserId,
            Arg.Is<DateTime>(d => IsApproximately(d, DateTime.UtcNow.AddDays(-30))));
    }

    /// <summary>Returns true if the two datetimes are within 1 minute of each other.</summary>
    private static bool IsApproximately(DateTime actual, DateTime expected) =>
        Math.Abs((actual - expected).TotalSeconds) < 60;
}
