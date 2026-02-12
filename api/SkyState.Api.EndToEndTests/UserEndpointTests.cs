using System;
using System.Net;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.EndToEndTests.Infrastructure;
using SkyState.Api.Models;
using Xunit;

namespace SkyState.Api.EndToEndTests;

/// <summary>
/// End-to-end tests for user endpoints against real PostgreSQL.
/// All data setup happens via HTTP calls (no direct repository access).
/// </summary>
[Collection(EndToEndCollection.Name)]
public class UserEndpointTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public UserEndpointTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    // --- PUT /users/me ---

    [Fact]
    public async Task UpdateProfile_UpdatesDisplayNameAndAvatarUrl()
    {
        var id = Uid();
        // Create client with initial name to provision the user
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "Original Name");

        // After user is provisioned, remove the headers so they don't overwrite updates
        client.DefaultRequestHeaders.Remove("X-Test-Name");
        client.DefaultRequestHeaders.Remove("X-Test-Email");

        // Update both display name and avatar URL
        var updateResponse = await client.PutAsJsonAsync("/users/me",
            new UpdateUser("New Name", "https://avatar.url/image.png"), CT);

        Assert.Equal(HttpStatusCode.NoContent, updateResponse.StatusCode);

        // Verify both fields persisted
        var getResponse = await client.GetAsync("/users/me", CT);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var user = await getResponse.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal("New Name", user.DisplayName);
        Assert.Equal("https://avatar.url/image.png", user.AvatarUrl);
    }

    [Fact]
    public async Task UpdateProfile_PartialUpdate_NullFieldsPreserved()
    {
        var id = Uid();
        // Create client with initial name to provision the user
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "Initial Name");

        // After user is provisioned, remove the headers so they don't overwrite updates
        client.DefaultRequestHeaders.Remove("X-Test-Name");
        client.DefaultRequestHeaders.Remove("X-Test-Email");

        // First, set both fields
        await client.PutAsJsonAsync("/users/me",
            new UpdateUser("First Name", "https://first.url/avatar.png"), CT);

        // Verify initial state
        var initialResponse = await client.GetAsync("/users/me", CT);
        var initialUser = await initialResponse.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(initialUser);
        Assert.Equal("First Name", initialUser.DisplayName);
        Assert.Equal("https://first.url/avatar.png", initialUser.AvatarUrl);

        // Now update only avatar URL with null display name
        var updateResponse = await client.PutAsJsonAsync("/users/me",
            new UpdateUser(null, "https://new-avatar.url/image.png"), CT);

        Assert.Equal(HttpStatusCode.NoContent, updateResponse.StatusCode);

        // Verify display name preserved, avatar URL updated
        var getResponse = await client.GetAsync("/users/me", CT);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var user = await getResponse.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal("First Name", user.DisplayName); // Preserved
        Assert.Equal("https://new-avatar.url/image.png", user.AvatarUrl); // Updated
    }

    [Fact]
    public async Task UpdateProfile_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync("/users/me",
            new UpdateUser("Unauthorized", "https://avatar.url"), CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
