using System;

namespace SkyState.Api.Models;

public record WebhookEvent
{
    public Guid WebhookEventId { get; init; }
    public string StripeEventId { get; init; } = "";
    public string EventType { get; init; } = "";
    public DateTime ReceivedAt { get; init; }
    public DateTime? ProcessedAt { get; init; }
    public string? Error { get; init; }
}
