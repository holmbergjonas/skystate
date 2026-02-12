using System.Threading.Tasks;
using SkyState.Api.Services;

namespace SkyState.Api.IntegrationTests.Infrastructure;

public class StubGitHubOAuthService : IGitHubOAuthService
{
    public const string ValidState = "valid_test_state";
    public const string ValidCode = "valid_test_code";
    public const string ValidToken = "gho_test_token_abc123";
    public const string FrontendUrl = "http://localhost:5173";

    private bool _isCliFlow;

    public string GetAuthorizationUrl(string? flow = null)
    {
        _isCliFlow = flow == "cli";
        return $"https://github.com/login/oauth/authorize?client_id=test_client_id&redirect_uri=http://localhost:8080/api/auth/github/callback&state={ValidState}&scope=read:user%20user:email";
    }

    public bool ValidateState(string state)
    {
        return state == ValidState;
    }

    public bool IsCliFlow(string state)
    {
        if (state == ValidState && _isCliFlow)
        {
            _isCliFlow = false;
            return true;
        }
        return false;
    }

    public Task<string?> ExchangeCodeForTokenAsync(string code)
    {
        if (code == ValidCode)
            return Task.FromResult<string?>(ValidToken);
        return Task.FromResult<string?>(null);
    }

    public string GetFrontendRedirectUrl(string token)
    {
        return $"{FrontendUrl}/auth/callback?token={token}";
    }

    public string GetFrontendErrorRedirectUrl(string error)
    {
        return $"{FrontendUrl}/auth/callback?error={error}";
    }
}
