using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.IntegrationTests.Infrastructure;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using Xunit;

namespace SkyState.Api.IntegrationTests;

public class PublicConfigMeteringTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    /// <summary>
    /// Seeds a user, project, and config in the in-memory database.
    /// Returns (userId, projectSlug, environmentSlug) for use in test requests.
    /// </summary>
    private async Task<(Guid UserId, string ProjectSlug, string EnvSlug)> SeedProjectAsync(
        string tier = "free", int boostMultiplier = 1)
    {
        var id = Uid();
        var userRepo = factory.Services.GetRequiredService<IUserRepository>();
        var projectRepo = factory.Services.GetRequiredService<IProjectRepository>();
        var configRepo = factory.Services.GetRequiredService<IProjectConfigRepository>();

        var userId = await userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        await userRepo.SetSubscriptionTierAsync(userId, tier, boostMultiplier);

        var projectSlug = $"proj-{id}";
        var projectId = await projectRepo.CreateAsync(userId, new CreateProject("Test Project", projectSlug, "hash"), null);
        await configRepo.CreateAsync(userId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{\"key\":\"value\"}", "Initial"));

        return (userId, projectSlug, "production");
    }

    /// <summary>
    /// Pre-seeds the counter so that IncrementAsync returns (preSeedCount + 1).
    /// </summary>
    private void PreSeedCounter(Guid userId, int preSeedCount)
    {
        var db = factory.Services.GetRequiredService<InMemoryDatabase>();
        var now = DateTime.UtcNow;
        db.Counters[(userId, now.Year, now.Month)] = preSeedCount;
    }

    [Fact]
    public async Task NormalUser_At50Percent_Returns200WithRateLimitHeaders()
    {
        // Free tier: limit 200, pre-seed to 99 so IncrementAsync returns 100 (50%)
        var (userId, slug, envSlug) = await SeedProjectAsync("free");
        PreSeedCounter(userId, 99);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // X-RateLimit-Limit should be the effective limit
        Assert.True(response.Headers.Contains("X-RateLimit-Limit"), "Missing X-RateLimit-Limit header");
        var limit = int.Parse(response.Headers.GetValues("X-RateLimit-Limit").First());
        Assert.Equal(200, limit);

        // X-RateLimit-Remaining should be max(0, limit - count)
        Assert.True(response.Headers.Contains("X-RateLimit-Remaining"), "Missing X-RateLimit-Remaining header");
        var remaining = int.Parse(response.Headers.GetValues("X-RateLimit-Remaining").First());
        Assert.Equal(100, remaining);

        // X-RateLimit-Reset should be a valid Unix timestamp of next month
        Assert.True(response.Headers.Contains("X-RateLimit-Reset"), "Missing X-RateLimit-Reset header");
        var resetStr = response.Headers.GetValues("X-RateLimit-Reset").First();
        var resetTimestamp = long.Parse(resetStr);
        var now = DateTime.UtcNow;
        var expectedReset = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero).AddMonths(1);
        Assert.Equal(expectedReset.ToUnixTimeSeconds(), resetTimestamp);

        // No warning header at 50%
        Assert.False(response.Headers.Contains("X-RateLimit-Warning"), "Unexpected X-RateLimit-Warning header");
    }

    [Fact]
    public async Task GraceZoneUser_Returns200WithWarningHeader()
    {
        // Free tier: limit 200, pre-seed to 204 so IncrementAsync returns 205 (102.5% -- in grace zone)
        var (userId, slug, envSlug) = await SeedProjectAsync("free");
        PreSeedCounter(userId, 204);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // Should have rate limit headers
        Assert.True(response.Headers.Contains("X-RateLimit-Limit"), "Missing X-RateLimit-Limit header");
        Assert.Equal("200", response.Headers.GetValues("X-RateLimit-Limit").First());

        // Remaining should be 0 (not negative)
        Assert.True(response.Headers.Contains("X-RateLimit-Remaining"), "Missing X-RateLimit-Remaining header");
        Assert.Equal("0", response.Headers.GetValues("X-RateLimit-Remaining").First());

        // Warning header should be present
        Assert.True(response.Headers.Contains("X-RateLimit-Warning"), "Missing X-RateLimit-Warning header");
        var warning = response.Headers.GetValues("X-RateLimit-Warning").First();
        Assert.Contains("110%", warning);
    }

    [Fact]
    public async Task OverLimitUser_Returns429WithJsonBodyAndRetryAfter()
    {
        // Free tier: limit 200, >110% = >220. Pre-seed to 220 so IncrementAsync returns 221.
        var (userId, slug, envSlug) = await SeedProjectAsync("free");
        PreSeedCounter(userId, 220);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);

        // Retry-After header should be positive integer (seconds until next month)
        Assert.True(response.Headers.Contains("Retry-After"), "Missing Retry-After header");
        var retryAfter = long.Parse(response.Headers.GetValues("Retry-After").First());
        Assert.True(retryAfter > 0, $"Retry-After should be positive, got {retryAfter}");

        // JSON body should contain all required fields
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("RATE_LIMIT_EXCEEDED", json.GetProperty("code").GetString());
        Assert.True(json.GetProperty("message").GetString()!.Length > 0, "Message should not be empty");
        Assert.Equal(200, json.GetProperty("limit").GetInt32());
        Assert.Equal(221, json.GetProperty("current").GetInt32());
        Assert.True(json.GetProperty("resetAt").GetString()!.Length > 0, "ResetAt should not be empty");
        Assert.Equal("/upgrade", json.GetProperty("upgradeUrl").GetString());
    }

    [Fact]
    public async Task UnknownSlug_DoesNotReturn429_FallsThrough404()
    {
        // No project seeded for this slug -- MeterResult.NotFound -> fall through to 404
        using var client = factory.CreateClient();
        var unknownSlug = $"nonexistent-{Uid()}";

        var response = await client.GetAsync($"/project/{unknownSlug}/config/production", CT);

        // Should be 404, NOT 429
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(response.Headers.Contains("Retry-After"), "Should not have Retry-After header");
        Assert.False(response.Headers.Contains("X-RateLimit-Limit"), "Should not have X-RateLimit-Limit header");
    }

    [Fact]
    public async Task ProTier_Returns200WithCorrectLimits()
    {
        var (userId, slug, envSlug) = await SeedProjectAsync("pro");
        PreSeedCounter(userId, 0);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // Pro tier has limit 20000
        Assert.True(response.Headers.Contains("X-RateLimit-Limit"), "Missing X-RateLimit-Limit header");
        Assert.Equal("20000", response.Headers.GetValues("X-RateLimit-Limit").First());

        Assert.True(response.Headers.Contains("X-RateLimit-Remaining"), "Missing X-RateLimit-Remaining header");
        var remaining = int.Parse(response.Headers.GetValues("X-RateLimit-Remaining").First());
        Assert.Equal(19999, remaining);

        // Reset header should still be present
        Assert.True(response.Headers.Contains("X-RateLimit-Reset"), "Missing X-RateLimit-Reset header");
    }

    [Fact]
    public async Task RetryAfter_IsPositiveIntegerSecondsUntilNextMonth()
    {
        // Over-limit: verify Retry-After is a reasonable number of seconds
        var (userId, slug, envSlug) = await SeedProjectAsync("free");
        PreSeedCounter(userId, 220);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.True(response.Headers.Contains("Retry-After"), "Missing Retry-After header");

        var retryAfterStr = response.Headers.GetValues("Retry-After").First();
        var retryAfter = long.Parse(retryAfterStr);
        Assert.True(retryAfter > 0, $"Retry-After should be positive, got {retryAfter}");
        // Should be less than ~31 days in seconds
        Assert.True(retryAfter <= 31 * 24 * 60 * 60, $"Retry-After too large: {retryAfter}");
    }

    [Fact]
    public async Task RateLimitReset_IsValidUnixTimestampOfNextMonth()
    {
        var (userId, slug, envSlug) = await SeedProjectAsync("free");
        PreSeedCounter(userId, 0);
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.Contains("X-RateLimit-Reset"), "Missing X-RateLimit-Reset header");

        var resetStr = response.Headers.GetValues("X-RateLimit-Reset").First();
        var resetTimestamp = long.Parse(resetStr);
        var resetDate = DateTimeOffset.FromUnixTimeSeconds(resetTimestamp);

        // Should be the first second of next month UTC
        var now = DateTime.UtcNow;
        var expectedReset = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero).AddMonths(1);
        Assert.Equal(expectedReset, resetDate);
        Assert.Equal(1, resetDate.Day);
        Assert.Equal(0, resetDate.Hour);
        Assert.Equal(0, resetDate.Minute);
        Assert.Equal(0, resetDate.Second);
    }

    [Fact]
    public async Task MeteringError_Returns200WithNoRateLimitHeaders()
    {
        var (userId, slug, envSlug) = await SeedProjectAsync("free");

        // Remove the user so MeteringService.MeterAsync returns NotFound
        var db = factory.Services.GetRequiredService<InMemoryDatabase>();
        db.Users.TryRemove(userId, out _);

        using var client = factory.CreateClient();
        var response = await client.GetAsync($"/project/{slug}/config/{envSlug}", CT);

        // Should still serve the config (200) -- metering falls through on NotFound
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // No rate limit headers
        Assert.False(response.Headers.Contains("X-RateLimit-Limit"), "Should not have X-RateLimit-Limit on metering fallthrough");
        Assert.False(response.Headers.Contains("X-RateLimit-Remaining"), "Should not have X-RateLimit-Remaining on metering fallthrough");
        Assert.False(response.Headers.Contains("X-RateLimit-Warning"), "Should not have X-RateLimit-Warning on metering fallthrough");
    }
}
