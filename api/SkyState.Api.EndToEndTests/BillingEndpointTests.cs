using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.EndToEndTests.Infrastructure;
using SkyState.Api.Models;
using Xunit;

namespace SkyState.Api.EndToEndTests;

/// <summary>
/// End-to-end tests for billing endpoints against real PostgreSQL.
/// These tests verify the billing status per-resource usage and limits
/// including project count, derived environment count, and total storage bytes.
/// </summary>
[Collection(EndToEndCollection.Name)]
public class BillingEndpointTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public BillingEndpointTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    private record CreateProjectResponse(Guid ProjectId);
    private record CreateConfigResponse(Guid ProjectConfigId);

    /// <summary>
    /// Helper to create a project via POST /projects and return the projectId.
    /// </summary>
    private async Task<Guid> CreateProjectViaApi(HttpClient client, string name, string slug, string apiKeyHash)
    {
        var response = await client.PostAsJsonAsync("/projects",
            new CreateProject(name, slug, apiKeyHash), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<CreateProjectResponse>(CT);
        Assert.NotNull(result);
        return result.ProjectId;
    }

    /// <summary>
    /// Helper to create a config via POST /project/{projectId}/config/{envSlug} and return the configId.
    /// </summary>
    private async Task<Guid> CreateConfigViaApi(HttpClient client, Guid projectId, string envSlug, int major, int minor, int patch, string state, string? comment = null)
    {
        var response = await client.PostAsJsonAsync($"/project/{projectId}/config/{envSlug}",
            new CreateProjectConfig(major, minor, patch, state, comment), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<CreateConfigResponse>(CT);
        Assert.NotNull(result);
        return result.ProjectConfigId;
    }

    // --- GET /billing/status ---

    [Fact]
    public async Task GetBillingStatus_FreshUser_ReturnsFreeWithZeroUsage()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal("free", status.Tier);
        Assert.Equal(1, status.BoostMultiplier);
        Assert.Equal(0, status.Projects.Count);
        Assert.Null(status.Projects.Limit);
        Assert.Equal(0, status.Environments.Count);
        Assert.Null(status.Environments.Limit);
        Assert.Equal(0L, status.Storage.Bytes);
        Assert.Null(status.Storage.Limit);
        Assert.Null(status.RetentionDays);
        Assert.Null(status.CurrentPeriodEnd);
    }

    [Fact]
    public async Task GetBillingStatus_WithData_ReflectsProjectCountAndStorage()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        // Create a project and a config
        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");
        var jsonBody = "{\"key\":\"value\",\"number\":42}";
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, jsonBody, "First release");

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal("free", status.Tier);
        Assert.Equal(1, status.Projects.Count);     // 1 project created
        Assert.Null(status.Projects.Limit);
        // Environments are derived: projectCount * environmentsPerProject
        Assert.True(status.Environments.Count > 0, "Environment count should be derived from projects");
        Assert.True(status.Storage.Bytes > 0);        // total storage includes all config versions
        Assert.Null(status.Storage.Limit);
    }

    [Fact]
    public async Task GetBillingStatus_MultipleProjects_CountsProjectsAndDerivedEnvironments()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        // Create 2 projects with configs
        var project1Id = await CreateProjectViaApi(client, "Project 1", $"proj-1-{id}", "hash1");
        var project2Id = await CreateProjectViaApi(client, "Project 2", $"proj-2-{id}", "hash2");
        await CreateConfigViaApi(client, project1Id, "production", 1, 0, 0, "{}", "Prod v1");
        await CreateConfigViaApi(client, project2Id, "development", 1, 0, 0, "{}", "Dev v1");

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = await response.Content.ReadFromJsonAsync<BillingStatusResponse>(CT);
        Assert.NotNull(status);
        Assert.Equal(2, status.Projects.Count);       // 2 projects
        // Environments derived: 2 projects * environmentsPerProject (e.g. 2 for free tier) = 4
        Assert.True(status.Environments.Count >= 2, $"Expected derived env count >= 2 but was {status.Environments.Count}");
        Assert.True(status.Storage.Bytes > 0);         // has config data
    }

    [Fact]
    public async Task GetBillingStatus_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/billing/status", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
