using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.EndToEndTests.Infrastructure;
using SkyState.Api.Models;
using Xunit;

namespace SkyState.Api.EndToEndTests;

/// <summary>
/// Comprehensive CRUD lifecycle test that exercises the full
/// project -> config version pipeline end-to-end.
/// Verifies every entity can be created, read, updated, and deleted.
/// </summary>
[Collection(EndToEndCollection.Name)]
public class CrudLifecycleTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public CrudLifecycleTests()
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
    /// Compares two JSON strings semantically (ignoring key order and whitespace).
    /// PostgreSQL jsonb normalizes JSON, so we can't use string equality.
    /// </summary>
    private static void AssertJsonEqual(string expected, string actual)
    {
        var expectedDoc = JsonDocument.Parse(expected);
        var actualDoc = JsonDocument.Parse(actual);
        Assert.True(
            JsonElement.DeepEquals(expectedDoc.RootElement, actualDoc.RootElement),
            $"JSON mismatch.\nExpected: {expected}\nActual:   {actual}");
    }

    /// <summary>
    /// Full CRUD lifecycle: project -> config versions -> rollback -> public read -> cleanup.
    /// Exercises every entity type through create, read, update, and delete operations.
    /// </summary>
    [Fact]
    public async Task FullCrudLifecycle_AllEntitiesCreateReadUpdateDelete()
    {
        var id = Uid();
        var projectSlug = $"lifecycle-{id}";
        using var client = _factory.CreateAuthenticatedClient(
            $"lifecycle-{id}", $"lifecycle-{id}@test.com", "Lifecycle User");

        // == PROJECT CRUD ==

        // 1. Create project
        var createProjResponse = await client.PostAsJsonAsync("/projects",
            new CreateProject("Lifecycle Test Project", projectSlug, "hash-lifecycle"), CT);
        Assert.Equal(HttpStatusCode.Created, createProjResponse.StatusCode);
        Assert.NotNull(createProjResponse.Headers.Location);
        var createProjResult = await createProjResponse.Content.ReadFromJsonAsync<CreateProjectResponse>(CT);
        Assert.NotNull(createProjResult);
        var projectId = createProjResult.ProjectId;

        // 2. Read project by ID
        var getProjByIdResponse = await client.GetAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.OK, getProjByIdResponse.StatusCode);
        var project = await getProjByIdResponse.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("Lifecycle Test Project", project.Name);
        Assert.Equal(projectSlug, project.Slug);

        // 3. Read project by slug
        var getProjBySlugResponse = await client.GetAsync($"/projects/by-slug/{projectSlug}", CT);
        Assert.Equal(HttpStatusCode.OK, getProjBySlugResponse.StatusCode);
        var projectBySlug = await getProjBySlugResponse.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(projectBySlug);
        Assert.Equal(projectId, projectBySlug.ProjectId);

        // 4. List projects (verify it appears)
        var listProjResponse = await client.GetAsync("/projects", CT);
        Assert.Equal(HttpStatusCode.OK, listProjResponse.StatusCode);
        var projects = await listProjResponse.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projects);
        Assert.Contains(projects, p => p.ProjectId == projectId);

        // 5. Update project
        var updateProjResponse = await client.PutAsJsonAsync($"/projects/{projectId}",
            new UpdateProject("Lifecycle Updated Name", "hash-lifecycle-updated"), CT);
        Assert.Equal(HttpStatusCode.NoContent, updateProjResponse.StatusCode);

        // 6. Verify project update persisted
        var getProjUpdatedResponse = await client.GetAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.OK, getProjUpdatedResponse.StatusCode);
        var updatedProject = await getProjUpdatedResponse.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(updatedProject);
        Assert.Equal("Lifecycle Updated Name", updatedProject.Name);

        // == CONFIG VERSION CRUD ==

        // 7. Create config 1.0.0
        var config100Json = "{\"key\":\"v1\",\"nested\":{\"a\":1}}";
        var createConfig100Response = await client.PostAsJsonAsync(
            $"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 0, 0, config100Json, "First release"), CT);
        Assert.Equal(HttpStatusCode.Created, createConfig100Response.StatusCode);
        var createConfig100Result = await createConfig100Response.Content
            .ReadFromJsonAsync<CreateConfigResponse>(CT);
        Assert.NotNull(createConfig100Result);
        var configId100 = createConfig100Result.ProjectConfigId;

        // 8. Create config 1.1.0
        var config110Json = "{\"key\":\"v1\",\"nested\":{\"a\":1},\"added\":\"field\"}";
        var createConfig110Response = await client.PostAsJsonAsync(
            $"/project/{projectId}/config/production",
            new CreateProjectConfig(1, 1, 0, config110Json, "Added field"), CT);
        Assert.Equal(HttpStatusCode.Created, createConfig110Response.StatusCode);

        // 9. List configs (should have 2: 1.1.0, 1.0.0 in desc order)
        var listConfigsResponse = await client.GetAsync(
            $"/project/{projectId}/config/production", CT);
        Assert.Equal(HttpStatusCode.OK, listConfigsResponse.StatusCode);
        var allConfigs = await listConfigsResponse.Content.ReadFromJsonAsync<List<ProjectConfig>>(CT);
        Assert.NotNull(allConfigs);
        Assert.Equal(2, allConfigs.Count);
        Assert.Equal(new Models.Version(1, 1, 0), allConfigs[0].Version);
        Assert.Equal(new Models.Version(1, 0, 0), allConfigs[1].Version);

        // 10. Get latest config (should be 1.1.0)
        var getLatestResponse = await client.GetAsync(
            $"/project/{projectId}/config/production/latest", CT);
        Assert.Equal(HttpStatusCode.OK, getLatestResponse.StatusCode);
        var latestConfig = await getLatestResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(latestConfig);
        Assert.Equal(new Models.Version(1, 1, 0), latestConfig.Version);
        AssertJsonEqual(config110Json, latestConfig.State);
        Assert.Equal("Added field", latestConfig.Comment);

        // 11. Get config by ID (verify specific version data)
        var getConfigByIdResponse = await client.GetAsync($"/project/config/{configId100}", CT);
        Assert.Equal(HttpStatusCode.OK, getConfigByIdResponse.StatusCode);
        var configById = await getConfigByIdResponse.Content.ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(configById);
        Assert.Equal(configId100, configById.ProjectStateId);
        AssertJsonEqual(config100Json, configById.State);
        Assert.Equal("First release", configById.Comment);

        // == ROLLBACK ==

        // 12. Rollback to 1.0.0 (same major, different minor -> creates 1.2.0)
        var rollbackResponse = await client.PostAsync(
            $"/project/{projectId}/config/production/rollback/{configId100}",
            null, CT);
        Assert.Equal(HttpStatusCode.Created, rollbackResponse.StatusCode);
        Assert.Contains("/project/config/", rollbackResponse.Headers.Location!.ToString());

        // 13. Verify rollback created correct version with original content
        var getRolledBackResponse = await client.GetAsync(
            rollbackResponse.Headers.Location!.ToString(), CT);
        Assert.Equal(HttpStatusCode.OK, getRolledBackResponse.StatusCode);
        var rolledBackConfig = await getRolledBackResponse.Content
            .ReadFromJsonAsync<ProjectConfig>(CT);
        Assert.NotNull(rolledBackConfig);
        Assert.Equal(new Models.Version(1, 2, 0), rolledBackConfig.Version);
        AssertJsonEqual(config100Json, rolledBackConfig.State);
        Assert.Equal("Rollback to version 1.0.0", rolledBackConfig.Comment);

        // == PUBLIC READ ==

        // 14. Public read (no auth) verifies config and caching headers
        using var publicClient = _factory.CreateClient();
        var publicReadResponse = await publicClient.GetAsync(
            $"/project/{projectSlug}/config/production", CT);
        Assert.Equal(HttpStatusCode.OK, publicReadResponse.StatusCode);

        // Verify caching headers
        Assert.True(publicReadResponse.Headers.Contains("Cache-Control"));

        // Verify response body contains config data
        var publicBody = await publicReadResponse.Content.ReadAsStringAsync(CT);
        Assert.Contains("\"version\"", publicBody);
        Assert.Contains("\"config\"", publicBody);

        // == CLEANUP (DELETE) ==

        // 15. Delete project
        var deleteProjResponse = await client.DeleteAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, deleteProjResponse.StatusCode);

        // 16. Verify project is gone
        var getDeletedProjResponse = await client.GetAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.NotFound, getDeletedProjResponse.StatusCode);
    }
}
