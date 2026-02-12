using System.Linq;
using System.Net.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.Repositories;
using SkyState.Api.Services;

namespace SkyState.Api.IntegrationTests.Infrastructure;

public class SkyStateApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Test");

        builder.ConfigureAppConfiguration(config =>
        {
            config.SetBasePath(System.AppContext.BaseDirectory);
            config.AddJsonFile("appsettings.Test.json", optional: false);
        });

        builder.UseSetting("EnableTestAuth", "true");

        builder.ConfigureServices(services =>
        {
            // Shared in-memory database for all repositories — also registered for direct test access
            var db = new InMemoryDatabase();
            services.AddSingleton(db);

            // Replace Settings (still needed for DI but unused)
            ReplaceService(services, new ConnectionStrings("unused"));

            // Replace all repositories with in-memory implementations
            ReplaceSingleton<IUserRepository>(services, new InMemoryUserRepository(db));
            ReplaceSingleton<IProjectRepository>(services, new InMemoryProjectRepository(db));
            ReplaceSingleton<IProjectConfigRepository>(services, new InMemoryProjectConfigRepository(db));
            ReplaceSingleton<IInvoiceRepository>(services, new InMemoryInvoiceRepository(db));
            ReplaceSingleton<IWebhookEventRepository>(services, new InMemoryWebhookEventRepository(db));
            ReplaceSingleton<IApiRequestCounterRepository>(services, new InMemoryApiRequestCounterRepository(db));

            // Replace Stripe service with stub
            ReplaceScoped<IStripeService>(services, new StubStripeService());

            // Replace GitHub OAuth service with stub
            ReplaceScoped<IGitHubOAuthService>(services, new StubGitHubOAuthService());
        });
    }

    private static void ReplaceService<T>(IServiceCollection services, T implementation) where T : class
    {
        var descriptor = services.SingleOrDefault(d => d.ServiceType == typeof(T));
        if (descriptor is not null)
            services.Remove(descriptor);
        services.AddSingleton(implementation);
    }

    private static void ReplaceSingleton<TService>(IServiceCollection services, TService implementation)
        where TService : class
    {
        var descriptor = services.SingleOrDefault(d => d.ServiceType == typeof(TService));
        if (descriptor is not null)
            services.Remove(descriptor);
        services.AddSingleton(implementation);
    }

    private static void ReplaceScoped<TService>(IServiceCollection services, TService implementation)
        where TService : class
    {
        var descriptors = services.Where(d => d.ServiceType == typeof(TService)).ToList();
        foreach (var descriptor in descriptors)
            services.Remove(descriptor);
        services.AddSingleton(implementation);
    }

    /// <summary>
    /// Creates an HttpClient authenticated as the given GitHub user.
    /// The TestAuthHandler will JIT-provision a user record and set the sub claim.
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
}
