using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using SkyState.Api.Services;
using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Unit tests for <see cref="BillingService"/> using NSubstitute mocks.
/// Verifies tier-aware billing logic, effective limit computation with boost,
/// per-resource usage reporting, per-resource limit checks, grace period,
/// and structured LimitResponse.
/// </summary>
public class BillingServiceTests
{
    private readonly IUserRepository _userRepo = Substitute.For<IUserRepository>();
    private readonly IProjectRepository _projectRepo = Substitute.For<IProjectRepository>();
    private readonly IProjectConfigRepository _configRepo = Substitute.For<IProjectConfigRepository>();
    private readonly IApiRequestCounterRepository _counterRepo = Substitute.For<IApiRequestCounterRepository>();
    private readonly BillingService _sut;

    private static IOptions<TierSettings> CreateTierSettings() =>
        Options.Create(new TierSettings
        {
            Tiers = new Dictionary<string, TierLimitConfig>(StringComparer.OrdinalIgnoreCase)
            {
                ["free"] = new()
                {
                    MaxProjects = 1,
                    MaxEnvironments = 2,
                    MaxStorageBytes = 512000,
                    RetentionDays = 30,
                    MaxApiRequestsPerMonth = 200
                },
                ["hobby"] = new()
                {
                    MaxProjects = 3,
                    MaxEnvironments = null,
                    MaxStorageBytes = 10485760,
                    RetentionDays = 90,
                    MaxApiRequestsPerMonth = 2000
                },
                ["pro"] = new()
                {
                    MaxProjects = 10,
                    MaxEnvironments = null,
                    MaxStorageBytes = 104857600,
                    RetentionDays = null,
                    MaxApiRequestsPerMonth = 20000
                }
            }
        });

    private static User MakeUser(Guid userId, string tier = "free", int boost = 1, DateTime? paymentFailedAt = null) =>
        new()
        {
            UserId = userId,
            SsoProvider = "github",
            SsoUserId = "test-123",
            Email = "test@test.com",
            DisplayName = "Test User",
            SubscriptionTier = tier,
            BoostMultiplier = boost,
            PaymentFailedAt = paymentFailedAt,
            LastLoginAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

    public BillingServiceTests()
    {
        _sut = new BillingService(_userRepo, _projectRepo, _configRepo, _counterRepo, CreateTierSettings(), NullLogger<BillingService>.Instance);
    }

    // --- GetStatusAsync ---

    [Fact]
    public async Task GetStatusAsync_FreeTier_ReturnsCorrectPerResourceUsageAndLimits()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal("free", status.Tier);
        Assert.Equal(1, status.BoostMultiplier);
        Assert.Equal(0, status.Projects.Count);
        Assert.Equal(1, status.Projects.Limit);
        Assert.Equal(0, status.Environments.Count);
        Assert.Equal(2, status.Environments.Limit);
        Assert.Equal(0L, status.Storage.Bytes);
        Assert.Equal(512000L, status.Storage.Limit);
        Assert.Equal(30, status.RetentionDays);
        Assert.Null(status.CurrentPeriodEnd);
        Assert.Empty(status.OverLimit);
    }

    [Fact]
    public async Task GetStatusAsync_HobbyTier_ReturnsHobbyLimits()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "hobby"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(2);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(1000L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal("hobby", status.Tier);
        Assert.Equal(3, status.Projects.Limit);
        Assert.Null(status.Environments.Limit);
        Assert.Equal(10485760L, status.Storage.Limit);
        Assert.Equal(90, status.RetentionDays);
        Assert.Equal(2, status.Projects.Count);
        Assert.Equal(6, status.Environments.Count);  // 2 projects * 3 envs per project (hobby)
        Assert.Equal(1000L, status.Storage.Bytes);
        Assert.Empty(status.OverLimit);
    }

