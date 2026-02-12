using System.Linq;
using System.Net.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.Services;

namespace SkyState.Api.EndToEndTests.Infrastructure;

/// <summary>
/// WebApplicationFactory that boots the real API with a real PostgreSQL database
/// and stubbed external services (Stripe).
/// Uses the "Test" environment so appsettings.Test.json is loaded automatically.
/// </summary>
public class SkyStateEndToEndFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Test");

        // Load test-project-local config, then user secrets (not auto-loaded outside Development).
        builder.ConfigureAppConfiguration(config =>
        {
            config.SetBasePath(System.AppContext.BaseDirectory);
            config.AddJsonFile("appsettings.Test.json", optional: false);
            config.AddUserSecrets<SkyStateEndToEndFactory>(optional: true);
            config.AddEnvironmentVariables();
        });

        builder.UseSetting("EnableTestAuth", "true");

        builder.ConfigureServices((_, services) =>
        {
            // Stub Stripe — it's an external service we don't hit in E2E tests
            ReplaceScoped<IStripeService>(services, new StubStripeService());
        });
    }

    /// <summary>
    /// Creates an HttpClient authenticated as the given GitHub user.
    /// The TestAuthHandler will JIT-provision a user record.
    /// </summary>
    public HttpClient CreateAuthenticatedClient(string githubId, string? email = null, string? name = null)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-GitHub-Id", githubId);
        if (email is not null)
            client.DefaultRequestHeaders.Add("X-Test-Email", email);
        if (name is not null)
            client.DefaultRequestHeaders.Add("X-Test-Name", name);
        return client;
    }

    private static void ReplaceScoped<TService>(IServiceCollection services, TService implementation)
        where TService : class
    {
        var descriptors = services.Where(d => d.ServiceType == typeof(TService)).ToList();
        foreach (var descriptor in descriptors)
            services.Remove(descriptor);
        services.AddSingleton(implementation);
    }
}
