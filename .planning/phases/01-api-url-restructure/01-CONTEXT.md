# Phase 1: API URL Restructure - Context

**Gathered:** 2026-03-05
**Updated:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate public and authenticated API endpoints from old URL patterns (`/state/...`, `/projectstates/...`) to the new `/project/.../config/...` pattern. Rename C# internals from `ProjectState*` to `ProjectConfig*`. Simplify environments from a configurable DB table to a fixed enum (`development`, `staging`, `production`). Add tier+environment-based Cache-Control and partitioned rate limiting to the public config endpoint. Rename CLI `state` command to `config` and existing `config` command to `settings`. No backward-compatible redirects needed (no existing users). Dashboard changes are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Architecture Shift: Remote Config (not Live Config)
- "Live Config" (real-time SSE push) is permanently out of scope due to costs
- v1 is "Remote Config" — clients fetch config via HTTP, browser caches via Cache-Control
- No SSE streaming, no ConfigBroadcaster, no EventSource
- SDK polling model: fetch on load, browser Cache-Control handles deduplication, re-fetch on page visibility change
- CDN deferred to future versions — v1 serves config directly from the API

### URL Structure
- Public read: `GET /project/{projectSlug}/config/{envSlug}` (slugs, human-readable, envSlug is `development`|`staging`|`production`)
- Authenticated CRUD: `/project/{projectId}/config/{envSlug}/...` (project GUID + environment slug, no environment GUIDs)
- No redirects from old URLs — simply replace them (no existing users)
- Old routes (`/state/...`, `/projectstates/...`) are deleted, not kept in parallel

### Environment Simplification
- Environments change from a configurable DB table to a fixed enum: `development`, `staging`, `production`
- Free tier: `development` + `production` only
- Hobby/Pro tier: `development` + `staging` + `production`
- Drop the `environment` DB table entirely
- Replace `environment_id` FK on `project_state` with a string `environment` column (`'development'`|`'staging'`|`'production'`)
- Full DB migration happens in Phase 1 — clean break
- Remove environment CRUD endpoints (create/delete/list environments) — environments are no longer user-managed

### Cache-Control (Tier + Environment)
- Public config endpoint returns `Cache-Control: public, max-age={TTL}` header
- TTL is fixed per tier + environment (not user-configurable):

| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 10s | n/a | 900s (15 min) |
| Hobby | 10s | 10s | 300s (5 min) |
| Pro | 10s | 10s | 60s (1 min) |

- Browser acts as a "free CDN" — cached responses prevent server hits until TTL expires
- No ETags in v1 — deferred to future versions

### Partitioned Rate Limiting
- Single public endpoint with .NET `PartitionedRateLimiter` that branches on `envSlug` from route data
- Rate limits per tier + environment:

| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 60 req/min (strict) | n/a | 1000 req/min (generous) |
| Hobby | 60 req/min (strict) | 60 req/min (strict) | Unlimited |
| Pro | 60 req/min (strict) | 60 req/min (strict) | Unlimited |

- Non-production environments always get strict rate limiting (testing, not serving users)
- 429 Too Many Requests on limit exceeded
- Runs as middleware — blocked requests never hit DB or business logic

### Config Write Flow
- Config writes go to PostgreSQL (same as current)
- Output cache is invalidated on write so next read gets fresh data
- No CDN push in v1

### C# Internal Naming
- Full rename: `ProjectState*` → `ProjectConfig*` across service, repository, model, and endpoint classes
- `ProjectStateService` → `ProjectConfigService`
- `ProjectStateRepository` → `ProjectConfigRepository`
- `ProjectState` model → `ProjectConfig`
- `CreateProjectState` → `CreateProjectConfig`
- `ProjectStateEndpoints` → `ProjectConfigEndpoints`
- `PublicStateEndpoints` → `PublicConfigEndpoints`
- DB table stays as `project_state` (rename explicitly out of scope per REQUIREMENTS.md)

### CLI Naming
- Rename existing `config` command (CLI settings) to `settings`: `skystate settings` — consistent with dashboard rename
- Rename `state` command to `config`: `skystate config push`, `skystate config pull`, `skystate config diff`, etc.

### Terminology Convention
| Concept | Code/URLs | User-facing (dashboard/CLI) |
|---------|-----------|----------------------------|
| V1 project config | `config` (`/config/`, `ProjectConfig`, `skystate config push`) | "Remote Config" |
| V2 user state | `user` | "User State" |
| V3 session state | `session` | "Session State" |

