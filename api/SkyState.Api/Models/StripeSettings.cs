namespace SkyState.Api.Models;

public class StripeSettings
{
    public string SecretKey { get; set; } = string.Empty;
    public string WebhookSecret { get; set; } = string.Empty;
    public string HobbyPriceId { get; set; } = string.Empty;
    public string ProPriceId { get; set; } = string.Empty;
    public string BoostPriceId { get; set; } = string.Empty;
}
