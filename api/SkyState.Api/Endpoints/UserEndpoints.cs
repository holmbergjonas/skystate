using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public record UpdateRetentionRequest(int? Days);

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        app.MapGet("/users/me", async (ICurrentUserService currentUser, IUserService service) =>
        {
            var user = await service.GetByIdAsync(currentUser.GetUserId());
            return user is not null ? Results.Ok(user) : Results.NotFound();
        })
            .WithTags("Users")
            .RequireAuthorization();

        app.MapPut("/users/me", async (UpdateUser body, ICurrentUserService currentUser, IUserService service) =>
        {
            var updated = await service.UpdateAsync(currentUser.GetUserId(), body);
            return updated ? Results.NoContent() : Results.NotFound();
        })
            .WithTags("Users")
            .RequireAuthorization();

        app.MapPut("/users/me/retention", async (
            UpdateRetentionRequest body,
            ICurrentUserService currentUser,
            IUserService userService,
            IOptions<TierSettings> tierSettings) =>
        {
            if (body.Days is not null && body.Days < 0)
                return Results.BadRequest(new { error = "INVALID_RETENTION", message = "Retention days must be >= 0." });

            var userId = currentUser.GetUserId();
            var user = await userService.GetByIdAsync(userId);
            if (user is null)
                return Results.NotFound();

            if (body.Days is not null)
            {
                var tiers = tierSettings.Value.Tiers;
                var config = tiers.TryGetValue(user.SubscriptionTier, out var c) ? c : tiers["free"];

                if (config.RetentionDays is not null && body.Days > config.RetentionDays)
                    return Results.BadRequest(new { error = "INVALID_RETENTION", message = $"Your plan allows a maximum of {config.RetentionDays} retention days." });
            }

            await userService.SetCustomRetentionDaysAsync(userId, body.Days);
            return Results.NoContent();
        })
            .WithTags("Users")
            .RequireAuthorization();
    }
}
