using System;
using System.Collections.Generic;
using System.Linq;
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

public class ProjectConfigEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();
    private readonly IProjectRepository _projectRepo = factory.Services.GetRequiredService<IProjectRepository>();
    private readonly IProjectConfigRepository _configRepo = factory.Services.GetRequiredService<IProjectConfigRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    // --- GET /project/config/{id} ---

    [Fact]
    public async Task GetConfig_AsAlice_OwnConfig_ReturnsOk()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        var configId = await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial release"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/config/{configId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var config = await response.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(1, config.Major);
        Assert.Equal(0, config.Minor);
        Assert.Equal(0, config.Patch);
        Assert.Equal("1.0.0", config.Version.ToString());
        Assert.Equal("Initial release", config.Comment);
    }

    [Fact]
    public async Task GetConfig_AsAlice_BobsConfig_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        var bobConfigId = await _configRepo.CreateAsync(bobId, bobProjectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/config/{bobConfigId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetConfig_UnknownId_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/config/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /project/{projectId}/config/{envSlug} ---

    [Fact]
    public async Task ListConfigs_AsAlice_OwnProject_ReturnsConfigs()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial"));
        await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 1, 0, "{}", "Update"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/{projectId}/config/production", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var configs = await response.Content.ReadFromJsonAsync<List<ProjectConfig>>(CT);
        Assert.NotNull(configs);
        Assert.Equal(2, configs.Count);
    }

    [Fact]
    public async Task ListConfigs_AsAlice_BobsProject_ReturnsEmpty()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(bobId, bobProjectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/{bobProjectId}/config/production", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var configs = await response.Content.ReadFromJsonAsync<List<ProjectConfig>>(CT);
        Assert.NotNull(configs);
        Assert.Empty(configs);
    }

    // --- GET /project/{projectId}/config/{envSlug}/latest ---

    [Fact]
    public async Task GetLatestConfig_AsAlice_OwnProject_ReturnsLatest()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial"));
        var latestId = await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 1, 0, "{}", "Update"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/{projectId}/config/production/latest", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var config = await response.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(latestId, config.ProjectStateId);
    }

    [Fact]
    public async Task GetLatestConfig_AsAlice_BobsProject_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(bobId, bobProjectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/{bobProjectId}/config/production/latest", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetLatestConfig_UnknownProject_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/project/{Guid.NewGuid()}/config/production/latest", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- POST /project/{projectId}/config/{envSlug} ---

    [Fact]
    public async Task CreateConfig_AsAlice_OwnProject_ReturnsCreated()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PostAsJsonAsync($"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, "{\"new\": true}", "Major release"), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Contains("/project/config/", response.Headers.Location!.ToString());
        var verify = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var config = await verify.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Equal(1, config.Major);
        Assert.Equal(0, config.Minor);
        Assert.Equal("1.0.0", config.Version.ToString());
        Assert.Equal("Major release", config.Comment);
    }

    // --- POST /project/{projectId}/config/{envSlug}/rollback/{targetId} ---

    [Fact]
    public async Task Rollback_AsAlice_OwnConfig_ReturnsCreated()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        var config1Id = await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial"));
        await _configRepo.CreateAsync(aliceId, projectId, "production",
            new CreateProjectConfig(1, 1, 0, "{}", "Update"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PostAsync(
            $"/project/{projectId}/config/production/rollback/{config1Id}", null, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Contains("/project/config/", response.Headers.Location!.ToString());
        var verify = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var config = await verify.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(config);
        Assert.Contains("Rollback to version 1.0.0", config.Comment);
    }

    // --- GET /project/{projectSlug}/config/{environmentSlug} (Public) ---

    [Fact]
    public async Task GetPublicConfig_ValidSlugs_ReturnsConfigWithCacheHeaders()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        var projectId = await _projectRepo.CreateAsync(userId, new CreateProject("Test Project", $"test-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(userId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{\"foo\":\"bar\"}", "Initial"));
        using var client = factory.CreateClient(); // Unauthenticated

        var response = await client.GetAsync($"/project/test-proj-{id}/config/production", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // Verify cache headers -- only max-age, no stale-while-revalidate or ETag per v1 design
        Assert.True(response.Headers.CacheControl is not null);
        Assert.Contains("max-age=", response.Headers.CacheControl.ToString());

        // Verify response body envelope uses "config" field
        var json = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(CT);
        var versionObj = json.GetProperty("version");
        Assert.Equal(1, versionObj.GetProperty("major").GetInt32());
        Assert.Equal(0, versionObj.GetProperty("minor").GetInt32());
        Assert.Equal(0, versionObj.GetProperty("patch").GetInt32());
        Assert.True(json.GetProperty("lastModified").GetString() is not null);
        var configObj = json.GetProperty("config");
        Assert.Equal("bar", configObj.GetProperty("foo").GetString());
    }

    [Fact]
    public async Task GetPublicConfig_InvalidSlugFormat_Returns400()
    {
        using var client = factory.CreateClient(); // Unauthenticated

        var response = await client.GetAsync("/project/Invalid_Slug/config/UPPERCASE", CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var json = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(CT);
        Assert.Equal("invalid_slug_format", json.GetProperty("error").GetString());
    }

    [Fact]
    public async Task GetPublicConfig_UnknownProject_Returns404()
    {
        using var client = factory.CreateClient(); // Unauthenticated

        var response = await client.GetAsync("/project/nonexistent-project/config/production", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(CT);
        Assert.True(string.IsNullOrEmpty(body));
    }

    [Fact]
    public async Task GetPublicConfig_UnknownEnvironment_Returns404()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        var projectId = await _projectRepo.CreateAsync(userId, new CreateProject("Test Project", $"test-proj-{id}", "hash"), null);
        // Create project but no config for this environment
        using var client = factory.CreateClient(); // Unauthenticated

        var response = await client.GetAsync($"/project/test-proj-{id}/config/nonexistent", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(CT);
        Assert.True(string.IsNullOrEmpty(body));
    }

    [Fact]
    public async Task GetPublicConfig_CorsHeaderPresent()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(new CreateUser("github", $"user-{id}", $"user-{id}@test.com", "User"));
        var projectId = await _projectRepo.CreateAsync(userId, new CreateProject("Test Project", $"test-proj-{id}", "hash"), null);
        await _configRepo.CreateAsync(userId, projectId, "production",
            new CreateProjectConfig(1, 0, 0, "{}", "Initial"));
        using var client = factory.CreateClient(); // Unauthenticated

        client.DefaultRequestHeaders.Add("Origin", "https://example.com");
        var response = await client.GetAsync($"/project/test-proj-{id}/config/production", CT);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        var corsHeader = response.Headers.GetValues("Access-Control-Allow-Origin").First();
        Assert.Equal("*", corsHeader);
    }
}
