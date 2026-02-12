using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using SkyState.Api.Models;
using SkyState.Api.Repositories;

namespace SkyState.Api.IntegrationTests.Infrastructure;

public class InMemoryDatabase
{
    public ConcurrentDictionary<Guid, User> Users { get; } = new();
    public ConcurrentDictionary<Guid, Project> Projects { get; } = new();
    public ConcurrentDictionary<Guid, ProjectConfig> ProjectConfigs { get; } = new();
    public ConcurrentDictionary<Guid, Invoice> Invoices { get; } = new();
    public ConcurrentDictionary<string, WebhookEvent> WebhookEvents { get; } = new();
    public ConcurrentDictionary<(Guid UserId, int Year, int Month), int> Counters { get; } = new();
}

public class InMemoryUserRepository(InMemoryDatabase db) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid userId)
    {
        db.Users.TryGetValue(userId, out var user);
        return Task.FromResult(user);
    }

    public Task<User?> GetBySsoAsync(string provider, string ssoUserId)
    {
        var user = db.Users.Values.FirstOrDefault(u =>
            u.SsoProvider == provider && u.SsoUserId == ssoUserId);
        return Task.FromResult(user);
    }

    public Task<Guid> CreateAsync(CreateUser user)
    {
        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var entity = new User
        {
            UserId = id,
            SsoProvider = user.SsoProvider,
            SsoUserId = user.SsoUserId,
            Email = user.Email,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            StripeUserId = user.StripeUserId,
            CreatedAt = now,
            UpdatedAt = now,
            LastLoginAt = now
        };
        db.Users[id] = entity;
        return Task.FromResult(id);
    }

    public Task<bool> UpdateAsync(Guid userId, UpdateUser user)
    {
        if (!db.Users.TryGetValue(userId, out var existing))
            return Task.FromResult(false);

        db.Users[userId] = existing with
        {
            DisplayName = user.DisplayName ?? existing.DisplayName,
            AvatarUrl = user.AvatarUrl ?? existing.AvatarUrl,
            UpdatedAt = DateTime.UtcNow
        };
        return Task.FromResult(true);
    }

    public Task<bool> DeleteAsync(Guid userId)
    {
        return Task.FromResult(db.Users.TryRemove(userId, out _));
    }

    public Task<User> UpsertBySsoAsync(string provider, string ssoUserId, string? email, string? displayName,
        string? avatarUrl)
    {
        var existing = db.Users.Values.FirstOrDefault(u =>
            u.SsoProvider == provider && u.SsoUserId == ssoUserId);

        if (existing is not null)
        {
            var updated = existing with
            {
                Email = email ?? existing.Email,
                DisplayName = displayName ?? existing.DisplayName,
                AvatarUrl = avatarUrl ?? existing.AvatarUrl,
                LastLoginAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            db.Users[existing.UserId] = updated;
            return Task.FromResult(updated);
        }

        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var user = new User
        {
            UserId = id,
            SsoProvider = provider,
            SsoUserId = ssoUserId,
            Email = email,
            DisplayName = displayName,
            AvatarUrl = avatarUrl,
            CreatedAt = now,
            UpdatedAt = now,
            LastLoginAt = now
        };
        db.Users[id] = user;
        return Task.FromResult(user);
    }

    public Task SetStripeCustomerIdAsync(Guid userId, string stripeCustomerId)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                StripeUserId = stripeCustomerId,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task<User?> GetByStripeCustomerIdAsync(string stripeCustomerId)
    {
        var user = db.Users.Values.FirstOrDefault(u => u.StripeUserId == stripeCustomerId);
        return Task.FromResult(user);
    }

    public Task SetSubscriptionTierAsync(Guid userId, string tier, int boostMultiplier)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                SubscriptionTier = tier,
                BoostMultiplier = boostMultiplier,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetTierAsync(Guid userId, string tier)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                SubscriptionTier = tier,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetBoostMultiplierAsync(Guid userId, int boostMultiplier)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                BoostMultiplier = boostMultiplier,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetPaymentFailedAtAsync(Guid userId, DateTime? paymentFailedAt)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                PaymentFailedAt = paymentFailedAt,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetCurrentPeriodEndAsync(Guid userId, DateTime? currentPeriodEnd)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                CurrentPeriodEnd = currentPeriodEnd,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetStripeSubscriptionIdAsync(Guid userId, string? stripeSubscriptionId)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                StripeSubscriptionId = stripeSubscriptionId,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetLastStripeErrorAsync(Guid userId, string? error)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                LastStripeError = error,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task SetCustomRetentionDaysAsync(Guid userId, int? customRetentionDays)
    {
        if (db.Users.TryGetValue(userId, out var existing))
        {
            db.Users[userId] = existing with
            {
                CustomRetentionDays = customRetentionDays,
                UpdatedAt = DateTime.UtcNow
            };
        }

        return Task.CompletedTask;
    }

    public Task<IEnumerable<User>> GetAllAsync()
    {
        return Task.FromResult<IEnumerable<User>>(db.Users.Values.ToList());
    }
}

