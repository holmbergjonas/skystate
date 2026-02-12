# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**Stripe field naming inconsistency (`stripe_user_id` vs `stripe_customer_id`):**
- Issue: The database column is named `stripe_user_id` but the concept is a Stripe Customer ID. The C# model exposes `StripeUserId`, but helper methods like `SetStripeCustomerIdAsync` and `GetByStripeCustomerIdAsync` use the term "customer". A TODO comment acknowledges this: `// TODO Is stripe_user_id called stripe_customer_id? Then maybe rename it here to be consistent`
- Files: `api/SkyState.Api/Models/User.cs`, `api/SkyState.Api/Repositories/UserRepository.cs`, `api/SkyState.Api/Services/StripeService.cs:59`
- Impact: Cognitive overhead for anyone working in billing code; any future rename is a schema migration plus application rename.
- Fix approach: Rename `stripe_user_id` → `stripe_customer_id` in DB via migration, update model and all usages.

**Tier order hardcoded in `StripeService` as a static dictionary:**
- Issue: `TierOrder` dictionary (`free=0, hobby=1, pro=2`) exists as a static in `StripeService` with a TODO: `// TODO Replace with index in the appsettings or something`. The tier ranking logic is not derived from the `TierSettings` configuration, so adding a new tier requires code changes in multiple places.
- Files: `api/SkyState.Api/Services/StripeService.cs:33-39`
- Impact: Adding a new subscription tier requires changes to `StripeService`, `BillingService`, and the tier settings config — a brittle triple-update.
- Fix approach: Add a `TierOrder` property to `TierLimitConfig` in `appsettings.json`, derive ordering from there.

**CLI token page is inline HTML in endpoint code:**
- Issue: The CLI OAuth token display page is an inline HTML string inside `AuthEndpoints.cs`. A TODO acknowledges this: `// TODO maybe redirect to styled login page instead`. It is hardcoded styles and layout mixed with endpoint logic.
- Files: `api/SkyState.Api/Endpoints/AuthEndpoints.cs:41-78`
- Impact: Any UI change requires a C# build and redeploy. Cannot be updated by frontend developers without touching the backend.
- Fix approach: Move the CLI token page to a static file or a dedicated Razor view, or redirect to a dashboard route that accepts the token as a query parameter.

**Manual migration management — no migration framework:**
- Issue: Schema migrations are hand-managed in `api/Database/migrations.sql` as idempotent `ALTER TABLE IF NOT EXISTS` statements. There is no Flyway, DbUp, EF migrations, or similar tooling. The lifecycle comment says "once all environments are current, remove the migration" — leaving no historical record.
- Files: `api/Database/migrations.sql`, `api/Database/installation.sql`
- Impact: Easy to forget to apply migrations to all environments; no audit trail of when migrations ran; drift between environments goes undetected until runtime errors occur.
- Fix approach: Adopt DbUp or a similar .NET migration library; version migrations; add CI step to verify schema is current before deployment.

**`GetAllAsync` loads entire user table for retention pruning:**
- Issue: `RetentionPrunerService` calls `userRepo.GetAllAsync()` which executes `SELECT * FROM "user"` with no filtering or pagination. The entire user table is loaded into memory on every nightly pruning run.
- Files: `api/SkyState.Api/Repositories/UserRepository.cs:230-234`, `api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs:54`
- Impact: Memory pressure grows linearly with users. At thousands of users this becomes a significant allocation per day. The 100ms sleep between users also means the cycle can take many minutes.
- Fix approach: Add cursor-based or keyset pagination to `GetAllAsync`; process users in batches of e.g. 100 at a time.

**State version history returned without pagination:**
- Issue: `GetByEnvironmentIdAsync` in `ProjectStateRepository` returns all version history for an environment with no LIMIT, and `GetByEnvironmentIdAsync` in `IProjectStateRepository` returns `IEnumerable<ProjectState>`. The state blob itself is included in every row.
- Files: `api/SkyState.Api/Repositories/ProjectStateRepository.cs:65-85`
- Impact: An environment with thousands of state versions (common for active projects) returns everything in one query, including all state JSON. Both memory and network payload grow unbounded.
- Fix approach: Add pagination (limit/offset or keyset), exclude the `state` JSONB column from version history listings.

