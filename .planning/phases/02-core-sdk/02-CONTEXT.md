# Phase 2: Core SDK - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the `@skystate/core` package: ConfigCache with stable object identity, PubSubEmitter with granular key-path subscriptions, HttpClient that fetches config via HTTP with Cache-Control respect and visibility-change re-fetch, and ConfigStore that composes all three. One ConfigStore instance per (apiUrl, project, env) tuple. This phase also restructures the SDK folder layout and updates the existing code to use the new `/project/.../config/...` URL pattern from Phase 1.

</domain>

<decisions>
## Implementation Decisions

### Stale Data Behavior
- When a re-fetch fails after initial load, **keep serving cached config** but **surface the error** in the hook return (`{ value, isLoading, error }`)
- Every subscriber (React component using `useProjectConfig`) gets the error signal alongside the cached value — no separate "opt-in" error channel
- No aggressive retry on fetch failure — avoid thundering herd on a struggling API
- Visibility change still triggers re-fetch as normal
- Cache-Control expiry triggers the next natural re-fetch
- Conservative retry policy: Claude's discretion on whether a single delayed retry makes sense, but default is no retry

### Initial Load Failure & Fallback Chain
- SDK accepts `initialState` (from a local `skystate.config.json` file) as a constructor/provider option
- `skystate.config.json` is created by CLI: `skystate config pull --env <environment>` fetches a snapshot and saves it locally — developer commits it to their repo
- The pull command requires an environment argument (snapshot is environment-specific)
- On app load: SDK serves `initialState` immediately with `isLoading: true`, starts HTTP fetch in background
- If fetch succeeds: live config replaces `initialState`, `isLoading: false`
- If fetch fails: `initialState` stays as current value, `error` is populated, `isLoading: false`
- If no `initialState` and fetch fails: pure error state, no config available
- **Fallback chain for a specific key** (e.g., `useProjectConfig('features.darkMode', false)`):
  1. Live fetched value (if available)
  2. Key from `initialState` / `skystate.config.json` (if key exists there)
  3. In-code fallback value (`false` in this example)
  4. If none of the above → `undefined` + error

### Config Freshness Metadata
- Core tracks `lastFetched: Date | null` — timestamp of last successful 200 response
- Core tracks `error: Error | null` — last fetch error (if any)
- These feed into `useProjectConfigStatus()` hook in Phase 3 (REACT-03): `{ lastFetched, error }`
- No `isStale` flag or connection state machine — keep it simple
- No manual `refetch()` method — only automatic triggers (visibility change, Cache-Control expiry)

### Client Telemetry Header
- Core HttpClient attaches `X-SkyState-Client` header on every request
- Format: `@skystate/core/0.1.0` (npm package name + version)
- When React SDK wraps core, header becomes: `@skystate/react/0.1.0 (@skystate/core/0.1.0)` — full chain
- Backend accepts the header silently in V1 — no logging, no enforcement (deferred to V2)
- Core must allow the wrapper SDK to override/extend the header value

### Package Folder Restructure
- Flatten `packages/typescript/core/` → `packages/core/`
- Flatten `packages/typescript/react/` → `packages/react/`
- Remove the `packages/typescript/` nesting (V1 is TypeScript-only; non-TS SDKs would be `packages/godot/` etc.)
- This restructure is the **first task** of Phase 2, before building the new engine
- `packages/protocol/` stays where it is

### Claude's Discretion
- Internal architecture of ConfigCache, PubSubEmitter, HttpClient composition
- Path resolution implementation (dot-notation traversal of config JSON)
- Object identity stability mechanism (structural sharing, snapshots, etc.)
- Whether to include a single delayed retry on fetch failure (conservative default: no)
- Test structure and tooling choices
- Whether existing `fetchSettings` function is refactored or replaced

</decisions>

<specifics>
## Specific Ideas

- "We should support having a default state in the client as a file, created when initializing the project" — the `skystate.config.json` fallback pattern
- CLI `skystate config pull --env production` creates the snapshot file — this is partially implemented already (Phase 1 renamed `state pull` → `config pull`), the JSON file output format may need Phase 4 work
- Full telemetry chain `@skystate/react/0.1.0 (@skystate/core/0.1.0)` — most informative for future deprecation decisions
- Spec §8 mandates `useSyncExternalStore` for React hooks (Phase 3), so the core pub/sub must expose `subscribe` + `getSnapshot` compatible interfaces

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SkyStateError` class (`packages/typescript/core/src/error.ts`): error with code + status — keep and extend
- `SkyStateConfig` type (`packages/typescript/core/src/types.ts`): `{ apiUrl, projectSlug, environmentSlug }` — extend with `initialState` option
- `StateEnvelope<T>` type: `{ version, lastModified, state }` — keep as the API response shape
- `fetchSettings` function: basic HTTP fetch — needs URL update from `/state/...` to `/project/.../config/...` and header injection

### Established Patterns
- ESM modules with TypeScript strict mode
- `tsc` for building (no bundler in core package)
- Package exports via `exports` field in package.json
- Peer dependency pattern: `@skystate/react` depends on `@skystate/core`

### Integration Points
- `@skystate/react` imports from `@skystate/core` — will need to consume ConfigStore instead of raw `fetchSettings`
- React hook currently uses `useState` + `useEffect` — Phase 3 will replace with `useSyncExternalStore` consuming core's pub/sub
- URL pattern must match Phase 1 output: `GET /project/{projectSlug}/config/{envSlug}`
- `packages/protocol/openapi.json` defines the response shape the SDK must parse

</code_context>

<deferred>
## Deferred Ideas

- CLI `skystate config pull --env <env>` saving to `skystate.config.json` file format — may need Phase 4 CLI work beyond what Phase 1 already provides
- Backend logging of `X-SkyState-Client` header — V2 scope (passive telemetry)
- Backend enforcement of minimum client version (`426 Upgrade Required`) — V2 scope
- Manual `refetch()` method on ConfigStore — not needed for V1 remote config use case
- ETag support for conditional requests — deferred per Phase 1 decisions
- Non-TypeScript SDKs (Godot, Unity, Python) — future `packages/<platform>/` directories

</deferred>

---

*Phase: 02-core-sdk*
*Context gathered: 2026-03-05*
