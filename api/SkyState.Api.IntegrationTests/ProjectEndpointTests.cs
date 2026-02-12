using System;
using System.Collections.Generic;
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

public class ProjectEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();
    private readonly IProjectRepository _projectRepo = factory.Services.GetRequiredService<IProjectRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    // --- GET /projects ---

    [Fact]
    public async Task ListProjects_AsAlice_ReturnsOnlyAliceProjects()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project 1", $"alice-proj-1-{id}", "hash"), null);
        await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project 2", $"alice-proj-2-{id}", "hash"), null);
        await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync("/projects", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var projects = await response.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projects);
        Assert.Equal(2, projects.Count);
        Assert.All(projects, p => Assert.Equal(aliceId, p.UserId));
    }

    [Fact]
    public async Task ListProjects_AsBob_ReturnsOnlyBobProjects()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project 1", $"bob-proj-1-{id}", "hash"), null);
        await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project 2", $"bob-proj-2-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"bob-{id}", $"bob-{id}@test.com", "Bob");

        var response = await client.GetAsync("/projects", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var projects = await response.Content.ReadFromJsonAsync<List<Project>>(CT);
        Assert.NotNull(projects);
        Assert.Equal(2, projects.Count);
        Assert.All(projects, p => Assert.Equal(bobId, p.UserId));
    }

    // --- GET /projects/{id} ---

    [Fact]
    public async Task GetProject_AsAlice_OwnProject_ReturnsOk()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Web App", $"alice-web-app-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/projects/{projectId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var project = await response.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("Alice Web App", project.Name);
    }

    [Fact]
    public async Task GetProject_AsAlice_BobsProject_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/projects/{bobProjectId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetProject_UnknownId_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/projects/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- GET /projects/by-slug/{slug} ---

    [Fact]
    public async Task GetProjectBySlug_AsAlice_OwnSlug_ReturnsOk()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var slug = $"alice-web-app-{id}";
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Web App", slug, "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/projects/by-slug/{slug}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var project = await response.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal(projectId, project.ProjectId);
    }

    [Fact]
    public async Task GetProjectBySlug_AsAlice_BobsSlug_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobSlug = $"bob-api-{id}";
        await _projectRepo.CreateAsync(bobId, new CreateProject("Bob API", bobSlug, "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/projects/by-slug/{bobSlug}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- POST /projects ---

    [Fact]
    public async Task CreateProject_AsAlice_ReturnsCreated()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PostAsJsonAsync("/projects",
            new CreateProject("New Project", $"new-project-{id}", "hash_new"), CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var verify = await client.GetAsync(response.Headers.Location!.ToString(), CT);
        var project = await verify.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("New Project", project.Name);
        Assert.Equal($"new-project-{id}", project.Slug);
    }

    // --- PUT /projects/{id} ---

    [Fact]
    public async Task UpdateProject_AsAlice_OwnProject_ReturnsNoContent()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var projectId = await _projectRepo.CreateAsync(aliceId, new CreateProject("Alice Project", $"alice-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PutAsJsonAsync($"/projects/{projectId}",
            new UpdateProject("Updated Name", "hash_updated"), CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var verify = await client.GetAsync($"/projects/{projectId}", CT);
        var project = await verify.Content.ReadFromJsonAsync<Project>(CT);
        Assert.NotNull(project);
        Assert.Equal("Updated Name", project.Name);
    }

    [Fact]
    public async Task UpdateProject_AsAlice_BobsProject_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PutAsJsonAsync($"/projects/{bobProjectId}",
            new UpdateProject("Hacked", "hash_hacked"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateProject_UnknownId_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.PutAsJsonAsync($"/projects/{Guid.NewGuid()}",
            new UpdateProject("Ghost", "hash_ghost"), CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- DELETE /projects/{id} ---

    [Fact]
    public async Task DeleteProject_AsAlice_BobsProject_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobProjectId = await _projectRepo.CreateAsync(bobId, new CreateProject("Bob Project", $"bob-proj-{id}", "hash"), null);
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.DeleteAsync($"/projects/{bobProjectId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteProject_UnknownId_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.DeleteAsync($"/projects/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