**`GetAllPriceIsStripeInterest` price IDs embedded in application config:**
- Issue: Stripe price IDs (`HobbyPriceId`, `ProPriceId`, `BoostPriceId`) are stored in `appsettings.json` / environment variables. The comment in `StripeService.cs:46` questions why SkyState maintains prices at all. This means test vs. staging vs. production each needs its own Stripe product/price IDs managed separately.
- Files: `api/SkyState.Api/Services/StripeService.cs:46`, `api/SkyState.Api/Models/StripeSettings.cs`
- Impact: Config drift between environments; Stripe product changes require deployment.
- Fix approach: Document why price IDs are stored here (they are required for upgrade/downgrade logic). Ensure consistency via CI environment validation.

## Known Bugs

**Rollback race condition acknowledged in comment:**
- Symptoms: Concurrent rollback operations could produce duplicate or conflicting version numbers.
- Files: `api/SkyState.Api/Repositories/ProjectStateRepository.cs:137`
- Trigger: Two concurrent rollback requests to the same environment.
- Note: The comment reads `// Not safe from race-conditions?`. The CTE logic reads the latest version and computes the new version number in a single statement, but there is no advisory lock or `FOR UPDATE` on the latest version query, so two concurrent rollbacks could compute the same target version.
- Workaround: Single Cloud Run instance limits (but does not eliminate) concurrent request exposure.

**`GetCurrentPeriodEnd` reads `RawJObject` as a Stripe SDK workaround:**
- Symptoms: If Stripe.NET library updates change the raw JSON serialization, subscription period tracking breaks silently.
- Files: `api/SkyState.Api/Services/StripeService.cs:598-612`
- Cause: Stripe.NET v50+ removed the typed `CurrentPeriodEnd` property. The code falls back to `subscription.RawJObject?["current_period_end"]` and parses a Unix timestamp manually.
- Workaround: The fallback handles both integer and Date JSON token types. Risk is Stripe changing the field name or format.

## Security Considerations

**CORS policy uses `AllowAnyOrigin()`:**
- Risk: The `PublicApi` CORS policy allows requests from any origin with any method and any header. This is intentional for the public state endpoint (SDK embeds), but the same policy is applied API-wide including authenticated management endpoints.
- Files: `api/SkyState.Api/Program.cs:27-35`
- Current mitigation: All management endpoints require `Authorization: Bearer` JWT. CORS bypass doesn't help an attacker without a valid token.
- Recommendations: Split CORS policy into `PublicApi` (wildcard, for `/state/*`) and `DashboardApi` (locked to dashboard origin, for authenticated endpoints). This follows the principle of least privilege.

**No PostgreSQL Row Level Security (RLS):**
- Risk: Data isolation is enforced only at the application layer. Every repository method must include `WHERE user_id = @userId` (or the equivalent join chain). A single missing `WHERE` clause in a future code change would leak data across tenants with no database-layer safety net.
- Files: All files in `api/SkyState.Api/Repositories/`
- Current mitigation: Consistent use of `userId` parameter in all queries; integration tests verify authorization boundaries.
- Recommendations: A full RLS implementation plan exists at `docs/plans/99-row-level-security.md`. Apply it to enforce isolation at the database level.

**No global exception middleware — stack traces can leak:**
- Risk: Unhandled exceptions propagate as raw .NET 500 responses which may include exception messages. There is no `GlobalExceptionMiddleware` to sanitize error output.
- Files: `api/SkyState.Api/Program.cs` (absent), multiple endpoint files use `_ => Results.StatusCode(500)` as a catch-all.
- Current mitigation: Exception details are usually in structured log output only; ASP.NET Core default developer exception page is off in non-Development environments.
- Recommendations: Add a global exception middleware that catches all unhandled exceptions and returns structured `{"error":"internal_error","message":"..."}` JSON. A full plan exists at `docs/plans/8-tiered-error-handling-strategy.md`.