public class InMemoryProjectRepository(InMemoryDatabase db) : IProjectRepository
{
    public Task<Project?> GetByIdAsync(Guid userId, Guid projectId)
    {
        db.Projects.TryGetValue(projectId, out var project);
        if (project is not null && project.UserId != userId)
            project = null;
        return Task.FromResult(project);
    }

    public Task<Project?> GetBySlugAsync(Guid userId, string slug)
    {
        var project = db.Projects.Values.FirstOrDefault(p => p.Slug == slug && p.UserId == userId);
        return Task.FromResult(project);
    }

    public Task<IEnumerable<Project>> GetByUserIdAsync(Guid userId)
    {
        var projects = db.Projects.Values.Where(p => p.UserId == userId);
        return Task.FromResult(projects);
    }

    public Task<Guid> CreateAsync(Guid userId, CreateProject project, int? effectiveLimit)
    {
        if (effectiveLimit.HasValue)
        {
            var count = db.Projects.Values.Count(p => p.UserId == userId);
            if (count >= effectiveLimit.Value)
                return Task.FromResult(Guid.Empty);
        }

        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var entity = new Project
        {
            ProjectId = id,
            UserId = userId,
            Name = project.Name,
            Slug = project.Slug,
            ApiKeyHash = project.ApiKeyHash,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Projects[id] = entity;
        return Task.FromResult(id);
    }

    public Task<bool> UpdateAsync(Guid userId, Guid projectId, UpdateProject project)
    {
        if (!db.Projects.TryGetValue(projectId, out var existing) || existing.UserId != userId)
            return Task.FromResult(false);

        db.Projects[projectId] = existing with
        {
            Name = project.Name,
            ApiKeyHash = project.ApiKeyHash,
            UpdatedAt = DateTime.UtcNow
        };
        return Task.FromResult(true);
    }

    public Task<bool> DeleteAsync(Guid userId, Guid projectId)
    {
        if (!db.Projects.TryGetValue(projectId, out var existing) || existing.UserId != userId)
            return Task.FromResult(false);

        return Task.FromResult(db.Projects.TryRemove(projectId, out _));
    }

    public Task<int> GetCountByUserIdAsync(Guid userId)
    {
        var count = db.Projects.Values.Count(p => p.UserId == userId);
        return Task.FromResult(count);
    }
}

public class InMemoryProjectConfigRepository(InMemoryDatabase db) : IProjectConfigRepository
{
    private bool UserOwnsProject(Guid userId, Guid projectId)
    {
        return db.Projects.TryGetValue(projectId, out var project) && project.UserId == userId;
    }

