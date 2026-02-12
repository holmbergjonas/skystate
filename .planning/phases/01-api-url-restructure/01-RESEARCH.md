# Phase 1: API URL Restructure - Research

**Researched:** 2026-03-05 (updated)
**Domain:** ASP.NET Core Minimal API routing, DB schema migration, .NET rate limiting middleware, Cache-Control headers, C# rename refactoring, CLI command rename
**Confidence:** HIGH

## Summary

Phase 1 is a comprehensive restructure spanning five major workstreams: (1) URL route migration from `/state/...` and `/projectstates/...` to `/project/.../config/...`, (2) C# internal rename from `ProjectState*` to `ProjectConfig*`, (3) environment simplification from a DB table to a fixed enum with DB migration, (4) tier+environment-based Cache-Control headers on the public endpoint, and (5) partitioned rate limiting using .NET's built-in `PartitionedRateLimiter`. The CLI `state` command becomes `config`, the existing CLI `config` command becomes `settings`, and environment CRUD endpoints are removed entirely.

The scope is significantly larger than a simple rename-and-reroute. The environment simplification requires a DB schema migration (dropping the `environment` table, adding a string `environment` column to `project_state`), rewriting all SQL queries that currently JOIN on the `environment` table, and removing the entire `EnvironmentService`/`EnvironmentRepository`/`EnvironmentEndpoints` layer. The Cache-Control and rate limiting additions require new middleware configuration in `Program.cs` but use .NET's built-in libraries (no new NuGet packages).

**Primary recommendation:** Execute in waves: (1) DB migration + environment simplification + SQL rewrites, (2) rename + reroute endpoints, (3) Cache-Control + partitioned rate limiting, (4) CLI rename, (5) test updates + OpenAPI. Each wave should compile and pass tests before proceeding.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Architecture: "Remote Config" model -- HTTP fetch + browser Cache-Control, no SSE/real-time
- Public read: `GET /project/{projectSlug}/config/{envSlug}` (slugs, envSlug is `development`|`staging`|`production`)
- Authenticated CRUD: `/project/{projectId}/config/{envSlug}/...` (project GUID + environment slug, no environment GUIDs)
- No redirects from old URLs -- simply replace them (no existing users)
- Old routes (`/state/...`, `/projectstates/...`) are deleted, not kept in parallel
- Full rename: `ProjectState*` -> `ProjectConfig*` across service, repository, model, and endpoint classes
- DB table stays as `project_state` (rename explicitly out of scope per REQUIREMENTS.md)
- Environments change from configurable DB table to fixed enum: `development`, `staging`, `production`
- Free tier: `development` + `production` only; Hobby/Pro: all three
- Drop the `environment` DB table entirely; replace `environment_id` FK with string `environment` column
- Remove environment CRUD endpoints entirely (environments are no longer user-managed)
- Cache-Control: `public, max-age={TTL}` per tier+environment (see TTL table in CONTEXT.md)
- Partitioned rate limiting: .NET `PartitionedRateLimiter` branching on `envSlug` from route data
- Rate limits per tier+environment (see rate limit table in CONTEXT.md)
- Config writes invalidate output cache so next read gets fresh data
- Rename CLI `state` command to `config`, existing `config` command to `settings`
- Dashboard changes deferred to Phase 4 (renumbered)
- Phase 1 is API + CLI + DB migration only
- OpenAPI: update public endpoint path and schema names
- No ETags in v1 -- deferred

### Claude's Discretion
- Exact test migration approach (update in place vs. new test files)
- Whether to rename the CLI source file (`state.ts` -> `config.ts`) or just the command name
- OpenAPI spec structural changes (path update, schema rename)
- DB migration strategy (SQL migration script approach)
- Partitioned rate limiter implementation details
- Cache-Control middleware/filter implementation approach

### Deferred Ideas (OUT OF SCOPE)
- CDN (CloudFront/Cloudflare) in front of public config endpoint -- future
- ETag support for conditional polling -- future
- Strict IP-based rate limiting refinement -- later
- SSE real-time push -- permanently out of scope for v1
- Dashboard "Settings" tab move to rightmost position (Phase 4)
- DB table rename `project_state` -> `project_config` (explicitly out of scope per REQUIREMENTS.md)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | Public config read endpoint serves at `GET /project/{projectSlug}/config/{environmentSlug}` (replaces `/state/{slug}/{slug}`) | Rename `PublicStateEndpoints` -> `PublicConfigEndpoints`, change route, rewrite SQL to use string `environment` column instead of JOIN on `environment` table, add tier-based Cache-Control headers, add partitioned rate limiting |
| API-03 | Authenticated config CRUD endpoints serve at `/project/{projectId}/config/{envSlug}/...` (replaces `/projectstates/{id}/...`) | Rename `ProjectStateEndpoints` -> `ProjectConfigEndpoints`, change all route patterns to use `{envSlug}` string instead of `{environmentId:guid}`, rewrite SQL to filter by string `environment` column, remove environment CRUD endpoints |
</phase_requirements>

## Standard Stack

### Core (already in project -- no new packages needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ASP.NET Core | .NET 10 | Web framework, minimal APIs | Already in use |
| Dapper | 2.1.66 | ORM for PostgreSQL queries | Already in use |
| Npgsql | 10.0.1 | PostgreSQL driver | Already in use |
| System.Threading.RateLimiting | built-in | PartitionedRateLimiter for per-env rate limiting | Ships with .NET 10, no NuGet needed |
| Microsoft.AspNetCore.RateLimiting | built-in | Rate limiting middleware (AddRateLimiter/UseRateLimiter) | Ships with ASP.NET Core 10 |