**`TestAuthHandler` bypasses all auth via HTTP header:**
- Risk: If `EnableTestAuth=true` is accidentally set in a non-Development environment, any request with `X-Test-GitHub-Id` header will authenticate as any user.
- Files: `api/SkyState.Api/Authentication/AuthenticationExtensions.cs:21-22`, `api/SkyState.Api/Authentication/TestAuthHandler.cs`
- Current mitigation: Guard is `!environment.IsProduction() && configuration.GetValue<bool>("EnableTestAuth")` — requires both a non-production environment AND explicit config flag.
- Recommendations: Consider additional protection such as an IP allowlist or requiring a secret header value (not just the presence of `X-Test-GitHub-Id`) when test auth is enabled.

**State payload has no per-request size limit:**
- Risk: A user can POST arbitrarily large JSON as their state payload in a single request. The only enforcement is the cumulative storage limit, checked after the write succeeds.
- Files: `api/SkyState.Api/Endpoints/ProjectStateEndpoints.cs:44-70`, `api/SkyState.Api/Models/ProjectState.cs`
- Current mitigation: Storage limit enforcement blocks new writes once cumulative threshold is exceeded. PostgreSQL JSONB has a practical limit of ~1GB per row but no application-level per-write cap.
- Recommendations: Add a per-request body size limit (e.g., 1MB) in the endpoint or via `[RequestSizeLimit]`. Validate state string length before DB insert.

**In-memory OAuth state and token cache doesn't work with multiple instances:**
- Risk: OAuth `state` parameter validation and GitHub token caching use `IMemoryCache` (in-process). With multiple API instances, a user whose browser is redirected to instance A but whose callback lands on instance B will get `invalid_state` errors.
- Files: `api/SkyState.Api/Services/GitHubOAuthService.cs:35-44`, `api/SkyState.Api/Authentication/GitHubTokenHandler.cs:50-63`
- Current mitigation: Cloud Run (GCP) runs a single instance by default. AWS ECS `DesiredCount=1` similarly.
- Recommendations: Replace `IMemoryCache` with a distributed cache (Redis or PostgreSQL-backed) for OAuth state and token validation cache before scaling to multiple instances.

## Performance Bottlenecks

**`GetByEnvironmentIdAsync` returns all state versions including JSONB blobs:**
- Problem: The version history query (`SELECT ps.*`) returns the full `state` JSONB column for every historical version. A project that has been pushed 1000 times returns 1000 state blobs in one query.
- Files: `api/SkyState.Api/Repositories/ProjectStateRepository.cs:65-85`
- Cause: No column projection in the history query; no pagination.
- Improvement path: Project out the `state` column from history queries (only include `project_state_id`, `major`, `minor`, `patch`, `comment`, `created_at`, `state_size_bytes`). Add LIMIT/OFFSET or cursor pagination.

**`project_state` table has no index on `environment_id` or `created_at`:**
- Problem: Queries that look up state history, prune by date, or compute storage totals join `project_state` via `environment_id`. There is no standalone index on `project_state.environment_id` or `project_state.created_at`.
- Files: `api/Database/installation.sql`
- Cause: Only the UNIQUE constraint on `(environment_id, major, minor, patch)` exists, which PostgreSQL turns into a unique index. Queries filtering only by `environment_id` or `created_at` cannot use this index efficiently.
- Improvement path: Add `CREATE INDEX IF NOT EXISTS idx_project_state_env ON project_state (environment_id, major DESC, minor DESC, patch DESC)` and `CREATE INDEX IF NOT EXISTS idx_project_state_created ON project_state (created_at)` for pruning queries.

**Retention pruner processes users sequentially with a 100ms sleep between each:**
- Problem: `RetentionPrunerService` iterates users one at a time with `await Task.Delay(100ms)` between each. At 1000 users, one pruning cycle takes ~100 seconds minimum.
- Files: `api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs:103`
- Cause: The throttle is intentional to avoid DB overload, but sequential processing doesn't scale.
- Improvement path: Process users in configurable batches with parallelism (e.g., `Task.WhenAll` over groups of 10). Add `PruneExpiredVersionsAsync` as a batch SQL operation filtering by retention tier rather than per-user.

**`BillingService.GetStatusAsync` executes 4 parallel queries on every billing status request:**
- Problem: Every `GET /billing/status` call runs 4 database queries in parallel (project count, environment count, storage bytes, API request count). The dashboard polls billing status on load and after every mutation.
- Files: `api/SkyState.Api/Services/BillingService.cs:51-55`
- Cause: No caching on billing status; each call is fully live.
- Improvement path: Add short-lived caching (30–60 seconds) for billing status per user, or combine the 4 queries into a single SQL query with aggregates.

