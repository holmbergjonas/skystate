using System;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.IntegrationTests.Infrastructure;

public class StubStripeService : IStripeService
{
    public Task<ServiceResult<string>> CreateCheckoutSessionAsync(Guid userId, string tier, string successUrl, string cancelUrl)
    {
        if (string.IsNullOrWhiteSpace(successUrl) || string.IsNullOrWhiteSpace(cancelUrl))
            return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.ValidationError("SuccessUrl and CancelUrl are required"));
        if (tier != "hobby" && tier != "pro")
            return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.ValidationError("Invalid tier. Must be 'hobby' or 'pro'."));
        return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.NotFound());
    }

    public Task<ServiceResult<string>> CreateBoostCheckoutSessionAsync(Guid userId, int quantity, string successUrl, string cancelUrl)
    {
        return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.NotFound());
    }

    public Task<ServiceResult<string>> UpdateBoostQuantityAsync(Guid userId, int newQuantity)
    {
        return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.NotFound());
    }

    public Task<ServiceResult<string>> ChangeTierAsync(Guid userId, string newTier)
    {
        return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.NotFound());
    }

    public Task<ServiceResult<string>> CreatePortalSessionAsync(Guid userId, string returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
            return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.ValidationError("ReturnUrl is required"));
        return Task.FromResult<ServiceResult<string>>(new ServiceResult<string>.NotFound());
    }

    public Task HandleWebhookEventAsync(Stripe.Event stripeEvent)
    {
        throw new InvalidOperationException("Stripe webhooks not available in tests");
    }

    public Task<Stripe.Subscription?> GetActiveSubscriptionAsync(string stripeCustomerId)
    {
        return Task.FromResult<Stripe.Subscription?>(null);
    }
}
