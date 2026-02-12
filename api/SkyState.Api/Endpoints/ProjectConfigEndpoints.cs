using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public static class ProjectConfigEndpoints
{
    public static void MapProjectConfigEndpoints(this WebApplication app)
    {
        app.MapGet("/project/config/{projectConfigId:guid}", async (Guid projectConfigId,
                ICurrentUserService currentUser, IProjectConfigService service) =>
            {
                var config = await service.GetByIdAsync(currentUser.GetUserId(), projectConfigId);
                return config is not null ? Results.Ok(config) : Results.NotFound();
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        app.MapGet("/project/{projectId:guid}/config/{envSlug}", async (
                Guid projectId, string envSlug,
                ICurrentUserService currentUser, IProjectConfigService service) =>
            {
                var configs = await service.GetByEnvironmentAsync(currentUser.GetUserId(), projectId, envSlug);
                return Results.Ok(configs);
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        app.MapGet("/project/{projectId:guid}/config/{envSlug}/latest", async (
                Guid projectId, string envSlug,
                ICurrentUserService currentUser, IProjectConfigService service) =>
            {
                var config = await service.GetLatestAsync(currentUser.GetUserId(), projectId, envSlug);
                return config is not null ? Results.Ok(config) : Results.NotFound();
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        app.MapPost("/project/{projectId:guid}/config/{envSlug}", async (
                Guid projectId,
                string envSlug,
                CreateProjectConfig body,
                ICurrentUserService currentUser,
                IProjectConfigService service,
                IBillingService billingService,
                HttpContext httpContext,
                IOutputCacheStore cache) =>
            {
                var result = await service.CreateAsync(currentUser.GetUserId(), projectId, envSlug, body);
                if (result is not ServiceResult<Guid>.Success(var id))
                {
                    return result switch
                    {
                        ServiceResult<Guid>.OverLimit(var limit) =>
                            Results.Json(limit, statusCode: 402),
                        _ => Results.NotFound()
                    };
                }

                await cache.EvictByTagAsync(PublicConfigEndpoints.CacheTag, default);
                await AppendStorageWarningHeader(billingService, currentUser.GetUserId(), httpContext);
                return Results.Created($"/project/config/{id}", new { projectConfigId = id });
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        app.MapPost("/project/{projectId:guid}/config/{envSlug}/rollback/{targetId:guid}", async (
                Guid projectId,
                string envSlug,
                Guid targetId,
                ICurrentUserService currentUser,
                IProjectConfigService service,
                IBillingService billingService,
                HttpContext httpContext,
                IOutputCacheStore cache) =>
            {
                var result = await service.RollbackAsync(currentUser.GetUserId(), projectId, envSlug, targetId);
                if (result is not ServiceResult<Guid>.Success(var id))
                {
                    return result switch
                    {
                        ServiceResult<Guid>.OverLimit(var limit) =>
                            Results.Json(limit, statusCode: 402),
                        _ => Results.NotFound()
                    };
                }

                await cache.EvictByTagAsync(PublicConfigEndpoints.CacheTag, default);
                await AppendStorageWarningHeader(billingService, currentUser.GetUserId(), httpContext);
                return Results.Created($"/project/config/{id}", new { projectConfigId = id });
            })
            .WithTags("Project Configs")
            .RequireAuthorization();
    }

    private static async Task AppendStorageWarningHeader(IBillingService billingService, Guid userId, HttpContext httpContext)
    {
        var status = await billingService.GetStatusAsync(userId);
        if (status is ServiceResult<BillingStatusResponse>.Success(var s)
            && s.Storage.Limit.HasValue
            && s.Storage.Limit.Value > 0
            && s.Storage.Bytes >= (long)(s.Storage.Limit.Value * 0.8))
        {
            var percent = (int)(s.Storage.Bytes * 100 / s.Storage.Limit.Value);
            httpContext.Response.Headers.Append("X-SkyState-Storage-Warning",
                $"usage={s.Storage.Bytes};limit={s.Storage.Limit.Value};percent={percent}");
        }
    }
}
