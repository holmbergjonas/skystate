using System;
using System.Threading.Tasks;
using Dapper;
using Npgsql;

namespace SkyState.Api.Repositories;

public interface IApiRequestCounterRepository
{
    Task<int> IncrementAsync(Guid userId);
    Task<int> GetCurrentCountAsync(Guid userId);
    Task<Guid?> GetOwnerByProjectSlugAsync(string projectSlug);
}

public class ApiRequestCounterRepository(ConnectionStrings connectionStrings) : IApiRequestCounterRepository
{
    private NpgsqlConnection GetConnection() => new(connectionStrings.DefaultConnection);

    public async Task<int> IncrementAsync(Guid userId)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO api_request_counter (user_id, counter_year, counter_month, request_count)
            VALUES (@userId, EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int, 1)
            ON CONFLICT (user_id, counter_year, counter_month)
            DO UPDATE SET request_count = api_request_counter.request_count + 1
            RETURNING request_count
            """, new { userId });
    }

    public async Task<int> GetCurrentCountAsync(Guid userId)
    {
        await using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            """
            SELECT COALESCE(
                (SELECT request_count FROM api_request_counter
                 WHERE user_id = @userId
                   AND counter_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
                   AND counter_month = EXTRACT(MONTH FROM CURRENT_DATE)::int),
                0)
            """, new { userId });
    }

    public async Task<Guid?> GetOwnerByProjectSlugAsync(string projectSlug)
    {
        await using var conn = GetConnection();
        return await conn.QueryFirstOrDefaultAsync<Guid?>(
            """
            SELECT user_id FROM project WHERE slug = @projectSlug LIMIT 1
            """, new { projectSlug });
    }
}
