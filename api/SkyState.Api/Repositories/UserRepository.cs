using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using SkyState.Api.Models;

namespace SkyState.Api.Repositories;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid userId);
    Task<User?> GetBySsoAsync(string provider, string ssoUserId);
    Task<Guid> CreateAsync(CreateUser user);
    Task<bool> UpdateAsync(Guid userId, UpdateUser user);
    Task<bool> DeleteAsync(Guid userId);

    Task<User> UpsertBySsoAsync(string provider, string ssoUserId, string? email, string? displayName,
        string? avatarUrl);

    Task SetStripeCustomerIdAsync(Guid userId, string stripeCustomerId);
    Task<User?> GetByStripeCustomerIdAsync(string stripeCustomerId);
    Task SetSubscriptionTierAsync(Guid userId, string tier, int boostMultiplier);
    Task SetTierAsync(Guid userId, string tier);
    Task SetBoostMultiplierAsync(Guid userId, int boostMultiplier);
    Task SetPaymentFailedAtAsync(Guid userId, DateTime? paymentFailedAt);
    Task SetCurrentPeriodEndAsync(Guid userId, DateTime? currentPeriodEnd);
    Task SetStripeSubscriptionIdAsync(Guid userId, string? stripeSubscriptionId);
    Task SetLastStripeErrorAsync(Guid userId, string? error);
    Task SetCustomRetentionDaysAsync(Guid userId, int? customRetentionDays);
    Task<IEnumerable<User>> GetAllAsync();
}

public class UserRepository(ConnectionStrings connectionStrings) : IUserRepository
{
    private IDbConnection GetConnection() => new NpgsqlConnection(connectionStrings.DefaultConnection);

    public async Task<User?> GetByIdAsync(Guid userId)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM \"user\" WHERE user_id = @UserId",
            new { UserId = userId });
    }

    public async Task<User?> GetBySsoAsync(string provider, string ssoUserId)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM \"user\" WHERE sso_provider = @Provider AND sso_user_id = @SsoUserId",
            new { Provider = provider, SsoUserId = ssoUserId });
    }

    public async Task<Guid> CreateAsync(CreateUser user)
    {
        var id = Guid.CreateVersion7();
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            INSERT INTO "user" (user_id, sso_provider, sso_user_id, email, display_name, avatar_url, stripe_user_id)
            VALUES (@Id, @SsoProvider, @SsoUserId, @Email, @DisplayName, @AvatarUrl, @StripeUserId)
            """, new { Id = id, user.SsoProvider, user.SsoUserId, user.Email, user.DisplayName, user.AvatarUrl, user.StripeUserId });
        return id;
    }

    public async Task<bool> UpdateAsync(Guid userId, UpdateUser user)
    {
        using var conn = GetConnection();
        var rows = await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET display_name = COALESCE(@displayName, display_name),
                avatar_url = COALESCE(@avatarUrl, avatar_url),
                updated_at = NOW()
            WHERE user_id = @userId
            """, new { userId, user.DisplayName, user.AvatarUrl });
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(Guid userId)
    {
        using var conn = GetConnection();
        var rows = await conn.ExecuteAsync("DELETE FROM \"user\" WHERE user_id = @UserId", new { UserId = userId });
        return rows > 0;
    }

    public async Task<User> UpsertBySsoAsync(string provider, string ssoUserId, string? email, string? displayName,
        string? avatarUrl)
    {
        var id = Guid.CreateVersion7();
        using var conn = GetConnection();
        var user = await conn.QuerySingleAsync<User>(
            """
            INSERT INTO "user" (user_id, sso_provider, sso_user_id, email, display_name, avatar_url, last_login_at, created_at, updated_at)
            VALUES (@Id, @Provider, @SsoUserId, @Email, @DisplayName, @AvatarUrl, NOW(), NOW(), NOW())
            ON CONFLICT (sso_provider, sso_user_id) DO UPDATE
            SET email = COALESCE(@Email, "user".email),
                display_name = COALESCE(@DisplayName, "user".display_name),
                avatar_url = COALESCE(@AvatarUrl, "user".avatar_url),
                last_login_at = NOW(),
                updated_at = NOW()
            RETURNING *
            """,
            new
            {
                Id = id, Provider = provider, SsoUserId = ssoUserId, Email = email, DisplayName = displayName,
                AvatarUrl = avatarUrl
            });

        return user;
    }

    public async Task SetStripeCustomerIdAsync(Guid userId, string stripeCustomerId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET stripe_user_id = @StripeCustomerId, updated_at = NOW()
            WHERE user_id = @UserId
            """,
            new { UserId = userId, StripeCustomerId = stripeCustomerId });
    }

    public async Task<User?> GetByStripeCustomerIdAsync(string stripeCustomerId)
    {
        using var conn = GetConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM \"user\" WHERE stripe_user_id = @StripeCustomerId",
            new { StripeCustomerId = stripeCustomerId });
    }

    public async Task SetSubscriptionTierAsync(Guid userId, string tier, int boostMultiplier)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET subscription_tier = @tier, boost_multiplier = @boostMultiplier, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, tier, boostMultiplier });
    }

    public async Task SetTierAsync(Guid userId, string tier)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET subscription_tier = @tier, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, tier });
    }

    public async Task SetBoostMultiplierAsync(Guid userId, int boostMultiplier)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET boost_multiplier = @boostMultiplier, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, boostMultiplier });
    }

    public async Task SetPaymentFailedAtAsync(Guid userId, DateTime? paymentFailedAt)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET payment_failed_at = @paymentFailedAt, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, paymentFailedAt });
    }

    public async Task SetCurrentPeriodEndAsync(Guid userId, DateTime? currentPeriodEnd)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET current_period_end = @currentPeriodEnd, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, currentPeriodEnd });
    }

    public async Task SetStripeSubscriptionIdAsync(Guid userId, string? stripeSubscriptionId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET stripe_subscription_id = @stripeSubscriptionId, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, stripeSubscriptionId });
    }

    public async Task SetLastStripeErrorAsync(Guid userId, string? error)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET last_stripe_error = @error, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, error });
    }

    public async Task SetCustomRetentionDaysAsync(Guid userId, int? customRetentionDays)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            """
            UPDATE "user"
            SET custom_retention_days = @customRetentionDays, updated_at = NOW()
            WHERE user_id = @userId
            """,
            new { userId, customRetentionDays });
    }

    public async Task<IEnumerable<User>> GetAllAsync()
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<User>("SELECT * FROM \"user\"");
    }
}
