---
phase: 01-api-url-restructure
plan: 03
subsystem: testing, cli, api
tags: [vitest, xunit, integration-tests, unit-tests, e2e, commander, openapi, json-schema]

# Dependency graph
requires:
  - phase: 01-api-url-restructure
    provides: "Plan 01 renamed models/repos/services; Plan 02 rewired endpoints and middleware"
provides:
  - "All API test suites updated and passing against new ProjectConfig types and URL patterns"
  - "CLI commands renamed: state->config, config->settings, with new /project/.../config/... URLs"
  - "resolveEnvironment() is now synchronous local validation (no API call)"
  - "OpenAPI spec documents /project/{slug}/config/{envSlug} public endpoint"
  - "Protocol schemas: project-config.schema.json and config-envelope.schema.json"
affects: [dashboard, cli-e2e-tests, postman-collection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed environments validated locally in CLI (development, staging, production)"
    - "CLI config command sends to /project/{id}/config/{envSlug} URLs"
    - "Protocol fixtures use project-config and config-envelope schemas"

key-files:
  created:
    - cli/src/commands/settings.ts
    - cli/test/unit/commands/settings.test.ts
    - packages/protocol/schemas/config-envelope.schema.json
    - packages/protocol/schemas/project-config.schema.json
    - api/SkyState.Api.EndToEndTests/ProjectConfigEndpointTests.cs
    - api/SkyState.Api.IntegrationTests/ProjectConfigEndpointTests.cs
    - api/SkyState.Api.IntegrationTests/PublicConfigMeteringTests.cs
  modified:
    - api/SkyState.Api.IntegrationTests/Infrastructure/InMemoryRepositories.cs
    - api/SkyState.Api.IntegrationTests/Infrastructure/SkyStateApiFactory.cs
    - api/SkyState.Api.UnitTests/BillingServiceTests.cs
    - api/SkyState.Api.UnitTests/MeteringServiceTests.cs
    - api/SkyState.Api.UnitTests/RetentionPrunerServiceTests.cs
    - api/SkyState.Api.IntegrationTests/BillingEndpointTests.cs
    - api/SkyState.Api.IntegrationTests/BillingStatusOverLimitTests.cs
    - api/SkyState.Api.EndToEndTests/CrudLifecycleTests.cs
    - api/SkyState.Api.EndToEndTests/BillingEndpointTests.cs
    - cli/src/commands/config.ts
    - cli/src/commands/envs.ts
    - cli/src/commands/index.ts
    - cli/src/lib/slug-resolver.ts
    - cli/test/unit/commands/config.test.ts
    - cli/test/unit/commands/envs.test.ts
    - cli/test/unit/lib/slug-resolver.test.ts
    - packages/protocol/openapi.json

key-decisions:
  - "resolveEnvironment changed from async API call to synchronous local validation against fixed list"
  - "envs command simplified: removed create/update/delete, list is now local showing tier availability"
  - "Protocol schemas renamed project-state->project-config and state-envelope->config-envelope"
  - "E2E BillingEndpointTests rewritten to use derived environment count assertions (deviation fix)"

patterns-established:
  - "CLI environment validation: local check against ['development', 'staging', 'production']"
  - "CLI config URLs: /project/{projectId}/config/{envSlug}/latest, /project/{projectId}/config/{envSlug}"
  - "InMemoryProjectConfigRepository: ownership via project lookup, grouping by (ProjectId, Environment)"

requirements-completed: [API-01, API-03]

# Metrics
duration: ~45min
completed: 2026-03-05
---

# Phase 01 Plan 03: Test Suite and CLI Command Alignment Summary

**All test suites (105 unit, 82 integration, E2E build) updated for ProjectConfig types and /project/.../config/... URLs; CLI commands renamed state->config and config->settings with local environment validation; OpenAPI spec and protocol schemas fully aligned**

## Performance

- **Duration:** ~45 min (across 2 sessions due to context continuation)
- **Tasks:** 4/4 completed
- **Files modified:** 45 files changed, 2857 insertions, 4521 deletions (net reduction)

## Accomplishments

- Rewrote InMemoryProjectConfigRepository (replacing InMemoryProjectStateRepository) with ownership via project lookup and grouping by (ProjectId, Environment) -- removed all environment table references
- Updated 105 unit tests (BillingService, MeteringService, RetentionPruner) and 82 integration tests to pass with new types
- Renamed E2E tests and CrudLifecycleTests to use /project/.../config/... URLs; deleted EnvironmentEndpointTests from both integration and E2E projects
- Renamed CLI: state.ts -> config.ts (configCommand), config.ts -> settings.ts (settingsCommand), with all API URLs updated
- Made resolveEnvironment() synchronous local validation -- no more API call to resolve environment slugs
- Simplified envs command: removed create/update/delete subcommands, list now shows fixed environments locally
- Updated OpenAPI spec path to /project/{projectSlug}/config/{environmentSlug} and all protocol schemas/fixtures

## Task Commits

Each task was committed atomically:

1. **Task 1: Update test infrastructure and unit tests** - `f9b82d1` (feat)
2. **Task 2: Update integration tests** - `271a4a1` (feat)
3. **Task 3: Update E2E tests** - `0ec2d08` (feat)
4. **Task 4: Rename CLI commands and update OpenAPI spec** - `a7e558d` (feat)

## Files Created/Modified

### Created (new files)
- `cli/src/commands/settings.ts` - CLI settings command (renamed from old config)
- `cli/test/unit/commands/settings.test.ts` - Tests for settings command
- `packages/protocol/schemas/config-envelope.schema.json` - Public config response envelope schema
- `packages/protocol/schemas/project-config.schema.json` - ProjectConfig entity schema
- `api/SkyState.Api.EndToEndTests/ProjectConfigEndpointTests.cs` - E2E tests for config endpoints
- `api/SkyState.Api.IntegrationTests/ProjectConfigEndpointTests.cs` - Integration tests for config CRUD
- `api/SkyState.Api.IntegrationTests/PublicConfigMeteringTests.cs` - Public config metering tests
- `packages/protocol/tests/fixtures/get-config-by-id-200.json` - Protocol fixture
- `packages/protocol/tests/fixtures/get-configs-by-environment-200.json` - Protocol fixture
- `packages/protocol/tests/fixtures/get-latest-config-200.json` - Protocol fixture
- `packages/protocol/tests/fixtures/get-public-config-*.json` - Protocol fixtures (3 files)
- `packages/protocol/tests/get-public-config-*.json` - Protocol test fixtures (3 files)

### Deleted
- `cli/src/commands/state.ts` - Replaced by config.ts
- `cli/test/unit/commands/state.test.ts` - Replaced by config.test.ts
- `packages/protocol/schemas/state-envelope.schema.json` - Replaced by config-envelope
- `packages/protocol/schemas/project-state.schema.json` - Replaced by project-config
- `packages/protocol/schemas/environment.schema.json` - No longer needed
- `api/SkyState.Api.IntegrationTests/EnvironmentEndpointTests.cs` - No environment CRUD
- `api/SkyState.Api.IntegrationTests/ProjectStateEndpointTests.cs` - Replaced by ProjectConfig
- `api/SkyState.Api.IntegrationTests/PublicStateMeteringTests.cs` - Replaced by PublicConfig
- `api/SkyState.Api.EndToEndTests/EnvironmentEndpointTests.cs` - No environment CRUD
- `api/SkyState.Api.EndToEndTests/ProjectStateEndpointTests.cs` - Replaced by ProjectConfig
- All old protocol fixtures (get-*state*, get-environment*)

### Modified
- `api/SkyState.Api.IntegrationTests/Infrastructure/InMemoryRepositories.cs` - ProjectConfig repo, removed env repo
- `api/SkyState.Api.IntegrationTests/Infrastructure/SkyStateApiFactory.cs` - DI registration updated
- `api/SkyState.Api.UnitTests/BillingServiceTests.cs` - Removed env repo dependency
- `api/SkyState.Api.UnitTests/MeteringServiceTests.cs` - MeterResult.Ok 3-param assertions
- `api/SkyState.Api.UnitTests/RetentionPrunerServiceTests.cs` - IProjectConfigRepository
- `api/SkyState.Api.IntegrationTests/BillingEndpointTests.cs` - Config repo, no env setup
- `api/SkyState.Api.IntegrationTests/BillingStatusOverLimitTests.cs` - Config repo, no env setup
- `api/SkyState.Api.EndToEndTests/CrudLifecycleTests.cs` - New URL patterns, skip env CRUD
- `api/SkyState.Api.EndToEndTests/BillingEndpointTests.cs` - Config repo, derived env counts
- `cli/src/commands/config.ts` - Remote config command (renamed from state), new URLs
- `cli/src/commands/envs.ts` - Simplified: local list, no CRUD
- `cli/src/commands/index.ts` - Updated imports and group labels
- `cli/src/lib/slug-resolver.ts` - Synchronous local environment validation
- `cli/test/unit/commands/config.test.ts` - Tests for remote config command
- `cli/test/unit/commands/envs.test.ts` - Updated for simplified envs
- `cli/test/unit/lib/slug-resolver.test.ts` - Synchronous resolveEnvironment tests
- `packages/protocol/openapi.json` - New public endpoint path and schemas

## Decisions Made

- **resolveEnvironment is synchronous local validation:** Changed from async API call (slug -> GUID) to synchronous check against fixed list `['development', 'staging', 'production']`. The slug IS the identifier now.
- **envs command simplified dramatically:** Removed create/update/delete subcommands entirely. `list` shows fixed environments locally with tier availability. `select` validates locally.
- **Protocol schemas renamed to match new terminology:** project-state -> project-config, state-envelope -> config-envelope. Environment schema removed entirely.
- **E2E BillingEndpointTests rewritten:** Deviation fix required because the file still used old CreateEnvironment/CreateProjectState models.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] E2E BillingEndpointTests.cs still used old models**
- **Found during:** Task 3 (E2E tests)
- **Issue:** BillingEndpointTests.cs used CreateEnvironment and CreateProjectState models that no longer exist after Plan 01 renames
- **Fix:** Rewrote BillingEndpointTests.cs with CreateConfigViaApi helper, new URL patterns, and derived environment count assertions
- **Files modified:** api/SkyState.Api.EndToEndTests/BillingEndpointTests.cs
- **Verification:** `dotnet build SkyState.Api.EndToEndTests/` succeeds with 0 errors
- **Committed in:** `0ec2d08` (Task 3 commit)

