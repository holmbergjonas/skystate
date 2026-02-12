using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using SkyState.Api.IntegrationTests.Infrastructure;
using Xunit;

namespace SkyState.Api.IntegrationTests;

public class WebhookEndpointTests(SkyStateApiFactory factory) : IClassFixture<SkyStateApiFactory>
{
    private static CancellationToken CT => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Webhook_Returns400_WhenNoSignatureHeader()
    {
        using var client = factory.CreateClient();
        var content = new StringContent("{\"type\":\"test.event\"}", Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/webhooks/stripe", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_Returns400_WhenInvalidSignature()
    {
        using var client = factory.CreateClient();
        var content = new StringContent("{\"type\":\"test.event\"}", Encoding.UTF8, "application/json");
        client.DefaultRequestHeaders.Add("Stripe-Signature", "t=12345,v1=fakesignature");

        var response = await client.PostAsync("/webhooks/stripe", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_DoesNotRequireAuth()
    {
        // Webhook endpoint should be AllowAnonymous - unauthenticated requests should NOT return 401
        // Instead they should return 400 for invalid signature (not 401 for missing auth)
        using var client = factory.CreateClient();
        var content = new StringContent("{\"type\":\"test.event\"}", Encoding.UTF8, "application/json");
        // No X-Test-GitHub-Id header, so this is unauthenticated

        var response = await client.PostAsync("/webhooks/stripe", content, CT);

        // Should return 400 for missing signature, NOT 401 for missing auth
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_AcceptsJsonContentType()
    {
        // Verify the endpoint accepts JSON payloads (should not return 415 Unsupported Media Type)
        using var client = factory.CreateClient();
        var jsonPayload = "{\"id\":\"evt_test\",\"type\":\"customer.subscription.created\",\"data\":{}}";
        var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
        client.DefaultRequestHeaders.Add("Stripe-Signature", "t=12345,v1=fakesignature");

        var response = await client.PostAsync("/webhooks/stripe", content, CT);

        // Should return 400 for invalid signature, NOT 415 Unsupported Media Type
        Assert.NotEqual(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_ReturnsOk_WithEmptySignatureHeader()
    {
        // Edge case: empty signature header should return 400 (validation fails)
        using var client = factory.CreateClient();
        var content = new StringContent("{\"type\":\"test.event\"}", Encoding.UTF8, "application/json");
        client.DefaultRequestHeaders.Add("Stripe-Signature", "");

        var response = await client.PostAsync("/webhooks/stripe", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
