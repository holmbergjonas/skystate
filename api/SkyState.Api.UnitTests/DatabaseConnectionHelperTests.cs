using System;
using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Tests for DatabaseConnectionHelper — validates Unix socket, TCP, and fallback paths.
/// </summary>
public class DatabaseConnectionHelperTests : IDisposable
{
    // Store original env vars to restore after each test
    private readonly string? _origUnixSocket;
    private readonly string? _origDbHost;
    private readonly string? _origDbName;
    private readonly string? _origDbUser;
    private readonly string? _origDbPassword;
    private readonly string? _origMaxPoolSize;

    public DatabaseConnectionHelperTests()
    {
        _origUnixSocket = Environment.GetEnvironmentVariable("INSTANCE_UNIX_SOCKET");
        _origDbHost = Environment.GetEnvironmentVariable("DB_HOST");
        _origDbName = Environment.GetEnvironmentVariable("DB_NAME");
        _origDbUser = Environment.GetEnvironmentVariable("DB_USER");
        _origDbPassword = Environment.GetEnvironmentVariable("DB_PASSWORD");
        _origMaxPoolSize = Environment.GetEnvironmentVariable("DB_MAX_POOL_SIZE");

        // Clear all DB env vars before each test
        ClearDbEnvVars();
    }

    public void Dispose()
    {
        // Restore original env vars
        SetOrClear("INSTANCE_UNIX_SOCKET", _origUnixSocket);
        SetOrClear("DB_HOST", _origDbHost);
        SetOrClear("DB_NAME", _origDbName);
        SetOrClear("DB_USER", _origDbUser);
        SetOrClear("DB_PASSWORD", _origDbPassword);
        SetOrClear("DB_MAX_POOL_SIZE", _origMaxPoolSize);
    }

    [Fact]
    public void UnixSocket_ReturnsConnectionStringWithSslDisable()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/project:region:instance/.s.PGSQL.5432");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "test-password");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Host=/cloudsql/project:region:instance/.s.PGSQL.5432", result!.Value.ConnectionString);
        Assert.Contains("SSL Mode=Disable", result.Value.ConnectionString);
        Assert.Equal("Database: Unix socket (Cloud SQL)", result.Value.Mode);
    }

    [Fact]
    public void UnixSocket_UsesDefaultDbNameAndUser()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i/.s.PGSQL.5432");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Database=skystate", result!.Value.ConnectionString);
        Assert.Contains("Username=skystate", result.Value.ConnectionString);
    }

    [Fact]
    public void UnixSocket_DefaultPoolSizeIs20()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Maximum Pool Size=20", result!.Value.ConnectionString);
    }

    [Fact]
    public void UnixSocket_CustomPoolSize()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");
        Environment.SetEnvironmentVariable("DB_MAX_POOL_SIZE", "15");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Maximum Pool Size=15", result!.Value.ConnectionString);
    }

    [Fact]
    public void UnixSocket_InvalidPoolSizeFallsBackToDefault()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");
        Environment.SetEnvironmentVariable("DB_MAX_POOL_SIZE", "not-a-number");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Maximum Pool Size=20", result!.Value.ConnectionString);
    }

    [Fact]
    public void UnixSocket_HasPoolingEnabled()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Pooling=True", result!.Value.ConnectionString);
    }

    [Fact]
    public void TcpHost_ReturnsConnectionStringWithSslRequire()
    {
        Environment.SetEnvironmentVariable("DB_HOST", "10.0.0.1");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "test-password");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Host=10.0.0.1", result!.Value.ConnectionString);
        Assert.Contains("SSL Mode=Require", result.Value.ConnectionString);
        Assert.Contains("Trust Server Certificate=true", result.Value.ConnectionString);
        Assert.Equal("Database: TCP (10.0.0.1)", result.Value.Mode);
    }

    [Fact]
    public void TcpHost_DefaultPoolSizeIs20()
    {
        Environment.SetEnvironmentVariable("DB_HOST", "10.0.0.1");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Maximum Pool Size=20", result!.Value.ConnectionString);
    }

    [Fact]
    public void TcpHost_CustomDbNameAndUser()
    {
        Environment.SetEnvironmentVariable("DB_HOST", "10.0.0.1");
        Environment.SetEnvironmentVariable("DB_NAME", "mydb");
        Environment.SetEnvironmentVariable("DB_USER", "myuser");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Database=mydb", result!.Value.ConnectionString);
        Assert.Contains("Username=myuser", result.Value.ConnectionString);
    }

    [Fact]
    public void UnixSocket_TakesPrecedenceOverDbHost()
    {
        // When both are set, Unix socket should win
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", "/cloudsql/p:r:i");
        Environment.SetEnvironmentVariable("DB_HOST", "10.0.0.1");
        Environment.SetEnvironmentVariable("DB_PASSWORD", "pw");

        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.NotNull(result);
        Assert.Contains("Host=/cloudsql/p:r:i", result!.Value.ConnectionString);
        Assert.Contains("SSL Mode=Disable", result.Value.ConnectionString);
        Assert.Equal("Database: Unix socket (Cloud SQL)", result.Value.Mode);
    }

    [Fact]
    public void NoEnvVars_ReturnsNull()
    {
        // Neither INSTANCE_UNIX_SOCKET nor DB_HOST set
        var result = DatabaseConnectionHelper.BuildConnectionString();

        Assert.Null(result);
    }

    private static void ClearDbEnvVars()
    {
        Environment.SetEnvironmentVariable("INSTANCE_UNIX_SOCKET", null);
        Environment.SetEnvironmentVariable("DB_HOST", null);
        Environment.SetEnvironmentVariable("DB_NAME", null);
        Environment.SetEnvironmentVariable("DB_USER", null);
        Environment.SetEnvironmentVariable("DB_PASSWORD", null);
        Environment.SetEnvironmentVariable("DB_MAX_POOL_SIZE", null);
    }

    private static void SetOrClear(string name, string? value)
    {
        Environment.SetEnvironmentVariable(name, value);
    }
}
