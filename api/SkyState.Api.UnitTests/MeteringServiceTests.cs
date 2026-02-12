using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using SkyState.Api.Services;
using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Unit tests for <see cref="MeteringService"/> covering all MeterResult variants,
/// boundary conditions at 110% hard block, boost multiplier, unlimited tiers,
/// and fail-open error handling.
/// </summary>
public class MeteringServiceTests
{
    private readonly IApiRequestCounterRepository _counterRepo =
        Substitute.For<IApiRequestCounterRepository>();
    private readonly IUserRepository _userRepo =
        Substitute.For<IUserRepository>();
    private readonly MeteringService _sut;

    private static IOptions<TierSettings> CreateTierSettings() =>
        Options.Create(new TierSettings
        {
            Tiers = new Dictionary<string, TierLimitConfig>(StringComparer.OrdinalIgnoreCase)
            {
                ["free"] = new() { MaxApiRequestsPerMonth = 200 },
                ["hobby"] = new() { MaxApiRequestsPerMonth = 2000 },
                ["pro"] = new() { MaxApiRequestsPerMonth = 20000 }
            }
        });

    private static IOptions<MeteringSettings> CreateMeteringSettings(
        double warning = 1.0, double block = 1.1) =>
        Options.Create(new MeteringSettings
        {
            WarningThresholdMultiplier = warning,
            BlockThresholdMultiplier = block
        });

    private static User MakeUser(Guid userId, string tier = "free", int boost = 1) =>
        new()
        {
            UserId = userId,
            SsoProvider = "github",
            SsoUserId = "test-123",
            Email = "test@test.com",
            DisplayName = "Test User",
            SubscriptionTier = tier,
            BoostMultiplier = boost,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

    public MeteringServiceTests()
    {
        _sut = new MeteringService(
            _counterRepo,
            _userRepo,
            CreateTierSettings(),
            CreateMeteringSettings(),
            NullLogger<MeteringService>.Instance);
    }

    // --- Test 1: Slug not found ---

    [Fact]
    public async Task MeterAsync_SlugNotFound_ReturnsNotFound()
    {
        _counterRepo.GetOwnerByProjectSlugAsync("unknown-slug").Returns((Guid?)null);

        var result = await _sut.MeterAsync("unknown-slug");

        Assert.IsType<MeterResult.NotFound>(result);
        await _counterRepo.DidNotReceive().IncrementAsync(Arg.Any<Guid>());
    }

    // --- Test 2: User not found (slug resolves but user is null) ---

    [Fact]
    public async Task MeterAsync_UserNotFound_ReturnsNotFound()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("valid-slug").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns((User?)null);

        var result = await _sut.MeterAsync("valid-slug");

        Assert.IsType<MeterResult.NotFound>(result);
        await _counterRepo.DidNotReceive().IncrementAsync(Arg.Any<Guid>());
    }

    // --- Test 3: At 50% (free, count=100 of 200) ---

    [Fact]
    public async Task MeterAsync_At50Percent_ReturnsOkWithCorrectCounts()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Returns(100);

