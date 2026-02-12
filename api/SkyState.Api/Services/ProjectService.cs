using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

public interface IProjectService
{
    Task<Project?> GetByIdAsync(Guid userId, Guid projectId);
    Task<Project?> GetBySlugAsync(Guid userId, string slug);
    Task<IEnumerable<Project>> GetByUserIdAsync(Guid userId);
    Task<ServiceResult<Guid>> CreateAsync(Guid userId, CreateProject body);
    Task<bool> UpdateAsync(Guid userId, Guid projectId, UpdateProject body);
    Task<bool> DeleteAsync(Guid userId, Guid projectId);
}

public class ProjectService(IProjectRepository projectRepo, IBillingService billingService) : IProjectService
{
    public async Task<Project?> GetByIdAsync(Guid userId, Guid projectId)
    {
        return await projectRepo.GetByIdAsync(userId, projectId);
    }

    public async Task<Project?> GetBySlugAsync(Guid userId, string slug)
    {
        return await projectRepo.GetBySlugAsync(userId, slug);
    }

    public async Task<IEnumerable<Project>> GetByUserIdAsync(Guid userId)
    {
        return await projectRepo.GetByUserIdAsync(userId);
    }

    public async Task<ServiceResult<Guid>> CreateAsync(Guid userId, CreateProject body)
    {
        var limitCheck = await billingService.CheckProjectLimitAsync(userId);
        if (limitCheck is ServiceResult<bool>.NotFound)
            return new ServiceResult<Guid>.NotFound();
        if (limitCheck is ServiceResult<bool>.OverLimit(var limit))
            return new ServiceResult<Guid>.OverLimit(limit);

        var effectiveLimit = await billingService.GetEffectiveProjectLimitAsync(userId);
        var id = await projectRepo.CreateAsync(userId, body, effectiveLimit);
        return id == Guid.Empty
            ? new ServiceResult<Guid>.ValidationError("Failed to create project (limit may have been reached concurrently)")
            : new ServiceResult<Guid>.Success(id);
    }

    public async Task<bool> UpdateAsync(Guid userId, Guid projectId, UpdateProject body)
    {
        return await projectRepo.UpdateAsync(userId, projectId, body);
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid projectId)
    {
        return await projectRepo.DeleteAsync(userId, projectId);
    }
}
