# Requirements: SkyState

**Defined:** 2026-03-04
**Core Value:** Developers can push JSON config and have all connected clients receive updates via polling, with zero infrastructure setup.

## v1 Requirements

Requirements for V1 -- Remote Config. Each maps to roadmap phases.

### API

- [x] **API-01**: Public config read endpoint serves at `GET /project/{projectSlug}/config/{environmentSlug}` (replaces `/state/{slug}/{slug}`)
- [x] **API-03**: Authenticated config CRUD endpoints serve at `/project/{projectId}/config/{environmentId}/...` (replaces `/projectstates/{id}/...`)

### Core SDK

- [x] **CORE-01**: ConfigCache stores config in memory with stable object identity for unchanged paths
- [x] **CORE-02**: PubSubEmitter provides granular key-path subscription registry with path-level notifications
- [x] **CORE-03**: HttpClient fetches config via HTTP, respects Cache-Control, re-fetches on page visibility change
- [x] **CORE-04**: ConfigStore composes cache + pub/sub + HTTP client; one instance per (apiUrl, project, env) tuple

### React SDK

- [ ] **REACT-01**: SkyStateProvider component holds one ConfigStore instance, accepts apiUrl/projectSlug/environmentSlug/initialData props
- [ ] **REACT-02**: `useProjectConfig(path?, fallback?)` hook uses `useSyncExternalStore` and returns `{ value, isLoading, error }`
- [ ] **REACT-03**: `useProjectConfigStatus()` hook returns `{ lastFetched, error }`
- [ ] **REACT-04**: Components using `useProjectConfig` only rerender when their subscribed path value changes
- [ ] **REACT-05**: `useProjectConfig<T>(path, fallback: T)` supports TypeScript generics with typed return
- [ ] **REACT-06**: SkyStateProvider accepts `initialData` prop for SSR hydration (pre-populates cache before mount)
- [ ] **REACT-07**: Provider cleanup on unmount disposes the ConfigStore and clears all subscriptions

### Dashboard

- [ ] **DASH-01**: Dashboard API client uses new `/project/{id}/config/...` endpoint patterns
- [ ] **DASH-02**: Dashboard UI renames "State" tab and labels to "Config"
- [ ] **DASH-03**: Dashboard UI copy uses "config" terminology instead of "state"

### CLI

- [ ] **CLI-01**: CLI HTTP calls use new `/project/{id}/config/...` endpoint patterns

## v2 Requirements

Deferred to V2 milestone. Tracked but not in current roadmap.

### Real-Time Streaming

- **API-02**: SSE streaming endpoint at `GET /project/{projectSlug}/config/{environmentSlug}/stream` pushes config updates as `text/event-stream`
- **API-04**: ConfigBroadcaster singleton service fans out config updates to all connected SSE clients via per-client `Channel<T>`
- **API-05**: Config writes trigger broadcast to all connected SSE clients for that project/environment
- **API-06**: SSE connections send keep-alive pings every 15-30s to prevent load balancer idle disconnects

### User State

- **USTATE-01**: User-level state API endpoints (`GET /user/state`, `PATCH /user/state`)
- **USTATE-02**: `useUserState` React hook with setter, optimistic updates, and error handling
- **USTATE-03**: JSON Patch (RFC 6902) support with custom `increment`/`decrement` operations

### Auth

- **AUTH-01**: Firebase-powered login page for end-user authentication
- **AUTH-02**: Firebase token validation against public keys

### Multi-Framework

- **FW-01**: Vanilla JS/TS core extraction from React SDK
- **FW-02**: Svelte SDK wrapping vanilla core
- **FW-03**: Vue SDK wrapping vanilla core

## Out of Scope

| Feature | Reason |
|---------|--------|
| SSE streaming (V1) | Eliminated from V1 due to costs; moved to V2 |
| Session-level state (V3) | Requires WebSocket infrastructure, multi-user concurrency |
| BYOA auth (V3) | Requires JWKS registration, multi-provider token validation |
| Non-web SDKs (Godot, Unity, Python) | Future, after web SDKs proven |
| Suspense support | React guidance on suspending useSyncExternalStore is immature |
| OpenFeature adapter | Flat key-space model doesn't map to JSON config blob traversal |
| Self-hosted deployment | Not validated demand |
| DB table rename | Internal detail; URL restructure sufficient for public-facing consistency |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 1 | Complete |
| API-03 | Phase 1 | Complete |
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| REACT-01 | Phase 3 | Pending |
| REACT-02 | Phase 3 | Pending |
| REACT-03 | Phase 3 | Pending |
| REACT-04 | Phase 3 | Pending |
| REACT-05 | Phase 3 | Pending |
| REACT-06 | Phase 3 | Pending |
| REACT-07 | Phase 3 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| CLI-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-05 after SSE elimination and phase renumbering*
