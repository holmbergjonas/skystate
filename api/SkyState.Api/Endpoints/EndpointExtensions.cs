using Microsoft.AspNetCore.Builder;

namespace SkyState.Api.Endpoints;

public static class EndpointExtensions
{
    public static WebApplication MapSkyStateEndpoints(this WebApplication app)
    {
        app.MapUserEndpoints();
        app.MapProjectEndpoints();
        app.MapProjectConfigEndpoints();
        app.MapPublicConfigEndpoints();
        app.MapInvoiceEndpoints();
        app.MapBillingEndpoints();
        app.MapWebhookEndpoints();
        app.MapAuthEndpoints();
        app.MapPingEndpoint();
        app.MapHealthEndpoint();

        return app;
    }
}
