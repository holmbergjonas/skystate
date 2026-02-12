using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public static class BillingEndpoints
{
    public static void MapBillingEndpoints(this WebApplication app)
    {
        // POST /billing/checkout - create Stripe Checkout session for a tier
        app.MapPost("/billing/checkout", async (
            CheckoutRequest body,
            ICurrentUserService currentUser,
            IStripeService stripeService,
            ILogger<Program> logger) =>
        {
            var userId = currentUser.GetUserId();
            logger.LogInformation("Checkout requested: user={UserId}, tier={Tier}", userId, body.Tier);
            var result = await stripeService.CreateCheckoutSessionAsync(
                userId, body.Tier, body.SuccessUrl, body.CancelUrl);
            switch (result)
            {
                case ServiceResult<string>.ValidationError(var message):
                    logger.LogWarning("Checkout validation error: user={UserId}, tier={Tier}, error={Error}", userId, body.Tier, message);
                    return Results.BadRequest(new ErrorResponse("validation_error", message));
                case ServiceResult<string>.NotFound:
                    logger.LogWarning("Checkout user not found: user={UserId}", userId);
                    return Results.BadRequest(new ErrorResponse("checkout_error", "User not found"));
                case ServiceResult<string>.Success(var url):
                    logger.LogInformation("Checkout session created: user={UserId}, tier={Tier}", userId, body.Tier);
                    return Results.Ok(new { url });
                default:
                    logger.LogError("Checkout unexpected result type: user={UserId}, tier={Tier}", userId, body.Tier);
                    return Results.StatusCode(500);
            }
        })
            .WithTags("Billing")
            .RequireAuthorization();

        // POST /billing/portal - create Stripe Customer Portal session
        app.MapPost("/billing/portal", async (
            PortalRequest body,
            ICurrentUserService currentUser,
            IStripeService stripeService) =>
        {
            var result = await stripeService.CreatePortalSessionAsync(
                currentUser.GetUserId(), body.ReturnUrl);
            return result switch
            {
                ServiceResult<string>.ValidationError(var message) =>
                    Results.BadRequest(new ErrorResponse("portal_error", message)),
                ServiceResult<string>.NotFound =>
                    Results.BadRequest(new ErrorResponse("portal_error", "User not found")),
                ServiceResult<string>.Success(var url) =>
                    Results.Ok(new { url }),
                _ => Results.StatusCode(500)
            };
        })
            .WithTags("Billing")
            .RequireAuthorization();

        // POST /billing/boost/checkout - create Stripe Checkout session for boost add-on
        app.MapPost("/billing/boost/checkout", async (
            BoostCheckoutRequest body,
            ICurrentUserService currentUser,
            IStripeService stripeService) =>
        {
            var result = await stripeService.CreateBoostCheckoutSessionAsync(
                currentUser.GetUserId(), body.Quantity, body.SuccessUrl, body.CancelUrl);
            return result switch
            {
                ServiceResult<string>.ValidationError(var message) =>
                    Results.BadRequest(new ErrorResponse("validation_error", message)),
                ServiceResult<string>.NotFound =>
                    Results.BadRequest(new ErrorResponse("boost_error", "User not found")),
                ServiceResult<string>.Success(var url) =>
                    Results.Ok(new { url }),
                _ => Results.StatusCode(500)
            };
        })
            .WithTags("Billing")
            .RequireAuthorization();

        // PUT /billing/boost - update boost quantity on existing subscription
        app.MapPut("/billing/boost", async (
            BoostUpdateRequest body,
            ICurrentUserService currentUser,
            IStripeService stripeService) =>
        {
            var result = await stripeService.UpdateBoostQuantityAsync(
                currentUser.GetUserId(), body.Quantity);
            return result switch
            {
                ServiceResult<string>.ValidationError(var message) =>
                    Results.BadRequest(new ErrorResponse("validation_error", message)),
                ServiceResult<string>.NotFound =>
                    Results.BadRequest(new ErrorResponse("boost_error", "User not found")),
                ServiceResult<string>.Success(var message) =>
                    Results.Ok(new { message }),
                _ => Results.StatusCode(500)
            };
        })
            .WithTags("Billing")
            .RequireAuthorization();

        // POST /billing/change-tier - upgrade or downgrade subscription tier
        app.MapPost("/billing/change-tier", async (
            ChangeTierRequest body,
            ICurrentUserService currentUser,
            IStripeService stripeService) =>
        {
            var result = await stripeService.ChangeTierAsync(
                currentUser.GetUserId(), body.Tier);
            return result switch
            {
                ServiceResult<string>.ValidationError(var message) =>
                    Results.BadRequest(new ErrorResponse("validation_error", message)),
                ServiceResult<string>.NotFound =>
                    Results.BadRequest(new ErrorResponse("tier_error", "User not found")),
                ServiceResult<string>.Success(var message) =>
                    Results.Ok(new { message }),
                _ => Results.StatusCode(500)
            };
        })
            .WithTags("Billing")
            .RequireAuthorization();

        // GET /billing/status - get billing status
        app.MapGet("/billing/status", async (
            ICurrentUserService currentUser,
            IBillingService billingService,
            ILogger<Program> logger) =>
        {
            var userId = currentUser.GetUserId();
            var result = await billingService.GetStatusAsync(userId);
            switch (result)
            {
                case ServiceResult<BillingStatusResponse>.Success(var status):
                    logger.LogInformation("Billing status polled: user={UserId}, tier={Tier}, boost={Boost}",
                        userId, status.Tier, status.BoostMultiplier);
                    return Results.Ok(status);
                default:
                    logger.LogWarning("Billing status not found: user={UserId}", userId);
                    return Results.NotFound();
            }
        })
            .WithTags("Billing")
            .RequireAuthorization();
    }
}

public record CheckoutRequest(string Tier, string SuccessUrl, string CancelUrl);
public record PortalRequest(string ReturnUrl);
public record BoostCheckoutRequest(int Quantity, string SuccessUrl, string CancelUrl);
public record BoostUpdateRequest(int Quantity);
public record ChangeTierRequest(string Tier);
