using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.IntegrationTests.Infrastructure;
using Xunit;

namespace SkyState.Api.IntegrationTests;

public class AuthEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private HttpClient CreateNoRedirectClient()
    {
        return factory.CreateDefaultClient(new NoAutoRedirectHandler());
    }

    [Fact]
    public async Task AuthGitHub_RedirectsToGitHub()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync("/auth/github", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.StartsWith("https://github.com/login/oauth/authorize", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task AuthGitHub_DoesNotRequireAuth()
    {
        using var client = CreateNoRedirectClient();
        // No auth headers

        var response = await client.GetAsync("/auth/github", CT);

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Callback_RedirectsToFrontend_WhenMissingCode()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync($"/auth/github/callback?state={StubGitHubOAuthService.ValidState}", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("error=missing_code", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Callback_RedirectsToFrontend_WhenMissingState()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync($"/auth/github/callback?code={StubGitHubOAuthService.ValidCode}", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("error=missing_state", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Callback_RedirectsToFrontend_WhenInvalidState()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync($"/auth/github/callback?code={StubGitHubOAuthService.ValidCode}&state=bad_state", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("error=invalid_state", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Callback_RedirectsToFrontend_WhenTokenExchangeFails()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync($"/auth/github/callback?code=bad_code&state={StubGitHubOAuthService.ValidState}", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("error=token_exchange_failed", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Callback_RedirectsToFrontendWithToken_WhenValid()
    {
        using var client = CreateNoRedirectClient();

        var response = await client.GetAsync($"/auth/github/callback?code={StubGitHubOAuthService.ValidCode}&state={StubGitHubOAuthService.ValidState}", CT);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var location = response.Headers.Location!.ToString();
        Assert.StartsWith($"{StubGitHubOAuthService.FrontendUrl}/auth/callback", location);
        Assert.Contains($"token={StubGitHubOAuthService.ValidToken}", location);
    }

    /// <summary>
    /// DelegatingHandler that prevents automatic redirect following,
    /// so tests can assert on 302 responses directly.
    /// </summary>
    private class NoAutoRedirectHandler : DelegatingHandler
    {
        public NoAutoRedirectHandler() : base(new HttpClientHandler { AllowAutoRedirect = false })
        {
        }
    }
}
