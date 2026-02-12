using System;
using System.Net;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.IntegrationTests.Infrastructure;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using Xunit;

namespace SkyState.Api.IntegrationTests;

/// <summary>
/// Integration tests for billing status overLimit scenarios.
/// Exercises the full HTTP pipeline: client -> endpoint -> BillingService -> InMemoryRepositories -> response.
/// Verifies that the OverLimit array is populated when usage exceeds tier limits.
/// </summary>
public class BillingStatusOverLimitTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();
    private readonly IProjectRepository _projectRepo = factory.Services.GetRequiredService<IProjectRepository>();
    private readonly IProjectConfigRepository _configRepo = factory.Services.GetRequiredService<IProjectConfigRepository>();
    private readonly InMemoryDatabase _db = factory.Services.GetRequiredService<InMemoryDatabase>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..16];

    [Fact]
    public async Task Status_OverProjectLimit_ReturnsOverLimitWithProjects()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Free tier allows 1 project -- create 2 directly (bypass limit enforcement)
        await _projectRepo.CreateAsync(userId, new CreateProject("Project A", $"proj-a-{id}", "hash1"), null);
        await _projectRepo.CreateAsync(userId, new CreateProject("Project B", $"proj-b-{id}", "hash2"), null);

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal(2, status.Projects.Count);
        Assert.Equal(1, status.Projects.Limit);
        Assert.Contains("projects", status.OverLimit);
    }

    [Fact]
    public async Task Status_OverEnvironmentLimit_ReturnsOverLimitWithEnvironments()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Environments are now derived: projectCount * environmentsPerProject.
        // Free tier: MaxEnvironments=2, so environmentsPerProject = min(2,3) = 2, envLimit = 2.
        // With 2 projects: environmentCount = 2*2 = 4 >= envLimit 2 -> over limit.
        await _projectRepo.CreateAsync(userId, new CreateProject("Project 1", $"proj-1-{id}", "hash1"), null);
        await _projectRepo.CreateAsync(userId, new CreateProject("Project 2", $"proj-2-{id}", "hash2"), null);

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal(4, status.Environments.Count);  // 2 projects * 2 envs/project
        Assert.Equal(2, status.Environments.Limit);
        Assert.Contains("environments", status.OverLimit);
    }

    [Fact]
    public async Task Status_OverStorageLimit_ReturnsOverLimitWithStorage()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Create project and config with large payload (>512KB free tier limit)
        var projectId = await _projectRepo.CreateAsync(userId, new CreateProject("Project", $"proj-{id}", "hash"), null);
        var largeJson = new string('x', 600_000);
        await _configRepo.CreateAsync(userId, projectId, "production",
            new CreateProjectConfig(Major: 1, Minor: 0, Patch: 0, State: largeJson, Comment: "large config"));

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.True(status.Storage.Bytes > 512000, $"Expected storage > 512000 but was {status.Storage.Bytes}");
        Assert.Equal(512000L, status.Storage.Limit);
        Assert.Contains("storage", status.OverLimit);
    }

    [Fact]
    public async Task Status_MultipleOverLimits_ReturnsAllInOverLimitArray()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Over project limit: 2 projects (free limit = 1)
        await _projectRepo.CreateAsync(userId, new CreateProject("Project 1", $"proj-1-{id}", "hash1"), null);
        await _projectRepo.CreateAsync(userId, new CreateProject("Project 2", $"proj-2-{id}", "hash2"), null);

        // Environments derived: 2 projects * 2 envs/project = 4 (free limit = 2) -> also over limit

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Contains("projects", status.OverLimit);
        Assert.Contains("environments", status.OverLimit);
    }

    [Fact]
    public async Task Status_HobbyTierUser_NotOverLimit_ReturnsEmptyOverLimit()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Set tier to hobby (limits: 3 projects, unlimited environments)
        await _userRepo.SetTierAsync(userId, "hobby");

        // Create 2 projects (within hobby limit of 3)
        var proj1 = await _projectRepo.CreateAsync(userId, new CreateProject("Project 1", $"proj-1-{id}", "hash1"), null);
        var proj2 = await _projectRepo.CreateAsync(userId, new CreateProject("Project 2", $"proj-2-{id}", "hash2"), null);

        // Create some configs
        await _configRepo.CreateAsync(userId, proj1, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Init"));
        await _configRepo.CreateAsync(userId, proj2, "development",
            new CreateProjectConfig(1, 0, 0, "{}", "Init"));

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal("hobby", status.Tier);
        Assert.Empty(status.OverLimit);
    }

    [Fact]
    public async Task Status_OverApiRequestLimit_ReturnsOverLimitWithApiRequests()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Set API request counter to 250 (free tier limit = 200)
        var now = DateTime.UtcNow;
        _db.Counters[(userId, now.Year, now.Month)] = 250;

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.True(status.ApiRequests.Count >= 200, $"Expected API requests >= 200 but was {status.ApiRequests.Count}");
        Assert.Contains("api_requests", status.OverLimit);
    }
}
