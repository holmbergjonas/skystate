# Plan: PostgreSQL Row Level Security (RLS)

## Context

SkyState enforces data isolation at the application layer — every repository method includes `WHERE user_id = @userId` (or JOINs through the ownership chain: `project` → `environment` → `project_state`). This works but offers no defense-in-depth: a single forgotten WHERE clause in a future code change could leak data across tenants. RLS moves the authorization boundary into PostgreSQL itself, so even buggy application code cannot access another user's rows.

## Approach

### Two database roles

- **`skystate_app`** — new role, RLS enforced. Used for all authenticated user-scoped queries.
- **Existing owner** (`admin` locally / `skystate` on staging) — RLS naturally bypassed (table owner). Used for webhooks, public endpoint, background services, migrations.
- Two separate connection pools via two connection strings. No `SET ROLE` gymnastics, no pool contamination risk.

### Session variable: `SET app.current_user_id`

Each user-scoped connection calls `SET app.current_user_id = '<guid>'` immediately after open, before any query. If unset or empty, the policy evaluates to `user_id = NULL` → no rows match (fail-closed). Connection returns to pool after `using` dispose; next checkout always re-sets the variable.

### Subquery-based policies (no schema denormalization)

`environment` and `project_state` lack a direct `user_id` column. Rather than denormalizing, use subquery policies:

```sql
-- environment: user owns the parent project
USING (project_id IN (
  SELECT project_id FROM project
  WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
))

-- project_state: user owns the project via environment
USING (environment_id IN (
  SELECT e.environment_id FROM environment e
  JOIN project p ON p.project_id = e.project_id
  WHERE p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
))
```

PostgreSQL optimizes these as semi-joins. For typical user cardinality (<100 projects, <1000 envs) this is fast. Avoids adding columns, backfill logic, and keeping denormalized `user_id` in sync on every INSERT.

## Key Decisions

### Tables with RLS

| Table | Has `user_id`? | Policy type |
|-------|---------------|-------------|
| `project` | Direct | Simple equality |
| `environment` | Via `project_id` | Subquery through `project` |
| `project_state` | Via `environment_id` | Subquery through `environment` → `project` |
| `invoice` | Direct | Simple equality |
| `api_request_counter` | Direct | Simple equality |
| `user` | N/A (identity) | **No RLS** |
| `webhook_event` | N/A (global) | **No RLS** |

### Admin-connection consumers

These use the owner connection (bypasses RLS):

- `UserRepository` — identity table, webhook lookups by `stripe_user_id`
- `WebhookEventRepository` — global table, no user context
- `ProjectStateRepository.GetLatestBySlugAsync` — public anonymous endpoint
- `ApiRequestCounterRepository` increment via `MeteringService` — public endpoint metering
- `RetentionPrunerService` → `UserRepository.GetAllAsync()` — iterates all users

### No `FORCE ROW LEVEL SECURITY`

Without `FORCE`, the table owner bypasses RLS automatically. This is exactly what we want: `skystate_app` gets RLS enforced, the owner role bypasses it for admin operations. No need for `BYPASSRLS` attribute.

### Fail-closed via `NULLIF`

```sql
NULLIF(current_setting('app.current_user_id', true), '')::uuid
```

If the GUC is unset/empty, `NULLIF` returns `NULL`, the cast succeeds, and `user_id = NULL` is always false. No rows leak.

## Implementation Notes

### Files to modify

| File | Change |
|------|--------|
| `api/Database/rls_migration.sql` | **New** — standalone migration (role, enable RLS, policies) |
| `api/Database/installation.sql` | Append RLS setup for fresh installs |
| `api/SkyState.Api/ConnectionStrings.cs` | Add optional `AdminConnection` property |
| `api/SkyState.Api/RlsConnection.cs` | **New** — static helper: `OpenForUserAsync()` + `GetAdmin()` |
| `api/SkyState.Api/DatabaseConnectionHelper.cs` | Build two connection strings from env vars (`DB_APP_USER`/`DB_APP_PASSWORD`) |
| `api/SkyState.Api/Program.cs` | Wire admin connection into config |
| `api/SkyState.Api/Repositories/ProjectRepository.cs` | Use RLS connections |
| `api/SkyState.Api/Repositories/EnvironmentRepository.cs` | Use RLS connections |
| `api/SkyState.Api/Repositories/ProjectStateRepository.cs` | Use RLS + admin for public endpoint |
| `api/SkyState.Api/Repositories/InvoiceRepository.cs` | Use RLS connections |
| `api/SkyState.Api/Repositories/ApiRequestCounterRepository.cs` | Use RLS + admin for metering |
| `api/SkyState.Api/Repositories/UserRepository.cs` | Use admin connection |
| `api/SkyState.Api/Repositories/WebhookEventRepository.cs` | Use admin connection |
| `docker-compose.yaml` | Two connection strings |
| `.github/workflows/workflow-test.yml` | E2E test DB setup + env vars |
| `.github/workflows/workflow-deploy.yml` | App user env vars + GCP secret |

### Repository pattern change

User-scoped repos replace:
```csharp
using var conn = GetConnection();  // implicit open
```
with:
```csharp
await using var conn = await RlsConnection.OpenForUserAsync(connectionStrings.DefaultConnection, userId);
```

Admin-only repos and methods use:
```csharp
using var conn = RlsConnection.GetAdmin(connectionStrings);
```

### Deployment sequence (zero-downtime)

1. **Apply migration SQL** — adds role, enables RLS, creates policies. Existing app still uses owner role → unaffected.
2. **Deploy application** — uses new `skystate_app` connection. RLS now enforced.
3. **Verify** — run E2E tests, check public endpoint, check webhook processing.

### Environment config

**Local (docker-compose):**
```yaml
- ConnectionStrings__DefaultConnection=Host=skystate_db;Database=skystate;Username=skystate_app;Password=skystate_app
- ConnectionStrings__AdminConnection=Host=skystate_db;Database=skystate;Username=admin;Password=admin
```

**Staging (Cloud Run):**
```
DB_APP_USER=skystate_app
DB_APP_PASSWORD=<from GCP secret: skystate-db-app-password>
DB_USER=skystate  (existing, becomes admin connection)
```

## Verification

- **Isolation test**: Two users created, user A creates project, user B queries with their `app.current_user_id` → gets 0 rows
- **Fail-closed test**: Connect as `skystate_app` without setting GUC → `SELECT * FROM project` returns 0 rows
- **Public endpoint**: `GET /state/{slug}/{slug}` still returns data (uses admin connection)
- **E2E**: Existing E2E tests pass (they authenticate and userId flows through the chain)
- **Webhook**: Stripe webhook processing works (uses admin connection)

## Open Questions

- **Performance of subquery policies at scale**: If a user has thousands of projects/environments, the subquery policies become heavier. At that point, denormalizing `user_id` onto `environment` and `project_state` would be worth the trade-off. Current scale doesn't warrant it.
- **Cloud SQL role creation**: The `skystate_app` role needs to be created on Cloud SQL. This can be done via `gcloud sql users create` as a one-time setup, or included in the migration SQL (preferred for repeatability).
