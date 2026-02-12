---
phase: 01-api-url-restructure
plan: 02
subsystem: api
tags: [csharp, aspnet, rate-limiting, cache-control, endpoints, middleware]

# Dependency graph
requires:
  - phase: 01-01
    provides: "IProjectConfigService, ProjectConfig model, MeterResult.Ok with Tier"
provides:
  - PublicConfigEndpoints at GET /project/{slug}/config/{envSlug} with tier-based Cache-Control
  - ProjectConfigEndpoints with 5 CRUD routes at /project/{id}/config/{envSlug}/... pattern
  - PartitionedRateLimiter middleware with PublicConfigRateLimit policy
  - OutputCache updated to PublicConfig policy with PublicConfigEndpoints.CacheTag
affects: [01-03, phase-02, phase-05]

# Tech tracking
tech-stack:
  added:
    - "System.Threading.RateLimiting (FixedWindowRateLimiter via ASP.NET Core built-in)"
  patterns:
    - "Tier+environment-based Cache-Control max-age via switch expression"
    - "PartitionedRateLimiter keyed by projectSlug:envSlug with environment-aware limits"
    - "Public endpoint combines monthly metering (MeterResult) with per-minute rate limiting (middleware)"

key-files:
  created:
    - api/SkyState.Api/Endpoints/PublicConfigEndpoints.cs
    - api/SkyState.Api/Endpoints/ProjectConfigEndpoints.cs
  modified:
    - api/SkyState.Api/Endpoints/EndpointExtensions.cs
    - api/SkyState.Api/Program.cs

key-decisions:
  - "Rate limiter uses FixedWindowRateLimiter (not sliding window) for predictable burst behavior and simplicity"
  - "Production rate limit set to 1000/min for all tiers in middleware; finer per-tier limits enforced by MeterResult monthly metering"
  - "Non-production environments rate limited to 60/min uniformly since they serve dev/testing traffic"
  - "Cache-Control uses only max-age (no stale-while-revalidate, no ETag) per CONTEXT.md v1 decision"

patterns-established:
  - "GetMaxAge(tier, environment) switch expression for Cache-Control TTL matrix"
  - "Rate limiter middleware pipeline order: UseRouting -> UseCors -> UseRateLimiter -> UseOutputCache -> UseAuthentication"

requirements-completed: [API-01, API-03]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 01 Plan 02: Endpoint Layer with Cache-Control, Rate Limiting, and New URL Patterns Summary

**PublicConfigEndpoints with tier-based Cache-Control and PartitionedRateLimiter, ProjectConfigEndpoints with 5 CRUD routes at /project/{id}/config/{envSlug}, old /state/ and /projectstates/ routes removed**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T07:44:12Z
- **Completed:** 2026-03-05T07:47:12Z
- **Tasks:** 2
- **Files modified:** 7 (2 created, 2 modified, 3 deleted)

## Accomplishments
- Created PublicConfigEndpoints at GET /project/{slug}/config/{envSlug} with tier+environment-based Cache-Control headers (10s-900s range)
- Created ProjectConfigEndpoints with 5 CRUD routes using new URL pattern with envSlug string parameter
- Added PartitionedRateLimiter middleware with PublicConfigRateLimit policy (1000/min production, 60/min non-production)
- Updated OutputCache policy from PublicState to PublicConfig referencing new CacheTag
- Removed all old endpoint files (PublicStateEndpoints, ProjectStateEndpoints, EnvironmentEndpoints)
- Updated EndpointExtensions to register new endpoint groups
- Middleware pipeline correctly ordered: Routing -> CORS -> RateLimiter -> OutputCache -> Authentication -> Authorization

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PublicConfigEndpoints and ProjectConfigEndpoints with new URLs** - `1b92af2` (feat)
2. **Task 2: Configure PartitionedRateLimiter and update OutputCache in Program.cs** - `14ff50d` (feat)

## Files Created/Modified
- `api/SkyState.Api/Endpoints/PublicConfigEndpoints.cs` - Public config read endpoint with tier-based Cache-Control, rate limit headers, RequireRateLimiting
- `api/SkyState.Api/Endpoints/ProjectConfigEndpoints.cs` - Authenticated CRUD endpoints at new /project/{id}/config/{envSlug} URLs
- `api/SkyState.Api/Endpoints/EndpointExtensions.cs` - Registers MapProjectConfigEndpoints and MapPublicConfigEndpoints (removed old registrations)
- `api/SkyState.Api/Program.cs` - AddRateLimiter with PublicConfigRateLimit policy, OutputCache renamed to PublicConfig, UseRateLimiter in pipeline

**Deleted files:**
- `api/SkyState.Api/Endpoints/PublicStateEndpoints.cs`
- `api/SkyState.Api/Endpoints/ProjectStateEndpoints.cs`
- `api/SkyState.Api/Endpoints/EnvironmentEndpoints.cs`

## Decisions Made
- Rate limiter uses FixedWindowRateLimiter (not sliding window) for predictable burst behavior and simplicity.
- Production rate limit set to 1000/min for all tiers in middleware; finer per-tier limits enforced at the application layer by MeterResult monthly metering.
- Non-production environments rate limited to 60/min uniformly since they serve dev/testing traffic only.
- Cache-Control uses only public max-age (no stale-while-revalidate, no ETag) per CONTEXT.md v1 decision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing usings for rate limiter compilation**
- **Found during:** Task 2 (Program.cs rate limiter configuration)
- **Issue:** `StatusCodes`, `WriteAsync`, and `GetRouteValue` required `Microsoft.AspNetCore.Http` and `Microsoft.AspNetCore.Routing` usings not specified in plan
- **Fix:** Added `using Microsoft.AspNetCore.Http;` and `using Microsoft.AspNetCore.Routing;` to Program.cs; removed unnecessary `using Microsoft.AspNetCore.RateLimiting;`
- **Files modified:** api/SkyState.Api/Program.cs
- **Verification:** Build succeeds with 0 errors, 0 warnings
- **Committed in:** 14ff50d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for compilation. The plan's code snippets were illustrative; actual using requirements depend on the target framework's global usings. No scope creep.

## Issues Encountered
- Task 1 build verification could not pass independently because Program.cs still referenced deleted `PublicStateEndpoints.CacheTag`. This was expected and resolved in Task 2 as planned.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All endpoint layer changes complete with new URL patterns, Cache-Control, and rate limiting
- SkyState.Api project compiles cleanly with 0 errors, 0 warnings
- Ready for Plan 03 (test updates) which will update unit, integration, and E2E tests for new endpoints
- Dashboard and CLI will need updates in Phase 5 to use new URL patterns

## Self-Check: PASSED

All created files verified present. All commits verified in git log. All deleted files confirmed removed.

---
*Phase: 01-api-url-restructure*
*Completed: 2026-03-05*