## Fragile Areas

**`StripeService.cs` at 876 lines handles all billing orchestration:**
- Files: `api/SkyState.Api/Services/StripeService.cs`
- Why fragile: Single file contains checkout session creation, boost management, tier changes, portal session creation, all webhook event handlers, and Stripe API retry logic. Any billing feature change touches this file. The webhook handler has nested try/catch with silent error recording that makes failure paths hard to trace.
- Safe modification: Read all handler methods before changing any; run full webhook integration test suite after any change; ensure `TryRecordEventAsync` idempotency check is not removed.
- Test coverage: `api/SkyState.Api.UnitTests/StripeServiceTests.cs` and `api/SkyState.Api.IntegrationTests/WebhookEndpointTests.cs` exist but webhook handler paths have limited coverage for error branches.

**`SettingsTab.tsx` at 830 lines manages all project/environment settings:**
- Files: `dashboard/src/features/settings/SettingsTab.tsx`
- Why fragile: Contains 15+ `useState` hooks, inline CRUD for projects and environments, retention settings, and Stripe portal redirect in one component. Changing one section can break another because all state is co-mingled.
- Safe modification: Extract each settings section (project details, environments list, retention) into separate sub-components before adding new features to this file.
- Test coverage: `dashboard/test/unit/features/settings/SettingsTab.test.tsx` exists but only covers a subset of interactions.

**`cli/src/commands/state.ts` at 1100 lines:**
- Files: `cli/src/commands/state.ts`
- Why fragile: All state CLI commands (get, push, promote, rollback, edit, diff, versions, rollback) live in one file. The `requireProjectAndEnv` helper and output formatting are inline. Editor command spawning (for `state edit`) includes temp-file management that is brittle if the spawned process crashes.
- Safe modification: Extract `requireProjectAndEnv` to a shared helper (it is duplicated across other command files). Use try/finally to ensure temp-file cleanup in the edit command.

**Dashboard has no React Error Boundary:**
- Files: `dashboard/src/App.tsx`
- Why fragile: A JavaScript runtime error in any component (e.g., unexpected null in state, failed JSON parse) causes a blank white screen with no recovery mechanism.
- Safe modification: Wrap the `<Routes>` tree in an `ErrorBoundary` class component as described in `docs/plans/8-tiered-error-handling-strategy.md`.
- Test coverage: None — no test for crash recovery.

**OAuth state validated via in-memory cache only:**
- Files: `api/SkyState.Api/Services/GitHubOAuthService.cs:47-59`
- Why fragile: `ValidateState` removes the state key immediately after one successful validation. If the callback is called twice (e.g., browser back button), the second attempt always fails. Under horizontal scaling, state keys from one instance are not visible to others.
- Safe modification: Do not change this code without simultaneously adding distributed cache support.

## Scaling Limits

**API request counter is per-month per user:**
- Current capacity: `api_request_counter` table uses `(user_id, counter_year, counter_month)` PK. One row per user per month. `IncrementAsync` does a PostgreSQL `INSERT ... ON CONFLICT ... UPDATE` with an atomic increment.
- Limit: At high write rates (many users hitting the public endpoint simultaneously), counter updates for the same user can create hot-row contention on that single row.
- Scaling path: Use PostgreSQL advisory locks per user, or move to a dedicated counter store (Redis `INCR`).

**Single-instance deployment assumed for in-memory state:**
- Current capacity: Works correctly with one API instance.
- Limit: OAuth CSRF state (`IMemoryCache`) and GitHub token cache are not shared. Running two instances causes intermittent login failures and increases GitHub API calls (no shared token cache).
- Scaling path: Replace `IMemoryCache` with a Redis or PostgreSQL-backed distributed cache before enabling autoscaling.

## Dependencies at Risk

