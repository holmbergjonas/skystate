using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using SkyState.Api.Services;

namespace SkyState.Api.Endpoints;

public static class InvoiceEndpoints
{
    public static void MapInvoiceEndpoints(this WebApplication app)
    {
        app.MapGet("/invoices/{invoiceId:guid}", async (Guid invoiceId, ICurrentUserService currentUser, IInvoiceService service) =>
        {
            var invoice = await service.GetByIdAsync(currentUser.GetUserId(), invoiceId);
            return invoice is not null ? Results.Ok(invoice) : Results.NotFound();
        })
            .WithTags("Invoices")
            .RequireAuthorization();

        app.MapGet("/invoices", async (ICurrentUserService currentUser, IInvoiceService service) =>
        {
            var invoices = await service.GetByUserIdAsync(currentUser.GetUserId());
            return Results.Ok(invoices);
        })
            .WithTags("Invoices")
            .RequireAuthorization();
    }
}