    public Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId)
    {
        if (!db.ProjectConfigs.TryGetValue(projectConfigId, out var config))
            return Task.FromResult<ProjectConfig?>(null);
        if (!UserOwnsProject(userId, config.ProjectId))
            return Task.FromResult<ProjectConfig?>(null);
        return Task.FromResult<ProjectConfig?>(config);
    }

    public Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment)
    {
        if (!UserOwnsProject(userId, projectId))
            return Task.FromResult<ProjectConfig?>(null);

        var latest = db.ProjectConfigs.Values
            .Where(c => c.ProjectId == projectId && c.Environment == environment)
            .OrderByDescending(c => c.Major)
            .ThenByDescending(c => c.Minor)
            .ThenByDescending(c => c.Patch)
            .FirstOrDefault();
        return Task.FromResult(latest);
    }

    public Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment)
    {
        if (!UserOwnsProject(userId, projectId))
            return Task.FromResult(Enumerable.Empty<ProjectConfig>());

        var configs = db.ProjectConfigs.Values
            .Where(c => c.ProjectId == projectId && c.Environment == environment)
            .OrderByDescending(c => c.Major)
            .ThenByDescending(c => c.Minor)
            .ThenByDescending(c => c.Patch);
        return Task.FromResult<IEnumerable<ProjectConfig>>(configs.ToList());
    }

    public Task<Guid> CreateAsync(Guid userId, Guid projectId, string environment, CreateProjectConfig version)
    {
        if (!UserOwnsProject(userId, projectId))
            return Task.FromResult(Guid.Empty);

        // Check version ordering - reject if version <= latest
        var existing = db.ProjectConfigs.Values
            .Where(c => c.ProjectId == projectId && c.Environment == environment)
            .Any(c => (c.Major, c.Minor, c.Patch).CompareTo((version.Major, version.Minor, version.Patch)) >= 0);

        if (existing)
            return Task.FromResult(Guid.Empty);

        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var stateSizeBytes = Encoding.UTF8.GetByteCount(version.State);
        var entity = new ProjectConfig
        {
            ProjectStateId = id,
            ProjectId = projectId,
            Environment = environment,
            Major = version.Major,
            Minor = version.Minor,
            Patch = version.Patch,
            State = version.State,
            Comment = version.Comment,
            CreatedAt = now,
            StateSizeBytes = stateSizeBytes
        };
        db.ProjectConfigs[id] = entity;
        return Task.FromResult(id);
    }

    public Task<Guid> RollbackAsync(Guid userId, Guid projectId, string environment, Guid targetProjectConfigId)
    {
        if (!UserOwnsProject(userId, projectId))
            return Task.FromResult(Guid.Empty);

        if (!db.ProjectConfigs.TryGetValue(targetProjectConfigId, out var target))
            return Task.FromResult(Guid.Empty);

        if (target.ProjectId != projectId || target.Environment != environment)
            return Task.FromResult(Guid.Empty);

        var latest = db.ProjectConfigs.Values
            .Where(c => c.ProjectId == projectId && c.Environment == environment)
            .OrderByDescending(c => c.Major)
            .ThenByDescending(c => c.Minor)
            .ThenByDescending(c => c.Patch)
            .FirstOrDefault();

        if (latest is null)
            return Task.FromResult(Guid.Empty);

        // Calculate new version (same logic as the SQL)
        int newMajor, newMinor, newPatch;
        if (latest.Major != target.Major)
        {
            newMajor = latest.Major + 1;
            newMinor = 0;
            newPatch = 0;
        }
        else if (latest.Minor != target.Minor)
        {
            newMajor = latest.Major;
            newMinor = latest.Minor + 1;
            newPatch = 0;
        }
        else
        {
            newMajor = latest.Major;
            newMinor = latest.Minor;
            newPatch = latest.Patch + 1;
        }

        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var comment = $"Rollback to version {target.Major}.{target.Minor}.{target.Patch}";
        var stateSizeBytes = Encoding.UTF8.GetByteCount(target.State);
        var entity = new ProjectConfig
        {
            ProjectStateId = id,
            ProjectId = projectId,
            Environment = environment,
            Major = newMajor,
            Minor = newMinor,
            Patch = newPatch,
            State = target.State,
            Comment = comment,
            CreatedAt = now,
            StateSizeBytes = stateSizeBytes
        };
        db.ProjectConfigs[id] = entity;
        return Task.FromResult(id);
    }

    public Task<(ProjectConfig Config, DateTime LastModified)?> GetLatestBySlugAsync(string projectSlug,
        string environmentSlug)
    {
        var project = db.Projects.Values.FirstOrDefault(p => p.Slug == projectSlug);
        if (project is null)
            return Task.FromResult<(ProjectConfig, DateTime)?>(null);

        var latest = db.ProjectConfigs.Values
            .Where(c => c.ProjectId == project.ProjectId && c.Environment == environmentSlug)
            .OrderByDescending(c => c.Major)
            .ThenByDescending(c => c.Minor)
            .ThenByDescending(c => c.Patch)
            .FirstOrDefault();

        if (latest is null)
            return Task.FromResult<(ProjectConfig, DateTime)?>(null);

        return Task.FromResult<(ProjectConfig, DateTime)?>((latest, latest.CreatedAt));
    }

    public Task<int> GetDocumentCountAsync(Guid userId)
    {
        // Count distinct (projectId, environment) pairs for configs owned by user
        var userProjectIds = db.Projects.Values
            .Where(p => p.UserId == userId)
            .Select(p => p.ProjectId)
            .ToHashSet();

        var count = db.ProjectConfigs.Values
            .Where(c => userProjectIds.Contains(c.ProjectId))
            .GroupBy(c => (c.ProjectId, c.Environment))
            .Count(g => g.Any());

        return Task.FromResult(count);
    }

    public Task<long> GetTotalStorageBytesAsync(Guid userId)
    {
        var userProjectIds = db.Projects.Values
            .Where(p => p.UserId == userId)
            .Select(p => p.ProjectId)
            .ToHashSet();

        var totalBytes = db.ProjectConfigs.Values
            .Where(c => userProjectIds.Contains(c.ProjectId))
            .Sum(c => (long)c.StateSizeBytes);

        return Task.FromResult(totalBytes);
    }

    public Task<long> GetStorageBytesAsync(Guid userId)
    {
        var userProjectIds = db.Projects.Values
            .Where(p => p.UserId == userId)
            .Select(p => p.ProjectId)
            .ToHashSet();

        long totalBytes = 0;
        var groups = db.ProjectConfigs.Values
            .Where(c => userProjectIds.Contains(c.ProjectId))
            .GroupBy(c => (c.ProjectId, c.Environment));

        foreach (var group in groups)
        {
            var latest = group
                .OrderByDescending(c => c.Major)
                .ThenByDescending(c => c.Minor)
                .ThenByDescending(c => c.Patch)
                .FirstOrDefault();

            if (latest is not null)
                totalBytes += latest.StateSizeBytes;
        }

        return Task.FromResult(totalBytes);
    }

    public Task<int> PruneExpiredVersionsAsync(Guid userId, DateTime cutoffDate)
    {
        var userProjectIds = db.Projects.Values
            .Where(p => p.UserId == userId)
            .Select(p => p.ProjectId)
            .ToHashSet();

        var deleted = 0;
        var groups = db.ProjectConfigs.Values
            .Where(c => userProjectIds.Contains(c.ProjectId))
            .GroupBy(c => (c.ProjectId, c.Environment));

        foreach (var group in groups)
        {
            var configs = group.ToList();

            if (configs.Count <= 1)
                continue;

            var latest = configs
                .OrderByDescending(c => c.Major)
                .ThenByDescending(c => c.Minor)
                .ThenByDescending(c => c.Patch)
                .First();

            var toDelete = configs
                .Where(c => c.ProjectStateId != latest.ProjectStateId && c.CreatedAt < cutoffDate)
                .ToList();

            foreach (var config in toDelete)
            {
                if (db.ProjectConfigs.TryRemove(config.ProjectStateId, out _))
                    deleted++;
            }
        }

        return Task.FromResult(deleted);
    }
}

