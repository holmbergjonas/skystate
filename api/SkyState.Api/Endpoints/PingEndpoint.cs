using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace SkyState.Api.Endpoints;

public static class PingEndpoint
{
    public static void MapPingEndpoint(this WebApplication app)
    {
        app.MapGet("/", () => Results.Text("ok"))
            .WithTags("Health")
            .AllowAnonymous()
            .RequireCors("PublicApi");
    }
}