using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using SkyState.Api.Models;

namespace SkyState.Api.Repositories;

public interface IProjectRepository
{
    Task<Project?> GetByIdAsync(Guid userId, Guid projectId);
    Task<Project?> GetBySlugAsync(Guid userId, string slug);
    Task<IEnumerable<Project>> GetByUserIdAsync(Guid userId);
    Task<Guid> CreateAsync(Guid userId, CreateProject project, int? effectiveLimit);
    Task<bool> UpdateAsync(Guid userId, Guid projectId, UpdateProject project);
    Task<bool> DeleteAsync(Guid userId, Guid projectId);
    Task<int> GetCountByUserIdAsync(Guid userId);
}

public class ProjectRepository(ConnectionStrings connectionStrings) : IProjectRepository
{
    private IDbConnection GetConnection() => new NpgsqlConnection(connectionStrings.DefaultConnection);

    public async Task<Project?> GetByIdAsync(Guid userId, Guid projectId)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<Project>(
            "SELECT * FROM project WHERE project_id = @projectId AND user_id = @userId",
            new { projectId, userId });
    }

    public async Task<Project?> GetBySlugAsync(Guid userId, string slug)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<Project>(
            "SELECT * FROM project WHERE slug = @slug AND user_id = @userId",
            new { slug, userId });
    }

    public async Task<IEnumerable<Project>> GetByUserIdAsync(Guid userId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<Project>(
            "SELECT * FROM project WHERE user_id = @userId", new { userId });
    }

    public async Task<Guid> CreateAsync(Guid userId, CreateProject project, int? effectiveLimit)
    {
        var id = Guid.CreateVersion7();
        using var conn = GetConnection();
        var result = await conn.QuerySingleOrDefaultAsync<Guid?>(
            """
            WITH current_count AS (
                SELECT COUNT(*) AS cnt FROM project WHERE user_id = @userId
            )
            INSERT INTO project (project_id, user_id, name, slug, api_key_hash)
            SELECT @id, @userId, @name, @slug, @apiKeyHash
            FROM current_count
            WHERE @effectiveLimit IS NULL OR current_count.cnt < @effectiveLimit
            RETURNING project_id
            """, new { id, userId, name = project.Name, slug = project.Slug, apiKeyHash = project.ApiKeyHash, effectiveLimit });
        return result ?? Guid.Empty;
    }

    public async Task<bool> UpdateAsync(Guid userId, Guid projectId, UpdateProject project)
    {
        using var conn = GetConnection();
        var rows = await conn.ExecuteAsync(
            """
            UPDATE project
            SET name = @name, api_key_hash = @apiKeyHash, updated_at = NOW()
            WHERE project_id = @projectId AND user_id = @userId
            """, new { projectId, userId, name = project.Name, apiKeyHash = project.ApiKeyHash });
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid projectId)
    {
        using var conn = GetConnection();
        var rows = await conn.ExecuteAsync(
            "DELETE FROM project WHERE project_id = @projectId AND user_id = @userId",
            new { projectId, userId });
        return rows > 0;
    }

    public async Task<int> GetCountByUserIdAsync(Guid userId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM project WHERE user_id = @userId",
            new { userId });
    }
}
