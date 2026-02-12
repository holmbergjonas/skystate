using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SkyState.Api.Services;

namespace SkyState.Api.Authentication;
public static class AuthenticationExtensions
{
    public static IServiceCollection AddSkyStateAuthentication(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUserService, CurrentUserService>();
        services.AddMemoryCache();
        services.AddHttpClient("GitHub");

        var enableTestAuth = !environment.IsProduction()
                             && configuration.GetValue<bool>("EnableTestAuth");

        // Logging during service registration uses a temporary logger.
        using var tempProvider = services.BuildServiceProvider();
        var logger = tempProvider.GetRequiredService<ILoggerFactory>()
            .CreateLogger("SkyState.Authentication");

        logger.LogDebug("Configuring authentication: environment={Environment}, enableTestAuth={EnableTestAuth}",
            environment.EnvironmentName, enableTestAuth);

        var authBuilder = services.AddAuthentication(options =>
        {
            options.DefaultScheme = GitHubTokenHandler.SchemeName;

            if (enableTestAuth)
            {
                options.DefaultScheme = "MultiAuth";
            }
        });

        authBuilder.AddScheme<AuthenticationSchemeOptions, GitHubTokenHandler>(
            GitHubTokenHandler.SchemeName, _ => { });

        logger.LogDebug("Registered authentication scheme: {Scheme}", GitHubTokenHandler.SchemeName);

        if (enableTestAuth)
        {
            authBuilder.AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(
                TestAuthHandler.SchemeName, _ => { });

            authBuilder.AddPolicyScheme("MultiAuth", "MultiAuth", options =>
            {
                options.ForwardDefaultSelector = context =>
                {
                    if (context.Request.Headers.ContainsKey("X-Test-GitHub-Id"))
                        return TestAuthHandler.SchemeName;

                    return GitHubTokenHandler.SchemeName;
                };
            });

            logger.LogDebug("Registered test authentication scheme: {Scheme} with MultiAuth policy",
                TestAuthHandler.SchemeName);
        }

        services.AddAuthorization();

        return services;
    }
}
