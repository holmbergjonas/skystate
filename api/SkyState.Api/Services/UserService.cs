using System;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.Services;

public interface IUserService
{
    Task<User?> GetByIdAsync(Guid userId);
    Task<bool> UpdateAsync(Guid userId, UpdateUser body);
    Task SetCustomRetentionDaysAsync(Guid userId, int? days);
}

public class UserService(IUserRepository userRepo) : IUserService
{

    public async Task<User?> GetByIdAsync(Guid userId)
    {
        return await userRepo.GetByIdAsync(userId);
    }

    public async Task<bool> UpdateAsync(Guid userId, UpdateUser body)
    {
        return await userRepo.UpdateAsync(userId, body);
    }

    public async Task SetCustomRetentionDaysAsync(Guid userId, int? days)
    {
        await userRepo.SetCustomRetentionDaysAsync(userId, days);
    }
}