public class InMemoryInvoiceRepository(InMemoryDatabase db) : IInvoiceRepository
{
    public Task<Invoice?> GetByIdAsync(Guid userId, Guid invoiceId)
    {
        if (!db.Invoices.TryGetValue(invoiceId, out var invoice) || invoice.UserId != userId)
            return Task.FromResult<Invoice?>(null);
        return Task.FromResult<Invoice?>(invoice);
    }

    public Task<IEnumerable<Invoice>> GetByUserIdAsync(Guid userId)
    {
        var invoices = db.Invoices.Values
            .Where(i => i.UserId == userId)
            .OrderByDescending(i => i.CreatedAt);
        return Task.FromResult<IEnumerable<Invoice>>(invoices.ToList());
    }

    public Task<Guid> CreateAsync(Guid userId, CreateInvoice invoice)
    {
        var id = Guid.CreateVersion7();
        var now = DateTime.UtcNow;
        var entity = new Invoice
        {
            InvoiceId = id,
            UserId = userId,
            Tier = invoice.Tier,
            BoostMultiplier = invoice.BoostMultiplier,
            AmountPaidCents = invoice.AmountPaidCents,
            Status = invoice.Status,
            BillingPeriodStart = invoice.BillingPeriodStart,
            BillingPeriodEnd = invoice.BillingPeriodEnd,
            CreatedAt = now
        };
        db.Invoices[id] = entity;
        return Task.FromResult(id);
    }
}