        var result = await _sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(100, ok.NewCount);
        Assert.Equal(200, ok.EffectiveLimit);
        Assert.Equal("free", ok.Tier);
    }

    // --- Test 4: At exactly 100% (free, count=200 of 200) ---

    [Fact]
    public async Task MeterAsync_AtExactly100Percent_ReturnsOk()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Returns(200);

        var result = await _sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(200, ok.NewCount);
        Assert.Equal(200, ok.EffectiveLimit);
    }

    // --- Test 5: In grace zone 105% (free, count=210 of 200) ---

    [Fact]
    public async Task MeterAsync_InGraceZone105Percent_ReturnsOk()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Returns(210);

        var result = await _sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(210, ok.NewCount);
        Assert.Equal(200, ok.EffectiveLimit);
    }

    // --- Test 6: At exactly 110% (free, count=220 of 200) — NOT blocked ---

    [Fact]
    public async Task MeterAsync_AtExact110Percent_ReturnsOk()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Returns(220); // 220 > 200 * 1.1 = 220.0 → false

        var result = await _sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(220, ok.NewCount);
        Assert.Equal(200, ok.EffectiveLimit);
    }

    // --- Test 7: Above 110% (free, count=221 of 200) — blocked ---

    [Fact]
    public async Task MeterAsync_Above110Percent_ReturnsOverLimit()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Returns(221); // 221 > 200 * 1.1 = 220.0 → true

        var result = await _sut.MeterAsync("my-project");

        var overLimit = Assert.IsType<MeterResult.OverLimit>(result);
        Assert.Equal(221, overLimit.NewCount);
        Assert.Equal(200, overLimit.EffectiveLimit);
    }

    // --- Test 8: Unlimited user (null limit) — counter IS incremented ---

    [Fact]
    public async Task MeterAsync_UnlimitedUser_CountsButReturnsOk()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        // Pro tier with MaxApiRequestsPerMonth = 20000, but we need null limit.
        // Create a user with a tier that has null limit — use a custom tier settings for this test.
        // Actually, the standard pro tier has 20000, not null.
        // To test unlimited, we need to create the SUT with a tier that has null MaxApiRequestsPerMonth.
        // Use a separate SUT for this test.
        var unlimitedTierSettings = Options.Create(new TierSettings
        {
            Tiers = new Dictionary<string, TierLimitConfig>(StringComparer.OrdinalIgnoreCase)
            {
                ["free"] = new() { MaxApiRequestsPerMonth = 200 },
                ["unlimited"] = new() { MaxApiRequestsPerMonth = null }
            }
        });
        var sut = new MeteringService(
            _counterRepo, _userRepo,
            unlimitedTierSettings, CreateMeteringSettings(),
            NullLogger<MeteringService>.Instance);

        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "unlimited"));
        _counterRepo.IncrementAsync(userId).Returns(5000);

        var result = await sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(5000, ok.NewCount);
        Assert.Null(ok.EffectiveLimit);
        Assert.Equal("unlimited", ok.Tier);
        await _counterRepo.Received(1).IncrementAsync(userId);
    }

    // --- Test 9: Pro with 2x boost, count=39999 → Ok ---

    [Fact]
    public async Task MeterAsync_ProWithBoost_UnderDoubledLimit_ReturnsOk()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));
        _counterRepo.IncrementAsync(userId).Returns(39999); // effective limit = 20000 * 2 = 40000

        var result = await _sut.MeterAsync("my-project");

        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(39999, ok.NewCount);
        Assert.Equal(40000, ok.EffectiveLimit);
        Assert.Equal("pro", ok.Tier);
    }

    // --- Test 10: Pro with 2x boost, count=44001 → OverLimit ---

    [Fact]
    public async Task MeterAsync_ProWithBoost_AboveDoubledLimit110_ReturnsOverLimit()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "pro", boost: 2));
        _counterRepo.IncrementAsync(userId).Returns(44001); // 44001 > 40000 * 1.1 = 44000.0 → true

        var result = await _sut.MeterAsync("my-project");

        var overLimit = Assert.IsType<MeterResult.OverLimit>(result);
        Assert.Equal(44001, overLimit.NewCount);
        Assert.Equal(40000, overLimit.EffectiveLimit);
    }

    // --- Test 11: Counter increment fails → Error ---

    [Fact]
    public async Task MeterAsync_CounterIncrementFails_ReturnsError()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "free"));
        _counterRepo.IncrementAsync(userId).Throws(new Exception("DB down"));

        var result = await _sut.MeterAsync("my-project");

        Assert.IsType<MeterResult.Error>(result);
    }

    // --- Test 12: Slug lookup fails → Error ---

    [Fact]
    public async Task MeterAsync_SlugLookupFails_ReturnsError()
    {
        _counterRepo.GetOwnerByProjectSlugAsync("my-project")
            .Throws(new Exception("Connection refused"));

        var result = await _sut.MeterAsync("my-project");

        Assert.IsType<MeterResult.Error>(result);
    }

    // --- Test 13: Unknown tier falls back to free limits ---

    [Fact]
    public async Task MeterAsync_UnknownTier_FallsBackToFreeLimits()
    {
        var userId = Guid.NewGuid();
        _counterRepo.GetOwnerByProjectSlugAsync("my-project").Returns(userId);
        _userRepo.GetByIdAsync(userId).Returns(MakeUser(userId, "custom-tier"));
        _counterRepo.IncrementAsync(userId).Returns(100);

        var result = await _sut.MeterAsync("my-project");

        // Falls back to free: 200 limit, count 100 = Ok
        var ok = Assert.IsType<MeterResult.Ok>(result);
        Assert.Equal(100, ok.NewCount);
        Assert.Equal(200, ok.EffectiveLimit);
        Assert.Equal("custom-tier", ok.Tier);  // Tier reflects user's actual tier, limits use free fallback
    }
}
