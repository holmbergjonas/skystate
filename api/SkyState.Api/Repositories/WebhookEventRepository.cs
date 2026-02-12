using System;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Npgsql;

namespace SkyState.Api.Repositories;

public interface IWebhookEventRepository
{
    Task<bool> TryRecordEventAsync(string stripeEventId, string eventType);
    Task MarkProcessedAsync(string stripeEventId);
    Task RecordErrorAsync(string stripeEventId, string error);
}

public class WebhookEventRepository(ConnectionStrings connectionStrings) : IWebhookEventRepository
{
    private IDbConnection GetConnection() => new NpgsqlConnection(connectionStrings.DefaultConnection);

    public async Task<bool> TryRecordEventAsync(string stripeEventId, string eventType)
    {
        var id = Guid.CreateVersion7();
        using var conn = GetConnection();
        var rows = await conn.ExecuteAsync(
            """
            INSERT INTO webhook_event (webhook_event_id, stripe_event_id, event_type)
            VALUES (@Id, @StripeEventId, @EventType)
            ON CONFLICT (stripe_event_id) DO NOTHING
            """,
            new { Id = id, StripeEventId = stripeEventId, EventType = eventType });
        return rows > 0;
    }

    public async Task MarkProcessedAsync(string stripeEventId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE webhook_event
            SET processed_at = NOW()
            WHERE stripe_event_id = @StripeEventId
            """,
            new { StripeEventId = stripeEventId });
    }

    public async Task RecordErrorAsync(string stripeEventId, string error)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE webhook_event
            SET error = @Error
            WHERE stripe_event_id = @StripeEventId
            """,
            new { StripeEventId = stripeEventId, Error = error });
    }
}
