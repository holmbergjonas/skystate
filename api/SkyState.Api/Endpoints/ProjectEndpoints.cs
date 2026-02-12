using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using SkyState.Api.Models;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public static class ProjectEndpoints
{
    public static void MapProjectEndpoints(this WebApplication app)
    {
        app.MapGet("/projects/{projectId:guid}",
                async (Guid projectId, ICurrentUserService currentUser, IProjectService service) =>
                {
                    var project = await service.GetByIdAsync(currentUser.GetUserId(), projectId);
                    return project is not null ? Results.Ok(project) : Results.NotFound();
                })
            .WithTags("Projects")
            .RequireAuthorization();

        app.MapGet("/projects/by-slug/{slug}",
                async (string slug, ICurrentUserService currentUser, IProjectService service) =>
                {
                    var project = await service.GetBySlugAsync(currentUser.GetUserId(), slug);
                    return project is not null ? Results.Ok(project) : Results.NotFound();
                })
            .WithTags("Projects")
            .RequireAuthorization();

        app.MapGet("/projects", async (ICurrentUserService currentUser, IProjectService service) =>
            {
                var projects = await service.GetByUserIdAsync(currentUser.GetUserId());
                return Results.Ok(projects);
            })
            .WithTags("Projects")
            .RequireAuthorization();

        app.MapPost("/projects", async (CreateProject body, ICurrentUserService currentUser, IProjectService service) =>
            {
                var result = await service.CreateAsync(currentUser.GetUserId(), body);
                return result switch
                {
                    ServiceResult<Guid>.OverLimit(var limit) =>
                        Results.Json(limit, statusCode: 402),
                    ServiceResult<Guid>.ValidationError(var msg) =>
                        Results.BadRequest(new ErrorResponse("validation_error", msg)),
                    ServiceResult<Guid>.NotFound =>
                        Results.NotFound(),
                    ServiceResult<Guid>.Success(var id) =>
                        Results.Created($"/projects/{id}", new { projectId = id }),
                    _ => Results.StatusCode(500)
                };
            })
            .WithTags("Projects")
            .RequireAuthorization();

        app.MapPut("/projects/{projectId:guid}", async (Guid projectId, UpdateProject body,
                ICurrentUserService currentUser, IProjectService service) =>
            {
                var updated = await service.UpdateAsync(currentUser.GetUserId(), projectId, body);
                return updated ? Results.NoContent() : Results.NotFound();
            })
            .WithTags("Projects")
            .RequireAuthorization();

        app.MapDelete("/projects/{projectId:guid}",
                async (Guid projectId, ICurrentUserService currentUser, IProjectService service) =>
                {
                    var deleted = await service.DeleteAsync(currentUser.GetUserId(), projectId);
                    return deleted ? Results.NoContent() : Results.NotFound();
                })
            .WithTags("Projects")
            .RequireAuthorization();
    }
}