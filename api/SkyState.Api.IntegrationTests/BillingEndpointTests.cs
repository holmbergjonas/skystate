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

public class BillingEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();
    private readonly IProjectRepository _projectRepo = factory.Services.GetRequiredService<IProjectRepository>();
    private readonly IProjectConfigRepository _configRepo = factory.Services.GetRequiredService<IProjectConfigRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..16];

    // --- POST /billing/checkout ---

    [Fact]
    public async Task Checkout_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/billing/checkout",
            new { Tier = "hobby", SuccessUrl = "https://example.com/success", CancelUrl = "https://example.com/cancel" }, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_Returns400_WhenMissingUrls()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Missing both URLs
        var response1 = await client.PostAsJsonAsync("/billing/checkout", new { Tier = "hobby" }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response1.StatusCode);

        // Missing SuccessUrl
        var response2 = await client.PostAsJsonAsync("/billing/checkout",
            new { Tier = "hobby", SuccessUrl = "", CancelUrl = "https://example.com/cancel" }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response2.StatusCode);

        // Missing CancelUrl
        var response3 = await client.PostAsJsonAsync("/billing/checkout",
            new { Tier = "hobby", SuccessUrl = "https://example.com/success", CancelUrl = "" }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response3.StatusCode);
    }

    [Fact]
    public async Task Checkout_Returns400_WhenInvalidTier()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.PostAsJsonAsync("/billing/checkout",
            new { Tier = "free", SuccessUrl = "https://example.com/success", CancelUrl = "https://example.com/cancel" }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_WithValidTier_ReachesEndpoint()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Stub returns NotFound (user not in Stripe) but the point is no 400/401 for routing/auth
        var response = await client.PostAsJsonAsync("/billing/checkout",
            new { Tier = "hobby", SuccessUrl = "https://example.com/success", CancelUrl = "https://example.com/cancel" }, CT);

        // Stub returns NotFound which maps to BadRequest("User not found") -- NOT 401/404
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- POST /billing/portal ---

    [Fact]
    public async Task Portal_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/billing/portal",
            new { ReturnUrl = "https://example.com/return" }, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Portal_Returns400_WhenMissingReturnUrl()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Missing ReturnUrl
        var response1 = await client.PostAsJsonAsync("/billing/portal", new { }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response1.StatusCode);

        // Empty ReturnUrl
        var response2 = await client.PostAsJsonAsync("/billing/portal",
            new { ReturnUrl = "" }, CT);
        Assert.Equal(HttpStatusCode.BadRequest, response2.StatusCode);
    }

    // --- POST /billing/boost/checkout ---

    [Fact]
    public async Task BoostCheckout_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/billing/boost/checkout",
            new { Quantity = 1, SuccessUrl = "https://example.com/success", CancelUrl = "https://example.com/cancel" }, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task BoostCheckout_ReachesEndpoint_WhenAuthenticated()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.PostAsJsonAsync("/billing/boost/checkout",
            new { Quantity = 1, SuccessUrl = "https://example.com/success", CancelUrl = "https://example.com/cancel" }, CT);

        // Stub returns NotFound -> BadRequest -- NOT 401/404/405
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- PUT /billing/boost ---

    [Fact]
    public async Task BoostUpdate_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/billing/boost",
            new { Quantity = 2 }, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task BoostUpdate_ReachesEndpoint_WhenAuthenticated()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.PutAsJsonAsync("/billing/boost",
            new { Quantity = 2 }, CT);

        // Stub returns NotFound -> BadRequest -- NOT 401/404/405
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- POST /billing/change-tier ---

    [Fact]
    public async Task ChangeTier_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/billing/change-tier",
            new { Tier = "pro" }, CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ChangeTier_ReachesEndpoint_WhenAuthenticated()
    {
        var id = Uid();
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.PostAsJsonAsync("/billing/change-tier",
            new { Tier = "pro" }, CT);

        // Stub returns NotFound -> BadRequest -- NOT 401/404/405
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- GET /billing/status ---

    [Fact]
    public async Task Status_Returns401_WhenUnauthenticated()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Status_ReturnsFreeTier_ForNewUser()
    {
        var id = Uid();
        // Create user via JIT provisioning with authenticated client
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "Test User");

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
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
    }

    [Fact]
    public async Task Status_ReturnsCorrectUsage_WithConfigs()
    {
        var id = Uid();
        // Create user
        var userId = await _userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Create a project
        var projectResponse = await client.PostAsJsonAsync("/projects",
            new CreateProject($"Test Project {id}", $"test-project-{id}", "hash"), CT);
        Assert.Equal(HttpStatusCode.Created, projectResponse.StatusCode);
        var projectLocation = projectResponse.Headers.Location!.ToString();
        var projectData = await (await client.GetAsync(projectLocation, CT)).Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(projectData);

        // Create config directly
        await _configRepo.CreateAsync(userId, projectData.ProjectId, "production",
            new CreateProjectConfig(1, 0, 0, "{\"test\": true}", "Initial"));

        // Get billing status - should show 1 project, derived environments, and some storage
        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal(1, status.Projects.Count);
        // Environments are derived: 1 project * 2 envs/project (free tier) = 2
        Assert.Equal(2, status.Environments.Count);
        Assert.True(status.Storage.Bytes > 0, "Storage should be > 0 after creating config");
    }

    // --- Limit enforcement tests ---

    [Fact]
    public async Task Status_ReflectsUsage_WithMultipleProjects()
    {
        var id = Uid();
        // Create user
        var userId = await _userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        using var client = factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        // Create 2 projects
        await _projectRepo.CreateAsync(userId, new CreateProject($"Project 1 {id}", $"proj-1-{id}", "hash1"), null);
        var proj2Id = await _projectRepo.CreateAsync(userId, new CreateProject($"Project 2 {id}", $"proj-2-{id}", "hash2"), null);

        // Create some configs
        await _configRepo.CreateAsync(userId, proj2Id, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial"));
        await _configRepo.CreateAsync(userId, proj2Id, "development",
            new CreateProjectConfig(1, 0, 0, "{}", "Dev init"));

        // Verify billing status reflects the counts
        var statusResponse = await client.GetAsync("/billing/status", CT);
        var status = await statusResponse.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal(2, status.Projects.Count);
        // Environments derived: 2 projects * 2 envs/project (free tier) = 4
        Assert.Equal(4, status.Environments.Count);
        Assert.True(status.Storage.Bytes > 0, "Storage should be > 0 after creating configs");
    }
}
