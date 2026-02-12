using System;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using SkyState.Api.Services;
using Stripe;

namespace SkyState.Api.Endpoints;

// Rename to "Stripe" something?
public static class WebhookEndpoints
{
    public static void MapWebhookEndpoints(this WebApplication app)
    {
        app.MapPost("/webhooks/stripe", async (HttpContext context, IWebhookService webhookService, ILogger<Program> logger) =>
        {
            logger.LogInformation("Stripe webhook endpoint hit: {Method} {Path} from {RemoteIp}",
                context.Request.Method, context.Request.Path, context.Connection.RemoteIpAddress);

            // CRITICAL: Enable buffering before reading body for signature verification
            context.Request.EnableBuffering();

            using var reader = new StreamReader(context.Request.Body);
            var json = await reader.ReadToEndAsync();

            logger.LogDebug("Stripe webhook body length: {Length}, has Stripe-Signature: {HasSig}",
                json.Length, context.Request.Headers.ContainsKey("Stripe-Signature"));

            var signatureHeader = context.Request.Headers["Stripe-Signature"].ToString();

            if (string.IsNullOrEmpty(signatureHeader))
            {
                logger.LogWarning("Stripe webhook rejected: empty Stripe-Signature header");
                return Results.BadRequest();
            }

            Event stripeEvent;
            try
            {
                stripeEvent = await webhookService.VerifyAndParseAsync(json, signatureHeader);
                logger.LogInformation("Stripe webhook parsed: {EventType} ({EventId})", stripeEvent.Type, stripeEvent.Id);
            }
            catch (StripeException ex)
            {
                logger.LogWarning(ex, "Stripe webhook signature verification failed");
                return Results.BadRequest();
            }

            try
            {
                await webhookService.ProcessEventAsync(stripeEvent);
                logger.LogInformation("Stripe webhook processed successfully: {EventType} ({EventId})", stripeEvent.Type, stripeEvent.Id);
            }
            catch (Exception ex)
            {
                // Log error but still return 200 to prevent Stripe retries for processing errors
                logger.LogError(ex, "Error processing Stripe webhook event {EventId}", stripeEvent.Id);
            }

            return Results.Ok();
        })
            .WithTags("Webhooks")
            .AllowAnonymous(); // Webhook uses Stripe signature, not JWT auth
    }
}