### Important: No New NuGet Packages
The `System.Threading.RateLimiting` namespace and `Microsoft.AspNetCore.RateLimiting` middleware are built into the ASP.NET Core framework starting from .NET 7. The project targets `net10.0` so these are available without adding any package references to the `.csproj`.

## Architecture Patterns

### Current URL Structure (being replaced)
```
Old public:        GET /state/{projectSlug}/{environmentSlug}
Old authenticated: GET /projectstates/{projectStateId}
                   GET /projectstates/{projectStateId}/environment/{environmentId:guid}
                   GET /projectstates/{projectStateId}/environment/{environmentId:guid}/latest
                   POST /projectstates/{projectStateId}/environment/{environmentId:guid}
                   POST /projectstates/{projectStateId}/environment/{environmentId:guid}/rollback/{targetId}
Old env CRUD:      GET /projects/{projectId}/environments
                   GET /projects/{projectId}/environments/{environmentId}
                   GET /projects/{projectId}/environments/by-slug/{slug}
                   POST /projects/{projectId}/environments
                   PUT /projects/{projectId}/environments/{environmentId}
                   DELETE /projects/{projectId}/environments/{environmentId}
```

### New URL Structure
```
New public:        GET /project/{projectSlug}/config/{envSlug}
New authenticated: GET /project/{projectId:guid}/config/{envSlug}                          (list by env)
                   GET /project/{projectId:guid}/config/{envSlug}/latest                   (get latest)
                   POST /project/{projectId:guid}/config/{envSlug}                         (create)
                   POST /project/{projectId:guid}/config/{envSlug}/rollback/{targetId:guid} (rollback)
Removed:           All environment CRUD endpoints
Flat lookup:       GET /project/config/{projectConfigId:guid}                              (single by ID)
```

**Key change from previous research:** Authenticated endpoints now use `{envSlug}` (string: `development`|`staging`|`production`) instead of `{environmentId:guid}`. This is because environments are no longer DB entities with GUIDs -- they are fixed enum values.

**Note on "get single by ID":** The current `GET /projectstates/{projectStateId}` takes only a config entry GUID. Since it does not fit the `/project/{projectId}/config/{envSlug}/...` nesting pattern (it needs no project or env context), use `GET /project/config/{projectConfigId:guid}` as a flat route.

### Environment Simplification Architecture

**Current schema:**
```sql
environment (environment_id PK, project_id FK, name, slug, color, created_at, updated_at)
project_state (project_state_id PK, environment_id FK -> environment, ...)
```

**New schema (after migration):**
```sql
-- environment table: DROPPED
project_state (project_state_id PK, project_id FK -> project, environment TEXT NOT NULL CHECK(...), ...)
```

The `environment_id` UUID FK is replaced by:
- `project_id` UUID FK (direct reference to project, was previously via environment table)
- `environment` TEXT column constrained to `('development', 'staging', 'production')`

**SQL rewrite impact:** Every query in `ProjectStateRepository` currently JOINs `project_state` -> `environment` -> `project`. After migration, queries JOIN `project_state` -> `project` directly, filtering by `ps.environment = @environment`. This simplifies every query.

### DB Migration Script

```sql
-- Phase 1 DB Migration: Environment Simplification
-- Run BEFORE deploying new code

-- Step 1: Add new columns to project_state
ALTER TABLE project_state
  ADD COLUMN project_id UUID,
  ADD COLUMN environment TEXT;

-- Step 2: Backfill from environment table
UPDATE project_state ps
SET project_id = e.project_id,
    environment = e.slug
FROM environment e
WHERE ps.environment_id = e.environment_id;

-- Step 3: Make new columns NOT NULL after backfill
ALTER TABLE project_state
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN environment SET NOT NULL;

-- Step 4: Add FK and CHECK constraints
ALTER TABLE project_state
  ADD CONSTRAINT fk_project_state_project
    FOREIGN KEY (project_id) REFERENCES project (project_id),
  ADD CONSTRAINT chk_project_state_environment
    CHECK (environment IN ('development', 'staging', 'production'));

-- Step 5: Replace unique constraint (was on environment_id + version)
ALTER TABLE project_state
  DROP CONSTRAINT IF EXISTS project_state_environment_id_major_minor_patch_key;
ALTER TABLE project_state
  ADD CONSTRAINT project_state_project_env_version_key
    UNIQUE (project_id, environment, major, minor, patch);

-- Step 6: Add index for common query pattern
CREATE INDEX IF NOT EXISTS idx_project_state_project_env
  ON project_state (project_id, environment);

-- Step 7: Drop old FK column
ALTER TABLE project_state
  DROP COLUMN environment_id;

-- Step 8: Drop environment table
DROP TABLE IF EXISTS environment;
```

**Migration strategy:** Single SQL script applied to the database. Since there are no existing production users, this can be a destructive migration. The `installation.sql` file should be updated to reflect the new schema (no `environment` table, `project_state` has `project_id` + `environment` columns directly).

### File Rename Map

