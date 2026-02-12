# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Multi-tier SaaS with separate backend API, web dashboard, and CLI client. Backend follows a strict three-layer architecture (Endpoints → Services → Repositories). Frontend uses a Zustand slice-based state machine. The CLI is command-group-structured and talks directly to the REST API.

**Key Characteristics:**
- Backend is ASP.NET Core minimal APIs (not MVC controllers) — endpoints are static extension methods
- All data access goes through Dapper with raw SQL, no ORM (no EF Core)
- Frontend state is centralized in a single Zustand store composed of slices
- The public state read endpoint (`GET /state/{project}/{env}`) is unauthenticated and output-cached
- Billing enforcement is woven into service-layer operations, not middleware
- A `RetentionPrunerService` background service runs daily at 03:00 UTC to clean old state versions

## Layers

**Endpoints (API presentation layer):**
- Purpose: Receive HTTP requests, extract route/query params and body, call services, return HTTP responses
- Location: `api/SkyState.Api/Endpoints/`
- Contains: Static classes with extension methods on `WebApplication` (e.g., `MapProjectStateEndpoints`)
- Depends on: Services (`IProjectStateService`, `IBillingService`, `IMeteringService`, etc.)
- Used by: ASP.NET Core routing pipeline via `MapSkyStateEndpoints()` in `Program.cs`
- Pattern: Each endpoint file maps one resource group. Authorization is declared per-route with `.RequireAuthorization()` or `.AllowAnonymous()`.

**Services (business logic layer):**
- Purpose: Enforce business rules, billing limits, and orchestrate cross-resource operations
- Location: `api/SkyState.Api/Services/`
- Contains: Interface + class pairs (e.g., `IProjectStateService`, `ProjectStateService`). All registered as `Scoped` in DI.
- Depends on: Repositories (injected via constructor), `IBillingService` for limit checks
- Used by: Endpoints (injected via route handler parameters)
- Pattern: Methods return `ServiceResult<T>` discriminated unions (`Success`, `NotFound`, `OverLimit`, `ValidationError`). Endpoints pattern-match on these.

**Repositories (data access layer):**
- Purpose: All PostgreSQL interaction via Dapper. No business logic.
- Location: `api/SkyState.Api/Repositories/`
- Contains: Interface + class pairs. All registered as `Singleton` in DI (connection per-call pattern).
- Depends on: `ConnectionStrings` record (injected); opens `NpgsqlConnection` per query
- Used by: Services
- Pattern: Each method opens and disposes its own connection with `await using var conn = GetConnection()`. Raw SQL with `@paramName` placeholders.

**Models (domain types):**
- Purpose: Shared DTOs, domain records, and discriminated unions
- Location: `api/SkyState.Api/Models/`
- Contains: C# records for domain objects (`User`, `Project`, `Environment`, `ProjectState`) and service results (`ServiceResult<T>`, `SlugLookupResult`, `MeterResult`, `LimitResponse`)
- Pattern: Immutable `record` types. snake_case PostgreSQL columns auto-map to PascalCase C# properties via `Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true`.

**Authentication:**
- Purpose: JWT validation and test auth bypass
- Location: `api/SkyState.Api/Authentication/`
- Contains: `GitHubTokenHandler` (validates JWT HS256 tokens), `TestAuthHandler` (accepts `X-Test-GitHub-Id` header in non-production), `AuthenticationExtensions` (DI wiring)
- Pattern: `ICurrentUserService.GetUserId()` extracts the user's `Guid` from the `sub` JWT claim. Injected into endpoints that need the authenticated user.

**Background Services:**
- Purpose: Scheduled async work outside the request/response cycle
- Location: `api/SkyState.Api/BackgroundServices/`
- Contains: `RetentionPrunerService` — `BackgroundService` subclass
- Pattern: Uses `IServiceScopeFactory` to create scoped DI contexts for each pruning cycle. Runs at 03:00 UTC daily via `PeriodicTimer`.

**Dashboard Store (Zustand slices):**
- Purpose: Centralized reactive state for the React dashboard
- Location: `dashboard/src/store/`
- Contains: One slice per resource domain: `auth-slice.ts`, `projects-slice.ts`, `environments-slice.ts`, `states-slice.ts`, `billing-slice.ts`, `state-tab-slice.ts`
- Pattern: Each slice is a `SliceCreator<T>` factory function. All slices are composed into a single `useStore` via `create<StoreState>()` in `index.ts`.

