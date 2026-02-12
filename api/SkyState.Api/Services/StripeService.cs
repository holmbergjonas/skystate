using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using Stripe;
using Stripe.Checkout;

namespace SkyState.Api.Services;

public interface IStripeService
{
    Task<ServiceResult<string>> CreateCheckoutSessionAsync(Guid userId, string tier, string successUrl, string cancelUrl);
    Task<ServiceResult<string>> CreateBoostCheckoutSessionAsync(Guid userId, int quantity, string successUrl, string cancelUrl);
    Task<ServiceResult<string>> UpdateBoostQuantityAsync(Guid userId, int newQuantity);
    Task<ServiceResult<string>> ChangeTierAsync(Guid userId, string newTier);
    Task<ServiceResult<string>> CreatePortalSessionAsync(Guid userId, string returnUrl);
    Task HandleWebhookEventAsync(Stripe.Event stripeEvent);
    Task<Stripe.Subscription?> GetActiveSubscriptionAsync(string stripeCustomerId);
}

public class StripeService(
    StripeClient stripeClient,
    IOptions<StripeSettings> settings,
    IUserRepository userRepo,
    IWebhookEventRepository webhookRepo,
    IInvoiceRepository invoiceRepo,
    ILogger<StripeService> logger) : IStripeService
{
    // TODO Replace with index in the appsettings or something
    private static readonly Dictionary<string, int> TierOrder = new()
    {
        ["free"] = 0,
        ["hobby"] = 1,
        ["pro"] = 2
    };

    public async Task<ServiceResult<string>> CreateCheckoutSessionAsync(Guid userId, string tier, string successUrl, string cancelUrl)
    {
        if (string.IsNullOrWhiteSpace(successUrl) || string.IsNullOrWhiteSpace(cancelUrl))
            return new ServiceResult<string>.ValidationError("SuccessUrl and CancelUrl are required");

        // TODO Why is skystate even bothering with prices? Is this not entierly a Stripe interest?
        var priceId = GetPriceIdForTier(tier);
        if (priceId == null)
            return new ServiceResult<string>.ValidationError("Invalid tier. Must be 'hobby' or 'pro'.");

        if (string.IsNullOrEmpty(priceId))
            return new ServiceResult<string>.ValidationError($"Price not configured for tier '{tier}'.");

        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<string>.NotFound();

        // Create Stripe customer if doesn't exist
        // TODO Is stripe_user_id called stripe_customer_id? Then maybe rename it here to be consistent
        string stripeCustomerId;
        if (string.IsNullOrEmpty(user.StripeUserId))
        {
            stripeCustomerId = await CreateCustomerWithRetryAsync(user);
            await userRepo.SetStripeCustomerIdAsync(userId, stripeCustomerId);
        }
        else
        {
            stripeCustomerId = user.StripeUserId;
        }

        // Create checkout session
        logger.LogInformation("Creating Stripe checkout session: user={UserId}, tier={Tier}, stripeCustomer={StripeCustomerId}, priceId={PriceId}",
            userId, tier, stripeCustomerId, priceId);

        var options = new SessionCreateOptions
        {
            Mode = "subscription",
            Customer = stripeCustomerId,
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Price = priceId,
                    Quantity = 1
                }
            ],
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", tier },
                { "user_id", userId.ToString() }
            },
            SuccessUrl = successUrl,
            CancelUrl = cancelUrl
        };

        var service = new SessionService(stripeClient);

        try
        {
            var session = await service.CreateAsync(options);

            logger.LogInformation("Stripe checkout session created: sessionId={SessionId}, user={UserId}, tier={Tier}",
                session.Id, userId, tier);

            return new ServiceResult<string>.Success(session.Url);
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            if (!await TryHandleStaleCustomerAsync(userId, ex))
                throw;

            // Self-heal: create a new customer and retry
            var newCustomerId = await CreateCustomerWithRetryAsync(user);
            await userRepo.SetStripeCustomerIdAsync(userId, newCustomerId);
            options.Customer = newCustomerId;

            var retrySession = await service.CreateAsync(options);

            logger.LogInformation("Stripe checkout session created after stale customer recovery: sessionId={SessionId}, user={UserId}, tier={Tier}",
                retrySession.Id, userId, tier);

            return new ServiceResult<string>.Success(retrySession.Url);
        }
    }

    public async Task<ServiceResult<string>> CreateBoostCheckoutSessionAsync(Guid userId, int quantity, string successUrl, string cancelUrl)
    {
        if (quantity < 1)
            return new ServiceResult<string>.ValidationError("Quantity must be at least 1.");

        if (string.IsNullOrWhiteSpace(successUrl) || string.IsNullOrWhiteSpace(cancelUrl))
            return new ServiceResult<string>.ValidationError("SuccessUrl and CancelUrl are required");

        if (string.IsNullOrEmpty(settings.Value.BoostPriceId))
            return new ServiceResult<string>.ValidationError("Boost price not configured.");

        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<string>.NotFound();

        if (string.IsNullOrEmpty(user.StripeUserId))
            return new ServiceResult<string>.ValidationError("Subscribe to a plan first.");

        var options = new SessionCreateOptions
        {
            Mode = "subscription",
            Customer = user.StripeUserId,
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Price = settings.Value.BoostPriceId,
                    Quantity = quantity
                }
            ],
            Metadata = new Dictionary<string, string>
            {
                { "type", "boost" },
                { "user_id", userId.ToString() }
            },
            SuccessUrl = successUrl,
            CancelUrl = cancelUrl
        };

        var service = new SessionService(stripeClient);

        try
        {
            var session = await service.CreateAsync(options);
            return new ServiceResult<string>.Success(session.Url);
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            await TryHandleStaleCustomerAsync(userId, ex);
            return new ServiceResult<string>.ValidationError(
                "Your billing account needs to be reconnected. Please subscribe via the upgrade page.");
        }
    }

    public async Task<ServiceResult<string>> UpdateBoostQuantityAsync(Guid userId, int newQuantity)
    {
        if (newQuantity < 1)
            return new ServiceResult<string>.ValidationError("Quantity must be at least 1.");

        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<string>.NotFound();

        if (string.IsNullOrEmpty(user.StripeUserId))
            return new ServiceResult<string>.ValidationError("No active subscription. Subscribe first.");

        try
        {
            // Find the boost subscription
            var subscriptionService = new SubscriptionService(stripeClient);
            var listOptions = new SubscriptionListOptions
            {
                Customer = user.StripeUserId,
                Status = "active",
            };
            listOptions.AddExpand("data.items.data.price");

            var subscriptions = await subscriptionService.ListAsync(listOptions);

            SubscriptionItem? boostItem = null;
            foreach (var sub in subscriptions.Data)
            {
                foreach (var item in sub.Items.Data)
                {
                    if (IsBoostPriceId(item.Price.Id))
                    {
                        boostItem = item;
                        break;
                    }
                }
                if (boostItem != null) break;
            }

            if (boostItem == null)
                return new ServiceResult<string>.ValidationError("No active boost subscription. Purchase boost first.");

            var itemService = new SubscriptionItemService(stripeClient);
            await itemService.UpdateAsync(boostItem.Id, new SubscriptionItemUpdateOptions
            {
                Quantity = newQuantity,
                ProrationBehavior = "always_invoice"
            });

            return new ServiceResult<string>.Success("Boost quantity updated");
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            await TryHandleStaleCustomerAsync(userId, ex);
            return new ServiceResult<string>.ValidationError(
                "Your billing account needs to be reconnected. Please subscribe via the upgrade page.");
        }
    }

    public async Task<ServiceResult<string>> ChangeTierAsync(Guid userId, string newTier)
    {
        var newPriceId = GetPriceIdForTier(newTier);
        if (newPriceId == null)
            return new ServiceResult<string>.ValidationError("Invalid tier. Must be 'hobby' or 'pro'.");

        if (string.IsNullOrEmpty(newPriceId))
            return new ServiceResult<string>.ValidationError($"Price not configured for tier '{newTier}'.");

        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<string>.NotFound();

        if (string.IsNullOrEmpty(user.StripeUserId))
            return new ServiceResult<string>.ValidationError("No active subscription. Subscribe first using checkout.");

        try
        {
            // Find the tier subscription
            var subscriptionService = new SubscriptionService(stripeClient);
            var listOptions = new SubscriptionListOptions
            {
                Customer = user.StripeUserId,
                Status = "active",
            };
            listOptions.AddExpand("data.items.data.price");

            var subscriptions = await subscriptionService.ListAsync(listOptions);

            Stripe.Subscription? tierSubscription = null;
            SubscriptionItem? tierItem = null;
            string? currentPriceId = null;

            foreach (var sub in subscriptions.Data)
            {
                foreach (var item in sub.Items.Data)
                {
                    if (GetTierForPriceId(item.Price.Id) != null)
                    {
                        tierSubscription = sub;
                        tierItem = item;
                        currentPriceId = item.Price.Id;
                        break;
                    }
                }
                if (tierSubscription != null) break;
            }

            if (tierSubscription == null || tierItem == null || currentPriceId == null)
                return new ServiceResult<string>.ValidationError("No active subscription. Subscribe first using checkout.");

            var currentTier = GetTierForPriceId(currentPriceId) ?? "free";

            // Determine upgrade vs downgrade
            var currentOrder = TierOrder.GetValueOrDefault(currentTier, 0);
            var newOrder = TierOrder.GetValueOrDefault(newTier, 0);

            if (currentOrder == newOrder)
                return new ServiceResult<string>.ValidationError($"Already on the '{newTier}' tier.");

            if (newOrder > currentOrder)
            {
                // Upgrade: immediate with proration
                await subscriptionService.UpdateAsync(tierSubscription.Id, new SubscriptionUpdateOptions
                {
                    Items = [new SubscriptionItemOptions { Id = tierItem.Id, Price = newPriceId }],
                    ProrationBehavior = "always_invoice"
                });

                return new ServiceResult<string>.Success($"Upgraded to '{newTier}' tier. Change is effective immediately.");
            }
            else
            {
                // Downgrade: schedule at end of billing period via Subscription Schedule
                var scheduleService = new SubscriptionScheduleService(stripeClient);
                var schedule = await scheduleService.CreateAsync(new SubscriptionScheduleCreateOptions
                {
                    FromSubscription = tierSubscription.Id
                });

                await scheduleService.UpdateAsync(schedule.Id, new SubscriptionScheduleUpdateOptions
                {
                    Phases =
                    [
                        new SubscriptionSchedulePhaseOptions
                        {
                            Items = [new SubscriptionSchedulePhaseItemOptions { Price = currentPriceId, Quantity = 1 }],
                            StartDate = schedule.CurrentPhase.StartDate,
                            EndDate = schedule.CurrentPhase.EndDate,
                        },
                        new SubscriptionSchedulePhaseOptions
                        {
                            Items = [new SubscriptionSchedulePhaseItemOptions { Price = newPriceId, Quantity = 1 }],
                            Duration = new SubscriptionSchedulePhaseDurationOptions { Interval = "month", IntervalCount = 1 },
                        }
                    ],
                    EndBehavior = "release"
                });

                return new ServiceResult<string>.Success($"Downgrade to '{newTier}' tier scheduled for end of current billing period.");
            }
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            await TryHandleStaleCustomerAsync(userId, ex);
            return new ServiceResult<string>.ValidationError(
                "Your billing account needs to be reconnected. Please subscribe via the upgrade page.");
        }
    }

    public async Task<ServiceResult<string>> CreatePortalSessionAsync(Guid userId, string returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
            return new ServiceResult<string>.ValidationError("ReturnUrl is required");

        var user = await userRepo.GetByIdAsync(userId);
        if (user is null)
            return new ServiceResult<string>.NotFound();

        if (string.IsNullOrEmpty(user.StripeUserId))
            return new ServiceResult<string>.ValidationError("No active subscription found. Subscribe first.");

        var options = new Stripe.BillingPortal.SessionCreateOptions
        {
            Customer = user.StripeUserId,
            ReturnUrl = returnUrl
        };

        var service = new Stripe.BillingPortal.SessionService(stripeClient);

        try
        {
            var session = await service.CreateAsync(options);
            return new ServiceResult<string>.Success(session.Url);
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            await TryHandleStaleCustomerAsync(userId, ex);
            return new ServiceResult<string>.ValidationError(
                "Your billing account needs to be reconnected. Please subscribe via the upgrade page.");
        }
    }

    public async Task HandleWebhookEventAsync(Stripe.Event stripeEvent)
    {
        logger.LogInformation("Processing webhook event: type={EventType}, id={EventId}, created={Created}",
            stripeEvent.Type, stripeEvent.Id, stripeEvent.Created);

        // Try to record event - if false (duplicate), return early
        var recorded = await webhookRepo.TryRecordEventAsync(stripeEvent.Id, stripeEvent.Type);
        if (!recorded)
        {
            logger.LogInformation("Duplicate event {EventId} of type {EventType} - skipping",
                stripeEvent.Id, stripeEvent.Type);
            return;
        }

        try
        {
            switch (stripeEvent.Type)
            {
                case "checkout.session.completed":
                    await HandleCheckoutCompletedAsync(stripeEvent);
                    break;

                case "invoice.paid":
                    await HandleInvoicePaidAsync(stripeEvent);
                    break;

                case "invoice.payment_failed":
                    await HandleInvoicePaymentFailedAsync(stripeEvent);
                    break;

                case "customer.subscription.updated":
                    await HandleSubscriptionUpdatedAsync(stripeEvent);
                    break;

                case "customer.subscription.deleted":
                    await HandleSubscriptionDeletedAsync(stripeEvent);
                    break;

                default:
                    logger.LogInformation("Unhandled event type: {EventType}", stripeEvent.Type);
                    break;
            }

            await webhookRepo.MarkProcessedAsync(stripeEvent.Id);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error processing webhook event {EventId}", stripeEvent.Id);
            await webhookRepo.RecordErrorAsync(stripeEvent.Id, ex.Message);

            // Try to record error on user for dashboard visibility
            try
            {
                var customerId = ExtractCustomerIdFromEvent(stripeEvent);
                if (customerId != null)
                {
                    var errorUser = await userRepo.GetByStripeCustomerIdAsync(customerId);
                    if (errorUser != null)
                        await userRepo.SetLastStripeErrorAsync(errorUser.UserId, ex.Message);
                }
            }
            catch (Exception innerEx)
            {
                logger.LogWarning(innerEx, "Failed to record stripe error on user");
            }

            throw;
        }
    }

    public async Task<Stripe.Subscription?> GetActiveSubscriptionAsync(string stripeCustomerId)
    {
        var service = new SubscriptionService(stripeClient);
        var options = new SubscriptionListOptions
        {
            Customer = stripeCustomerId,
            Status = "active",
        };
        options.AddExpand("data.items.data.price");

        try
        {
            var subscriptions = await service.ListAsync(options);
            return subscriptions.Data.FirstOrDefault();
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            // Look up the user to clear stale IDs
            var user = await userRepo.GetByStripeCustomerIdAsync(stripeCustomerId);
            if (user != null)
            {
                await TryHandleStaleCustomerAsync(user.UserId, ex);
            }
            else
            {
                logger.LogWarning(
                    "Stale Stripe customer ID {CustomerId} but no matching user found. Error: {Message}",
                    stripeCustomerId, ex.Message);
            }
            return null;
        }
    }

    private string? GetPriceIdForTier(string tier)
    {
        return tier.ToLowerInvariant() switch
        {
            "hobby" => settings.Value.HobbyPriceId,
            "pro" => settings.Value.ProPriceId,
            _ => null
        };
    }

    private async Task<string> CreateCustomerWithRetryAsync(User user)
    {
        const int maxAttempts = 3;
        int attempt = 0;

        while (attempt < maxAttempts)
        {
            attempt++;

            try
            {
                var options = new CustomerCreateOptions
                {
                    Email = user.Email,
                    Metadata = new Dictionary<string, string>
                    {
                        { "user_id", user.UserId.ToString() }
                    }
                };

                var service = new CustomerService(stripeClient);
                var customer = await service.CreateAsync(options);
                return customer.Id;
            }
            catch (StripeException ex) when (attempt < maxAttempts && IsRetryableError(ex))
            {
                var delay = TimeSpan.FromMilliseconds(Math.Pow(2, attempt) * 100);
                logger.LogWarning(ex,
                    "Retryable error creating Stripe customer (attempt {Attempt}/{MaxAttempts}), retrying in {Delay}ms",
                    attempt, maxAttempts, delay.TotalMilliseconds);
                await Task.Delay(delay);
            }
        }

        throw new InvalidOperationException("Failed to create Stripe customer after multiple attempts");
    }

    private static bool IsRetryableError(StripeException ex)
    {
        return ex.StripeError?.Type == "api_connection_error"
            || ex.StripeError?.Type == "rate_limit_error";
    }

    private async Task<bool> TryHandleStaleCustomerAsync(Guid userId, StripeException ex)
    {
        if (ex.StripeError?.Code != "resource_missing")
            return false;

        logger.LogWarning(
            "Stale Stripe customer ID detected for user {UserId}. Clearing stripe_user_id. Error: {Message}",
            userId, ex.Message);

        await userRepo.SetStripeCustomerIdAsync(userId, null!);
        await userRepo.SetStripeSubscriptionIdAsync(userId, null);
        return true;
    }

    private string? GetTierForPriceId(string priceId) => priceId switch
    {
        _ when priceId == settings.Value.HobbyPriceId => "hobby",
        _ when priceId == settings.Value.ProPriceId => "pro",
        _ => null
    };

    private bool IsBoostPriceId(string priceId) => priceId == settings.Value.BoostPriceId;

    private string? ResolveTierFromInvoice(Stripe.Invoice invoice)
    {
        foreach (var line in invoice.Lines?.Data ?? [])
        {
            var priceId = line.Pricing?.PriceDetails?.Price ?? "";
            var tier = GetTierForPriceId(priceId);
            if (tier != null) return tier;
        }
        return null;
    }

    private static (DateTime Start, DateTime End) ResolveBillingPeriodFromInvoice(Stripe.Invoice invoice)
    {
        var line = invoice.Lines?.Data?.FirstOrDefault();
        if (line?.Period != null)
            return (line.Period.Start, line.Period.End);

        // Fallback to invoice-level period (better than nothing)
        return (invoice.PeriodStart, invoice.PeriodEnd);
    }

    /// <summary>
    /// Extracts the Stripe customer ID from a webhook event's data object.
    /// Supports Subscription, Session (checkout), and Invoice event types.
    /// </summary>
    private static string? ExtractCustomerIdFromEvent(Stripe.Event stripeEvent)
    {
        return stripeEvent.Data.Object switch
        {
            Stripe.Subscription sub => sub.CustomerId,
            Session session => session.CustomerId,
            Stripe.Invoice invoice => invoice.CustomerId,
            _ => null
        };
    }

    /// <summary>
    /// Extract current_period_end from the subscription's raw JSON.
    /// Stripe.net v50+ removed the typed CurrentPeriodEnd property but the API still returns it.
    /// </summary>
    private static DateTime? GetCurrentPeriodEnd(Stripe.Subscription subscription)
    {
        var token = subscription.RawJObject?["current_period_end"];
        if (token == null) return null;
        // Stripe returns Unix timestamp as integer
        if (token.Type == Newtonsoft.Json.Linq.JTokenType.Integer)
            return DateTimeOffset.FromUnixTimeSeconds((long)token).UtcDateTime;
        if (token.Type == Newtonsoft.Json.Linq.JTokenType.Date)
            return (DateTime)token;
        return null;
    }

    private async Task HandleSubscriptionUpdatedAsync(Stripe.Event stripeEvent)
    {
        var subscription = stripeEvent.Data.Object as Stripe.Subscription;
        if (subscription?.CustomerId == null)
        {
            logger.LogError("customer.subscription.updated: missing customer ID in event {EventId}", stripeEvent.Id);
            return;
        }

        logger.LogInformation("Subscription updated: customerId={CustomerId}, subscriptionId={SubscriptionId}, status={Status}, cancelAtPeriodEnd={CancelAtPeriodEnd}, items={ItemCount}",
            subscription.CustomerId, subscription.Id, subscription.Status, subscription.CancelAtPeriodEnd, subscription.Items?.Data?.Count ?? 0);

        var user = await userRepo.GetByStripeCustomerIdAsync(subscription.CustomerId);
        if (user == null)
        {
            logger.LogError("customer.subscription.updated: no user found for Stripe customer {CustomerId} (event {EventId})",
                subscription.CustomerId, stripeEvent.Id);
            return;
        }

        logger.LogInformation("Subscription updated: matched user={UserId}, currentTier={CurrentTier}, currentBoost={CurrentBoost}",
            user.UserId, user.SubscriptionTier, user.BoostMultiplier);

        foreach (var item in subscription.Items?.Data ?? [])
        {
            logger.LogInformation("Subscription item: priceId={PriceId}, quantity={Quantity}, resolvedTier={Tier}, isBoost={IsBoost}",
                item.Price.Id, item.Quantity, GetTierForPriceId(item.Price.Id) ?? "(none)", IsBoostPriceId(item.Price.Id));
            var tier = GetTierForPriceId(item.Price.Id);
            if (tier != null)
            {
                if (subscription.Status == "active" && !subscription.CancelAtPeriodEnd)
                {
                    await userRepo.SetTierAsync(user.UserId, tier);
                    logger.LogInformation("Updated tier to {Tier} for user {UserId}", tier, user.UserId);

                    // Clear last stripe error on successful subscription update
                    await userRepo.SetLastStripeErrorAsync(user.UserId, null);

                    // Clear payment_failed_at on active subscription (successful payment clears any previous failure)
                    if (user.PaymentFailedAt.HasValue)
                        await userRepo.SetPaymentFailedAtAsync(user.UserId, null);
                }
                else if (subscription.CancelAtPeriodEnd)
                {
                    logger.LogInformation(
                        "Tier subscription cancel_at_period_end for user {UserId}, keeping current tier until period ends",
                        user.UserId);
                }
            }
            else if (IsBoostPriceId(item.Price.Id))
            {
                if (subscription.Status == "active" && !subscription.CancelAtPeriodEnd)
                {
                    var boost = item.Quantity > 0 ? (int)item.Quantity : 1;
                    await userRepo.SetBoostMultiplierAsync(user.UserId, boost);
                    logger.LogInformation("Updated boost multiplier to {Boost} for user {UserId}",
                        boost, user.UserId);
                }
                else if (subscription.CancelAtPeriodEnd)
                {
                    logger.LogInformation(
                        "Boost subscription cancel_at_period_end for user {UserId}, keeping current boost until period ends",
                        user.UserId);
                }
            }
        }

        // Always persist billing metadata from subscription updates
        var periodEnd = GetCurrentPeriodEnd(subscription);
        if (periodEnd.HasValue)
            await userRepo.SetCurrentPeriodEndAsync(user.UserId, periodEnd.Value);

        if (!string.IsNullOrEmpty(subscription.Id))
            await userRepo.SetStripeSubscriptionIdAsync(user.UserId, subscription.Id);
    }

    private async Task HandleSubscriptionDeletedAsync(Stripe.Event stripeEvent)
    {
        var subscription = stripeEvent.Data.Object as Stripe.Subscription;
        if (subscription?.CustomerId == null)
        {
            logger.LogError("customer.subscription.deleted: missing customer ID in event {EventId}", stripeEvent.Id);
            return;
        }

        var user = await userRepo.GetByStripeCustomerIdAsync(subscription.CustomerId);
        if (user == null)
        {
            logger.LogError("customer.subscription.deleted: no user found for Stripe customer {CustomerId} (event {EventId})",
                subscription.CustomerId, stripeEvent.Id);
            return;
        }

        foreach (var item in subscription.Items.Data)
        {
            var tier = GetTierForPriceId(item.Price.Id);
            if (tier != null)
            {
                await userRepo.SetTierAsync(user.UserId, "free");
                logger.LogInformation("Tier subscription ended, reset user {UserId} to free tier", user.UserId);
            }
            else if (IsBoostPriceId(item.Price.Id))
            {
                await userRepo.SetBoostMultiplierAsync(user.UserId, 1);
                logger.LogInformation("Boost subscription ended, reset user {UserId} boost multiplier to 1",
                    user.UserId);
            }
        }

        // Only set payment_failed_at for involuntary cancellation (payment failure)
        // Voluntary cancellation: Stripe keeps subscription active until period end, no grace needed
        var isPaymentFailure = subscription.CancellationDetails?.Reason == "payment_failed";
        if (isPaymentFailure)
        {
            await userRepo.SetPaymentFailedAtAsync(user.UserId, DateTime.UtcNow);
            logger.LogInformation("Payment failure cancellation for user {UserId}, grace period activated", user.UserId);
        }

        // Clear billing metadata on subscription deletion
        await userRepo.SetCurrentPeriodEndAsync(user.UserId, null);
        await userRepo.SetStripeSubscriptionIdAsync(user.UserId, null);
    }

    private async Task HandleCheckoutCompletedAsync(Stripe.Event stripeEvent)
    {
        var session = stripeEvent.Data.Object as Session;
        if (session?.CustomerId == null)
        {
            logger.LogError("checkout.session.completed: missing customer ID in event {EventId}", stripeEvent.Id);
            return;
        }

        logger.LogInformation("Checkout completed: customerId={CustomerId}, sessionId={SessionId}, metadata={Metadata}",
            session.CustomerId, session.Id, session.Metadata != null ? string.Join(", ", session.Metadata.Select(kv => $"{kv.Key}={kv.Value}")) : "(none)");

        var user = await userRepo.GetByStripeCustomerIdAsync(session.CustomerId);
        if (user == null)
        {
            // Fallback: look up by user_id in session metadata (handles stale/missing stripe_user_id)
            var metadataUserId = session.Metadata?.GetValueOrDefault("user_id");
            if (metadataUserId != null && Guid.TryParse(metadataUserId, out var parsedUserId))
            {
                user = await userRepo.GetByIdAsync(parsedUserId);
                if (user != null)
                {
                    logger.LogWarning("checkout.session.completed: user {UserId} found via metadata fallback for Stripe customer {CustomerId}. Linking stripe_user_id.",
                        user.UserId, session.CustomerId);
                    await userRepo.SetStripeCustomerIdAsync(user.UserId, session.CustomerId);
                }
            }

            if (user == null)
            {
                logger.LogError("checkout.session.completed: no user found for Stripe customer {CustomerId} (event {EventId}). " +
                    "Metadata user_id lookup also failed.", session.CustomerId, stripeEvent.Id);
                return;
            }
        }

        logger.LogInformation("Checkout completed: matched user={UserId}, currentTier={CurrentTier}", user.UserId, user.SubscriptionTier);

        // Extract metadata for tier/boost determination
        var metadata = session.Metadata ?? new Dictionary<string, string>();
        var checkoutType = metadata.GetValueOrDefault("type", "tier");
        var checkoutTier = metadata.GetValueOrDefault("tier", "hobby");

        // Set tier directly from checkout metadata -- do NOT rely solely on subscription.updated webhook
        if (checkoutType == "tier" && !string.IsNullOrEmpty(checkoutTier))
        {
            await userRepo.SetTierAsync(user.UserId, checkoutTier);
            logger.LogInformation("Set tier to {Tier} from checkout completion for user {UserId}", checkoutTier, user.UserId);
        }

        // Clear any previous stripe error on successful checkout
        await userRepo.SetLastStripeErrorAsync(user.UserId, null);

        // Get subscription details
        var subscription = await GetActiveSubscriptionAsync(session.CustomerId);
        if (subscription == null)
        {
            logger.LogWarning("Checkout completed but no active subscription found for customer {CustomerId} (user {UserId}). Tier was set from metadata.",
                session.CustomerId, user.UserId);
            return;
        }

        logger.LogInformation("Checkout completed: found subscription={SubscriptionId}, status={Status}, items={ItemCount}",
            subscription.Id, subscription.Status, subscription.Items?.Data?.Count ?? 0);

        // Persist billing metadata from checkout
        var periodEnd = GetCurrentPeriodEnd(subscription);
        if (periodEnd.HasValue)
            await userRepo.SetCurrentPeriodEndAsync(user.UserId, periodEnd.Value);
        if (!string.IsNullOrEmpty(subscription.Id))
            await userRepo.SetStripeSubscriptionIdAsync(user.UserId, subscription.Id);

    }

    private async Task HandleInvoicePaidAsync(Stripe.Event stripeEvent)
    {
        var invoice = stripeEvent.Data.Object as Stripe.Invoice;
        if (invoice?.CustomerId == null)
        {
            logger.LogError("invoice.paid: missing customer ID in event {EventId}", stripeEvent.Id);
            return;
        }

        var user = await userRepo.GetByStripeCustomerIdAsync(invoice.CustomerId);
        if (user == null)
        {
            logger.LogError("invoice.paid: no user found for Stripe customer {CustomerId} (event {EventId})",
                invoice.CustomerId, stripeEvent.Id);
            return;
        }

        // Create/update invoice record
        var period = ResolveBillingPeriodFromInvoice(invoice);
        await invoiceRepo.CreateAsync(user.UserId, new CreateInvoice(
            Tier: ResolveTierFromInvoice(invoice) ?? user.SubscriptionTier,
            BoostMultiplier: user.BoostMultiplier,
            AmountPaidCents: (int)(invoice.AmountPaid),
            Status: "paid",
            BillingPeriodStart: period.Start,
            BillingPeriodEnd: period.End
        ));

        // Clear payment_failed_at on successful payment (clean slate)
        if (user.PaymentFailedAt.HasValue)
            await userRepo.SetPaymentFailedAtAsync(user.UserId, null);

        logger.LogInformation("Created invoice for user {UserId} from paid invoice", user.UserId);
    }

    private async Task HandleInvoicePaymentFailedAsync(Stripe.Event stripeEvent)
    {
        var invoice = stripeEvent.Data.Object as Stripe.Invoice;
        if (invoice?.CustomerId == null)
        {
            logger.LogError("invoice.payment_failed: missing customer ID in event {EventId}", stripeEvent.Id);
            return;
        }

        var user = await userRepo.GetByStripeCustomerIdAsync(invoice.CustomerId);
        if (user == null)
        {
            logger.LogError("invoice.payment_failed: no user found for Stripe customer {CustomerId} (event {EventId})",
                invoice.CustomerId, stripeEvent.Id);
            return;
        }

        // Create invoice record with failed status
        var period = ResolveBillingPeriodFromInvoice(invoice);
        await invoiceRepo.CreateAsync(user.UserId, new CreateInvoice(
            Tier: ResolveTierFromInvoice(invoice) ?? user.SubscriptionTier,
            BoostMultiplier: user.BoostMultiplier,
            AmountPaidCents: (int)(invoice.AmountDue),
            Status: "failed",
            BillingPeriodStart: period.Start,
            BillingPeriodEnd: period.End
        ));

        logger.LogWarning("Created failed invoice for user {UserId}", user.UserId);
    }
}
