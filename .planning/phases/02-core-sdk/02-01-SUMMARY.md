---
phase: 02-core-sdk
plan: 01
subsystem: sdk
tags: [typescript, eslint, vitest, sdk, config]

# Dependency graph
requires:
  - phase: 01-api-url-restructure
    provides: "API URL pattern /project/{slug}/config/{slug} for fetchSettings"
provides:
  - "Relocated @skystate/core at packages/core/ with test/lint/build tooling"
  - "Relocated @skystate/react at packages/react/ with correct core dependency"
  - "ConfigEnvelope type with .config field matching API response shape"
  - "ConfigStoreOptions type for Plan 02/03 implementation"
  - "fetchSettings URL updated to Phase 1 pattern"
affects: [02-02, 02-03, 04-dashboard-cli]

# Tech tracking
tech-stack:
  added: [vitest, eslint, typescript-eslint, globals]
  patterns: [colocated-tests, eslint-flat-config, package-flattening]

key-files:
  created:
    - packages/core/vitest.config.ts
    - packages/core/eslint.config.js
  modified:
    - packages/core/package.json
    - packages/core/src/types.ts
    - packages/core/src/fetch-settings.ts
    - packages/core/src/index.ts

key-decisions:
  - "Added passWithNoTests to vitest config so test script passes before test files exist"
  - "Kept deprecated StateEnvelope type for backward compatibility during migration"
  - "ConfigEnvelope uses unknown (not generic T) for config field to match API response"

patterns-established:
  - "SDK package location: packages/{name}/ (flattened from packages/typescript/{name}/)"
  - "Core package tooling: vitest + eslint flat config + tsc matching CLI conventions"
  - "Colocated tests: src/**/*.test.ts pattern"

requirements-completed: [CORE-01, CORE-04]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 2 Plan 01: Package Restructure and Tooling Summary

**Relocated SDK packages to packages/{core,react}/ with vitest/eslint tooling and ConfigEnvelope/ConfigStoreOptions type contracts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T11:11:07Z
- **Completed:** 2026-03-05T11:14:34Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Relocated @skystate/core and @skystate/react from packages/typescript/ to packages/
- Set up vitest, eslint, and TypeScript tooling for core package matching CLI conventions
- Defined ConfigEnvelope type with .config field matching Phase 1 API response shape
- Defined ConfigStoreOptions type with initialConfig and clientHeader for Plan 02/03
- Updated fetchSettings URL from /state/{slug}/{slug} to /project/{slug}/config/{slug}

## Task Commits

Each task was committed atomically:

1. **Task 1: Relocate packages and update cross-references** - `da5a9b5` (refactor)
2. **Task 2: Set up tooling and define type contracts** - `c5726c6` (feat)

**Plan metadata:** `a4f5545` (docs: complete plan)

## Files Created/Modified
- `packages/core/package.json` - Added vitest, eslint, typescript-eslint devDeps and test/lint/typecheck scripts
- `packages/core/vitest.config.ts` - Vitest config with colocated test pattern
- `packages/core/eslint.config.js` - ESLint flat config matching CLI pattern
- `packages/core/src/types.ts` - ConfigEnvelope, ConfigStoreOptions, deprecated StateEnvelope
- `packages/core/src/fetch-settings.ts` - Updated URL to Phase 1 pattern
- `packages/core/src/index.ts` - Added ConfigEnvelope, ConfigStoreOptions exports
- `packages/core/src/error.ts` - Unchanged (relocated)
- `packages/react/package.json` - Relocated with correct file:../core dependency
- `packages/react/tsconfig.json` - Relocated with correct ../core project reference
- `packages/react/src/index.ts` - Relocated unchanged
- `packages/react/src/use-settings.ts` - Relocated unchanged

## Decisions Made
- Added `passWithNoTests: true` to vitest config so `npm test` passes before test files exist (Plan 02 creates them)
- Kept deprecated `StateEnvelope<T>` alongside new `ConfigEnvelope` for backward compatibility during migration
- `ConfigEnvelope.config` uses `unknown` (not generic `T`) to match raw API response; typed generics will be in ConfigStore layer

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added passWithNoTests to vitest config**
- **Found during:** Task 2 (vitest verification)
- **Issue:** vitest exits with code 1 when no test files exist, failing the test script
- **Fix:** Added `passWithNoTests: true` to vitest.config.ts
- **Files modified:** packages/core/vitest.config.ts
- **Verification:** `npx vitest run` exits with code 0
- **Committed in:** c5726c6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor config adjustment for vitest to handle no-tests-yet state. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Core package ready for TDD implementation in Plan 02 (ConfigStore with polling)
- Type contracts (ConfigEnvelope, ConfigStoreOptions) defined for Plan 02 and Plan 03
- vitest infrastructure ready for test-first development
- React package compiles and resolves @skystate/core correctly

## Self-Check: PASSED

All 10 created/modified files verified present. Both task commits (da5a9b5, c5726c6) verified in git log.

---
*Phase: 02-core-sdk*
*Completed: 2026-03-05*