**Dashboard API Client:**
- Purpose: Typed fetch wrapper for all API calls from the dashboard
- Location: `dashboard/src/lib/api.ts`
- Contains: `api` object with namespaced methods (`api.projects.list()`, `api.states.create()`, etc.)
- Pattern: Single internal `request<T>()` function handles auth headers, 401 redirect, and error classification. Sets/clears api-status reactive store on network failures.

**CLI HTTP Client:**
- Purpose: Authenticated HTTP client for CLI commands
- Location: `cli/src/lib/http-client.ts`
- Contains: `createHttpClient()` factory returning `HttpClient` interface (`get`, `post`, `put`, `del`)
- Pattern: Single retry on network/5xx errors. Supports `--verbose` curl-style request/response logging to stderr. Resolves JWT from `SKYSTATE_TOKEN` env var or `credentials.json` config file.

## Data Flow

**Authenticated State Push (CLI → API → DB):**

1. `skystate state push config.json` invoked in `cli/src/commands/state.ts`
2. CLI reads project/env slugs from config file or `--project`/`--env` flags
3. CLI calls `resolveProject()` and `resolveEnvironment()` in `slug-resolver.ts` to get UUIDs via `GET /projects` and `GET /projects/{id}/environments`
4. Fetches current latest state via `GET /projectstates/{psId}/environment/{envId}/latest`
5. Auto-detects version bump type via `detectBump()` in `diff.ts` (structural diff)
6. POSTs new state to `POST /projectstates/{psId}/environment/{envId}`
7. API endpoint (`ProjectStateEndpoints.cs`) calls `IProjectStateService.CreateAsync()`
8. Service first checks `IBillingService.CheckStorageLimitAsync()` — returns `OverLimit` if exceeded
9. Repository executes INSERT with conditional WHERE EXISTS guard (enforces ownership + prevents version conflicts)
10. Endpoint evicts the `public-states` output cache tag and appends storage warning header if >80% usage

**Public State Fetch (SDK/CLI → API → DB, no auth):**

1. `GET /state/{projectSlug}/{environmentSlug}` hits `PublicStateEndpoints.cs`
2. `IMeteringService.MeterAsync()` resolves slug → owner, increments monthly counter, returns `OverLimit` if exceeded (HTTP 429 with `Retry-After`)
3. If not rate-limited, `IProjectStateService.GetLatestBySlugAsync()` fetches latest state row
4. Response includes ETag, `Cache-Control: public, max-age=60`, and `Last-Modified` headers
5. ASP.NET Core `OutputCache` (`PublicState` policy) caches responses for 60s by project+env slug

**GitHub OAuth Login:**

1. User visits `/login` in dashboard → `LoginPage` redirects to `GET /api/auth/github`
2. API redirects to GitHub OAuth with `state` CSRF parameter
3. GitHub redirects back to `GET /api/auth/github/callback?code=...`
4. `AuthEndpoints.cs` calls `IGitHubOAuthService` which exchanges code for GitHub user info
5. `IUserService.GetOrCreateFromSsoAsync()` JIT-provisions user in `user` table on first login
6. API generates JWT (HS256, 30-min expiry) with `sub` = user UUID, redirects to dashboard with `?token=<jwt>` in URL
7. Dashboard `App.tsx` detects `?token=` in URL, calls `validateToken()`, stores token in `sessionStorage`

**State Management (Dashboard):**

1. `AppShell.tsx` bootstraps on mount: calls `api.users.getCurrent()`, `loadProjects()`, `loadBilling()`
2. Project selection triggers `selectProject(id)` in `projects-slice.ts` which clears child state and calls `loadEnvironments(id)`
3. Environment selection triggers `loadStateVersions()` in `states-slice.ts`
4. All state mutations (create, push, rollback) go through the store slices which call `api.*` methods then reload affected data

## Key Abstractions

**ServiceResult<T>:**
- Purpose: Typed discriminated union for service operation outcomes — eliminates exception-based flow control
- Examples: `api/SkyState.Api/Models/ServiceResult.cs`
- Pattern: `sealed record Success(T Value)`, `sealed record NotFound()`, `sealed record OverLimit(LimitResponse Limit)`, `sealed record ValidationError(string Message)`. Endpoints pattern-match with `switch` expression.

**SlugLookupResult:**
- Purpose: Outcome type for public state slug resolution
- Examples: `api/SkyState.Api/Models/SlugLookupResult.cs`
- Pattern: Same discriminated union style — `Success(ProjectState, DateTime)`, `NotFound`, `InvalidSlug`