### OpenAPI Spec
- Update public endpoint: `GET /project/{projectSlug}/config/{envSlug}`
- Authenticated CRUD endpoints remain undocumented (internal to dashboard/CLI)

### Dashboard Timing
- Dashboard API client and store renaming deferred to Phase 4 (renumbered)
- Phase 1 is API + CLI + DB migration only

### Roadmap Impact
- Phase 2 (API Real-Time Streaming / SSE) is eliminated entirely — no SSE in v1
- Phases renumbered to 4 total:
  - Phase 1: API URL Restructure (this phase)
  - Phase 2: Core SDK (HTTP fetch + Cache-Control polling, no SSE)
  - Phase 3: React SDK (provider + hooks, polling-based)
  - Phase 4: Dashboard and CLI Alignment
- Core SDK model: fetch on load, respect Cache-Control, re-fetch on page visibility change only

### Claude's Discretion
- Exact test migration approach (update in place vs. new test files)
- Whether to rename the CLI source file (`state.ts` → `config.ts`) or just the command name
- OpenAPI spec structural changes (path update, schema rename)
- DB migration strategy (SQL migration script approach)
- Partitioned rate limiter implementation details
- Cache-Control middleware/filter implementation approach

</decisions>

<specifics>
## Specific Ideas

- Use .NET `PartitionedRateLimiter.Create<HttpContext, string>` that extracts `envSlug` from route data and applies different `FixedWindowRateLimiterOptions` per environment — no route duplication needed
- Same pattern for Cache-Control: middleware/filter reads `envSlug` from route, sets appropriate `max-age` based on tier + environment
- Dashboard tab currently labeled "Config" (settings page) already renamed to "Settings" — CLI should follow the same pattern
- "State" tab gets renamed to "Config" with subtabs in Phase 4: "Remote Config" (active in v1), "User State" (coming soon splash), "Session" (coming soon splash)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProjectStateEndpoints.cs`: 5 authenticated routes to migrate (GET single, GET list, GET latest, POST create, POST rollback)
- `PublicStateEndpoints.cs`: 1 public route with metering, caching, rate limiting, CORS — logic carries forward but needs Cache-Control + partitioned rate limiting additions
- `ProjectStateService.cs` / `ProjectStateRepository.cs`: service + repo layer with clean interfaces — rename and update route params, update environment queries from FK joins to string filters
- CLI `state.ts`: ~1100 lines, 15+ API call sites using `/projectstates/...` pattern
- CLI `config.ts`: existing CLI settings command — rename to `settings.ts`

### Established Patterns
- Minimal API endpoint registration via extension methods in `EndpointExtensions.cs`
- Dapper ORM with `MatchNamesWithUnderscores` — DB column mapping stays as-is since table isn't renamed
- Output caching (`OutputCache "PublicState"`) on public endpoint — keep and enhance with Cache-Control headers
- Rate limiting headers pattern on public endpoint — replace with partitioned rate limiter

### Integration Points
- `EndpointExtensions.cs` registers all endpoint groups — rename registration call
- `Program.cs` DI registration for service/repository interfaces — update type names, add partitioned rate limiter config
- CLI `state.ts` command registration — rename command from `state` to `config`
- CLI `config.ts` command registration — rename command from `config` to `settings`
- Integration + E2E tests reference old URL patterns — must be updated
- `packages/protocol/openapi.json` — update public endpoint path and schema names
- `api/Database/installation.sql` — drop `environment` table, alter `project_state` table
- Environment CRUD endpoints — remove entirely

</code_context>

<deferred>
## Deferred Ideas

- CDN (CloudFront/Cloudflare) in front of public config endpoint — future version optimization
- ETag support for efficient conditional polling — future version
- Strict IP-based rate limiting refinement — later optimization
- SSE real-time push — permanently out of scope for v1 due to costs, revisit in future if demand warrants
- Dashboard "Settings" tab move to rightmost position (Phase 4)
- DB table rename `project_state` → `project_config` (explicitly out of scope per REQUIREMENTS.md)

</deferred>

---

*Phase: 01-api-url-restructure*
*Context gathered: 2026-03-05*
*Context updated: 2026-03-05*