**2. [Rule 1 - Bug] envs test mock did not validate environment slugs**
- **Found during:** Task 4 (CLI tests)
- **Issue:** The resolveEnvironment mock in envs.test.ts always returned the slug as-is, causing the "rejects invalid environment slug" test to fail (promise resolved instead of rejecting)
- **Fix:** Updated mock to throw CliError for invalid slugs, matching real resolveEnvironment behavior
- **Files modified:** cli/test/unit/commands/envs.test.ts
- **Verification:** `npm test` passes all 122 CLI tests
- **Committed in:** `a7e558d` (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- CLI typecheck revealed cascading errors in test files after source renames (old imports, wrong argument counts for resolveEnvironment). All fixed by creating new test files matching the new source structure.
- Context continuation required between sessions due to the large number of files modified across 4 tasks (45 files total).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 01 is now complete: all 3 plans executed successfully
- All API test suites pass (105 unit, 82 integration, E2E builds)
- CLI fully functional with renamed commands and new URL patterns
- Remaining out-of-scope references: dashboard (api.ts), CLI e2e test (lifecycle.test.ts), postman collection -- these belong to future phases
- The system is ready for end-to-end testing once PostgreSQL has the new schema applied

## Self-Check: PASSED

- All 17 key created/modified files: FOUND
- All 7 deleted files: CONFIRMED DELETED
- All 4 task commits: FOUND (f9b82d1, 271a4a1, 0ec2d08, a7e558d)
- Full verification suite: 105 unit tests passed, 82 integration tests passed, E2E build 0 errors, CLI typecheck+build success, 40 protocol tests passed, 122 CLI tests passed

---
*Phase: 01-api-url-restructure*
*Completed: 2026-03-05*