**Stripe.NET RawJObject workaround for `current_period_end`:**
- Risk: Stripe.NET v50+ removed `Subscription.CurrentPeriodEnd` as a typed property. The code reads `subscription.RawJObject?["current_period_end"]` directly. If Stripe.NET changes internal JSON representation or field name, subscription period tracking breaks silently.
- Files: `api/SkyState.Api/Services/StripeService.cs:598-612`
- Impact: `current_period_end` stored in DB would stop being updated; users would see stale billing period information.
- Migration plan: Upgrade Stripe.NET and check if the typed property is re-introduced; alternatively, use the Stripe API directly to fetch subscription details.

## Missing Critical Features

**No global exception middleware:**
- Problem: Unhandled exceptions bubble up as raw .NET 500 responses with potentially unstructured bodies. Several endpoint catch-all arms return bare `Results.StatusCode(500)` with no JSON body.
- Blocks: Consistent error handling in CLI (which tries to parse JSON from all error responses) and dashboard (which shows `res.statusText` on failures).
- Files: Multiple endpoints in `api/SkyState.Api/Endpoints/` use `_ => Results.StatusCode(500)`.

**Health endpoint does not check database connectivity:**
- Problem: `GET /health` returns the static string `"ok"` regardless of database state. Cloud Run health checks use this endpoint; it will pass even when the DB is down.
- Blocks: Load balancer cannot distinguish a healthy instance from one with a broken DB connection. The dashboard's `ServiceBanner` cannot distinguish API offline from DB offline.
- Files: `api/SkyState.Api/Endpoints/HealthEndpoint.cs`

**No toast notification system in dashboard:**
- Problem: The dashboard has no global notification mechanism. Errors are shown inline within each feature or silently swallowed. Silent failures give no user feedback.
- Blocks: Usability during partial failures; cannot implement the tiered error strategy described in `docs/plans/8-tiered-error-handling-strategy.md`.
- Files: `dashboard/src/App.tsx`, all store slices.

**No React Error Boundary:**
- Problem: Any unhandled render-time exception produces a blank white screen.
- Blocks: Users cannot recover from JavaScript errors without a hard reload.
- Files: `dashboard/src/App.tsx`

## Test Coverage Gaps

**State write race condition (concurrent pushes to same environment):**
- What's not tested: Two simultaneous `POST /projectstates/{id}/environment/{envId}` requests with the same version number.
- Files: `api/SkyState.Api/Repositories/ProjectStateRepository.cs:87-130`
- Risk: The `NOT EXISTS (SELECT 1 FROM project_state WHERE (major, minor, patch) >= ...)` guard in SQL prevents duplicate versions, but the behavior when both requests conflict (empty result vs. error) is not verified.
- Priority: Medium

**Stripe webhook duplicate event handling:**
- What's not tested: The `TryRecordEventAsync` idempotency check is tested for basic scenarios but concurrent duplicate webhooks arriving at exactly the same time are not tested.
- Files: `api/SkyState.Api.IntegrationTests/WebhookEndpointTests.cs`
- Risk: Concurrent Stripe retries could trigger duplicate subscription updates if the DB `UNIQUE` constraint race is not properly handled.
- Priority: High

**Downgrade scheduled via `SubscriptionSchedule` is not integration-tested:**
- What's not tested: The Stripe `ChangeTierAsync` downgrade path creates a `SubscriptionSchedule`. This path is not exercised in any integration or unit test.
- Files: `api/SkyState.Api/Services/StripeService.cs:313-337`, `api/SkyState.Api.UnitTests/StripeServiceTests.cs`
- Risk: Downgrade could silently fail or produce unexpected Stripe API errors in production.
- Priority: High

**CLI `state edit` command (temp file + editor spawn):**
- What's not tested: The editor-based state editing flow is not covered by any CLI test. Temp file cleanup on crash is not verified.
- Files: `cli/src/commands/state.ts` (edit command section)
- Risk: Editor crash or signal interrupt could leave temp files on disk with state content.
- Priority: Low

**Dashboard error states for all store actions:**
- What's not tested: Error states in Zustand store slices (e.g., `billingError`, `projectsError`) are set but no test verifies the dashboard renders an appropriate error message when they are populated.
- Files: `dashboard/src/store/billing-slice.ts`, `dashboard/src/store/projects-slice.ts`
- Risk: Silent failures show broken loading states rather than actionable error messages.
- Priority: Medium

---

*Concerns audit: 2026-03-04*