    [Fact]
    public async Task GetStatusAsync_ProTierWithBoost_AppliesBoostMultiplier()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(5);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(50000L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal("pro", status.Tier);
        Assert.Equal(2, status.BoostMultiplier);
        Assert.Equal(20, status.Projects.Limit);       // 10 * 2
        Assert.Null(status.Environments.Limit);          // null * 2 = null
        Assert.Equal(209715200L, status.Storage.Limit);  // 104857600 * 2
        Assert.Null(status.RetentionDays);               // null * 2 = null
        Assert.Empty(status.OverLimit);
    }

    [Fact]
    public async Task GetStatusAsync_NullLimit_StaysNullWithBoost()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 3));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        // Pro has null environments and null retention -- must stay null with any boost
        Assert.Null(status.Environments.Limit);
        Assert.Null(status.RetentionDays);
    }

    [Fact]
    public async Task GetStatusAsync_UserNotFound_ReturnsNotFound()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns((User?)null);

        var result = await _sut.GetStatusAsync(userId);

        Assert.IsType<ServiceResult<BillingStatusResponse>.NotFound>(result);
        await _projectRepo.DidNotReceive().GetCountByUserIdAsync(Arg.Any<Guid>());
    }

    [Fact]
    public async Task GetStatusAsync_OverLimit_ReportsOverLimitResources()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(2);  // over limit of 1

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(600000L); // over limit of 512000
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Contains("projects", status.OverLimit);
        Assert.Contains("storage", status.OverLimit);
        // Environments are now derived (2 projects * 2 envs/project = 4), which exceeds free limit of 2
        Assert.Contains("environments", status.OverLimit);
    }

    // --- CheckProjectLimitAsync ---

    [Fact]
    public async Task CheckProjectLimitAsync_UnderLimit_ReturnsSuccess()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        var result = await _sut.CheckProjectLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    [Fact]
    public async Task CheckProjectLimitAsync_AtLimit_ReturnsOverLimitWithLimitResponse()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(1); // free limit = 1

        var result = await _sut.CheckProjectLimitAsync(userId);

        var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
        Assert.Equal("projects", overLimit.Limit.Resource);
        Assert.Equal(1, overLimit.Limit.Current);
        Assert.Equal(1, overLimit.Limit.Limit);
        Assert.Equal("free", overLimit.Limit.Tier);
        Assert.Equal("hobby", overLimit.Limit.UpgradeTier);
        Assert.Equal("/upgrade/hobby", overLimit.Limit.CheckoutUrl);
        Assert.Equal("LIMIT_PROJECTS", overLimit.Limit.Code);
    }

    [Fact]
    public async Task CheckProjectLimitAsync_UserNotFound_ReturnsNotFound()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns((User?)null);

        var result = await _sut.CheckProjectLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.NotFound>(result);
    }

    [Fact]
    public async Task CheckProjectLimitAsync_ProTier_AtLimit_ReturnsNullUpgradeTierWithBoostUrl()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(10); // pro limit = 10

        var result = await _sut.CheckProjectLimitAsync(userId);

        var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
        Assert.Null(overLimit.Limit.UpgradeTier);
        Assert.Equal("/upgrade/boost", overLimit.Limit.CheckoutUrl);
    }

    // --- CheckEnvironmentLimitAsync ---

    [Fact]
    public async Task CheckEnvironmentLimitAsync_FreeTier_AlwaysReturnsSuccess()
    {
        // Environments are now fixed per tier (not user-managed), so this always succeeds
        var userId = Guid.NewGuid();
        var projectId = Guid.NewGuid();

        var result = await _sut.CheckEnvironmentLimitAsync(userId, projectId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    [Fact]
    public async Task CheckEnvironmentLimitAsync_HobbyTier_AlwaysReturnsSuccess()
    {
        // Environments are now fixed per tier, so this always succeeds regardless of tier
        var userId = Guid.NewGuid();
        var projectId = Guid.NewGuid();

        var result = await _sut.CheckEnvironmentLimitAsync(userId, projectId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    // --- CheckStorageLimitAsync ---

    [Fact]
    public async Task CheckStorageLimitAsync_OverLimit_ReturnsOverLimitWithLimitResponse()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _configRepo.GetTotalStorageBytesAsync(userId).Returns(600000L); // over 512000

        var result = await _sut.CheckStorageLimitAsync(userId);

        var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
        Assert.Equal("storage", overLimit.Limit.Resource);
        Assert.Equal(600000L, overLimit.Limit.Current);
        Assert.Equal(512000L, overLimit.Limit.Limit);
        Assert.Equal("free", overLimit.Limit.Tier);
        Assert.Equal("hobby", overLimit.Limit.UpgradeTier);
        Assert.Equal("/upgrade/hobby", overLimit.Limit.CheckoutUrl);
        Assert.Equal("LIMIT_STORAGE", overLimit.Limit.Code);
    }

    [Fact]
    public async Task CheckStorageLimitAsync_UnderLimit_ReturnsSuccess()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _configRepo.GetTotalStorageBytesAsync(userId).Returns(100000L); // under 512000

        var result = await _sut.CheckStorageLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    // --- Grace Period ---

    [Fact]
    public async Task CheckProjectLimitAsync_WithinGracePeriod_ReturnsSuccess()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-3)));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(5); // well over free limit of 1

        var result = await _sut.CheckProjectLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
        // Should not even query project count during grace period
        await _projectRepo.DidNotReceive().GetCountByUserIdAsync(Arg.Any<Guid>());
    }

    [Fact]
    public async Task CheckProjectLimitAsync_GracePeriodExpired_ReturnsOverLimit()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-8)));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(2); // over free limit of 1

        var result = await _sut.CheckProjectLimitAsync(userId);

        var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
        Assert.Equal("LIMIT_PROJECTS", overLimit.Limit.Code);
    }

    [Fact]
    public async Task CheckEnvironmentLimitAsync_WithinGracePeriod_ReturnsSuccess()
    {
        // Environments are now fixed per tier, so this always succeeds (grace period irrelevant)
        var userId = Guid.NewGuid();
        var projectId = Guid.NewGuid();

        var result = await _sut.CheckEnvironmentLimitAsync(userId, projectId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    [Fact]
    public async Task CheckStorageLimitAsync_WithinGracePeriod_ReturnsSuccess()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-5)));
        _configRepo.GetTotalStorageBytesAsync(userId).Returns(999999L); // over free limit

        var result = await _sut.CheckStorageLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.Success>(result);
    }

    [Fact]
    public async Task CheckStorageLimitAsync_GracePeriodExpired_ReturnsOverLimit()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-10)));
        _configRepo.GetTotalStorageBytesAsync(userId).Returns(999999L);

        var result = await _sut.CheckStorageLimitAsync(userId);

        var overLimit = Assert.IsType<ServiceResult<bool>.OverLimit>(result);
        Assert.Equal("LIMIT_STORAGE", overLimit.Limit.Code);
    }

    [Fact]
    public async Task CheckProjectLimitAsync_NoDowngrade_NullGracePeriod_EnforcesNormally()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: null));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(1);

        var result = await _sut.CheckProjectLimitAsync(userId);

        Assert.IsType<ServiceResult<bool>.OverLimit>(result);
    }

    // --- GetEffectiveProjectLimitAsync ---

    [Fact]
    public async Task GetEffectiveProjectLimitAsync_FreeUser_Returns1()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));

        var result = await _sut.GetEffectiveProjectLimitAsync(userId);

        Assert.Equal(1, result);
    }

    [Fact]
    public async Task GetEffectiveProjectLimitAsync_HobbyUser_Returns3()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "hobby"));

        var result = await _sut.GetEffectiveProjectLimitAsync(userId);

        Assert.Equal(3, result);
    }

    [Fact]
    public async Task GetEffectiveProjectLimitAsync_ProUserWithBoost2_Returns20()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));

        var result = await _sut.GetEffectiveProjectLimitAsync(userId);

        Assert.Equal(20, result); // 10 * 2
    }

    [Fact]
    public async Task GetEffectiveProjectLimitAsync_GracePeriodUser_ReturnsNull()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-3)));

        var result = await _sut.GetEffectiveProjectLimitAsync(userId);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEffectiveProjectLimitAsync_UnknownUser_ReturnsNull()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns((User?)null);

        var result = await _sut.GetEffectiveProjectLimitAsync(userId);

        Assert.Null(result);
    }

    // --- GetEffectiveEnvironmentLimitAsync ---

    [Fact]
    public async Task GetEffectiveEnvironmentLimitAsync_FreeUser_Returns2()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));

        var result = await _sut.GetEffectiveEnvironmentLimitAsync(userId);

        Assert.Equal(2, result);
    }

    [Fact]
    public async Task GetEffectiveEnvironmentLimitAsync_HobbyUser_ReturnsNull()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "hobby"));

        var result = await _sut.GetEffectiveEnvironmentLimitAsync(userId);

        Assert.Null(result); // hobby = unlimited environments
    }

    [Fact]
    public async Task GetEffectiveEnvironmentLimitAsync_ProUserWithBoost2_ReturnsNull()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));

        var result = await _sut.GetEffectiveEnvironmentLimitAsync(userId);

        Assert.Null(result); // pro = unlimited environments
    }

    [Fact]
    public async Task GetEffectiveEnvironmentLimitAsync_GracePeriodUser_ReturnsNull()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free", paymentFailedAt: DateTime.UtcNow.AddDays(-1)));

        var result = await _sut.GetEffectiveEnvironmentLimitAsync(userId);

        Assert.Null(result); // grace period = unlimited
    }

    // --- CurrentPeriodEnd ---

    [Fact]
    public async Task GetStatusAsync_UserWithCurrentPeriodEnd_ReturnsIt()
    {
        var userId = Guid.NewGuid();
        var periodEnd = new DateTime(2026, 3, 15, 0, 0, 0, DateTimeKind.Utc);
        var user = MakeUser(userId, "hobby") with { CurrentPeriodEnd = periodEnd };
        _userRepo.GetByIdAsync(userId).Returns(user);
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(0);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal(periodEnd, status.CurrentPeriodEnd);
    }

    // --- API Request Usage in GetStatusAsync ---

    [Fact]
    public async Task GetStatusAsync_FreeTier_ReturnsApiRequestUsageWithCountLimitAndResetDate()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(42);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal(42, status.ApiRequests.Count);
        Assert.Equal(200, status.ApiRequests.Limit);
        // ResetDate should be first of next month UTC
        var now = DateTime.UtcNow;
        var expectedReset = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
        Assert.Equal(expectedReset.Year, status.ApiRequests.ResetDate.Year);
        Assert.Equal(expectedReset.Month, status.ApiRequests.ResetDate.Month);
        Assert.Equal(1, status.ApiRequests.ResetDate.Day);
        Assert.Equal(0, status.ApiRequests.ResetDate.Hour);
        Assert.Equal(DateTimeKind.Utc, status.ApiRequests.ResetDate.Kind);
    }

    [Fact]
    public async Task GetStatusAsync_ProTierWithBoost2_DoublesApiRequestLimit()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(500);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Equal(500, status.ApiRequests.Count);
        Assert.Equal(40000, status.ApiRequests.Limit); // 20000 * 2
        var now = DateTime.UtcNow;
        var expectedReset = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
        Assert.Equal(expectedReset.Year, status.ApiRequests.ResetDate.Year);
        Assert.Equal(expectedReset.Month, status.ApiRequests.ResetDate.Month);
    }

    [Fact]
    public async Task GetStatusAsync_ApiRequestsAtLimit_AddsToOverLimitArray()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(200); // exactly at limit of 200

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.Contains("api_requests", status.OverLimit);
    }

    [Fact]
    public async Task GetStatusAsync_ApiRequestsUnderLimit_NotInOverLimitArray()
    {
        var userId = Guid.NewGuid();
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _projectRepo.GetCountByUserIdAsync(userId).Returns(0);

        _configRepo.GetTotalStorageBytesAsync(userId).Returns(0L);
        _counterRepo.GetCurrentCountAsync(userId).Returns(100);

        var result = await _sut.GetStatusAsync(userId);

        var status = Assert.IsType<ServiceResult<BillingStatusResponse>.Success>(result).Value;
        Assert.DoesNotContain("api_requests", status.OverLimit);
    }
}
