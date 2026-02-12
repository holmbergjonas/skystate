using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

public interface IProjectConfigService
{
    Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId);
    Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment);
    Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment);
    Task<ServiceResult<Guid>> CreateAsync(Guid userId, Guid projectId, string environment, CreateProjectConfig body);
    Task<ServiceResult<Guid>> RollbackAsync(Guid userId, Guid projectId, string environment, Guid targetProjectConfigId);
    Task<SlugLookupResult> GetLatestBySlugAsync(string projectSlug, string environmentSlug);
}

public class ProjectConfigService(
    IProjectConfigRepository configRepo,
    IBillingService billingService) : IProjectConfigService
{
    private static readonly Regex SlugRegex = new(@"^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.Compiled);
    private static readonly HashSet<string> ValidEnvironments = new(StringComparer.OrdinalIgnoreCase)
    {
        "development", "staging", "production"
    };

    public Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId)
        => configRepo.GetByIdAsync(userId, projectConfigId);

    public Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment)
    {
        if (!IsValidEnvironment(environment))
            return Task.FromResult<IEnumerable<ProjectConfig>>(Array.Empty<ProjectConfig>());

        return configRepo.GetByEnvironmentAsync(userId, projectId, environment);
    }

    public Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment)
    {
        if (!IsValidEnvironment(environment))
            return Task.FromResult<ProjectConfig?>(null);

        return configRepo.GetLatestAsync(userId, projectId, environment);
    }

    public async Task<ServiceResult<Guid>> CreateAsync(Guid userId, Guid projectId, string environment, CreateProjectConfig body)
    {
        if (!IsValidEnvironment(environment))
            return new ServiceResult<Guid>.NotFound();

        var tierCheck = await billingService.CheckStorageLimitAsync(userId);
        if (tierCheck is ServiceResult<bool>.NotFound)
            return new ServiceResult<Guid>.NotFound();
        if (tierCheck is ServiceResult<bool>.OverLimit(var limit))
            return new ServiceResult<Guid>.OverLimit(limit);

        var id = await configRepo.CreateAsync(userId, projectId, environment, body);
        return id == Guid.Empty
            ? new ServiceResult<Guid>.NotFound()
            : new ServiceResult<Guid>.Success(id);
    }

    public async Task<ServiceResult<Guid>> RollbackAsync(Guid userId, Guid projectId, string environment, Guid targetProjectConfigId)
    {
        if (!IsValidEnvironment(environment))
            return new ServiceResult<Guid>.NotFound();

        var tierCheck = await billingService.CheckStorageLimitAsync(userId);
        if (tierCheck is ServiceResult<bool>.NotFound)
            return new ServiceResult<Guid>.NotFound();
        if (tierCheck is ServiceResult<bool>.OverLimit(var limit))
            return new ServiceResult<Guid>.OverLimit(limit);

        var id = await configRepo.RollbackAsync(userId, projectId, environment, targetProjectConfigId);
        return id == Guid.Empty
            ? new ServiceResult<Guid>.NotFound()
            : new ServiceResult<Guid>.Success(id);
    }

    public async Task<SlugLookupResult> GetLatestBySlugAsync(
        string projectSlug, string environmentSlug)
    {
        if (!SlugRegex.IsMatch(projectSlug) || !SlugRegex.IsMatch(environmentSlug))
            return new SlugLookupResult.InvalidSlug();

        var result = await configRepo.GetLatestBySlugAsync(projectSlug, environmentSlug);

        if (result is null)
            return new SlugLookupResult.NotFound();

        return new SlugLookupResult.Success(result.Value.Config, result.Value.LastModified);
    }

    private static bool IsValidEnvironment(string environment)
        => ValidEnvironments.Contains(environment);
}
