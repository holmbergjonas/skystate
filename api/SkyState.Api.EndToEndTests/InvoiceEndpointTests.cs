using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.EndToEndTests.Infrastructure;
using SkyState.Api.Models;
using Xunit;

namespace SkyState.Api.EndToEndTests;

/// <summary>
/// End-to-end tests for invoice endpoints against real PostgreSQL.
/// Note: Invoices cannot be created via HTTP endpoints (no POST /invoices).
/// Invoices are created internally by the billing system via webhooks.
/// These tests verify the read paths work correctly for users with no invoices.
/// </summary>
[Collection(EndToEndCollection.Name)]
public class InvoiceEndpointTests : IDisposable
{
    private readonly SkyStateEndToEndFactory _factory;

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    public InvoiceEndpointTests()
    {
        _factory = new SkyStateEndToEndFactory();
    }

    public void Dispose()
    {
        _factory.Dispose();
    }

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    // --- GET /invoices ---

    [Fact]
    public async Task ListInvoices_NoInvoices_ReturnsEmptyList()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        // Fresh user with no invoices
        var response = await client.GetAsync("/invoices", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoices = await response.Content.ReadFromJsonAsync<List<Invoice>>(CT);
        Assert.NotNull(invoices);
        Assert.Empty(invoices);
    }

    [Fact]
    public async Task ListInvoices_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/invoices", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- GET /invoices/{invoiceId} ---

    [Fact]
    public async Task GetInvoiceById_NonexistentId_ReturnsNotFound()
    {
        var id = Uid();
        using var client = _factory.CreateAuthenticatedClient($"e2e-{id}", $"e2e-{id}@test.com", "E2E User");

        var response = await client.GetAsync($"/invoices/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetInvoiceById_Unauthenticated_Returns401()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync($"/invoices/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
