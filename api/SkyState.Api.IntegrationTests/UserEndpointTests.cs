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

public class UserEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    // --- GET /users/me ---

    [Fact]
    public async Task GetMe_AsAlice_ReturnsAliceProfile()
    {
        var id = Uid();
        // Pre-create user with known data
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice Anderson"));
        // Auth as this user (TestAuthHandler finds existing user via UpsertBySsoAsync)
        using var client = factory.CreateAuthenticatedClient(
            $"alice-{id}", $"alice-{id}@test.com", "Alice Anderson");

        var response = await client.GetAsync("/users/me", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal(userId, user.UserId);
        Assert.Equal($"alice-{id}@test.com", user.Email);
        Assert.Equal("Alice Anderson", user.DisplayName);
    }

    [Fact]
    public async Task GetMe_AsBob_ReturnsBobProfile()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob Builder"));
        using var client = factory.CreateAuthenticatedClient(
            $"bob-{id}", $"bob-{id}@test.com", "Bob Builder");

        var response = await client.GetAsync("/users/me", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal(userId, user.UserId);
        Assert.Equal($"bob-{id}@test.com", user.Email);
        Assert.Equal("Bob Builder", user.DisplayName);
    }

    [Fact]
    public async Task GetMe_UnknownUser_ReturnsNotFound()
    {
        var id = Uid();
        // Authenticate as a user that doesn't exist in DB -- TestAuthHandler will JIT-provision
        // but GetMe endpoint should still work (user is created on auth)
        using var client = factory.CreateAuthenticatedClient(
            $"ghost-{id}", $"ghost-{id}@test.com", "Ghost User");

        var response = await client.GetAsync("/users/me", CT);

        // With JIT provisioning, this should now return OK with the newly created user
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal($"ghost-{id}@test.com", user.Email);
        Assert.Equal("Ghost User", user.DisplayName);
    }

    [Fact]
    public async Task GetMe_Unauthenticated_Returns401()
    {
        using var client = factory.CreateClient(); // No auth headers

        var response = await client.GetAsync("/users/me", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- PUT /users/me ---

    [Fact]
    public async Task UpdateMe_AsAlice_UpdatesDisplayName()
    {
        var id = Uid();
        var userId = await _userRepo.CreateAsync(
            new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice Anderson"));
        // Auth with initial name, but don't pass name/email on subsequent requests to avoid overwriting updates
        using var client = factory.CreateAuthenticatedClient($"alice-{id}");

        var response = await client.PutAsJsonAsync("/users/me", new UpdateUser("Alice Updated", null), CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var verify = await client.GetAsync("/users/me", CT);
        var user = await verify.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal("Alice Updated", user.DisplayName);
    }

    [Fact]
    public async Task UpdateMe_UnknownUser_CreatesUserAndUpdates()
    {
        var id = Uid();
        // Authenticate as new user (JIT provisioning creates them)
        // Provide email for JIT creation, but no name so we can test the update
        using var client = factory.CreateAuthenticatedClient($"newuser-{id}", $"newuser-{id}@test.com");

        var response = await client.PutAsJsonAsync("/users/me", new UpdateUser("Updated Name", null), CT);

        // With JIT provisioning, the user is created on auth, so update should succeed
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var verify = await client.GetAsync("/users/me", CT);
        var user = await verify.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal("Updated Name", user.DisplayName);
    }
}
