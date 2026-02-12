using System;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.EndToEndTests.Infrastructure;

public class StubStripeService : IStripeService
{
    public Task<ServiceResult<string>> CreateCheckoutSessionAsync(Guid userId, string tier, string successUrl, string cancelUrl)
    {
        throw new InvalidOperationException("Stripe checkout not available in E2E tests");
    }

    public Task<ServiceResult<string>> CreateBoostCheckoutSessionAsync(Guid userId, int quantity, string successUrl, string cancelUrl)
    {
        throw new InvalidOperationException("Stripe boost checkout not available in E2E tests");
    }

    public Task<ServiceResult<string>> UpdateBoostQuantityAsync(Guid userId, int newQuantity)
    {
        throw new InvalidOperationException("Stripe boost update not available in E2E tests");
    }

    public Task<ServiceResult<string>> ChangeTierAsync(Guid userId, string newTier)
    {
        throw new InvalidOperationException("Stripe tier change not available in E2E tests");
    }

    public Task<ServiceResult<string>> CreatePortalSessionAsync(Guid userId, string returnUrl)
    {
        throw new InvalidOperationException("Stripe portal not available in E2E tests");
    }

    public Task HandleWebhookEventAsync(Stripe.Event stripeEvent)
    {
        throw new InvalidOperationException("Stripe webhooks not available in E2E tests");
    }

    public Task<Stripe.Subscription?> GetActiveSubscriptionAsync(string stripeCustomerId)
    {
        return Task.FromResult<Stripe.Subscription?>(null);
    }
}
