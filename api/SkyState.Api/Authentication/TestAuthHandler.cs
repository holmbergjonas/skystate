using System.Collections.Generic;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Repositories;

namespace SkyState.Api.Authentication;

public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "TestScheme";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        Logger.LogDebug("TestAuthHandler: evaluating request {Method} {Path}",
            Request.Method, Request.Path);

        if (!Request.Headers.TryGetValue("X-Test-GitHub-Id", out var githubId)
            || string.IsNullOrEmpty(githubId))
        {
            Logger.LogDebug("TestAuthHandler: no X-Test-GitHub-Id header, skipping");
            return AuthenticateResult.NoResult();
        }

        Logger.LogDebug("TestAuthHandler: processing test auth for GitHub id {GitHubId}", (string)githubId!);

        string? email = null;
        if (Request.Headers.TryGetValue("X-Test-Email", out var emailHeader)
            && !string.IsNullOrEmpty(emailHeader))
        {
            email = emailHeader!;
        }

        string? name = null;
        if (Request.Headers.TryGetValue("X-Test-Name", out var nameHeader)
            && !string.IsNullOrEmpty(nameHeader))
        {
            name = nameHeader!;
        }

        // JIT user provisioning
        var userRepo = Context.RequestServices.GetRequiredService<IUserRepository>();
        var user = await userRepo.UpsertBySsoAsync("github", githubId!, email, name, null);

        Logger.LogDebug("TestAuthHandler: upserted local user {UserId} for GitHub id {GitHubId}",
            user.UserId, (string)githubId!);

        var claims = new List<Claim>
        {
            new("sub", user.UserId.ToString()),
            new(ClaimTypes.NameIdentifier, githubId!)
        };

        if (!string.IsNullOrEmpty(email))
            claims.Add(new Claim(ClaimTypes.Email, email));
        if (!string.IsNullOrEmpty(name))
            claims.Add(new Claim(ClaimTypes.Name, name));

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        Logger.LogDebug("TestAuthHandler: authentication succeeded for user {UserId} with {ClaimCount} claims",
            user.UserId, claims.Count);

        return AuthenticateResult.Success(ticket);
    }
}
