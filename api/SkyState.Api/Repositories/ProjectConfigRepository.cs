using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using SkyState.Api.Models;

namespace SkyState.Api.Repositories;

public interface IProjectConfigRepository
{
    Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId);
    Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment);
    Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment);
    Task<Guid> CreateAsync(Guid userId, Guid projectId, string environment, CreateProjectConfig version);
    Task<Guid> RollbackAsync(Guid userId, Guid projectId, string environment, Guid targetProjectConfigId);
    Task<(ProjectConfig Config, DateTime LastModified)?> GetLatestBySlugAsync(string projectSlug, string environmentSlug);
    Task<int> GetDocumentCountAsync(Guid userId);
    Task<long> GetStorageBytesAsync(Guid userId);
    Task<long> GetTotalStorageBytesAsync(Guid userId);
    Task<int> PruneExpiredVersionsAsync(Guid userId, DateTime cutoffDate);
}

public class ProjectConfigRepository(ConnectionStrings connectionStrings) : IProjectConfigRepository
{
    private NpgsqlConnection GetConnection() => new(connectionStrings.DefaultConnection);

    public async Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId)
    {
        await using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<ProjectConfig>(
            """
            SELECT ps.* FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE ps.project_state_id = @projectConfigId AND p.user_id = @userId
            """, new { projectConfigId, userId });
    }

    public async Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment)
    {
        await using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<ProjectConfig>(
            """
            SELECT ps.* FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE ps.project_id = @projectId AND ps.environment = @environment AND p.user_id = @userId
            ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC
            LIMIT 1
            """, new { projectId, environment, userId });
    }

    public async Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment)
    {
        await using var conn = GetConnection();
        return await conn.QueryAsync<ProjectConfig>(
            """
            SELECT ps.* FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE ps.project_id = @projectId AND ps.environment = @environment AND p.user_id = @userId
            ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC
            """, new { projectId, environment, userId });
    }

    public async Task<Guid> CreateAsync(Guid userId, Guid projectId, string environment,
        CreateProjectConfig version)
    {
        var id = Guid.CreateVersion7();
        await using var conn = GetConnection();
        var result = await conn.ExecuteScalarAsync<Guid?>(
            """
            INSERT INTO project_state (project_state_id, project_id, environment, major, minor, patch, state, comment, state_size_bytes)
            SELECT @id, @projectId, @environment, @major, @minor, @patch, @state::jsonb, @comment, octet_length(@state)
            WHERE EXISTS (
                SELECT 1 FROM project p
                WHERE p.project_id = @projectId AND p.user_id = @userId
            )
            AND NOT EXISTS (
                SELECT 1 FROM project_state ps
                WHERE ps.project_id = @projectId AND ps.environment = @environment
                AND (ps.major, ps.minor, ps.patch) >= (@major, @minor, @patch)
            )
            RETURNING project_state_id
            """,
            new
            {
                id,
                projectId,
                environment,
                userId,
                major = version.Major,
                minor = version.Minor,
                patch = version.Patch,
                state = version.State,
                comment = version.Comment
            });

        return result ?? Guid.Empty;
    }

    public async Task<Guid> RollbackAsync(Guid userId, Guid projectId, string environment,
        Guid targetProjectConfigId)
    {
        var id = Guid.CreateVersion7();
        await using var conn = GetConnection();
        var result = await conn.ExecuteScalarAsync<Guid?>(
            """
            WITH target AS (
                SELECT ps.major, ps.minor, ps.patch, ps.state
                FROM project_state ps
                JOIN project p ON p.project_id = ps.project_id
                WHERE ps.project_state_id = @targetProjectConfigId
                  AND ps.project_id = @projectId AND p.user_id = @userId
            ),
            latest AS (
                SELECT ps.major, ps.minor, ps.patch
                FROM project_state ps
                JOIN project p ON p.project_id = ps.project_id
                WHERE ps.project_id = @projectId AND ps.environment = @environment AND p.user_id = @userId
                ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC
                LIMIT 1
            )
            INSERT INTO project_state (project_state_id, project_id, environment, major, minor, patch, state, comment, state_size_bytes)
            SELECT
                @id,
                @projectId,
                @environment,
                CASE
                    WHEN latest.major != target.major THEN latest.major + 1
                    ELSE latest.major
                END,
                CASE
                    WHEN latest.major != target.major THEN 0
                    WHEN latest.minor != target.minor THEN latest.minor + 1
                    ELSE latest.minor
                END,
                CASE
                    WHEN latest.major != target.major THEN 0
                    WHEN latest.minor != target.minor THEN 0
                    ELSE latest.patch + 1
                END,
                target.state,
                'Rollback to version ' || target.major || '.' || target.minor || '.' || target.patch,
                octet_length(target.state::text)
            FROM target, latest
            RETURNING project_state_id
            """,
            new { id, projectId, environment, userId, targetProjectConfigId });

        return result ?? Guid.Empty;
    }

    public async Task<(ProjectConfig Config, DateTime LastModified)?> GetLatestBySlugAsync(string projectSlug,
        string environmentSlug)
    {
        await using var conn = GetConnection();
        var result = await conn.QuerySingleOrDefaultAsync<ProjectConfig>(
            """
            SELECT ps.project_state_id, ps.project_id, ps.environment, ps.major, ps.minor, ps.patch,
                   ps.state, ps.comment, ps.created_at, ps.state_size_bytes
            FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE p.slug = @projectSlug
              AND ps.environment = @environmentSlug
            ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC
            LIMIT 1
            """, new { projectSlug, environmentSlug });

        if (result is null)
            return null;

        return (result, result.CreatedAt);
    }

    public async Task<int> GetDocumentCountAsync(Guid userId)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            """
            SELECT COUNT(*)
            FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE p.user_id = @UserId
              AND ps.project_state_id IN (
                SELECT DISTINCT ON (ps2.project_id, ps2.environment) ps2.project_state_id
                FROM project_state ps2
                WHERE ps2.project_id = ps.project_id AND ps2.environment = ps.environment
                ORDER BY ps2.project_id, ps2.environment, ps2.major DESC, ps2.minor DESC, ps2.patch DESC
              )
            """, new { userId });
    }

    public async Task<long> GetStorageBytesAsync(Guid userId)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<long>(
            """
            SELECT COALESCE(SUM(ps.state_size_bytes), 0)
            FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE p.user_id = @UserId
              AND ps.project_state_id IN (
                SELECT DISTINCT ON (ps2.project_id, ps2.environment) ps2.project_state_id
                FROM project_state ps2
                WHERE ps2.project_id = ps.project_id AND ps2.environment = ps.environment
                ORDER BY ps2.project_id, ps2.environment, ps2.major DESC, ps2.minor DESC, ps2.patch DESC
              )
            """, new { userId });
    }

    public async Task<long> GetTotalStorageBytesAsync(Guid userId)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<long>(
            """
            SELECT COALESCE(SUM(ps.state_size_bytes), 0)
            FROM project_state ps
            JOIN project p ON p.project_id = ps.project_id
            WHERE p.user_id = @UserId
            """, new { userId });
    }

    public async Task<int> PruneExpiredVersionsAsync(Guid userId, DateTime cutoffDate)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteAsync(
            """
            WITH latest_per_env AS (
                SELECT DISTINCT ON (ps.project_id, ps.environment) ps.project_state_id
                FROM project_state ps
                JOIN project p ON p.project_id = ps.project_id
                WHERE p.user_id = @userId
                ORDER BY ps.project_id, ps.environment, ps.major DESC, ps.minor DESC, ps.patch DESC
            )
            DELETE FROM project_state
            WHERE project_state_id IN (
                SELECT ps.project_state_id
                FROM project_state ps
                JOIN project p ON p.project_id = ps.project_id
                WHERE p.user_id = @userId
                  AND ps.created_at < @cutoffDate
                  AND ps.project_state_id NOT IN (SELECT project_state_id FROM latest_per_env)
            )
            """,
            new { userId, cutoffDate });
    }
}
