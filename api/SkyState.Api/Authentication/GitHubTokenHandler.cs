using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Repositories;

namespace SkyState.Api.Authentication;

public class GitHubTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IMemoryCache cache,
    IHttpClientFactory httpClientFactory)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "GitHubToken";

    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        Logger.LogDebug("GitHubTokenHandler: evaluating request {Method} {Path}",
            Request.Method, Request.Path);

        var authorization = Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(authorization) || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            Logger.LogDebug("GitHubTokenHandler: no Bearer token found, skipping");
            return AuthenticateResult.NoResult();
        }

        var token = authorization["Bearer ".Length..].Trim();
        if (string.IsNullOrEmpty(token))
        {
            Logger.LogDebug("GitHubTokenHandler: Bearer prefix present but token is empty, skipping");
            return AuthenticateResult.NoResult();
        }

        var cacheKey = "gh:" + HashToken(token);

        if (cache.TryGetValue(cacheKey, out AuthenticateResult? cached) && cached is not null)
        {
            Logger.LogDebug("GitHubTokenHandler: cache hit for token hash {CacheKey}, succeeded={Succeeded}",
                cacheKey, cached.Succeeded);
            return cached;
        }

        Logger.LogDebug("GitHubTokenHandler: cache miss, validating token against GitHub API");
        var result = await ValidateTokenAsync(token);

        cache.Set(cacheKey, result, CacheTtl);
        Logger.LogDebug("GitHubTokenHandler: cached result for {CacheTtl}", CacheTtl);

        return result;
    }

    private async Task<AuthenticateResult> ValidateTokenAsync(string token)
    {
        Logger.LogDebug("GitHubTokenHandler: sending GET https://api.github.com/user");
        var client = httpClientFactory.CreateClient("GitHub");
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("SkyState", "1.0"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request);
        }
        catch (HttpRequestException ex)
        {
            Logger.LogWarning(ex, "Failed to reach GitHub API");
            return AuthenticateResult.Fail("Unable to validate token");
        }

        Logger.LogDebug("GitHubTokenHandler: GitHub API responded with {StatusCode}", response.StatusCode);

        if (!response.IsSuccessStatusCode)
        {
            Logger.LogDebug("GitHubTokenHandler: token validation failed, returning Fail result");
            return AuthenticateResult.Fail("GitHub token validation failed");
        }

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var root = doc.RootElement;

        var githubId = root.GetProperty("id").GetInt64().ToString();
        var email = root.TryGetProperty("email", out var emailProp) && emailProp.ValueKind == JsonValueKind.String
            ? emailProp.GetString()
            : null;
        var name = root.TryGetProperty("name", out var nameProp) && nameProp.ValueKind == JsonValueKind.String
            ? nameProp.GetString()
            : null;
        var avatarUrl = root.TryGetProperty("avatar_url", out var avatarProp) && avatarProp.ValueKind == JsonValueKind.String
            ? avatarProp.GetString()
            : null;

        Logger.LogDebug("GitHubTokenHandler: GitHub user id={GitHubId} email={Email} name={Name}",
            githubId, email ?? "(null)", name ?? "(null)");

        var userRepo = Context.RequestServices.GetRequiredService<IUserRepository>();
        var user = await userRepo.UpsertBySsoAsync("github", githubId, email, name, avatarUrl);

        Logger.LogDebug("GitHubTokenHandler: upserted local user {UserId} for GitHub id {GitHubId}",
            user.UserId, githubId);

        var claims = new List<Claim>
        {
            new("sub", user.UserId.ToString()),
            new(ClaimTypes.NameIdentifier, githubId)
        };

        if (!string.IsNullOrEmpty(email))
            claims.Add(new Claim(ClaimTypes.Email, email));
        if (!string.IsNullOrEmpty(name))
            claims.Add(new Claim(ClaimTypes.Name, name));

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        Logger.LogDebug("GitHubTokenHandler: authentication succeeded for user {UserId} with {ClaimCount} claims",
            user.UserId, claims.Count);

        return AuthenticateResult.Success(ticket);
    }

    private static string HashToken(string token)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexStringLower(hash);
    }
}
