using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using SkyState.Api.Models;

namespace SkyState.Api.Repositories;

public interface IInvoiceRepository
{
    Task<Invoice?> GetByIdAsync(Guid userId, Guid invoiceId);
    Task<IEnumerable<Invoice>> GetByUserIdAsync(Guid userId);
    Task<Guid> CreateAsync(Guid userId, CreateInvoice invoice);
}

public class InvoiceRepository(ConnectionStrings connectionStrings) : IInvoiceRepository
{
    private IDbConnection GetConnection() => new NpgsqlConnection(connectionStrings.DefaultConnection);

    public async Task<Invoice?> GetByIdAsync(Guid userId, Guid invoiceId)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<Invoice>(
            "SELECT * FROM invoice WHERE invoice_id = @invoiceId AND user_id = @userId",
            new { invoiceId, userId });
    }

    public async Task<IEnumerable<Invoice>> GetByUserIdAsync(Guid userId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<Invoice>(
            "SELECT * FROM invoice WHERE user_id = @UserId ORDER BY created_at DESC",
            new { UserId = userId });
    }

    public async Task<Guid> CreateAsync(Guid userId, CreateInvoice invoice)
    {
        var id = Guid.CreateVersion7();
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            INSERT INTO invoice (invoice_id, user_id, tier, boost_multiplier, amount_paid_cents, status, billing_period_start, billing_period_end)
            VALUES (@Id, @UserId, @Tier, @BoostMultiplier, @AmountPaidCents, @Status, @BillingPeriodStart, @BillingPeriodEnd)
            """,
            new { Id = id, UserId = userId, invoice.Tier, invoice.BoostMultiplier, invoice.AmountPaidCents, invoice.Status, invoice.BillingPeriodStart, invoice.BillingPeriodEnd });
        return id;
    }
}
