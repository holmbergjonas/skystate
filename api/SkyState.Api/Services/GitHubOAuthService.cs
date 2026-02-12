using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;

namespace SkyState.Api.Services;

public interface IGitHubOAuthService
{
    string GetAuthorizationUrl(string? flow = null);
    bool ValidateState(string state);
    bool IsCliFlow(string state);
    Task<string?> ExchangeCodeForTokenAsync(string code);
    string GetFrontendRedirectUrl(string token);
    string GetFrontendErrorRedirectUrl(string error);
}

public class GitHubOAuthService(
    IOptions<GitHubOAuthSettings> settings,
    IMemoryCache cache,
    IHttpClientFactory httpClientFactory,
    ILogger<GitHubOAuthService> logger) : IGitHubOAuthService
{
    private static readonly TimeSpan StateTtl = TimeSpan.FromMinutes(10);

    public string GetAuthorizationUrl(string? flow = null)
    {
        var state = GenerateState();
        cache.Set($"oauth_state:{state}", true, StateTtl);

        if (flow == "cli")
        {
            cache.Set($"oauth_cli_flow:{state}", true, StateTtl);
            logger.LogDebug("CLI flow flagged for state");
        }

        var config = settings.Value;
        return $"https://github.com/login/oauth/authorize?client_id={Uri.EscapeDataString(config.ClientId)}&redirect_uri={Uri.EscapeDataString(config.CallbackUrl)}&state={Uri.EscapeDataString(state)}&scope=read:user%20user:email";
    }

    public bool ValidateState(string state)
    {
        var key = $"oauth_state:{state}";
        if (!cache.TryGetValue(key, out _))
        {
            logger.LogDebug("OAuth state validation failed: key not found in cache");
            return false;
        }

        cache.Remove(key);
        logger.LogDebug("OAuth state validated and consumed");
        return true;
    }

    public bool IsCliFlow(string state)
    {
        var key = $"oauth_cli_flow:{state}";
        if (cache.TryGetValue(key, out _))
        {
            cache.Remove(key);
            return true;
        }
        return false;
    }

    public async Task<string?> ExchangeCodeForTokenAsync(string code)
    {
        logger.LogDebug("Exchanging OAuth code for access token");
        var config = settings.Value;
        var client = httpClientFactory.CreateClient("GitHub");

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var content = new FormUrlEncodedContent(
        [
            new("client_id", config.ClientId),
            new("client_secret", config.ClientSecret),
            new("code", code)
        ]);
        request.Content = content;

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Failed to exchange code for token with GitHub");
            return null;
        }

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("GitHub token exchange returned {StatusCode}", response.StatusCode);
            return null;
        }

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var root = doc.RootElement;

        if (root.TryGetProperty("access_token", out var tokenProp) && tokenProp.ValueKind == JsonValueKind.String)
            return tokenProp.GetString();

        if (root.TryGetProperty("error", out var errorProp))
            logger.LogWarning("GitHub token exchange error: {Error}", errorProp.GetString());

        return null;
    }

    public string GetFrontendRedirectUrl(string token)
    {
        return $"{settings.Value.FrontendUrl}/auth/callback?token={Uri.EscapeDataString(token)}";
    }

    public string GetFrontendErrorRedirectUrl(string error)
    {
        return $"{settings.Value.FrontendUrl}/auth/callback?error={Uri.EscapeDataString(error)}";
    }

    private static string GenerateState()
    {
        return Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    }
}
