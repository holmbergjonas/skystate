using System;

namespace SkyState.Api.Models;

public record Invoice
{
    public Guid InvoiceId { get; init; }
    public Guid UserId { get; init; }
    public string Tier { get; init; } = "";
    public int BoostMultiplier { get; init; }
    public int AmountPaidCents { get; init; }
    public string Status { get; init; } = "";
    public DateTime BillingPeriodStart { get; init; }
    public DateTime BillingPeriodEnd { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record CreateInvoice(
    string Tier,
    int BoostMultiplier,
    int AmountPaidCents,
    string Status,
    DateTime BillingPeriodStart,
    DateTime BillingPeriodEnd
);
