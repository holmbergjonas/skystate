using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.EndToEndTests.Infrastructure;
using SkyState.Api.Models;
using Xunit;

namespace SkyState.Api.EndToEndTests;

/// <summary>
/// End-to-end tests for project config endpoints against real PostgreSQL.
/// These tests verify complex repository query logic including semantic version ordering,
/// version conflict prevention, CTE rollback logic, and public slug-based reads with caching.
/// All data setup happens via HTTP calls (no direct repository access).
/// </summary>
[Collection(EndToEndCollection.Name)]
public class ProjectConfigEndpointTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public ProjectConfigEndpointTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    /// <summary>
    /// Compares two JSON strings semantically (ignoring whitespace formatting).
    /// PostgreSQL jsonb normalizes JSON, so we can't use string equality.
    /// </summary>
    private static void AssertJsonEqual(string expected, string actual)
    {
        var expectedDoc = JsonDocument.Parse(expected);
        var actualDoc = JsonDocument.Parse(actual);
        var normalizedExpected = JsonSerializer.Serialize(expectedDoc.RootElement);
        var normalizedActual = JsonSerializer.Serialize(actualDoc.RootElement);
        Assert.Equal(normalizedExpected, normalizedActual);
    }

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
    /// Helper to create a config via POST /project/{projectId}/config/{envSlug} and return the projectConfigId.
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

    // --- POST /project/{projectId}/config/{envSlug} ---

    [Fact]
    public async Task CreateConfig_ValidVersion_ReturnsCreated()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create config 1.0.0 with JSON content
        var response = await client.PostAsJsonAsync($"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, "{\"key\":\"value\"}", "First release"), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);
        Assert.Contains("/project/config/", response.Headers.Location.ToString());

        // Follow Location header to verify config exists with correct data
        var getResponse = await client.GetAsync(response.Headers.Location.ToString(), CT);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var config = await getResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(1, config.Major);
        Assert.Equal(0, config.Minor);
        Assert.Equal(0, config.Patch);
        AssertJsonEqual("{\"key\":\"value\"}", config.State);
        Assert.Equal("First release", config.Comment);
    }

    [Fact]
    public async Task CreateConfig_DuplicateVersion_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 1.0.0
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{}", "First");

        // Try to create 1.0.0 again - the NOT EXISTS clause blocks it
        var response = await client.PostAsJsonAsync($"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, "{}", "Duplicate"), CT);

        // The INSERT returns NULL -> Guid.Empty -> 404
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreateConfig_LowerVersion_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 2.0.0
        await CreateConfigViaApi(client, projectId, "production", 2, 0, 0, "{}", "Version 2");

        // Try to create 1.0.0 - the tuple comparison >= should block it
        var response = await client.PostAsJsonAsync($"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, "{}", "Lower version"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreateConfig_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates project
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");

        // User B tries to create config in User A's project - ownership check blocks it
        var response = await clientB.PostAsJsonAsync($"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, "{}", "Hacked"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreateConfig_StateSizeBytesCalculated()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create config with known JSON string
        var knownState = "{\"test\":\"data\",\"number\":42}";
        var configId = await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, knownState, "Size test");

        // GET the config back and check StateSizeBytes matches octet_length
        var response = await client.GetAsync($"/project/config/{configId}", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var config = await response.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(knownState.Length, config.StateSizeBytes);
    }

    // --- GET /project/{projectId}/config/{envSlug} ---

    [Fact]
    public async Task ListConfigs_ReturnedInSemanticVersionDescOrder()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create configs in non-semantic order: 1.0.0, 1.0.5, 1.1.0, 2.0.0
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{}", "v1.0.0");
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 5, "{}", "v1.0.5");
        await CreateConfigViaApi(client, projectId, "production", 1, 1, 0, "{}", "v1.1.0");
        await CreateConfigViaApi(client, projectId, "production", 2, 0, 0, "{}", "v2.0.0");

        // List should return them in semantic version DESC order: 2.0.0, 1.1.0, 1.0.5, 1.0.0
        var response = await client.GetAsync($"/project/{projectId}/config/production", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var configs = await response.Content.ReadFromJsonAsync<List<ProjectConfig>>(CT);
        Assert.NotNull(configs);
        Assert.Equal(4, configs.Count);

        Assert.Equal(new Models.Version(2, 0, 0), configs[0].Version);
        Assert.Equal(new Models.Version(1, 1, 0), configs[1].Version);
        Assert.Equal(new Models.Version(1, 0, 5), configs[2].Version);
        Assert.Equal(new Models.Version(1, 0, 0), configs[3].Version);
    }

    [Fact]
    public async Task ListConfigs_OtherUsersProject_ReturnsEmptyList()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates project and config
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");
        await CreateConfigViaApi(clientA, projectId, "production", 1, 0, 0, "{}", "Version 1");

        // User B listing configs for User A's project gets empty
        var response = await clientB.GetAsync($"/project/{projectId}/config/production", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var configs = await response.Content.ReadFromJsonAsync<List<ProjectConfig>>(CT);
        Assert.NotNull(configs);
        Assert.Empty(configs);
    }

    // --- GET /project/{projectId}/config/{envSlug}/latest ---

    [Fact]
    public async Task GetLatestConfig_ReturnsHighestSemanticVersion()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 1.0.0, 1.0.5, 1.1.0, 2.0.0 in that order
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{}", "v1.0.0");
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 5, "{}", "v1.0.5");
        await CreateConfigViaApi(client, projectId, "production", 1, 1, 0, "{}", "v1.1.0");
        await CreateConfigViaApi(client, projectId, "production", 2, 0, 0, "{\"latest\":true}", "v2.0.0");

        // Latest should be 2.0.0
        var response = await client.GetAsync($"/project/{projectId}/config/production/latest", CT);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var config = await response.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(new Models.Version(2, 0, 0), config.Version);
        AssertJsonEqual("{\"latest\":true}", config.State);
    }

    [Fact]
    public async Task GetLatestConfig_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates project and config
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");
        await CreateConfigViaApi(clientA, projectId, "production", 1, 0, 0, "{}", "Version 1");

        // User B tries to get latest config
        var response = await clientB.GetAsync($"/project/{projectId}/config/production/latest", CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /project/config/{projectConfigId} ---

    [Fact]
    public async Task GetConfigById_OwnConfig_ReturnsOk()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");
        var configId = await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{\"test\":true}", "Test config");

        var response = await client.GetAsync($"/project/config/{configId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var config = await response.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(configId, config.ProjectStateId);
        AssertJsonEqual("{\"test\":true}", config.State);
    }

    [Fact]
    public async Task GetConfigById_OtherUsersConfig_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates project and config
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");
        var configId = await CreateConfigViaApi(clientA, projectId, "production", 1, 0, 0, "{}", "A's config");

        // User B tries to access it
        var response = await clientB.GetAsync($"/project/config/{configId}", CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetConfigById_NonexistentId_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var response = await client.GetAsync($"/project/config/{Guid.NewGuid()}", CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- POST /project/{projectId}/config/{envSlug}/rollback/{targetId} ---

    [Fact]
    public async Task Rollback_SameMajorSameMinor_IncrementsPatch()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 1.0.0 and 1.0.2
        var targetId = await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{\"rollback\":\"target\"}", "v1.0.0");
        await CreateConfigViaApi(client, projectId, "production", 1, 0, 2, "{}", "v1.0.2");

        // Rollback to 1.0.0 target - should create 1.0.3 (patch+1)
        var response = await client.PostAsync($"/project/{projectId}/config/production/rollback/{targetId}", null, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Contains("/project/config/", response.Headers.Location!.ToString());

        // Verify the new config
        var getResponse = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var newConfig = await getResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(newConfig);
        Assert.Equal(new Models.Version(1, 0, 3), newConfig.Version);
        AssertJsonEqual("{\"rollback\":\"target\"}", newConfig.State);
        Assert.Equal("Rollback to version 1.0.0", newConfig.Comment);
    }

    [Fact]
    public async Task Rollback_SameMajorDifferentMinor_IncrementsMinorResetsPatch()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 1.0.0 and 1.2.0
        var targetId = await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{\"rollback\":\"target\"}", "v1.0.0");
        await CreateConfigViaApi(client, projectId, "production", 1, 2, 0, "{}", "v1.2.0");

        // Rollback to 1.0.0 target - should create 1.3.0 (minor+1, patch=0)
        var response = await client.PostAsync($"/project/{projectId}/config/production/rollback/{targetId}", null, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var getResponse = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var newConfig = await getResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(newConfig);
        Assert.Equal(new Models.Version(1, 3, 0), newConfig.Version);
        AssertJsonEqual("{\"rollback\":\"target\"}", newConfig.State);
    }

    [Fact]
    public async Task Rollback_DifferentMajor_IncrementsMajorResetsMinorAndPatch()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var projectId = await CreateProjectViaApi(client, "Test Project", $"test-proj-{id}", "hash123");

        // Create 1.0.0 and 2.0.0
        var targetId = await CreateConfigViaApi(client, projectId, "production", 1, 0, 0, "{\"rollback\":\"target\"}", "v1.0.0");
        await CreateConfigViaApi(client, projectId, "production", 2, 0, 0, "{}", "v2.0.0");

        // Rollback to 1.0.0 target - should create 3.0.0 (major+1, minor=0, patch=0)
        var response = await client.PostAsync($"/project/{projectId}/config/production/rollback/{targetId}", null, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var getResponse = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var newConfig = await getResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(newConfig);
        Assert.Equal(new Models.Version(3, 0, 0), newConfig.Version);
        AssertJsonEqual("{\"rollback\":\"target\"}", newConfig.State);
    }

    [Fact]
    public async Task Rollback_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates project and configs
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");
        var targetId = await CreateConfigViaApi(clientA, projectId, "production", 1, 0, 0, "{}", "v1.0.0");
        await CreateConfigViaApi(clientA, projectId, "production", 2, 0, 0, "{}", "v2.0.0");

        // User B tries to rollback - ownership check blocks it
        var response = await clientB.PostAsync($"/project/{projectId}/config/production/rollback/{targetId}", null, CT);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /project/{projectSlug}/config/{environmentSlug} (public read) ---

    [Fact]
    public async Task PublicRead_ValidSlugs_ReturnsConfigWithCachingHeaders()
    {
        var id = Uid();
        using var authClient = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        // Create project and config
        var projectId = await CreateProjectViaApi(authClient, "Test Project", $"test-proj-{id}", "hash123");
        await CreateConfigViaApi(authClient, projectId, "production", 1, 0, 0, "{\"public\":true}", "Public config");

        // Public read - no auth required
        using var publicClient = _factory.CreateClient();
        var response = await publicClient.GetAsync($"/project/test-proj-{id}/config/production", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // Verify response has caching headers
        Assert.True(response.Headers.Contains("Cache-Control"));

        // Verify response body structure
        var body = await response.Content.ReadAsStringAsync(CT);
        Assert.Contains("\"version\"", body);
        Assert.Contains("\"lastModified\"", body);
        Assert.Contains("\"config\"", body);
        Assert.Contains("\"public\":true", body);
    }

    [Fact]
    public async Task PublicRead_NonexistentSlugs_Returns404()
    {
        using var publicClient = _factory.CreateClient();

        var response = await publicClient.GetAsync($"/project/nonexistent-proj/config/nonexistent-env", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PublicRead_InvalidSlugFormat_Returns400()
    {
        using var publicClient = _factory.CreateClient();

        // Slug with uppercase or special chars should return 400
        var response = await publicClient.GetAsync($"/project/InvalidSlug/config/production", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(CT);
        Assert.Contains("invalid_slug_format", body);
    }
}
