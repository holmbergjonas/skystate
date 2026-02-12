namespace SkyState.Api.Models;

public class GitHubOAuthSettings
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string CallbackUrl { get; set; } = string.Empty;
    public string FrontendUrl { get; set; } = string.Empty;
}