**API Endpoint files:**
| Old File | New File |
|----------|----------|
| `Endpoints/ProjectStateEndpoints.cs` | `Endpoints/ProjectConfigEndpoints.cs` |
| `Endpoints/PublicStateEndpoints.cs` | `Endpoints/PublicConfigEndpoints.cs` |
| `Endpoints/EnvironmentEndpoints.cs` | **DELETED** |

**API Service/Repository files:**
| Old File | New File |
|----------|----------|
| `Services/ProjectStateService.cs` | `Services/ProjectConfigService.cs` |
| `Repositories/ProjectStateRepository.cs` | `Repositories/ProjectConfigRepository.cs` |
| `Services/EnvironmentService.cs` | **DELETED** |
| `Repositories/EnvironmentRepository.cs` | **DELETED** |

**API Model files:**
| Old File | New File |
|----------|----------|
| `Models/ProjectState.cs` | `Models/ProjectConfig.cs` |
| `Models/Environment.cs` | **DELETED** (or reduced to just enum-like validation constants) |

**CLI files:**
| Old File | New File |
|----------|----------|
| `commands/state.ts` | `commands/config.ts` |
| `commands/config.ts` | `commands/settings.ts` |
| `commands/envs.ts` | **Simplified** (list only, shows fixed environments for project's tier) |

### C# Rename Inventory

**Classes/Interfaces to rename:**
| Old Name | New Name | File |
|----------|----------|------|
| `ProjectState` (record) | `ProjectConfig` | Models/ProjectConfig.cs |
| `CreateProjectState` (record) | `CreateProjectConfig` | Models/ProjectConfig.cs |
| `IProjectStateService` | `IProjectConfigService` | Services/ProjectConfigService.cs |
| `ProjectStateService` | `ProjectConfigService` | Services/ProjectConfigService.cs |
| `IProjectStateRepository` | `IProjectConfigRepository` | Repositories/ProjectConfigRepository.cs |
| `ProjectStateRepository` | `ProjectConfigRepository` | Repositories/ProjectConfigRepository.cs |
| `ProjectStateEndpoints` | `ProjectConfigEndpoints` | Endpoints/ProjectConfigEndpoints.cs |
| `PublicStateEndpoints` | `PublicConfigEndpoints` | Endpoints/PublicConfigEndpoints.cs |

**Classes/Interfaces to REMOVE:**
| Name | File | Reason |
|------|------|--------|
| `IEnvironmentService` | Services/EnvironmentService.cs | Environments are no longer user-managed |
| `EnvironmentService` | Services/EnvironmentService.cs | Environments are no longer user-managed |
| `IEnvironmentRepository` | Repositories/EnvironmentRepository.cs | No environment table |
| `EnvironmentRepository` | Repositories/EnvironmentRepository.cs | No environment table |
| `EnvironmentEndpoints` | Endpoints/EnvironmentEndpoints.cs | No environment CRUD |
| `Environment` model | Models/Environment.cs | No environment table |
| `CreateEnvironment` model | Models/Environment.cs | No environment CRUD |
| `UpdateEnvironment` model | Models/Environment.cs | No environment CRUD |

**DI Registration updates:**
| File | Change |
|------|--------|
| `ServiceCollectionExtensions.cs` | Replace `IProjectStateService, ProjectStateService` with `IProjectConfigService, ProjectConfigService`; REMOVE `IEnvironmentService, EnvironmentService` |
| `RepositoryCollectionExtensions.cs` | Replace `IProjectStateRepository, ProjectStateRepository` with `IProjectConfigRepository, ProjectConfigRepository`; REMOVE `IEnvironmentRepository, EnvironmentRepository` |
| `EndpointExtensions.cs` | Replace `MapProjectStateEndpoints()` / `MapPublicStateEndpoints()` with `MapProjectConfigEndpoints()` / `MapPublicConfigEndpoints()`; REMOVE `MapEnvironmentEndpoints()` |

**Route parameter changes (environment simplification):**
| Old Parameter | New Parameter | Type Change |
|---------------|---------------|-------------|
| `environmentId:guid` | `envSlug` (string) | GUID -> string enum |
| `projectStateId` | `projectId` (authenticated) | Semantics: was config-entry-as-project, now actual project ID |

### Cache-Control Implementation

The public config endpoint returns `Cache-Control: public, max-age={TTL}` where TTL depends on tier + environment.

**TTL Matrix:**
| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 10s | n/a | 900s (15 min) |
| Hobby | 10s | 10s | 300s (5 min) |
| Pro | 10s | 10s | 60s (1 min) |

**Implementation approach:** Set the `Cache-Control` header directly in the public endpoint handler. The handler already has access to the project slug (to look up the user's tier) and the environment slug (from route data). After the metering step resolves the project owner, the tier is available.

```csharp
// In PublicConfigEndpoints handler, after metering resolves the tier:
var ttl = GetCacheControlMaxAge(tier, environmentSlug);
context.Response.Headers.CacheControl = $"public, max-age={ttl}";
```

**Replaces current behavior:** The existing endpoint sets `Cache-Control: public, max-age=60, stale-while-revalidate=300` uniformly. The new implementation removes `stale-while-revalidate` and varies `max-age` by tier+environment.

**Remove ETag/Last-Modified headers:** Per CONTEXT.md, no ETags in v1. Remove the existing ETag and Last-Modified header logic from the public endpoint. The `OutputCache` with its 304 behavior can remain for server-side caching, but client-facing headers should only be `Cache-Control`.

### Partitioned Rate Limiting Implementation

**Decision:** Use .NET's built-in `PartitionedRateLimiter` middleware to enforce per-minute rate limits on the public config endpoint, partitioned by project slug + environment.

**Rate Limit Matrix:**
| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 60 req/min | n/a | 1000 req/min |
| Hobby | 60 req/min | 60 req/min | Unlimited |
| Pro | 60 req/min | 60 req/min | Unlimited |

**Implementation pattern:**

```csharp
// In Program.cs
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("PublicConfig", context =>
    {
        var envSlug = context.GetRouteValue("environmentSlug")?.ToString() ?? "production";
        // Tier lookup requires async DB call -- see implementation note below
        var partitionKey = $"{context.GetRouteValue("projectSlug")}:{envSlug}";

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: partitionKey,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60, // Default to strict; override per-tier in handler
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            });
    });
});

// Place after UseRouting()
app.UseRateLimiter();
```

**Critical implementation note:** The `PartitionedRateLimiter` partition factory runs synchronously and cannot do async DB lookups to determine the user's tier. Two approaches:

1. **Simple approach (recommended for v1):** Apply a single fixed-window limit per partition key (project+env), defaulting to the strictest tier (60 req/min for non-production). For production environments, use the highest limit (1000 req/min) as the partition limit, and let the existing metering system handle per-user monthly limits. This avoids async tier lookups in the rate limiter.

2. **Full approach:** Use the existing metering service (which already does async tier lookup) to enforce per-request rate limiting inline in the endpoint handler, similar to how monthly metering already works. The `MeteringService.MeterAsync` already resolves the project owner and tier -- extend it to also check per-minute limits.

**Recommendation:** Given that the existing metering service already resolves tier and enforces limits (monthly), the simplest approach is to add per-minute rate limiting INSIDE the endpoint handler, alongside the existing metering logic. This avoids the sync-vs-async mismatch of the middleware approach. The `PartitionedRateLimiter` middleware is better suited for scenarios where the partition key and limits are known without DB lookups.

**Alternative hybrid approach:** Use `PartitionedRateLimiter` middleware with a generous default (e.g., 1000 req/min per project+env partition), and apply stricter per-tier limits in the endpoint handler after the tier is resolved. This provides DDoS protection at the middleware layer while enforcing tier-specific limits in business logic.

### CLI Changes

**CLI `state` -> `config` rename:**
- Rename `commands/state.ts` to `commands/config.ts` (file rename)
- Change export from `stateCommand` to `configCommand` (new `Command('config')`)
- Update all 16 API URL references from `/projectstates/...` to `/project/.../config/...`
- The environment resolution changes: instead of resolving env slug -> env GUID via API, the CLI now passes the env slug directly in the URL

**CLI `config` -> `settings` rename:**
- Rename `commands/config.ts` to `commands/settings.ts`
- Change export from `configCommand` to `settingsCommand` (new `Command('settings')`)
- Update `commands/index.ts` imports and group labels

**CLI `envs` command simplification:**
- The `envs` command currently does full CRUD (list, create, update, delete, select)
- After environment simplification, environments are fixed per tier
- `envs list` still works but reads from a hardcoded list based on project tier, not from API
- `envs create`, `envs update`, `envs delete` are REMOVED
- `envs select` remains (sets `default_env` in config)
- The `resolveEnvironment()` function in `lib/slug-resolver.ts` changes from API lookup to local validation (is the slug one of `development`|`staging`|`production`?)

**CLI `commands/index.ts` changes:**
```typescript
// Old
import { stateCommand } from './state.js';
import { configCommand } from './config.js';
// New
import { configCommand } from './config.js';   // was state
import { settingsCommand } from './settings.js'; // was config

// Registration: rename groups
program.commandsGroup('Config:');
program.addCommand(configCommand);     // was stateCommand

program.commandsGroup('Settings:');
program.addCommand(settingsCommand);   // was configCommand
```

### SQL Query Rewrite Patterns

All queries in `ProjectStateRepository` need rewriting. The pattern is consistent:

**Before (JOIN through environment):**
```sql
SELECT ps.* FROM project_state ps
JOIN environment e ON e.environment_id = ps.environment_id
JOIN project p ON p.project_id = e.project_id
WHERE p.user_id = @userId AND ps.environment_id = @environmentId
```

**After (direct project reference):**
```sql
SELECT ps.* FROM project_state ps
JOIN project p ON p.project_id = ps.project_id
WHERE p.user_id = @userId
  AND ps.project_id = @projectId
  AND ps.environment = @environment
```

**Public endpoint query (before):**
```sql
SELECT ps.* FROM project_state ps
JOIN environment e ON e.environment_id = ps.environment_id
JOIN project p ON p.project_id = e.project_id
WHERE p.slug = @projectSlug AND e.slug = @environmentSlug
ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC LIMIT 1
```

**Public endpoint query (after):**
```sql
SELECT ps.* FROM project_state ps
JOIN project p ON p.project_id = ps.project_id
WHERE p.slug = @projectSlug AND ps.environment = @environmentSlug
ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC LIMIT 1
```

### Model Changes

```csharp
// ProjectConfig model (renamed from ProjectState)
// IMPORTANT: Keep ProjectStateId property name to match DB column project_state_id
public record ProjectConfig
{
    public Guid ProjectStateId { get; init; }  // Matches DB column project_state_id
    public Guid ProjectId { get; init; }        // NEW: direct FK to project (was via environment)
    public string Environment { get; init; } = "";  // NEW: 'development'|'staging'|'production'
    // EnvironmentId REMOVED -- no longer exists
    public int Major { get; init; }
    public int Minor { get; init; }
    public int Patch { get; init; }
    public string State { get; init; } = "";
    public string? Comment { get; init; }
    public DateTime CreatedAt { get; init; }
    public int StateSizeBytes { get; init; }

    public Version Version => new(Major, Minor, Patch);
}
```

### Service Method Signature Changes

```csharp
// Old: used Guid environmentId
public interface IProjectConfigService
{
    Task<ProjectConfig?> GetByIdAsync(Guid userId, Guid projectConfigId);
    Task<IEnumerable<ProjectConfig>> GetByEnvironmentAsync(Guid userId, Guid projectId, string environment);
    Task<ProjectConfig?> GetLatestAsync(Guid userId, Guid projectId, string environment);
    Task<ServiceResult<Guid>> CreateAsync(Guid userId, Guid projectId, string environment, CreateProjectConfig body);
    Task<ServiceResult<Guid>> RollbackAsync(Guid userId, Guid projectId, string environment, Guid targetProjectConfigId);
    Task<SlugLookupResult> GetLatestBySlugAsync(string projectSlug, string environmentSlug);
}
```

### Impact on BillingService and Other Consumers

The `BillingService` currently uses `IEnvironmentRepository` (for `GetTotalCountByUserIdAsync`). After removing the environment table:
- Environment count billing checks become trivial (environments per project are fixed by tier)
- `CheckEnvironmentLimitAsync` is no longer needed (can be removed or hardcoded)
- The `EnvironmentService.CreateAsync` call that checks environment limits is eliminated entirely

Other consumers of `IProjectStateRepository`:
- `BillingService.GetStatusAsync` calls `stateRepo.GetTotalStorageBytesAsync()` -- this query also JOINs through environment and needs rewriting
- `RetentionPrunerService` calls `stateRepo.PruneExpiredVersionsAsync()` -- also JOINs through environment

### Anti-Patterns to Avoid

- **Partial rename:** Leaving some references to "state" while others say "config" creates confusion. Complete each layer before moving on.
- **Changing DB column `project_state_id`:** The DB column stays `project_state_id`. The C# property stays `ProjectStateId`. Dapper's `MatchNamesWithUnderscores` requires this match.
- **Forgetting to update all SQL queries:** Every query in `ProjectStateRepository` JOINs through the `environment` table. ALL must be rewritten after migration. Missing even one causes runtime SQL errors (table not found).
- **Not removing `EnvironmentRepository` consumers:** `EnvironmentEndpoints`, `EnvironmentService`, `BillingService`, and `SkyStateApiFactory` (test infrastructure) all reference `IEnvironmentRepository`. All must be updated.
- **Dashboard breakage without documentation:** Dashboard will break. Document it explicitly.

## Common Pitfalls

### Pitfall 1: Dapper Column Mapping Mismatch
**What goes wrong:** Renaming `ProjectStateId` property to `ProjectConfigId` breaks Dapper mapping.
**Why it happens:** `MatchNamesWithUnderscores` maps `project_state_id` -> `ProjectStateId`, not `ProjectConfigId`.
**How to avoid:** Keep `ProjectStateId` as the C# property name. The DB table is not being renamed.
**Warning signs:** null IDs, empty result sets, NullReferenceExceptions.

### Pitfall 2: SQL Queries Referencing Dropped Environment Table
**What goes wrong:** Any SQL query that still references the `environment` table or `environment_id` column will fail at runtime after migration.
**Why it happens:** The `environment` table is dropped and `environment_id` column is removed from `project_state`.
**How to avoid:** Search ALL `.cs` files for `environment_id`, `JOIN environment`, `e.environment_id`, `e.project_id`, `e.slug`. Rewrite every occurrence. This affects `ProjectStateRepository` (8+ queries), `EnvironmentRepository` (all queries), `BillingService` (storage/count queries), and `RetentionPrunerService`.
**Warning signs:** `Npgsql.PostgresException: relation "environment" does not exist` or `column "environment_id" does not exist`.

### Pitfall 3: Created() Location Header URLs
**What goes wrong:** POST endpoints return `Results.Created($"/projectstates/{id}", ...)`. Integration tests follow the Location header.
**Why it happens:** Location headers must match GET endpoint routes.
**How to avoid:** Update Created() URI templates AND GET routes simultaneously.
**Warning signs:** 404 when following Location headers in tests.

### Pitfall 4: OutputCache Tag Mismatch
**What goes wrong:** Cache eviction references `PublicStateEndpoints.CacheTag`. Renaming the class but not updating references breaks eviction.
**How to avoid:** The compiler catches class rename issues. Verify the tag string value is consistent.
**Warning signs:** Stale public config responses after writes.

### Pitfall 5: CLI Config Command Name Collision
**What goes wrong:** Two CLI commands both named `config`.
**How to avoid:** Rename existing `config` -> `settings` BEFORE or simultaneously with `state` -> `config`.
**Warning signs:** Commander.js duplicate command error.

### Pitfall 6: Dashboard Breakage
**What goes wrong:** Dashboard calls `/projectstates/...` and `/projects/.../environments/...` URLs. Both stop working after Phase 1.
**How to avoid:** Accept temporary breakage. Dashboard state/environment management will return 404s until Phase 4.
**Warning signs:** Dashboard errors on state/environment pages.

### Pitfall 7: PartitionedRateLimiter Sync-Only Partitioning
**What goes wrong:** Trying to do async DB lookups (to get tier) inside the `PartitionedRateLimiter` factory function.
**Why it happens:** The partition factory is synchronous -- it cannot await database calls.
**How to avoid:** Either use a generous default in middleware and apply tier-specific limits in the handler, or implement per-minute rate limiting entirely in the endpoint handler alongside existing metering logic.
**Warning signs:** Compilation errors (cannot use `await` in non-async context), or blocking on `.Result` causing deadlocks.

### Pitfall 8: Environment Validation Missing
**What goes wrong:** After removing the environment table, there's no longer a DB-level validation that the environment exists for a given project.
**Why it happens:** Previously, the environment table + FK ensured the environment belonged to the project. Now it's a CHECK constraint on the string value.
**How to avoid:** Add validation in the service layer that checks: (1) the environment slug is one of the three valid values, and (2) the user's tier allows access to that environment (free tier cannot use `staging`).
**Warning signs:** Free-tier users accessing staging configs, or invalid environment strings being written.

### Pitfall 9: InMemoryDatabase Type References in Tests
**What goes wrong:** Test infrastructure stores `ConcurrentDictionary<Guid, ProjectState>` and uses `InMemoryEnvironmentRepository`.
**How to avoid:** Update `InMemoryDatabase`, remove `InMemoryEnvironmentRepository`, update `InMemoryProjectStateRepository` -> `InMemoryProjectConfigRepository`, update `SkyStateApiFactory` DI.
**Warning signs:** Compilation errors in test projects.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-minute rate limiting | Custom in-memory counter | .NET `PartitionedRateLimiter` or extend existing `MeteringService` | Built-in framework handles concurrency, window expiry, and partition cleanup |
| Environment validation | Custom middleware | CHECK constraint in DB + service-layer validation | DB constraint is the last line of defense; service layer provides friendly errors |
| Cache-Control headers | Custom response middleware | Inline header setting in endpoint handler | Only one endpoint needs it; middleware is overkill |
| DB migration | EF Core migrations | Raw SQL migration script | Project uses Dapper, not EF Core. Raw SQL is consistent with `installation.sql` |

## Code Examples

### Pattern 1: New Public Config Endpoint with Cache-Control
```csharp
// Source: Derived from existing PublicStateEndpoints.cs + CONTEXT.md decisions
public static class PublicConfigEndpoints
{
    public const string CacheTag = "public-configs";

    public static void MapPublicConfigEndpoints(this WebApplication app)
    {
        app.MapGet("/project/{projectSlug}/config/{environmentSlug}", async (
                HttpContext context, string projectSlug, string environmentSlug,
                IProjectConfigService service, IMeteringService metering) =>
            {
                // Meter the request (resolves tier, enforces monthly limit)
                var meterResult = await metering.MeterAsync(projectSlug);

                // ... existing metering logic (429, rate limit headers) ...

                // Get tier from metering for Cache-Control
                var tier = meterResult switch
                {
                    MeterResult.Ok ok => ok.Tier,  // Need to add Tier to MeterResult
                    _ => "free"
                };

                var result = await service.GetLatestBySlugAsync(projectSlug, environmentSlug);
                if (result is not SlugLookupResult.Success(var config, var lastModified))
                {
                    return result switch { /* ... error handling ... */ };
                }

                // Tier+environment Cache-Control
                var maxAge = GetMaxAge(tier, environmentSlug);
                context.Response.Headers.CacheControl = $"public, max-age={maxAge}";

                return Results.Ok(new
                {
                    version = config.Version,
                    lastModified = lastModified.ToString("O"),
                    config = JsonSerializer.Deserialize<JsonElement>(config.State)
                });
            })
            .WithTags("Public Config")
            .CacheOutput("PublicConfig")
            .AllowAnonymous()
            .RequireCors("PublicApi");
    }

    private static int GetMaxAge(string tier, string environment) => (tier, environment) switch
    {
        ("free", "development") => 10,
        ("free", "production") => 900,
        ("hobby", "development" or "staging") => 10,
        ("hobby", "production") => 300,
        ("pro", "development" or "staging") => 10,
        ("pro", "production") => 60,
        _ => 60 // default
    };
}
```

### Pattern 2: New Authenticated Endpoint Routes
```csharp
// Source: Derived from existing ProjectStateEndpoints.cs + CONTEXT.md decisions
public static class ProjectConfigEndpoints
{
    public static void MapProjectConfigEndpoints(this WebApplication app)
    {
        // Flat lookup by config entry ID
        app.MapGet("/project/config/{projectConfigId:guid}", async (Guid projectConfigId,
                ICurrentUserService currentUser, IProjectConfigService service) =>
            {
                var config = await service.GetByIdAsync(currentUser.GetUserId(), projectConfigId);
                return config is not null ? Results.Ok(config) : Results.NotFound();
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        // List configs for project+environment
        app.MapGet("/project/{projectId:guid}/config/{envSlug}", async (
                Guid projectId, string envSlug,
                ICurrentUserService currentUser, IProjectConfigService service) =>
            {
                var configs = await service.GetByEnvironmentAsync(
                    currentUser.GetUserId(), projectId, envSlug);
                return Results.Ok(configs);
            })
            .WithTags("Project Configs")
            .RequireAuthorization();

        // ... remaining endpoints follow same pattern with envSlug string
    }
}
```

### Pattern 3: Simplified SQL Query (After Environment Table Dropped)
```sql
-- GetLatestAsync (authenticated): Before
SELECT ps.* FROM project_state ps
JOIN environment e ON e.environment_id = ps.environment_id
JOIN project p ON p.project_id = e.project_id
WHERE ps.environment_id = @environmentId AND p.user_id = @userId
ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC LIMIT 1

-- GetLatestAsync (authenticated): After
SELECT ps.* FROM project_state ps
JOIN project p ON p.project_id = ps.project_id
WHERE ps.project_id = @projectId
  AND ps.environment = @environment
  AND p.user_id = @userId
ORDER BY ps.major DESC, ps.minor DESC, ps.patch DESC LIMIT 1
```

### Pattern 4: PartitionedRateLimiter Configuration
```csharp
// Source: Microsoft Learn - Rate limiting middleware in ASP.NET Core
// https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-10.0
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsync(
            "Rate limit exceeded. Try again later.", cancellationToken);
    };

    // Global rate limiter partitioned by project+env slug
    options.AddPolicy("PublicConfigRateLimit",
        context =>
        {
            var projectSlug = context.GetRouteValue("projectSlug")?.ToString() ?? "unknown";
            var envSlug = context.GetRouteValue("environmentSlug")?.ToString() ?? "unknown";
            var partitionKey = $"{projectSlug}:{envSlug}";

            // Default to strict limit; tier-specific enforcement in handler
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

// In middleware pipeline (after UseRouting)
app.UseRateLimiter();

// On the endpoint
app.MapGet("/project/{projectSlug}/config/{environmentSlug}", handler)
    .RequireRateLimiting("PublicConfigRateLimit");
```

### Pattern 5: CLI Command Rename
```typescript
// File: cli/src/commands/config.ts (renamed from state.ts)
export const configCommand = new Command('config')
  .description('Manage remote config');

configCommand
  .command('get')
  .description('Fetch the latest config as JSON')
  .action(async function () {
    // URLs changed from:
    //   `/projectstates/${projectId}/environment/${envId}/latest`
    // to:
    //   `/project/${projectId}/config/${envSlug}/latest`
    // Note: envSlug is now passed directly (no GUID resolution needed)
  });
```

### Pattern 6: Updated installation.sql (New Schema)
```sql
-- project_state table (updated -- no environment table dependency)
CREATE TABLE IF NOT EXISTS project_state
(
    project_state_id UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id       UUID        NOT NULL REFERENCES project (project_id) ON DELETE CASCADE,
    environment      TEXT        NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    major            INTEGER     NOT NULL,
    minor            INTEGER     NOT NULL,
    patch            INTEGER     NOT NULL,
    state            JSONB       NOT NULL DEFAULT '{}',
    comment          TEXT,
    created_at       TIMESTAMPTZ          DEFAULT now(),
    state_size_bytes INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (project_id, environment, major, minor, patch)
);

CREATE INDEX IF NOT EXISTS idx_project_state_project_env
  ON project_state (project_id, environment);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | xUnit (C# API), Vitest (CLI/Protocol) |
| Config file | `api/SkyState.Api.UnitTests/SkyState.Api.UnitTests.csproj`, `cli/vitest.config.ts`, `packages/protocol/vitest.config.ts` |
| Quick run command | `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/` |
| Full suite command | `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/ && cd ../cli && npm run typecheck && npm run build && cd ../packages/protocol && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | Public config read at new URL | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectConfigEndpointTests.GetPublicConfig"` | Needs URL + type rename |
| API-01 | Cache-Control headers per tier+env | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectConfigEndpointTests.GetPublicConfig_ValidSlugs"` | Needs new assertions for tier-based TTL |
| API-01 | Partitioned rate limiting | integration | New test or extend PublicStateMeteringTests | Wave 0: new test cases needed |
| API-01 | Public config metering | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "PublicConfigMeteringTests"` | Needs rename + URL update |
| API-03 | Authenticated CRUD at new URLs with envSlug | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectConfigEndpointTests"` | Needs major rewrite (envSlug vs GUID) |
| API-03 | Environment validation (tier access) | integration | New test | Wave 0: new test cases needed |
| API-03 | Authenticated CRUD E2E | e2e | `cd api && dotnet test SkyState.Api.EndToEndTests/ --filter "ProjectConfigEndpointTests"` | Needs major rewrite (new schema) |
| CLI | CLI uses new URL patterns with envSlug | build | `cd cli && npm run typecheck && npm run build` | Typecheck validates compilation |

### Sampling Rate
- **Per task commit:** `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/`
- **Per wave merge:** Full suite (unit + integration + CLI typecheck + protocol tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New integration tests for tier-based Cache-Control TTL values
- [ ] New integration tests for partitioned rate limiting (per-minute limits)
- [ ] New integration tests for environment validation (free tier cannot use staging)
- [ ] `InMemoryDatabase` / `InMemoryProjectConfigRepository` must be updated to remove environment table references
- [ ] Existing environment endpoint tests (`EnvironmentEndpointTests.cs`) will be DELETED (not updated)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Environment as DB entity with GUID | Fixed enum string (`development`/`staging`/`production`) | Phase 1 | Eliminates entire environment CRUD layer; simplifies all queries |
| Monthly rate limiting only | Monthly + per-minute partitioned rate limiting | Phase 1 | Prevents burst abuse; .NET built-in middleware |
| Uniform `max-age=60` Cache-Control | Tier+environment variable TTL | Phase 1 | Higher-paying tiers get fresher data |
| `environmentId` (GUID) in URLs | `envSlug` (string) in URLs | Phase 1 | Human-readable URLs; no GUID resolution step |

## Open Questions

1. **MeterResult needs tier information for Cache-Control**
   - What we know: The `MeteringService.MeterAsync` already resolves the project owner and loads the user (including `SubscriptionTier`). But the current `MeterResult` types do not expose the tier.
   - What's unclear: Best way to pass tier info from metering to Cache-Control header logic.
   - Recommendation: Add a `Tier` property to `MeterResult.Ok` so the endpoint handler can use it for Cache-Control without a second DB lookup. For `MeterResult.NotFound`/`MeterResult.Error`, default to "free" tier (shortest cache, most conservative).

2. **Per-minute rate limiting: middleware vs. handler**
   - What we know: `PartitionedRateLimiter` middleware cannot do async tier lookups. The existing metering runs inside the handler.
   - What's unclear: Whether to use middleware with generous defaults or implement entirely in the handler.
   - Recommendation: Use `PartitionedRateLimiter` middleware with a generous baseline (e.g., 1000 req/min per project+env for production, 60 for non-production). This provides DDoS protection without needing tier info. Tier-specific stricter limits can be layered in the handler if needed in the future.

3. **CLI `envs` command post-simplification**
   - What we know: Environment CRUD endpoints are being removed. The CLI `envs list` currently calls `GET /projects/{projectId}/environments`.
   - What's unclear: Whether to keep `envs list` as a local operation (show hardcoded envs for tier) or remove the command entirely.
   - Recommendation: Keep `envs list` and `envs select` as local operations. `envs list` shows the fixed environments for the current project's tier. `envs select` sets `default_env` in local config. Remove `envs create`, `envs update`, `envs delete`.

4. **Default environment auto-provisioning on project create**
   - What we know: Currently, when a project is created, environments are created separately. After simplification, environments are implicit.
   - What's unclear: Whether project creation should auto-insert default `project_state` rows for each environment.
   - Recommendation: No auto-insertion. When a user first pushes config to an environment, that creates the first `project_state` row. The public endpoint returns 404 for environments with no config, which is the correct behavior.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files in scope (endpoints, services, repositories, models, tests, CLI, OpenAPI, DB schema)
- `api/Database/installation.sql` -- current schema with `environment` table and FK relationships
- `api/SkyState.Api/Endpoints/ProjectStateEndpoints.cs` -- 5 authenticated routes
- `api/SkyState.Api/Endpoints/PublicStateEndpoints.cs` -- public route with metering/caching/CORS
- `api/SkyState.Api/Endpoints/EnvironmentEndpoints.cs` -- 6 CRUD routes being removed
- `api/SkyState.Api/Repositories/ProjectStateRepository.cs` -- 8+ SQL queries JOINing through environment
- `api/SkyState.Api/Repositories/EnvironmentRepository.cs` -- being removed entirely
- `api/SkyState.Api/Services/EnvironmentService.cs` -- being removed entirely
- `api/SkyState.Api/Services/MeteringService.cs` -- existing tier resolution logic
- `cli/src/commands/state.ts` -- 1100 lines, 16 API URL references
- `cli/src/commands/config.ts` -- existing config command (naming conflict)
- `cli/src/commands/envs.ts` -- environment CRUD commands being simplified
- `cli/src/lib/slug-resolver.ts` -- environment GUID resolution being simplified
- [Rate limiting middleware in ASP.NET Core | Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-10.0) -- PartitionedRateLimiter API, FixedWindowRateLimiterOptions, RequireRateLimiting

### Secondary (MEDIUM confidence)
- [Output caching middleware in ASP.NET Core | Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output?view=aspnetcore-10.0) -- OutputCache interaction with Cache-Control headers
- [GitHub Issue #62143: Add ResponseCache to Minimal Api](https://github.com/dotnet/aspnetcore/issues/62143) -- Confirms no declarative Cache-Control for minimal APIs; manual header setting is standard approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries; .NET rate limiting is built-in and verified against official docs
- Architecture: HIGH -- all code reviewed; SQL rewrite patterns verified against existing queries
- DB migration: HIGH -- straightforward ALTER/DROP; no existing production data to worry about
- Cache-Control: HIGH -- simple header setting in handler; verified that no built-in declarative approach exists for minimal APIs
- Rate limiting: MEDIUM -- `PartitionedRateLimiter` API is well-documented, but sync-only partition factory requires design decision on tier-specific limits
- Pitfalls: HIGH -- Dapper mapping, SQL JOIN removal, and environment table drop verified against actual code
- Test impact: HIGH -- all test files reviewed; significant rewrite needed for environment simplification

**Research date:** 2026-03-05
**Valid until:** No expiry for codebase-specific analysis. Rate limiting API information valid for .NET 10 (current LTS).
