---
phase: 02-core-sdk
plan: 03
subsystem: sdk
tags: [typescript, fetch, cache-control, visibility-api, useSyncExternalStore, singleton]

# Dependency graph
requires:
  - phase: 02-core-sdk/02-01
    provides: types (ConfigEnvelope, ConfigStoreOptions, Version), SkyStateError
  - phase: 02-core-sdk/02-02
    provides: ConfigCache (structural sharing), PubSubEmitter (path-keyed subscriptions)
provides:
  - HttpClient with Cache-Control max-age scheduling and page visibility re-fetch
  - ConfigStore facade composing ConfigCache + PubSubEmitter + HttpClient
  - getOrCreateStore singleton registry deduplicating by (apiUrl, projectSlug, environmentSlug)
  - Complete @skystate/core package ready for consumption by @skystate/react
affects: [03-react-sdk]

# Tech tracking
tech-stack:
  added: []
  patterns: [facade-composition, singleton-registry, useSyncExternalStore-contract, cache-control-polling]

key-files:
  created:
    - packages/core/src/http-client.ts
    - packages/core/src/http-client.test.ts
    - packages/core/src/config-store.ts
    - packages/core/src/config-store.test.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "HttpClient uses AbortController for in-flight fetch cancellation on dispose"
  - "ConfigStore uses __status reserved path for status change notifications (isLoading, error, lastFetched)"
  - "Singleton registry key format: apiUrl|projectSlug|environmentSlug with pipe separator"
  - "initialConfig seeded as synthetic ConfigEnvelope with version 0.0.0"

patterns-established:
  - "Facade composition: ConfigStore composes ConfigCache + PubSubEmitter + HttpClient"
  - "useSyncExternalStore contract: subscribe(path, cb) returns unsubscribe, getSnapshot(path) returns stable ref"
  - "__status reserved path for meta-state subscriptions (loading, error, fetch timestamp)"

requirements-completed: [CORE-03, CORE-04]

# Metrics
duration: 8min
completed: 2026-03-05
---

# Phase 2 Plan 3: HttpClient and ConfigStore Summary

**HttpClient with Cache-Control max-age polling and ConfigStore facade composing cache + pubsub + http into useSyncExternalStore-compatible API**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-05T11:23:50Z
- **Completed:** 2026-03-05T11:31:49Z
- **Tasks:** 4 (2 TDD RED + 2 TDD GREEN, no refactor needed)
- **Files modified:** 5

## Accomplishments
- HttpClient fetches config from correct URL with X-SkyState-Client header and Cache-Control max-age scheduling
- HttpClient re-fetches on page visibility change when cache is expired, guards browser APIs for SSR/Node safety
- ConfigStore serves initialConfig immediately with isLoading=true, replaces with fetched values on success
- ConfigStore subscribe/getSnapshot are useSyncExternalStore-compatible for React integration
- getOrCreateStore singleton registry deduplicates by (apiUrl, projectSlug, environmentSlug)
- Complete @skystate/core package: 48 tests passing, TypeScript strict mode clean, ESLint zero warnings

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **HttpClient tests (RED)** - `fed07db` (test)
2. **HttpClient implementation (GREEN)** - `47da7d3` (feat)
3. **ConfigStore tests (RED)** - `d98edd7` (test)
4. **ConfigStore + index.ts exports (GREEN)** - `7909a46` (feat)

_TDD cycle: RED (failing tests) -> GREEN (implementation) for each feature_

## Files Created/Modified
- `packages/core/src/http-client.ts` - HTTP fetch with Cache-Control max-age scheduling and visibility re-fetch
- `packages/core/src/http-client.test.ts` - 11 test cases for HttpClient (URL, headers, scheduling, visibility, dispose)
- `packages/core/src/config-store.ts` - ConfigStore facade and getOrCreateStore singleton registry
- `packages/core/src/config-store.test.ts` - 15 test cases for ConfigStore (init, fetch, subscribe, dispose, singleton)
- `packages/core/src/index.ts` - Updated public exports: added ConfigStore, getOrCreateStore, HttpClient, types

## Decisions Made
- HttpClient uses AbortController for cancelling in-flight fetch on dispose, with disposed flag to ignore late callbacks
- ConfigStore uses `__status` reserved path so React hooks can subscribe to meta-state changes (isLoading, error, lastFetched)
- Singleton registry key uses pipe separator (`apiUrl|projectSlug|environmentSlug`) for deduplication
- initialConfig is wrapped in a synthetic ConfigEnvelope with version 0.0.0 and current timestamp to seed ConfigCache

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- @skystate/core package is complete with all core components: types, error, ConfigCache, PubSubEmitter, HttpClient, ConfigStore
- ConfigStore.subscribe and ConfigStore.getSnapshot match useSyncExternalStore contract exactly
- Ready for Phase 3: @skystate/react hooks (SkyStateProvider, useConfig, useConfigStatus) will wrap ConfigStore
- The `__status` reserved path enables React hooks to subscribe to loading/error state changes

## Self-Check: PASSED

All 5 created/modified files verified on disk. All 4 task commit hashes verified in git log.

---
*Phase: 02-core-sdk*
*Completed: 2026-03-05*
