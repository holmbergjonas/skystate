using System;
using System.Collections.Generic;
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
/// End-to-end tests for project endpoints against real PostgreSQL.
/// All data setup happens via HTTP calls (no direct repository access).
/// </summary>
[Collection(EndToEndCollection.Name)]
public class ProjectEndpointTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public ProjectEndpointTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    private record CreateProjectResponse(Guid ProjectId);

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

    // --- POST /projects ---

    [Fact]
    public async Task CreateProject_Authenticated_ReturnsCreatedWithLocationHeader()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var response = await client.PostAsJsonAsync("/projects",
            new CreateProject("Test Project", $"test-proj-{id}", "hash123"), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);

        // Follow Location header to verify project exists
        var getResponse = await client.GetAsync(response.Headers.Location.ToString(), CT);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var project = await getResponse.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("Test Project", project.Name);
        Assert.Equal($"test-proj-{id}", project.Slug);
    }

    [Fact]
    public async Task CreateProject_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/projects",
            new CreateProject("Unauthorized Project", "unauth-proj", "hash"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- GET /projects ---

    [Fact]
    public async Task ListProjects_ReturnsOnlyCurrentUsersProjects()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // Create 2 projects for user A
        await CreateProjectViaApi(clientA, "A Project 1", $"a-proj-1-{id}", "hash-a1");
        await CreateProjectViaApi(clientA, "A Project 2", $"a-proj-2-{id}", "hash-a2");

        // Create 1 project for user B
        await CreateProjectViaApi(clientB, "B Project", $"b-proj-{id}", "hash-b");

        // User A should see only their 2 projects
        var responseA = await clientA.GetAsync("/projects", CT);
        Assert.Equal(HttpStatusCode.OK, responseA.StatusCode);
        var projectsA = await responseA.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projectsA);
        Assert.Equal(2, projectsA.Count);

        // User B should see only their 1 project
        var responseB = await clientB.GetAsync("/projects", CT);
        Assert.Equal(HttpStatusCode.OK, responseB.StatusCode);
        var projectsB = await responseB.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projectsB);
        Assert.Single(projectsB);
    }

    [Fact]
    public async Task ListProjects_NoProjects_ReturnsEmptyList()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"fresh-user-{id}", $"fresh-{id}@test.com", "Fresh User");

        var response = await client.GetAsync("/projects", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var projects = await response.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projects);
        Assert.Empty(projects);
    }

    // --- GET /projects/{projectId} ---

    [Fact]
    public async Task GetProjectById_OwnProject_ReturnsOk()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"owner-{id}", $"owner-{id}@test.com", "Owner");

        var projectId = await CreateProjectViaApi(client, "My Project", $"my-proj-{id}", "hash-mine");

        var response = await client.GetAsync($"/projects/{projectId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var project = await response.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal(projectId, project.ProjectId);
        Assert.Equal("My Project", project.Name);
    }

    [Fact]
    public async Task GetProjectById_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates a project
        var projectId = await CreateProjectViaApi(clientA, "A's Secret", $"a-secret-{id}", "hash-a");

        // User B tries to access it
        var response = await clientB.GetAsync($"/projects/{projectId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetProjectById_NonexistentId_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.GetAsync($"/projects/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /projects/by-slug/{slug} ---

    [Fact]
    public async Task GetProjectBySlug_OwnSlug_ReturnsOk()
    {
        var id = Uid();
        var slug = $"unique-slug-{id}";
        using var client = _factory.CreateAuthenticatedClient($"slug-owner-{id}", $"slug-owner-{id}@test.com", "Slug Owner");

        var projectId = await CreateProjectViaApi(client, "Slug Project", slug, "hash-slug");

        var response = await client.GetAsync($"/projects/by-slug/{slug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var project = await response.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal(projectId, project.ProjectId);
        Assert.Equal(slug, project.Slug);
    }

    [Fact]
    public async Task GetProjectBySlug_OtherUsersSlug_ReturnsNotFound()
    {
        var id = Uid();
        var slug = $"other-slug-{id}";
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates a project with this slug
        await CreateProjectViaApi(clientA, "A's Slug Project", slug, "hash-a");

        // User B tries to lookup by slug
        var response = await clientB.GetAsync($"/projects/by-slug/{slug}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- PUT /projects/{projectId} ---

    [Fact]
    public async Task UpdateProject_OwnProject_ReturnsNoContentAndPersistsChanges()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"updater-{id}", $"updater-{id}@test.com", "Updater");

        var projectId = await CreateProjectViaApi(client, "Original Name", $"orig-{id}", "hash-original");

        // Update the project
        var updateResponse = await client.PutAsJsonAsync($"/projects/{projectId}",
            new UpdateProject("Updated Name", "hash-updated"), CT);

        Assert.Equal(HttpStatusCode.NoContent, updateResponse.StatusCode);

        // Verify the changes persisted
        var getResponse = await client.GetAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var project = await getResponse.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("Updated Name", project.Name);
        Assert.Equal("hash-updated", project.ApiKeyHash);
    }

    [Fact]
    public async Task UpdateProject_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates a project
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");

        // User B tries to update it
        var response = await clientB.PutAsJsonAsync($"/projects/{projectId}",
            new UpdateProject("Hacked", "hash-hacked"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateProject_NonexistentId_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.PutAsJsonAsync($"/projects/{Guid.NewGuid()}",
            new UpdateProject("Ghost", "hash-ghost"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /projects/{projectId} ---

    [Fact]
    public async Task DeleteProject_OwnProject_ReturnsNoContentAndRemoves()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"deleter-{id}", $"deleter-{id}@test.com", "Deleter");

        var projectId = await CreateProjectViaApi(client, "To Delete", $"to-delete-{id}", "hash-delete");

        // Delete the project
        var deleteResponse = await client.DeleteAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        // Verify it's gone
        var getResponse = await client.GetAsync($"/projects/{projectId}", CT);
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task DeleteProject_OtherUsersProject_ReturnsNotFound()
    {
        var id = Uid();
        using var clientA = _factory.CreateAuthenticatedClient($"user-a-{id}", $"user-a-{id}@test.com", "User A");
        using var clientB = _factory.CreateAuthenticatedClient($"user-b-{id}", $"user-b-{id}@test.com", "User B");

        // User A creates a project
        var projectId = await CreateProjectViaApi(clientA, "A's Project", $"a-proj-{id}", "hash-a");

        // User B tries to delete it
        var response = await clientB.DeleteAsync($"/projects/{projectId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteProject_NonexistentId_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"user-{id}", $"user-{id}@test.com", "User");

        var response = await client.DeleteAsync($"/projects/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
