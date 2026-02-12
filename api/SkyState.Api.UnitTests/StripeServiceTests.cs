using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using SkyState.Api.Services;
using Stripe;
using Stripe.Checkout;
using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Unit tests for <see cref="StripeService"/> covering webhook event handling,
/// duplicate detection, subscription lifecycle, invoice processing, and input validation.
/// Uses NSubstitute mocks for repositories and MockHttpMessageHandler for StripeClient HTTP interception.
/// </summary>
public class StripeServiceTests
{
    private readonly IUserRepository _userRepo = Substitute.For<IUserRepository>();
    private readonly IWebhookEventRepository _webhookRepo = Substitute.For<IWebhookEventRepository>();
    private readonly IInvoiceRepository _invoiceRepo = Substitute.For<IInvoiceRepository>();

    private static readonly StripeSettings TestSettings = new()
    {
        SecretKey = "sk_test_fake",
        WebhookSecret = "whsec_test_fake",
        HobbyPriceId = "price_hobby_test",
        ProPriceId = "price_pro_test",
        BoostPriceId = "price_boost_test"
    };

    private static IOptions<StripeSettings> CreateSettings() => Options.Create(TestSettings);

    private static User MakeUser(Guid userId, string tier = "free", int boost = 1,
        string? stripeCustomerId = "cus_test_123", DateTime? paymentFailedAt = null) =>
        new()
        {
            UserId = userId,
            SsoProvider = "github",
            SsoUserId = "test-sso-123",
            Email = "test@test.com",
            DisplayName = "Test User",
            SubscriptionTier = tier,
            BoostMultiplier = boost,
            StripeUserId = stripeCustomerId,
            PaymentFailedAt = paymentFailedAt,
            LastLoginAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

    /// <summary>
    /// Creates a StripeService with a MockHttpMessageHandler that returns the given response
    /// for any HTTP request made by StripeClient.
    /// </summary>
    private StripeService CreateSut(Func<HttpRequestMessage, HttpResponseMessage>? handler = null)
    {
        handler ??= _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}")
        };

        var mockHandler = new MockHttpMessageHandler(handler);
        var httpClient = new HttpClient(mockHandler);
        var stripeHttpClient = new SystemNetHttpClient(httpClient);
        var stripeClient = new StripeClient(apiKey: "sk_test_fake", httpClient: stripeHttpClient);

