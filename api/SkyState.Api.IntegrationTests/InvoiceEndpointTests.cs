using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using SkyState.Api.IntegrationTests.Infrastructure;
using SkyState.Api.Models;
using SkyState.Api.Repositories;
using Xunit;

namespace SkyState.Api.IntegrationTests;

public class InvoiceEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private readonly IUserRepository _userRepo = factory.Services.GetRequiredService<IUserRepository>();
    private readonly IInvoiceRepository _invoiceRepo = factory.Services.GetRequiredService<IInvoiceRepository>();

    private static CancellationToken CT => TestContext.Current.CancellationToken;

    private static string Uid() => Guid.NewGuid().ToString("N")[..8];

    private static CreateInvoice NewInvoice(string tier = "hobby", int boostMultiplier = 1, int cents = 4999, string status = "paid") =>
        new(tier, boostMultiplier, cents, status,
            new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2025, 1, 31, 23, 59, 59, DateTimeKind.Utc));

    // --- GET /invoices ---

    [Fact]
    public async Task ListInvoices_AsAlice_ReturnsOnlyAliceInvoices()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        await _invoiceRepo.CreateAsync(aliceId, NewInvoice("hobby", 1, 4999));
        await _invoiceRepo.CreateAsync(aliceId, NewInvoice("pro", 2, 7499));
        await _invoiceRepo.CreateAsync(bobId, NewInvoice("hobby", 1, 2999));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync("/invoices", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoices = await response.Content.ReadFromJsonAsync<List<Invoice>>(CT);
        Assert.NotNull(invoices);
        Assert.Equal(2, invoices.Count);
        Assert.All(invoices, i => Assert.Equal(aliceId, i.UserId));
    }

    [Fact]
    public async Task ListInvoices_AsBob_ReturnsOnlyBobInvoices()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        await _invoiceRepo.CreateAsync(aliceId, NewInvoice("hobby", 1, 4999));
        await _invoiceRepo.CreateAsync(bobId, NewInvoice("hobby", 1, 2999));
        await _invoiceRepo.CreateAsync(bobId, NewInvoice("pro", 1, 3999));
        using var client = factory.CreateAuthenticatedClient($"bob-{id}", $"bob-{id}@test.com", "Bob");

        var response = await client.GetAsync("/invoices", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoices = await response.Content.ReadFromJsonAsync<List<Invoice>>(CT);
        Assert.NotNull(invoices);
        Assert.Equal(2, invoices.Count);
        Assert.All(invoices, i => Assert.Equal(bobId, i.UserId));
    }

    // --- GET /invoices/{id} ---

    [Fact]
    public async Task GetInvoice_AsAlice_OwnInvoice_ReturnsOk()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var invoiceId = await _invoiceRepo.CreateAsync(aliceId, NewInvoice("hobby", 1, 4999));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/invoices/{invoiceId}", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoice = await response.Content.ReadFromJsonAsync<Invoice>(CT);
        Assert.NotNull(invoice);
        Assert.Equal("hobby", invoice.Tier);
        Assert.Equal(1, invoice.BoostMultiplier);
        Assert.Equal(4999, invoice.AmountPaidCents);
        Assert.Equal("paid", invoice.Status);
    }

    [Fact]
    public async Task GetInvoice_AsAlice_BobsInvoice_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var bobInvoiceId = await _invoiceRepo.CreateAsync(bobId, NewInvoice());
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/invoices/{bobInvoiceId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetInvoice_AsBob_AlicesInvoice_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        var bobId = await _userRepo.CreateAsync(new CreateUser("github", $"bob-{id}", $"bob-{id}@test.com", "Bob"));
        var aliceInvoiceId = await _invoiceRepo.CreateAsync(aliceId, NewInvoice());
        using var client = factory.CreateAuthenticatedClient($"bob-{id}", $"bob-{id}@test.com", "Bob");

        var response = await client.GetAsync($"/invoices/{aliceInvoiceId}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetInvoice_UnknownId_ReturnsNotFound()
    {
        var id = Uid();
        var aliceId = await _userRepo.CreateAsync(new CreateUser("github", $"alice-{id}", $"alice-{id}@test.com", "Alice"));
        using var client = factory.CreateAuthenticatedClient($"alice-{id}", $"alice-{id}@test.com", "Alice");

        var response = await client.GetAsync($"/invoices/{Guid.NewGuid()}", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
