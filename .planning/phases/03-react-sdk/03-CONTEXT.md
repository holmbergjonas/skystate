# Phase 3: React SDK - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `@skystate/react` with `SkyStateProvider`, `useProjectConfig` hook, `useProjectConfigStatus` hook, and strict env validation (CORE-05). Developers can drop in the Provider and hooks to get type-safe config values that update on re-fetch with minimal re-renders. No SSE, no real-time push — polling-based via the ConfigStore built in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Package public API
- Single entry point: everything from `@skystate/react` — Provider, hooks, re-exported core types (ConfigEnvelope, SkyStateError)
- No re-export of ConfigStore or getOrCreateStore — hooks only, advanced users install `@skystate/core` directly
- Minimal export surface — no SkyStateProviderProps or internal types exported. Fewer exports = fewer contracts to maintain
- `@skystate/core` is a regular dependency (not peer) — `npm install @skystate/react` is all consumers need

### Old API cleanup
- Delete `useSettings` hook entirely — no existing users, clean slate
- Delete all old re-exports (StateEnvelope, SkyStateConfig, fetchSettings types) — clean break, new API surface only

### Testing utilities
- Ship `MockSkyStateProvider` at subpath export `@skystate/react/test`
- Accepts static config object, serves it immediately (isLoading=false, error=null)
- Static config only for v1 — loading/error simulation deferred to future version
- Subpath export keeps test code out of production bundles

### Error surfacing model
- Invalid `env` string → throw at render time (React ErrorBoundary catches it). Invalid env is a developer bug, not a runtime condition. Fail loud and early. Matches CORE-05 spec.
- `useProjectConfig` outside Provider → throw with helpful message: "useProjectConfig must be used within a SkyStateProvider"
- Runtime fetch errors (network, 500s) → silent, error field only. No automatic console.warn. Consumer decides how to handle.

### Claude's Discretion
- Internal Context implementation (createContext, Provider component structure)
- useSyncExternalStore integration details (subscribe/getSnapshot wiring)
- TypeScript generic implementation for `useProjectConfig<T>`
- File structure within `packages/react/src/`
- Test file organization and testing patterns

</decisions>

<specifics>
## Specific Ideas

- Import pattern for consumers: `import { SkyStateProvider, useProjectConfig, useProjectConfigStatus, SkyStateError } from '@skystate/react'`
- Test utility import: `import { MockSkyStateProvider } from '@skystate/react/test'`
- MockSkyStateProvider API: `<MockSkyStateProvider config={{ features: { dark: true } }}><MyComponent /></MockSkyStateProvider>`

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigStore` (`packages/core/src/config-store.ts`): Already exposes `subscribe(path, cb)` + `getSnapshot(path)` — directly compatible with `useSyncExternalStore`
- `getOrCreateStore()`: Singleton registry keyed by `apiUrl|projectSlug|environmentSlug` — Provider calls this internally
- `ConfigStore.isLoading`, `.error`, `.lastFetched`: Status getters ready for `useProjectConfigStatus` hook
- `STATUS_PATH` (`__status`): Reserved path that fires on any status change — status hook subscribes here
- `SkyStateError` (`packages/core/src/error.ts`): Error class with code + status — re-export from react package

### Established Patterns
- ESM modules with TypeScript strict mode
- `tsc` for building (no bundler in core package — react should match)
- Package `exports` field for entry points (main + `/test` subpath)
- Peer dependency on React (standard pattern for React libraries)

### Integration Points
- Provider wraps `getOrCreateStore(options)` — creates ConfigStore on mount, disposes on unmount
- `useProjectConfig(path, fallback)` uses `useSyncExternalStore(store.subscribe.bind(store, path), () => store.getSnapshot(path))`
- `useProjectConfigStatus()` subscribes to `__status` path, reads `store.isLoading`, `store.error`, `store.lastFetched`
- CORE-05 (strict env validation) must be added to `getOrCreateStore` in core before Provider can rely on it

</code_context>

<deferred>
## Deferred Ideas

- MockSkyStateProvider with loading/error state simulation — future version
- Re-exporting ConfigStore/getOrCreateStore from react package — reconsider if user demand
- Exported prop types (SkyStateProviderProps) — add if consumers request it
- console.warn on fetch errors — add if silent errors prove hard to debug

</deferred>

---

*Phase: 03-react-sdk*
*Context gathered: 2026-03-05*
