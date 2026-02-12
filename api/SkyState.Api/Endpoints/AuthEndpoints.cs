using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/auth/github", (IGitHubOAuthService oauthService, ILogger<IGitHubOAuthService> logger, string? flow) =>
        {
            var url = oauthService.GetAuthorizationUrl(flow);
            logger.LogInformation("GET /auth/github → redirecting to GitHub, flow={Flow}", flow ?? "web");
            return Results.Redirect(url);
        }).WithTags("Auth").AllowAnonymous();

        app.MapGet("/auth/github/callback", async (string? code, string? state, IGitHubOAuthService oauthService, ILogger<IGitHubOAuthService> logger) =>
        {
            var isCli = !string.IsNullOrEmpty(state) && oauthService.IsCliFlow(state);

            if (string.IsNullOrEmpty(code))
                return isCli ? CliTokenPage(null, "Login failed: missing authorization code.") : Results.Redirect(oauthService.GetFrontendErrorRedirectUrl("missing_code"));

            if (string.IsNullOrEmpty(state))
                return Results.Redirect(oauthService.GetFrontendErrorRedirectUrl("missing_state"));

            if (!oauthService.ValidateState(state))
                return isCli ? CliTokenPage(null, "Login failed: invalid or expired state.") : Results.Redirect(oauthService.GetFrontendErrorRedirectUrl("invalid_state"));

            var token = await oauthService.ExchangeCodeForTokenAsync(code);
            if (token is null)
                return isCli ? CliTokenPage(null, "Login failed: could not exchange code for token.") : Results.Redirect(oauthService.GetFrontendErrorRedirectUrl("token_exchange_failed"));

            logger.LogDebug("Token exchange succeeded, flow={Flow}", isCli ? "cli" : "web");
            return isCli ? CliTokenPage(token, null) : Results.Redirect(oauthService.GetFrontendRedirectUrl(token));
        }).WithTags("Auth").AllowAnonymous();
    }
    
    // TODO maybe redirect to styled login page instead
    private static IResult CliTokenPage(string? token, string? error)
    {
        var body = error is not null
            ? $"""
               <h2 style="color:#e2e8f0;font-weight:600">Authentication Failed</h2>
               <p style="color:#f87171">{error}</p>
               """
            : $$"""
                <h2 style="color:#e2e8f0;font-weight:600">Authentication Successful</h2>
                <p style="color:#94a3b8">Copy this token and paste it into your terminal:</p>
                <input id="tok" readonly value="{{token}}"
                  style="width:100%;box-sizing:border-box;font-family:monospace;font-size:14px;padding:12px;
                  background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;outline:none" />
                <button onclick="navigator.clipboard.writeText(document.getElementById('tok').value);this.textContent='Copied!'"
                  style="margin-top:12px;padding:8px 20px;cursor:pointer;background:#3b82f6;color:#fff;
                  border:none;border-radius:6px;font-size:14px;font-weight:500">Copy</button>
                """;
        
        var html = $$"""
                    <!DOCTYPE html>
                    <html><head><title>SkyState CLI Login</title>
                    <style>body{background:#0f172a;}button:hover{opacity:0.9;}</style>
                    </head>
                    <body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;text-align:center;
                      background:#0f172a;color:#e2e8f0;padding:20px">
                    <div style="margin-bottom:24px;display:flex;align-items:center;justify-content:center;gap:10px">
                      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3399FF" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
                      <span style="font-size:20px;font-weight:700;color:#e2e8f0">SkyState</span>
                    </div>
                    <div style="background:#1a2332;border:1px solid #1e293b;border-radius:12px;padding:32px">
                    {{body}}
                    </div>
                    <p style="color:#475569;margin-top:24px;font-size:13px">You can close this tab after pasting.</p>
                    </body></html>
                    """;
        return Results.Content(html, "text/html");
    }
}
