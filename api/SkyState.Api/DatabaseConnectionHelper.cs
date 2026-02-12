using System;
using Npgsql;

namespace SkyState.Api;

/// <summary>
/// Builds database connection strings from environment variables.
/// Supports Unix socket (Cloud Run via Cloud SQL Auth Proxy) and TCP (ECS/local dev) modes.
/// </summary>
internal static class DatabaseConnectionHelper
{
    private const int DefaultMaxPoolSize = 20;

    /// <summary>
    /// Attempts to build a connection string from environment variables.
    /// Returns null if neither INSTANCE_UNIX_SOCKET nor DB_HOST is set.
    /// </summary>
    internal static (string ConnectionString, string Mode)? BuildConnectionString()
    {
        var unixSocket = Environment.GetEnvironmentVariable("INSTANCE_UNIX_SOCKET");
        if (unixSocket is not null)
        {
            return BuildUnixSocketConnectionString(unixSocket);
        }

        var dbHost = Environment.GetEnvironmentVariable("DB_HOST");
        if (dbHost is not null)
        {
            return BuildTcpConnectionString(dbHost);
        }

        return null;
    }

    private static (string ConnectionString, string Mode) BuildUnixSocketConnectionString(string unixSocket)
    {
        var dbName = Environment.GetEnvironmentVariable("DB_NAME") ?? "skystate";
        var dbUser = Environment.GetEnvironmentVariable("DB_USER") ?? "skystate";
        var dbPassword = Environment.GetEnvironmentVariable("DB_PASSWORD");
        var maxPoolSize = ParsePoolSize();

        var csb = new NpgsqlConnectionStringBuilder
        {
            Host = unixSocket,
            Database = dbName,
            Username = dbUser,
            Password = dbPassword,
            SslMode = SslMode.Disable,
            Pooling = true,
            MaxPoolSize = maxPoolSize,
        };

        return (csb.ConnectionString, "Database: Unix socket (Cloud SQL)");
    }

    private static (string ConnectionString, string Mode) BuildTcpConnectionString(string dbHost)
    {
        var dbName = Environment.GetEnvironmentVariable("DB_NAME") ?? "skystate";
        var dbUser = Environment.GetEnvironmentVariable("DB_USER") ?? "skystate";
        var dbPassword = Environment.GetEnvironmentVariable("DB_PASSWORD");
        var maxPoolSize = ParsePoolSize();

        var connectionString = $"Host={dbHost};Database={dbName};Username={dbUser};Password={dbPassword};SSL Mode=Require;Trust Server Certificate=true;Maximum Pool Size={maxPoolSize}";

        return (connectionString, $"Database: TCP ({dbHost})");
    }

    private static int ParsePoolSize()
    {
        return int.TryParse(
            Environment.GetEnvironmentVariable("DB_MAX_POOL_SIZE"), out var poolSize)
            ? poolSize
            : DefaultMaxPoolSize;
    }
}
