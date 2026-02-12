# Roadmap: SkyState v1.0 -- Remote Config

## Overview

SkyState v1.0 delivers remote config with a polling-based SDK. The work flows from API surface restructure (new URL patterns), into a layered SDK (core engine with cache + pub/sub first, React wrapper second), and finishes with dashboard/CLI alignment to the new "config" terminology. Each phase delivers a verifiable capability that the next phase builds on. No SSE/real-time push in V1 -- clients fetch config via HTTP and respect Cache-Control headers.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: API URL Restructure** - Migrate public and authenticated endpoints to `/project/.../config/...` URL pattern, environment simplification, Cache-Control, rate limiting
- [ ] **Phase 2: Core SDK** - Build the @skystate/core engine: cache, pub/sub emitter, HTTP polling client, and ConfigStore composition
- [ ] **Phase 3: React SDK** - Build @skystate/react with SkyStateProvider, useProjectConfig hook, and config status hook
- [ ] **Phase 4: Dashboard and CLI Alignment** - Update dashboard and CLI to use new config endpoints and terminology

## Phase Details

### Phase 1: API URL Restructure
**Goal**: Public and authenticated config endpoints serve at the new `/project/.../config/...` URL pattern, with environment simplification (fixed enum), tier-based Cache-Control, and partitioned rate limiting
**Depends on**: Nothing (first phase)
**Requirements**: API-01, API-03
**Success Criteria** (what must be TRUE):
  1. `GET /project/{projectSlug}/config/{environmentSlug}` returns the current config JSON for that project/environment
  2. `GET /project/{projectId}/config/{envSlug}/...` authenticated CRUD endpoints work for create, read, update operations
  3. Old `/state/...` and `/projectstates/...` URL patterns are removed (no existing users, no redirects needed)
  4. Existing tests pass against the new URL structure (no regressions in config read/write)
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md -- Data layer rename (ProjectState->ProjectConfig), environment simplification, DB migration
- [x] 01-02-PLAN.md -- Endpoint layer (new URLs, Cache-Control, rate limiting, Program.cs)
- [x] 01-03-PLAN.md -- Test infrastructure, integration tests, CLI rename, OpenAPI spec

### Phase 2: Core SDK
**Goal**: The @skystate/core package provides a ConfigStore that maintains a cached copy of project config with granular path-level change notifications, fetched via HTTP polling
**Depends on**: Phase 1
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04
**Success Criteria** (what must be TRUE):
  1. ConfigStore fetches config via HTTP and keeps an in-memory cache that updates on re-fetch
  2. Subscribing to a specific key path (e.g., `features.darkMode`) only triggers the callback when that path's value changes, not on unrelated config changes
  3. ConfigStore performs an initial HTTP fetch so the first config value is available immediately
  4. ConfigStore re-fetches on page visibility change and respects Cache-Control headers from the API
  5. Object identity is stable for unchanged paths -- `Object.is(prevSnapshot, nextSnapshot)` returns true when the config has not changed
**Plans:** 3 plans

Plans:
- [x] 02-01-PLAN.md -- Package restructure, tooling setup, and type contracts
- [ ] 02-02-PLAN.md -- ConfigCache (structural sharing) and PubSubEmitter (path-level subscriptions)
- [ ] 02-03-PLAN.md -- HttpClient (fetch + Cache-Control + visibility) and ConfigStore facade

### Phase 3: React SDK
**Goal**: Developers can drop in SkyStateProvider and useProjectConfig to get type-safe config values that update on re-fetch with minimal re-renders
**Depends on**: Phase 2
**Requirements**: REACT-01, REACT-02, REACT-03, REACT-04, REACT-05, REACT-06, REACT-07
**Success Criteria** (what must be TRUE):
  1. Wrapping an app in `<SkyStateProvider apiUrl={...} projectSlug={...} environmentSlug={...}>` creates a single shared ConfigStore, and `useProjectConfig('path')` returns config values within child components
  2. `useProjectConfig(path, fallback)` returns `{ value, isLoading, error }` where `isLoading` is true until the first config is available, and `value` falls back to the provided default
  3. A component using `useProjectConfig('features.darkMode')` does NOT re-render when an unrelated config path (e.g., `features.banner`) changes
  4. `useProjectConfig<T>(path, fallback)` supports TypeScript generics so `value` is typed as `T`
  5. Unmounting the SkyStateProvider cleans up the ConfigStore and clears all subscriptions (no resource leaks)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Dashboard and CLI Alignment
**Goal**: Dashboard UI and CLI commands use the new config endpoints and "Config" terminology consistently
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02, DASH-03, CLI-01
**Success Criteria** (what must be TRUE):
  1. Dashboard API calls target `/project/{id}/config/...` endpoints (no requests to old `/projectstates/...` URLs)
  2. Dashboard tab previously labeled "State" now reads "Config", and all UI copy uses "config" instead of "state"
  3. CLI commands (`push`, `pull`, `diff`, `promote`, `rollback`) send requests to `/project/{id}/config/...` endpoints
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4
Note: Phase 4 depends on Phase 1 (not Phase 3) and could execute in parallel with Phases 2-3 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. API URL Restructure | 3/3 | Complete | 2026-03-05 |
| 2. Core SDK | 0/3 | Not started | - |
| 3. React SDK | 0/? | Not started | - |
| 4. Dashboard and CLI Alignment | 0/? | Not started | - |
