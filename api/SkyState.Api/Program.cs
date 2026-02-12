using System;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Scalar.AspNetCore;
using Serilog;
using SkyState.Api.Authentication;
using SkyState.Api.Endpoints;
using SkyState.Api.Repositories;
using SkyState.Api.Services;

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
    configuration.ReadFrom.Configuration(context.Configuration));

builder.Services.AddSkyStateRepositories();
builder.Services.AddSkyStateServices(builder.Configuration);
builder.Services.AddSkyStateAuthentication(builder.Configuration, builder.Environment);

builder.Services.AddOpenApi();

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("PublicApi", policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader();
    });
});

// OutputCache
builder.Services.AddOutputCache(options =>
{
    options.AddPolicy("PublicConfig", builder => builder
        .Expire(TimeSpan.FromSeconds(60))
        .SetVaryByRouteValue(["projectSlug", "environmentSlug"])
        .Tag(PublicConfigEndpoints.CacheTag));
});

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor
                             | ForwardedHeaders.XForwardedProto
                             | ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// Compose DB connection string from environment variables
// Supports: INSTANCE_UNIX_SOCKET (Cloud Run) → TCP via DB_HOST (ECS) → appsettings.json (local dev)
var dbConnection = SkyState.Api.DatabaseConnectionHelper.BuildConnectionString();
if (dbConnection is not null)
{
    builder.Configuration["ConnectionStrings:DefaultConnection"] = dbConnection.Value.ConnectionString;
    Log.Information("Database connection: {Mode}", dbConnection.Value.Mode);
}

// Rate Limiter
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsync(
            "Per-minute rate limit exceeded. Try again later.", cancellationToken);
    };

    options.AddPolicy("PublicConfigRateLimit", context =>
    {
        var projectSlug = context.GetRouteValue("projectSlug")?.ToString() ?? "unknown";
        var envSlug = context.GetRouteValue("environmentSlug")?.ToString() ?? "unknown";
        var partitionKey = $"{projectSlug}:{envSlug}";

        // Use generous defaults in middleware (no async tier lookup possible here).
        // Production gets 1000 req/min baseline (covers Free tier limit).
        // Non-production gets 60 req/min (strict -- testing, not serving users).
        var isProduction = envSlug == "production";
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: partitionKey,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isProduction ? 1000 : 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseSerilogRequestLogging();

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseRouting();
app.UseCors("PublicApi");
app.UseRateLimiter();
app.UseOutputCache();
app.UseAuthentication();
app.UseAuthorization();

app.MapOpenApi();
app.MapScalarApiReference();

app.MapSkyStateEndpoints();

app.Run();

public partial class Program;