public class InMemoryWebhookEventRepository(InMemoryDatabase db) : IWebhookEventRepository
{
    public Task<bool> TryRecordEventAsync(string stripeEventId, string eventType)
    {
        var id = Guid.CreateVersion7();
        var entity = new WebhookEvent
        {
            WebhookEventId = id,
            StripeEventId = stripeEventId,
            EventType = eventType,
            ReceivedAt = DateTime.UtcNow
        };
        var added = db.WebhookEvents.TryAdd(stripeEventId, entity);
        return Task.FromResult(added);
    }

    public Task MarkProcessedAsync(string stripeEventId)
    {
        if (db.WebhookEvents.TryGetValue(stripeEventId, out var existing))
        {
            db.WebhookEvents[stripeEventId] = existing with { ProcessedAt = DateTime.UtcNow };
        }

        return Task.CompletedTask;
    }

    public Task RecordErrorAsync(string stripeEventId, string error)
    {
        if (db.WebhookEvents.TryGetValue(stripeEventId, out var existing))
        {
            db.WebhookEvents[stripeEventId] = existing with { Error = error };
        }

        return Task.CompletedTask;
    }
}

public class InMemoryApiRequestCounterRepository(InMemoryDatabase db) : IApiRequestCounterRepository
{
    public Task<int> IncrementAsync(Guid userId)
    {
        var now = DateTime.UtcNow;
        var key = (userId, now.Year, now.Month);
        var newCount = db.Counters.AddOrUpdate(key, 1, (_, old) => old + 1);
        return Task.FromResult(newCount);
    }

    public Task<int> GetCurrentCountAsync(Guid userId)
    {
        var now = DateTime.UtcNow;
        var key = (userId, now.Year, now.Month);
        db.Counters.TryGetValue(key, out var count);
        return Task.FromResult(count);
    }

    public Task<Guid?> GetOwnerByProjectSlugAsync(string projectSlug)
    {
        var project = db.Projects.Values.FirstOrDefault(p => p.Slug == projectSlug);
        return Task.FromResult((Guid?)project?.UserId);
    }
}