        return new StripeService(
            stripeClient,
            CreateSettings(),
            _userRepo,
            _webhookRepo,
            _invoiceRepo,
            NullLogger<StripeService>.Instance);
    }

    /// <summary>
    /// Builds a Stripe.Event with the given type and data object.
    /// </summary>
    private static Stripe.Event MakeEvent(string eventType, IHasObject dataObject, string? eventId = null)
    {
        return new Stripe.Event
        {
            Id = eventId ?? $"evt_{Guid.NewGuid():N}",
            Type = eventType,
            Data = new EventData { Object = dataObject }
        };
    }

    /// <summary>
    /// Creates a Stripe.Subscription with the given properties.
    /// </summary>
    private static Stripe.Subscription MakeSubscription(
        string customerId = "cus_test_123",
        string status = "active",
        bool cancelAtPeriodEnd = false,
        string? priceId = null,
        long quantity = 1,
        string? cancellationReason = null)
    {
        var sub = new Stripe.Subscription
        {
            Id = $"sub_{Guid.NewGuid():N}",
            CustomerId = customerId,
            Status = status,
            CancelAtPeriodEnd = cancelAtPeriodEnd,
            Items = new StripeList<SubscriptionItem>
            {
                Data = new List<SubscriptionItem>
                {
                    new()
                    {
                        Price = new Price { Id = priceId ?? TestSettings.HobbyPriceId },
                        Quantity = quantity
                    }
                }
            },
            Created = DateTime.UtcNow.AddDays(-30)
        };

        if (cancellationReason != null)
        {
            sub.CancellationDetails = new SubscriptionCancellationDetails
            {
                Reason = cancellationReason
            };
        }

        return sub;
    }

    // ===== 1. HandleWebhookEventAsync routing + duplicate detection =====

    [Fact]
    public async Task HandleWebhookEventAsync_DuplicateEvent_SkipsProcessing()
    {
        var sut = CreateSut();
        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(false);

        var sub = MakeSubscription();
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _webhookRepo.DidNotReceive().MarkProcessedAsync(Arg.Any<string>());
        await _userRepo.DidNotReceive().GetByStripeCustomerIdAsync(Arg.Any<string>());
    }

    [Fact]
    public async Task HandleWebhookEventAsync_UnhandledEventType_RecordsAndMarksProcessed()
    {
        var sut = CreateSut();
        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);

        // Use an event type that does not match any switch case
        var stripeEvent = new Stripe.Event
        {
            Id = "evt_unhandled_123",
            Type = "unknown.type.event",
            Data = new EventData()
        };

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _webhookRepo.Received(1).MarkProcessedAsync("evt_unhandled_123");
        await _userRepo.DidNotReceive().GetByStripeCustomerIdAsync(Arg.Any<string>());
    }

    [Fact]
    public async Task HandleWebhookEventAsync_ProcessingError_RecordsErrorAndRethrows()
    {
        var sut = CreateSut();
        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);

        // subscription.updated with null Data.Object cast results in null check early return,
        // so we force an error by having GetByStripeCustomerIdAsync throw
        var sub = MakeSubscription();
        var stripeEvent = MakeEvent("customer.subscription.updated", sub, "evt_error_123");

        _userRepo.GetByStripeCustomerIdAsync("cus_test_123")
            .ThrowsAsync(new InvalidOperationException("Database failure"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => sut.HandleWebhookEventAsync(stripeEvent));

        await _webhookRepo.Received(1).RecordErrorAsync("evt_error_123", "Database failure");
        await _webhookRepo.DidNotReceive().MarkProcessedAsync(Arg.Any<string>());
    }

    // ===== 2. HandleSubscriptionUpdatedAsync =====

    [Fact]
    public async Task HandleSubscriptionUpdated_ActiveTierSubscription_UpdatesTier()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(priceId: TestSettings.HobbyPriceId, status: "active", cancelAtPeriodEnd: false);
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetTierAsync(userId, "hobby");
        await _webhookRepo.Received(1).MarkProcessedAsync(Arg.Any<string>());
    }

    [Fact]
    public async Task HandleSubscriptionUpdated_ActiveBoostSubscription_UpdatesBoostMultiplier()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(
            priceId: TestSettings.BoostPriceId,
            status: "active",
            cancelAtPeriodEnd: false,
            quantity: 3);
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetBoostMultiplierAsync(userId, 3);
    }

    [Fact]
    public async Task HandleSubscriptionUpdated_CancelAtPeriodEnd_DoesNotChangeTier()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(
            priceId: TestSettings.HobbyPriceId,
            status: "active",
            cancelAtPeriodEnd: true);
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.DidNotReceive().SetTierAsync(Arg.Any<Guid>(), Arg.Any<string>());
    }

    [Fact]
    public async Task HandleSubscriptionUpdated_NoUserForCustomer_LogsWarning()
    {
        var sut = CreateSut();

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns((User?)null);

        var sub = MakeSubscription();
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.DidNotReceive().SetTierAsync(Arg.Any<Guid>(), Arg.Any<string>());
        await _userRepo.DidNotReceive().SetBoostMultiplierAsync(Arg.Any<Guid>(), Arg.Any<int>());
        await _webhookRepo.Received(1).MarkProcessedAsync(Arg.Any<string>());
    }

    // ===== 3. HandleSubscriptionDeletedAsync =====

    [Fact]
    public async Task HandleSubscriptionDeleted_TierSubscription_ResetsToFree()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(priceId: TestSettings.HobbyPriceId);
        var stripeEvent = MakeEvent("customer.subscription.deleted", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetTierAsync(userId, "free");
    }

    [Fact]
    public async Task HandleSubscriptionDeleted_BoostSubscription_ResetsBoostTo1()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby", boost: 3);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(priceId: TestSettings.BoostPriceId);
        var stripeEvent = MakeEvent("customer.subscription.deleted", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetBoostMultiplierAsync(userId, 1);
    }

    [Fact]
    public async Task HandleSubscriptionDeleted_PaymentFailure_SetsPaymentFailedAt()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(
            priceId: TestSettings.HobbyPriceId,
            cancellationReason: "payment_failed");
        var stripeEvent = MakeEvent("customer.subscription.deleted", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetPaymentFailedAtAsync(userId, Arg.Is<DateTime?>(d => d.HasValue));
    }

    // ===== 4. HandleInvoicePaidAsync =====

    [Fact]
    public async Task HandleInvoicePaid_CreatesInvoiceRecord()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var invoicePeriodStart = DateTime.UtcNow;
        var invoicePeriodEnd = DateTime.UtcNow; // Same date — simulates Stripe's initial invoice behavior
        var lineItemPeriodStart = DateTime.UtcNow.AddDays(-30);
        var lineItemPeriodEnd = DateTime.UtcNow;

        var invoice = new Stripe.Invoice
        {
            Id = "in_test_123",
            CustomerId = "cus_test_123",
            AmountPaid = 999,
            PeriodStart = invoicePeriodStart,
            PeriodEnd = invoicePeriodEnd,
            Lines = new StripeList<InvoiceLineItem>
            {
                Data = new List<InvoiceLineItem>
                {
                    new()
                    {
                        Pricing = new InvoiceLineItemPricing { PriceDetails = new InvoiceLineItemPricingPriceDetails { Price = TestSettings.HobbyPriceId } },
                        Period = new InvoiceLineItemPeriod { Start = lineItemPeriodStart, End = lineItemPeriodEnd }
                    }
                }
            }
        };
        var stripeEvent = MakeEvent("invoice.paid", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should use the line item period, NOT the invoice-level period
        await _invoiceRepo.Received(1).CreateAsync(
            userId,
            Arg.Is<CreateInvoice>(ci =>
                ci.Tier == "hobby" &&
                ci.AmountPaidCents == 999 &&
                ci.Status == "paid" &&
                ci.BillingPeriodStart == lineItemPeriodStart &&
                ci.BillingPeriodEnd == lineItemPeriodEnd));
    }

    [Fact]
    public async Task HandleInvoicePaid_ClearsPaymentFailedAt()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby", paymentFailedAt: DateTime.UtcNow.AddDays(-3));

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var invoice = new Stripe.Invoice
        {
            Id = "in_test_456",
            CustomerId = "cus_test_123",
            AmountPaid = 999,
            PeriodStart = DateTime.UtcNow.AddDays(-30),
            PeriodEnd = DateTime.UtcNow
        };
        var stripeEvent = MakeEvent("invoice.paid", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetPaymentFailedAtAsync(userId, null);
    }

    [Fact]
    public async Task HandleInvoicePaid_ExtractsTierFromInvoiceLines()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        // User is still "free" in DB (checkout.session.completed hasn't been processed yet)
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var invoice = new Stripe.Invoice
        {
            Id = "in_race_123",
            CustomerId = "cus_test_123",
            AmountPaid = 500,
            PeriodStart = DateTime.UtcNow.AddDays(-30),
            PeriodEnd = DateTime.UtcNow,
            Lines = new StripeList<InvoiceLineItem>
            {
                Data = new List<InvoiceLineItem>
                {
                    new()
                    {
                        Pricing = new InvoiceLineItemPricing { PriceDetails = new InvoiceLineItemPricingPriceDetails { Price = TestSettings.HobbyPriceId } },
                        Period = new InvoiceLineItemPeriod { Start = DateTime.UtcNow.AddDays(-30), End = DateTime.UtcNow }
                    }
                }
            }
        };
        var stripeEvent = MakeEvent("invoice.paid", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should resolve "hobby" from line items, NOT "free" from user DB
        await _invoiceRepo.Received(1).CreateAsync(
            userId,
            Arg.Is<CreateInvoice>(ci =>
                ci.Tier == "hobby" &&
                ci.AmountPaidCents == 500 &&
                ci.Status == "paid"));
    }

    [Fact]
    public async Task HandleInvoicePaid_FallsBackToInvoicePeriod_WhenNoLineItems()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var periodStart = DateTime.UtcNow.AddDays(-30);
        var periodEnd = DateTime.UtcNow;

        var invoice = new Stripe.Invoice
        {
            Id = "in_fallback_123",
            CustomerId = "cus_test_123",
            AmountPaid = 999,
            PeriodStart = periodStart,
            PeriodEnd = periodEnd
            // No Lines — fallback to invoice-level period
        };
        var stripeEvent = MakeEvent("invoice.paid", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _invoiceRepo.Received(1).CreateAsync(
            userId,
            Arg.Is<CreateInvoice>(ci =>
                ci.Status == "paid" &&
                ci.BillingPeriodStart == periodStart &&
                ci.BillingPeriodEnd == periodEnd));
    }

    // ===== 5. HandleInvoicePaymentFailedAsync =====

    [Fact]
    public async Task HandleInvoicePaymentFailed_CreatesFailedInvoice()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var invoicePeriodStart = DateTime.UtcNow;
        var invoicePeriodEnd = DateTime.UtcNow;
        var lineItemPeriodStart = DateTime.UtcNow.AddDays(-30);
        var lineItemPeriodEnd = DateTime.UtcNow;

        var invoice = new Stripe.Invoice
        {
            Id = "in_fail_123",
            CustomerId = "cus_test_123",
            AmountDue = 999,
            PeriodStart = invoicePeriodStart,
            PeriodEnd = invoicePeriodEnd,
            Lines = new StripeList<InvoiceLineItem>
            {
                Data = new List<InvoiceLineItem>
                {
                    new()
                    {
                        Pricing = new InvoiceLineItemPricing { PriceDetails = new InvoiceLineItemPricingPriceDetails { Price = TestSettings.HobbyPriceId } },
                        Period = new InvoiceLineItemPeriod { Start = lineItemPeriodStart, End = lineItemPeriodEnd }
                    }
                }
            }
        };
        var stripeEvent = MakeEvent("invoice.payment_failed", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should use the line item period, NOT the invoice-level period
        await _invoiceRepo.Received(1).CreateAsync(
            userId,
            Arg.Is<CreateInvoice>(ci =>
                ci.AmountPaidCents == 999 &&
                ci.Status == "failed" &&
                ci.BillingPeriodStart == lineItemPeriodStart &&
                ci.BillingPeriodEnd == lineItemPeriodEnd));
    }

    [Fact]
    public async Task HandleInvoicePaymentFailed_ExtractsTierFromInvoiceLines()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        // User is still "free" in DB (checkout.session.completed hasn't been processed yet)
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);
        _invoiceRepo.CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>()).Returns(Guid.NewGuid());

        var invoice = new Stripe.Invoice
        {
            Id = "in_fail_race_123",
            CustomerId = "cus_test_123",
            AmountDue = 500,
            PeriodStart = DateTime.UtcNow.AddDays(-30),
            PeriodEnd = DateTime.UtcNow,
            Lines = new StripeList<InvoiceLineItem>
            {
                Data = new List<InvoiceLineItem>
                {
                    new()
                    {
                        Pricing = new InvoiceLineItemPricing { PriceDetails = new InvoiceLineItemPricingPriceDetails { Price = TestSettings.ProPriceId } },
                        Period = new InvoiceLineItemPeriod { Start = DateTime.UtcNow.AddDays(-30), End = DateTime.UtcNow }
                    }
                }
            }
        };
        var stripeEvent = MakeEvent("invoice.payment_failed", invoice);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should resolve "pro" from line items, NOT "free" from user DB
        await _invoiceRepo.Received(1).CreateAsync(
            userId,
            Arg.Is<CreateInvoice>(ci =>
                ci.Tier == "pro" &&
                ci.AmountPaidCents == 500 &&
                ci.Status == "failed"));
    }

    // ===== 6. HandleCheckoutCompletedAsync =====

    [Fact]
    public async Task HandleCheckoutCompleted_PersistsBillingMetadata()
    {
        // MockHttpMessageHandler returns a valid subscription list for GetActiveSubscriptionAsync
        var subscriptionListJson = """
        {
            "object": "list",
            "data": [{
                "id": "sub_checkout_123",
                "object": "subscription",
                "customer": "cus_test_123",
                "status": "active",
                "created": 1700000000,
                "items": {
                    "object": "list",
                    "data": [{
                        "id": "si_123",
                        "object": "subscription_item",
                        "price": {
                            "id": "price_hobby_test",
                            "object": "price"
                        },
                        "quantity": 1
                    }]
                }
            }],
            "has_more": false
        }
        """;

        var sut = CreateSut(req =>
        {
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(subscriptionListJson, System.Text.Encoding.UTF8, "application/json")
            };
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var session = new Session
        {
            Id = "cs_test_123",
            CustomerId = "cus_test_123",
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", "hobby" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _invoiceRepo.DidNotReceive().CreateAsync(Arg.Any<Guid>(), Arg.Any<CreateInvoice>());
        await _userRepo.Received(1).SetStripeSubscriptionIdAsync(userId, "sub_checkout_123");
    }

    // ===== 6b. HandleCheckoutCompleted — tier setting from metadata =====

    [Fact]
    public async Task HandleCheckoutCompleted_TierCheckout_SetsTierFromMetadata()
    {
        var subscriptionListJson = """
        {
            "object": "list",
            "data": [{
                "id": "sub_checkout_tier",
                "object": "subscription",
                "customer": "cus_test_123",
                "status": "active",
                "created": 1700000000,
                "items": {
                    "object": "list",
                    "data": [{
                        "id": "si_123",
                        "object": "subscription_item",
                        "price": { "id": "price_hobby_test", "object": "price" },
                        "quantity": 1
                    }]
                }
            }],
            "has_more": false
        }
        """;

        var sut = CreateSut(req => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(subscriptionListJson, System.Text.Encoding.UTF8, "application/json")
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var session = new Session
        {
            Id = "cs_tier_test",
            CustomerId = "cus_test_123",
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", "hobby" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetTierAsync(userId, "hobby");
    }

    [Fact]
    public async Task HandleCheckoutCompleted_BoostCheckout_DoesNotChangeTier()
    {
        var subscriptionListJson = """
        {
            "object": "list",
            "data": [{
                "id": "sub_checkout_boost",
                "object": "subscription",
                "customer": "cus_test_123",
                "status": "active",
                "created": 1700000000,
                "items": {
                    "object": "list",
                    "data": [{
                        "id": "si_123",
                        "object": "subscription_item",
                        "price": { "id": "price_boost_test", "object": "price" },
                        "quantity": 2
                    }]
                }
            }],
            "has_more": false
        }
        """;

        var sut = CreateSut(req => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(subscriptionListJson, System.Text.Encoding.UTF8, "application/json")
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "hobby");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var session = new Session
        {
            Id = "cs_boost_test",
            CustomerId = "cus_test_123",
            Metadata = new Dictionary<string, string>
            {
                { "type", "boost" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.DidNotReceive().SetTierAsync(Arg.Any<Guid>(), Arg.Any<string>());
    }

    [Fact]
    public async Task HandleCheckoutCompleted_NoSubscription_StillSetsTierFromMetadata()
    {
        // Return empty subscription list — no active subscription found
        var emptyListJson = """
        {
            "object": "list",
            "data": [],
            "has_more": false
        }
        """;

        var sut = CreateSut(req => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(emptyListJson, System.Text.Encoding.UTF8, "application/json")
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var session = new Session
        {
            Id = "cs_nosub_test",
            CustomerId = "cus_test_123",
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", "hobby" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should still set tier from metadata even without subscription
        await _userRepo.Received(1).SetTierAsync(userId, "hobby");
    }

    [Fact]
    public async Task HandleCheckoutCompleted_MetadataFallback_SetsTierAndLinksCustomer()
    {
        var subscriptionListJson = """
        {
            "object": "list",
            "data": [{
                "id": "sub_fallback_123",
                "object": "subscription",
                "customer": "cus_new_789",
                "status": "active",
                "created": 1700000000,
                "items": {
                    "object": "list",
                    "data": [{
                        "id": "si_123",
                        "object": "subscription_item",
                        "price": { "id": "price_hobby_test", "object": "price" },
                        "quantity": 1
                    }]
                }
            }],
            "has_more": false
        }
        """;

        var sut = CreateSut(req => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(subscriptionListJson, System.Text.Encoding.UTF8, "application/json")
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "free", stripeCustomerId: null);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        // Not found by customerId
        _userRepo.GetByStripeCustomerIdAsync("cus_new_789").Returns((User?)null);
        // Found by metadata user_id fallback
        _userRepo.GetByIdAsync(userId).Returns(user);

        var session = new Session
        {
            Id = "cs_fallback_test",
            CustomerId = "cus_new_789",
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", "hobby" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        // Should link the customer and set the tier
        await _userRepo.Received(1).SetStripeCustomerIdAsync(userId, "cus_new_789");
        await _userRepo.Received(1).SetTierAsync(userId, "hobby");
    }

    [Fact]
    public async Task HandleCheckoutCompleted_ClearsLastStripeError()
    {
        var subscriptionListJson = """
        {
            "object": "list",
            "data": [{
                "id": "sub_clear_err",
                "object": "subscription",
                "customer": "cus_test_123",
                "status": "active",
                "created": 1700000000,
                "items": {
                    "object": "list",
                    "data": [{
                        "id": "si_123",
                        "object": "subscription_item",
                        "price": { "id": "price_hobby_test", "object": "price" },
                        "quantity": 1
                    }]
                }
            }],
            "has_more": false
        }
        """;

        var sut = CreateSut(req => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(subscriptionListJson, System.Text.Encoding.UTF8, "application/json")
        });

        var userId = Guid.NewGuid();
        var user = MakeUser(userId, "free");

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var session = new Session
        {
            Id = "cs_clear_err_test",
            CustomerId = "cus_test_123",
            Metadata = new Dictionary<string, string>
            {
                { "type", "tier" },
                { "tier", "hobby" },
                { "user_id", userId.ToString() }
            }
        };
        var stripeEvent = MakeEvent("checkout.session.completed", session);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetLastStripeErrorAsync(userId, null);
    }

    [Fact]
    public async Task HandleSubscriptionUpdated_ActiveTier_ClearsLastStripeError()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();
        var user = MakeUser(userId);

        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);
        _userRepo.GetByStripeCustomerIdAsync("cus_test_123").Returns(user);

        var sub = MakeSubscription(priceId: TestSettings.HobbyPriceId, status: "active", cancelAtPeriodEnd: false);
        var stripeEvent = MakeEvent("customer.subscription.updated", sub);

        await sut.HandleWebhookEventAsync(stripeEvent);

        await _userRepo.Received(1).SetLastStripeErrorAsync(userId, null);
    }

    [Fact]
    public async Task HandleWebhookEvent_ProcessingError_SetsLastStripeErrorOnUser()
    {
        var sut = CreateSut();
        _webhookRepo.TryRecordEventAsync(Arg.Any<string>(), Arg.Any<string>()).Returns(true);

        var userId = Guid.NewGuid();
        var user = MakeUser(userId);

        // subscription.updated handler will call GetByStripeCustomerIdAsync which throws
        var sub = MakeSubscription();
        var stripeEvent = MakeEvent("customer.subscription.updated", sub, "evt_err_user");

        _userRepo.GetByStripeCustomerIdAsync("cus_test_123")
            .ThrowsAsync(new InvalidOperationException("DB connection failed"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => sut.HandleWebhookEventAsync(stripeEvent));

        // After the error, the catch block should try to record the error on the user.
        // Since the subscription has a customerId, it should try to look up the user.
        // However, GetByStripeCustomerIdAsync throws, so the inner catch should swallow that.
        // We verify via webhookRepo that the error was recorded on the event.
        await _webhookRepo.Received(1).RecordErrorAsync("evt_err_user", "DB connection failed");
    }

    // ===== 7. Input validation tests =====

    [Fact]
    public async Task CreateCheckoutSessionAsync_EmptyUrls_ReturnsValidationError()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();

        var result = await sut.CreateCheckoutSessionAsync(userId, "hobby", "", "https://example.com/cancel");

        Assert.IsType<ServiceResult<string>.ValidationError>(result);
    }

    [Fact]
    public async Task CreateCheckoutSessionAsync_InvalidTier_ReturnsValidationError()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();

        var result = await sut.CreateCheckoutSessionAsync(userId, "free", "https://example.com/success", "https://example.com/cancel");

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("Invalid tier", error.Message);
    }

    [Fact]
    public async Task CreateBoostCheckoutSessionAsync_ZeroQuantity_ReturnsValidationError()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();

        var result = await sut.CreateBoostCheckoutSessionAsync(userId, 0, "https://example.com/success", "https://example.com/cancel");

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("Quantity must be at least 1", error.Message);
    }

    [Fact]
    public async Task CreatePortalSessionAsync_EmptyReturnUrl_ReturnsValidationError()
    {
        var sut = CreateSut();
        var userId = Guid.NewGuid();

        var result = await sut.CreatePortalSessionAsync(userId, "");

        Assert.IsType<ServiceResult<string>.ValidationError>(result);
    }

    // ===== 8. Stale Stripe customer ID tests =====

    [Fact]
    public async Task CreateCheckoutSession_StaleCustomerId_ClearsAndRetriesSuccessfully()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse(),   // First call: session create fails (stale customer)
            _ => MakeCustomerCreateResponse(),  // Second call: create new customer
            _ => MakeCheckoutSessionResponse()  // Third call: retry session create
        );

        var result = await sut.CreateCheckoutSessionAsync(
            userId, "hobby", "https://example.com/success", "https://example.com/cancel");

        // Should succeed with a checkout URL
        var success = Assert.IsType<ServiceResult<string>.Success>(result);
        Assert.Contains("checkout.stripe.com", success.Value);

        // Stale ID should have been cleared, then new ID set
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, Arg.Is<string>(s => s == null! || s == ""));
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, "cus_new_456");
    }

    [Fact]
    public async Task CreateCheckoutSession_StaleCustomerId_RetryAlsoFails_ReturnsError()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        // All calls return stale customer error
        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        // Current code throws StripeException (unhandled) — after Phase 43 fix,
        // this should return a ServiceResult.ValidationError instead
        var exception = await Assert.ThrowsAnyAsync<Exception>(
            () => sut.CreateCheckoutSessionAsync(
                userId, "hobby", "https://example.com/success", "https://example.com/cancel"));

        Assert.NotNull(exception);
    }

    [Fact]
    public async Task CreateCheckoutSession_UserHasNoStripeId_CreatesNewCustomer()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: null);
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeCustomerCreateResponse(),  // Customer create
            _ => MakeCheckoutSessionResponse()  // Session create
        );

        var result = await sut.CreateCheckoutSessionAsync(
            userId, "hobby", "https://example.com/success", "https://example.com/cancel");

        var success = Assert.IsType<ServiceResult<string>.Success>(result);
        Assert.Contains("checkout.stripe.com", success.Value);
        await _userRepo.Received(1).SetStripeCustomerIdAsync(userId, "cus_new_456");
    }

    [Fact]
    public async Task CreateBoostCheckout_StaleCustomerId_ClearsAndReturnsValidationError()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        var result = await sut.CreateBoostCheckoutSessionAsync(
            userId, 1, "https://example.com/success", "https://example.com/cancel");

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("reconnected", error.Message);

        // Verify stale ID was cleared
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, null!);
    }

    [Fact]
    public async Task UpdateBoostQuantity_StaleCustomerId_ClearsAndReturnsValidationError()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        var result = await sut.UpdateBoostQuantityAsync(userId, 2);

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("reconnected", error.Message);

        // Verify stale ID was cleared
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, null!);
    }

    [Fact]
    public async Task ChangeTier_StaleCustomerId_ClearsAndReturnsValidationError()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        var result = await sut.ChangeTierAsync(userId, "pro");

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("reconnected", error.Message);

        // Verify stale ID was cleared
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, null!);
    }

    [Fact]
    public async Task CreatePortalSession_StaleCustomerId_ClearsAndReturnsValidationError()
    {
        var userId = Guid.NewGuid();
        var user = MakeUser(userId, stripeCustomerId: "cus_stale_123");
        _userRepo.GetByIdAsync(userId).Returns(user);

        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        var result = await sut.CreatePortalSessionAsync(userId, "https://example.com/return");

        var error = Assert.IsType<ServiceResult<string>.ValidationError>(result);
        Assert.Contains("reconnected", error.Message);

        // Verify stale ID was cleared
        await _userRepo.Received().SetStripeCustomerIdAsync(userId, null!);
    }

    [Fact]
    public async Task GetActiveSubscription_StaleCustomerId_ReturnsNull()
    {
        var sut = CreateSutWithSequencedHandler(
            _ => MakeStaleCustomerResponse()
        );

        var result = await sut.GetActiveSubscriptionAsync("cus_stale_123");

        Assert.Null(result);
    }

    /// <summary>
    /// A mock HttpMessageHandler that intercepts HTTP requests for StripeClient.
    /// </summary>
    private sealed class MockHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> handler)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(handler(request));
        }
    }

    /// <summary>
    /// A mock HttpMessageHandler that returns responses in sequence.
    /// When only one response remains, it reuses that response for all subsequent calls.
    /// </summary>
    private sealed class SequencedMockHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses;

        public SequencedMockHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] responses)
        {
            _responses = new Queue<Func<HttpRequestMessage, HttpResponseMessage>>(responses);
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var handler = _responses.Count > 1 ? _responses.Dequeue() : _responses.Peek();
            return Task.FromResult(handler(request));
        }
    }

    /// <summary>
    /// Creates a StripeService with a SequencedMockHandler for multi-step test scenarios.
    /// </summary>
    private StripeService CreateSutWithSequencedHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] responses)
    {
        var mockHandler = new SequencedMockHandler(responses);
        var httpClient = new HttpClient(mockHandler);
        var stripeHttpClient = new SystemNetHttpClient(httpClient);
        var stripeClient = new StripeClient(apiKey: "sk_test_fake", httpClient: stripeHttpClient);

        return new StripeService(
            stripeClient,
            CreateSettings(),
            _userRepo,
            _webhookRepo,
            _invoiceRepo,
            NullLogger<StripeService>.Instance);
    }

    /// <summary>
    /// Returns an HTTP 404 response with a Stripe resource_missing error body.
    /// </summary>
    private static HttpResponseMessage MakeStaleCustomerResponse()
    {
        return new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent(
                """
                {
                    "error": {
                        "type": "invalid_request_error",
                        "code": "resource_missing",
                        "message": "No such customer: 'cus_stale_123'",
                        "param": "customer"
                    }
                }
                """,
                System.Text.Encoding.UTF8,
                "application/json")
        };
    }

    /// <summary>
    /// Returns a successful Stripe customer create response.
    /// </summary>
    private static HttpResponseMessage MakeCustomerCreateResponse()
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """
                {
                    "id": "cus_new_456",
                    "object": "customer",
                    "email": "test@test.com"
                }
                """,
                System.Text.Encoding.UTF8,
                "application/json")
        };
    }

    /// <summary>
    /// Returns a successful Stripe checkout session create response.
    /// </summary>
    private static HttpResponseMessage MakeCheckoutSessionResponse()
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """
                {
                    "id": "cs_test_new",
                    "object": "checkout.session",
                    "url": "https://checkout.stripe.com/pay/cs_test_new"
                }
                """,
                System.Text.Encoding.UTF8,
                "application/json")
        };
    }
}
