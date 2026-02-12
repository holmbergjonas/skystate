using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using SkyState.Api.BackgroundServices;
using SkyState.Api.Models;
using Stripe;

namespace SkyState.Api.Services;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddSkyStateServices(this IServiceCollection services, IConfiguration configuration)
    {
        // Connection strings
        services.AddSingleton(sp =>
            sp.GetRequiredService<IConfiguration>().GetSection("ConnectionStrings").Get<ConnectionStrings>()!);

        // Stripe configuration
        services.Configure<StripeSettings>(configuration.GetSection("Stripe"));

        // GitHub OAuth configuration
        services.Configure<GitHubOAuthSettings>(configuration.GetSection("GitHub"));

        // Tier settings
        services.Configure<TierSettings>(configuration.GetSection("TierSettings"));

        // Metering settings
        services.Configure<MeteringSettings>(configuration.GetSection("MeteringSettings"));
        services.AddScoped<StripeClient>(sp =>
        {
            var stripeSettings = sp.GetRequiredService<IOptions<StripeSettings>>().Value;
            var key = string.IsNullOrEmpty(stripeSettings.SecretKey) ? "sk_not_configured" : stripeSettings.SecretKey;
            return new StripeClient(key);
        });

        // Services
        services.AddScoped<IStripeService, StripeService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IProjectService, ProjectService>();
        // EnvironmentService removed -- environments are now fixed per tier
        services.AddScoped<IInvoiceService, InvoiceService>();
        services.AddScoped<IBillingService, BillingService>();
        services.AddScoped<IProjectConfigService, ProjectConfigService>();
        services.AddScoped<IWebhookService, WebhookService>();
        services.AddScoped<IGitHubOAuthService, GitHubOAuthService>();
        services.AddScoped<IMeteringService, MeteringService>();

        // Background services
        services.AddHostedService<RetentionPrunerService>();

        return services;
    }
}
