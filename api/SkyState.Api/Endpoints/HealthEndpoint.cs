using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace SkyState.Api.Endpoints;

public static class HealthEndpoint
{
    public static void MapHealthEndpoint(this WebApplication app)
    {
        app.MapGet("/health", () => Results.Text("ok"))
            .WithTags("Health")
            .AllowAnonymous()
            .RequireCors("PublicApi");
    }
}
