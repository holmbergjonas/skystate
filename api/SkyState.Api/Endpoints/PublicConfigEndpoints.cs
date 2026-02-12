using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

/// <summary>
/// Public read-only endpoint for fetching project config by slug.
/// This endpoint is exempt from authentication because it serves as the client-facing
/// read API -- end-user applications embed project/environment slugs and fetch config
/// directly without credentials. Authentication is enforced on all write operations
/// and management endpoints instead.
/// </summary>
public static class PublicConfigEndpoints
{
    public const string CacheTag = "public-configs";

    public static void MapPublicConfigEndpoints(this WebApplication app)
    {
        var invalidSlugResponse = new ErrorResponse("invalid_slug_format",
            "Slugs must contain only lowercase alphanumeric characters and hyphens");

        app.MapGet("/project/{projectSlug}/config/{environmentSlug}", async (HttpContext context, string projectSlug,
                string environmentSlug, IProjectConfigService service, IMeteringService metering) =>
            {
                // Meter the request before config lookup -- short-circuit with 429 if over limit
                var meterResult = await metering.MeterAsync(projectSlug);

                if (meterResult is MeterResult.OverLimit overLimit)
                {
                    var resetDate = GetNextMonthReset();
                    context.Response.Headers["Retry-After"] = ((long)(resetDate - DateTimeOffset.UtcNow).TotalSeconds).ToString();
                    return Results.Json(new RateLimitResponse(
                        Code: "RATE_LIMIT_EXCEEDED",
                        Message: "Monthly API request limit exceeded. Upgrade your plan for higher limits.",
                        Limit: overLimit.EffectiveLimit,
                        Current: overLimit.NewCount,
                        ResetAt: resetDate.ToString("O"),
                        UpgradeUrl: "/upgrade"), statusCode: 429);
                }

                var tier = "free";
                if (meterResult is MeterResult.Ok ok)
                {
                    tier = ok.Tier;
                    var resetDate = GetNextMonthReset();
                    context.Response.Headers["X-RateLimit-Reset"] = resetDate.ToUnixTimeSeconds().ToString();

                    if (ok.EffectiveLimit.HasValue)
                    {
                        context.Response.Headers["X-RateLimit-Limit"] = ok.EffectiveLimit.Value.ToString();
                        context.Response.Headers["X-RateLimit-Remaining"] = Math.Max(0, ok.EffectiveLimit.Value - ok.NewCount).ToString();

                        if (ok.NewCount > ok.EffectiveLimit.Value)
                            context.Response.Headers["X-RateLimit-Warning"] = "Rate limit exceeded; requests will be blocked above 110%";
                    }
                }
                // MeterResult.NotFound or MeterResult.Error -> no headers, fall through

                var result = await service.GetLatestBySlugAsync(projectSlug, environmentSlug);

                if (result is not SlugLookupResult.Success(var config, var lastModified))
                {
                    return result switch
                    {
                        SlugLookupResult.InvalidSlug => Results.BadRequest(invalidSlugResponse),
                        SlugLookupResult.NotFound
                            => Results.NotFound(),
                        _ => Results.StatusCode(500)
                    };
                }

                // Set caching headers -- tier+environment-based Cache-Control
                var maxAge = GetMaxAge(tier, environmentSlug);
                context.Response.Headers.CacheControl = $"public, max-age={maxAge}";

                return Results.Ok(new
                {
                    version = config.Version,
                    lastModified = lastModified.ToString("O"),
                    config = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(config.State)
                });
            })
            .WithTags("Public Config")
            .CacheOutput("PublicConfig")
            .AllowAnonymous()
            .RequireCors("PublicApi")
            .RequireRateLimiting("PublicConfigRateLimit");
    }

    /// <summary>
    /// Returns the first second of the next calendar month in UTC.
    /// Used for X-RateLimit-Reset (Unix timestamp) and Retry-After (seconds until).
    /// </summary>
    private static DateTimeOffset GetNextMonthReset()
    {
        var now = DateTime.UtcNow;
        return new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero).AddMonths(1);
    }

    /// <summary>
    /// Returns Cache-Control max-age in seconds based on subscription tier and environment.
    /// Production gets longer cache for lower tiers (less frequent changes expected).
    /// Development/staging always gets short cache for fast iteration.
    /// </summary>
    private static int GetMaxAge(string tier, string environment) => (tier, environment) switch
    {
        ("free", "development") => 10,
        ("free", "production") => 900,
        ("hobby", "development" or "staging") => 10,
        ("hobby", "production") => 300,
        ("pro", "development" or "staging") => 10,
        ("pro", "production") => 60,
        _ => 60
    };
}
