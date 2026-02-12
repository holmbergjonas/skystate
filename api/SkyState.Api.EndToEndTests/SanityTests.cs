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
/// Smoke tests that verify the full stack (API + real PostgreSQL) is working.
/// </summary>
[Collection(EndToEndCollection.Name)]
public class SanityTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public SanityTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    [Fact]
    public async Task GetMe_AuthenticatedUser_ReturnsProfile()
    {
        var id = Guid.NewGuid().ToString("N")[..8];
        using var client = _factory.CreateAuthenticatedClient(
            $"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var response = await client.GetAsync("/users/me", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<User>(CT);
        Assert.NotNull(user);
        Assert.Equal($"e2e-{id}@test.com", user.Email);
        Assert.Equal("E2E User", user.DisplayName);
    }

    [Fact]
    public async Task GetMe_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/users/me", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
