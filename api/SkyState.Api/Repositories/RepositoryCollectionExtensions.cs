using Microsoft.Extensions.DependencyInjection;

namespace SkyState.Api.Repositories;

public static class RepositoryCollectionExtensions
{
    public static IServiceCollection AddSkyStateRepositories(this IServiceCollection services)
    {
        services.AddSingleton<IUserRepository, UserRepository>();
        services.AddSingleton<IProjectRepository, ProjectRepository>();
        services.AddSingleton<IProjectConfigRepository, ProjectConfigRepository>();
        services.AddSingleton<IInvoiceRepository, InvoiceRepository>();
        services.AddSingleton<IWebhookEventRepository, WebhookEventRepository>();
        services.AddSingleton<IApiRequestCounterRepository, ApiRequestCounterRepository>();

        return services;
    }
}