**MeterResult:**
- Purpose: Outcome type for API request metering
- Examples: `api/SkyState.Api/Models/MeterResult.cs`
- Pattern: `Ok(int NewCount, int? EffectiveLimit)`, `OverLimit(int NewCount, int EffectiveLimit)`, `NotFound`, `Error`

**TierSettings / TierLimitConfig:**
- Purpose: Configuration-driven tier limits (projects, environments, storage, retention, API requests) read from `appsettings.json`
- Examples: `api/SkyState.Api/Models/TierSettings.cs`
- Pattern: `IOptions<TierSettings>` injected into `BillingService` and `MeteringService`. `boostMultiplier` multiplies all base limits for paid add-ons.

**HttpClient (CLI):**
- Purpose: Typed, retrying HTTP client for CLI commands
- Examples: `cli/src/lib/http-client.ts`
- Pattern: Factory function `createHttpClient(config)` returns interface. Test auth headers (`X-Test-GitHub-Id`) bypass JWT when `SKYSTATE_TEST_AUTH_GITHUB_ID` is set.

## Entry Points

**API:**
- Location: `api/SkyState.Api/Program.cs`
- Triggers: ASP.NET Core runtime, started by `dotnet run` or `dotnet watch`
- Responsibilities: DI registration, middleware pipeline, endpoint registration, DB connection string composition (supports Cloud Run Unix socket, ECS TCP, and local appsettings)

**Dashboard:**
- Location: `dashboard/src/main.tsx` (Vite entry), `dashboard/src/App.tsx` (root component)
- Triggers: Vite dev server or static file serve
- Responsibilities: Auth check on mount, routing between `/login` and authenticated app shell

**CLI:**
- Location: `cli/src/cli.ts`
- Triggers: `skystate` binary (Node.js shebang)
- Responsibilities: Commander.js program setup, global options (`--format`, `--quiet`, `--verbose`, `--api-url`, `--project`, `--env`), error handling with exit codes

**Background Services:**
- Location: `api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs`
- Triggers: Registered as `IHostedService` in `Program.cs`, starts with the API process
- Responsibilities: Daily pruning of expired state versions per user tier retention policy

## Error Handling

**Strategy:** Structured result types in the API backend; typed error classes in the CLI; store-level error state in the dashboard.

**API Patterns:**
- Services return `ServiceResult<T>` — endpoints map these to HTTP status codes via switch expressions
- `OverLimit` → HTTP 402 with `LimitResponse` JSON body
- `NotFound` → HTTP 404
- `ValidationError` → HTTP 400
- Stripe webhook processing errors are caught and logged but return HTTP 200 (prevents Stripe retries)
- Metering errors (`MeterResult.Error`) are non-fatal — request proceeds normally

**CLI Patterns:**
- `CliError` (in `cli/src/lib/errors.ts`) is a user-facing error with optional `hint` and custom `exitCode`
- `AuthError`, `LimitError`, `RateLimitError`, `NetworkError`, `ApiError` are typed subclasses classified in the HTTP client
- All caught and formatted in `cli/src/cli.ts` main() with colored output on TTY

**Dashboard Patterns:**
- Store slices catch errors and set `*Error` state fields (e.g., `projectsError`, `stateVersionsError`)
- `ApiError` class (`dashboard/src/lib/api-error.ts`) wraps HTTP error responses
- 401 responses automatically clear the session token and redirect to `/login`
- Network failures set `api-status` reactive store (displayed via `ServiceBanner` component)

## Cross-Cutting Concerns

**Logging:** Serilog in the API (`builder.Host.UseSerilog(...)`). Configuration-driven via `appsettings.json`. Structured logging throughout all services with contextual properties. Request logging via `UseSerilogRequestLogging()`.

**Validation:** Slug format validated with a compiled regex in `ProjectStateService`. Tier limits validated in `BillingService.Check*LimitAsync()` methods before writes. JSON validity for state payloads validated in CLI before pushing.

**Authentication:** JWT Bearer scheme (`GitHubTokenHandler`) is the default. `TestAuthHandler` activates when `EnableTestAuth=true` in non-production config and `X-Test-GitHub-Id` header is present. `ICurrentUserService` abstracts claim extraction.

**Caching:** Output cache on `GET /state/{project}/{env}` with 60s TTL, keyed by route values, tagged `public-states`. Tag-based invalidation on every state write clears the cache immediately.

**Metering:** `IMeteringService.MeterAsync()` called on every public state read. Resolves project slug → owner → tier → increments monthly counter in `api_request_counter` table. Blocks requests at `effectiveLimit * blockThresholdMultiplier`.

---

*Architecture analysis: 2026-03-04*
