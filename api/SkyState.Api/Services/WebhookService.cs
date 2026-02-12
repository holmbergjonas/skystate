using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using Stripe;

namespace SkyState.Api.Services;

public interface IWebhookService
{
    Task<Event> VerifyAndParseAsync(string json, string signatureHeader);
    Task ProcessEventAsync(Event stripeEvent);
}

public class WebhookService(
    IOptions<StripeSettings> stripeSettings,
    IStripeService stripeService,
    ILogger<WebhookService> logger) : IWebhookService
{
    public Task<Event> VerifyAndParseAsync(string json, string signatureHeader)
    {
        if (string.IsNullOrEmpty(stripeSettings.Value.WebhookSecret))
        {
            logger.LogWarning("Stripe webhook signature verification skipped (no WebhookSecret configured)");
            var stripeEvent = EventUtility.ParseEvent(json);
            return Task.FromResult(stripeEvent);
        }
        else
        {
            var stripeEvent = EventUtility.ConstructEvent(
                json,
                signatureHeader,
                stripeSettings.Value.WebhookSecret,
                tolerance: 300 // 5 minutes
            );
            return Task.FromResult(stripeEvent);
        }
    }

    public async Task ProcessEventAsync(Event stripeEvent)
    {
        logger.LogInformation("Stripe webhook received: {EventType} ({EventId})",
            stripeEvent.Type, stripeEvent.Id);

        await stripeService.HandleWebhookEventAsync(stripeEvent);
    }
}
