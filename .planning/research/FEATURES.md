# Feature Research

**Domain:** Real-time config / feature flag React SDK (client-side)
**Researched:** 2026-03-04
**Confidence:** HIGH (LaunchDarkly, Unleash, ConfigCat, GrowthBook, OpenFeature, Firebase RC official docs cross-referenced)

---

## Context

SkyState already has a working REST read endpoint and a minimal `useSettings` hook (in `packages/typescript/react/`) that fetches config once per mount using `useState` + `useEffect`. This milestone closes the gap to a production-grade SDK by adding:

- SSE streaming for real-time push
- Shared cache + pub/sub so multiple hooks share one connection
- Granular path subscriptions so components only re-render when their slice changes
- `useSyncExternalStore` for React 18+ correctness

The baseline for comparison is what developers who have used LaunchDarkly, ConfigCat, Unleash, or GrowthBook will **expect** to be there on day one.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any serious config/flag SDK must have. Missing these causes developers to question the product's maturity.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `SkyStateProvider` wrapping component | Every major SDK (LaunchDarkly, ConfigCat, Unleash, GrowthBook) uses a Provider to hold the shared client instance. Developers assume it exists. | LOW | Holds one `SkyStateClient` instance; passes via React context. No re-render propagation — only the client reference lives here. |
| `useProjectConfig(path?)` hook | Core ergonomic surface. The whole value of a React SDK is not having to wire up fetch logic manually. Path-based access (`'features.darkMode'`, `'banner.text'`) lets components subscribe to exactly the slice they need. | MEDIUM | Must use `useSyncExternalStore` (not `useState`) per React 18 spec for concurrent-mode safety. Path resolution is dot-notation traversal of the config JSON blob. |
| Loading state exposed per hook | Every competitor returns `{ data, isLoading, error }` or equivalent. Without it, developers can't show spinners or skeleton UIs during initial fetch. | LOW | `isLoading: boolean` — true until the first config value is available (cache hit or SSE first event). |
| Default/fallback value parameter | `useProjectConfig('features.darkMode', false)` — if the path doesn't exist or the SDK hasn't loaded yet, return the fallback. This is table stakes per LaunchDarkly, ConfigCat, and GrowthBook. | LOW | Eliminates the `data?.features?.darkMode ?? false` ceremony. |
| Error state exposed per hook | Developers need to know when the SDK can't reach the server, distinguish network errors from config-not-found. The existing `useSettings` hook already does this — it must carry forward. | LOW | `error: SkyStateError | null`. On SSE disconnect after retries exhausted, set error. |
| Automatic SSE reconnection | SSE browser API (`EventSource`) reconnects automatically, but only with a 3s fixed delay. Production SDKs implement exponential backoff with jitter to avoid thundering herd. | MEDIUM | Cap at ~30s. Include jitter. Pass `Last-Event-ID` header on reconnect (SSE spec) so server can replay missed events if supported. |
| Single shared SSE connection per provider | LaunchDarkly and GrowthBook both open one streaming connection per SDK instance, not one per hook. Multiple components using `useProjectConfig` must share one `EventSource`. This is non-negotiable for performance — 10 components on a page cannot open 10 SSE connections. | MEDIUM | Implemented via pub/sub event emitter inside `SkyStateClient`. Hooks subscribe to client; client owns one `EventSource`. |
| In-memory cache with stale-while-revalidate | All production SDKs serve from cache immediately (zero-latency render), then update when the stream delivers a new value. Without this, every page load shows a loading state even when a config is known. | MEDIUM | Cache keyed by `(projectSlug, environmentSlug)`. On provider mount: serve cached value immediately, open SSE stream, update cache on each event. |
| TypeScript generics on the hook | `useProjectConfig<boolean>('features.darkMode', false)` — callers know the return type at compile time. LaunchDarkly and GrowthBook both support typed access. | LOW | Generic `T` on the hook; return type is `T | typeof fallback`. No type inference magic needed — keep it simple. |
| Cleanup on unmount | The provider must close the `EventSource` and clear subscriptions when it unmounts, or connections leak. All production SDKs handle this. | LOW | `useEffect` cleanup in `SkyStateProvider` calls `client.destroy()`. |

### Differentiators (Competitive Advantage)

Features that go beyond baseline and create a better DX or UX than competitors offer by default.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Granular path subscriptions with zero-unnecessary-rerenders | Competitors like LaunchDarkly's `useFlags()` return the full flag map — every component re-renders when any flag changes. `useProjectConfig('a.b.c')` subscribes at path level, so a component watching `banner.text` does not re-render when `features.darkMode` changes. | HIGH | `useSyncExternalStore` `getSnapshot` returns a stable reference for an unchanged path slice. Path subscription registry in the client tracks which paths are watched and only notifies affected subscribers. |
| `isStreaming` / `isConnected` connection status | Developers building status indicators ("live" badges, dev tools) want to know if the SSE connection is active or degraded. Most competitors bury this or don't expose it. | LOW | Export `useProjectConfigStatus()` hook returning `{ isConnected: boolean, lastUpdated: Date | null, error: SkyStateError | null }`. |
| `initialData` prop on provider for SSR hydration | GrowthBook's `initSync()` and DevCycle's `bootstrapConfig` exist to prevent hydration mismatches in SSR frameworks (Next.js, Remix). Without this, the first server-rendered HTML will differ from client-rendered HTML. | MEDIUM | `<SkyStateProvider initialData={...}>` — pre-loads the cache before the first render, eliminating flash-of-loading-state and hydration warnings. |
| Dot-notation path accessor with type inference from a schema type | `useProjectConfig<AppConfig>()('features.darkMode')` — if a user passes their config type, the return type is automatically inferred from the path. None of the competitors do this cleanly for arbitrary JSON config. | HIGH | Optional enhancement using TypeScript 4.1+ template literal path types. Can ship after V1 core; hard to do without breaking change later if API isn't designed for it from the start. |
| React DevTools-friendly label on the external store | `useSyncExternalStore` subscriptions are invisible in React DevTools by default. Naming the store helps debugging. | LOW | Cosmetic but appreciated by developers who use React DevTools profiler. |

### Anti-Features (Deliberately Not Building in V1)

Features that seem like natural extensions but would create scope, maintenance burden, or design baggage disproportionate to their V1 value.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Suspense support (`useSuspenseConfig`) | React Suspense for data fetching is the future, and OpenFeature ships `useSuspenseFlag`. Developers ask for it. | React's own docs warn against suspending on `useSyncExternalStore` values — mutations can't be marked as non-blocking transitions, causing visible Suspense fallback thrashing on every config update. Adds significant API surface. | Return `isLoading` from the hook. Let developers decide their own fallback UI. Defer Suspense until SSE push stabilizes and React's guidance on this pattern matures. |
| Multiple provider instances / domain scoping | OpenFeature and ConfigCat support multiple provider instances for different configs in the same app tree. | V1 has one project + one environment per provider. There is no multi-tenant use case yet, and adding provider IDs before the core pattern is proven adds complexity with no validated demand. | Single `SkyStateProvider` per tree is sufficient. Developers needing two configs can nest providers or manage multiple clients manually. |
| User targeting / context propagation | LaunchDarkly's `identify()` and Unleash's `useUnleashContext()` pass user identity to server-side flag evaluation. | SkyState V1 has no concept of end-user identity — config is project-level, not user-level. Building targeting infrastructure before the V2 per-user state feature exists creates dead code and API surface that would need to change. | Defer to V2 (`useUserState` milestone). Design the provider API so `context` can be added later without breaking the V1 hook signature. |
| Flag variants / A/B testing API | Unleash's `useVariant()` and LaunchDarkly's multivariate flags are powerful. | SkyState is a config blob, not a feature flag system. The appropriate way to do A/B testing with a blob is for the developer to read the value and branch in their own code — there's no server-side evaluation to integrate. Adding a variant API would be a category shift, not a feature. | Recommend developers read the relevant config path and implement branching themselves. |
| Offline mode toggle (`setOffline()` / `setOnline()`) | ConfigCat supports manual offline switching for testing. | The SSE stream already handles disconnection gracefully (reconnect with backoff, serve stale cache). Manual offline control is a testing convenience, not a production need. It adds API surface and state machine complexity before the core is proven. | Use `initialData` for testing with static config. Mock the `EventSource` in tests. |
| Local overrides / flag overrides | ConfigCat and Unleash support local override maps for development. | Adds a second source of truth and priority rules (LocalOnly, LocalOverRemote, RemoteOverLocal). The SkyState CLI already handles the "push a dev config" workflow — this is the correct override path. | Use a dev environment with a different config blob. No in-SDK override layer needed. |
| OpenFeature provider adapter | OpenFeature is an emerging standard that would allow SkyState to be swapped for other providers. | OpenFeature is designed for boolean/string/number feature flags, not arbitrary JSON config blobs. The `useProjectConfig('a.b.c')` path-traversal model doesn't map cleanly to OpenFeature's evaluation model. Building a lossy adapter creates confusion about what is and isn't supported. | Ship native SkyState SDK. If OpenFeature demand materializes with V2's flag-oriented features, build an adapter then. |
| Polling fallback when SSE unavailable | Some corporate environments block long-lived connections. ConfigCat's auto-polling is an explicit design choice. | For V1, the SSE stream failing should fall back to the last-known cached value, not initiate a polling loop. Polling adds a separate fetch cycle, cache-invalidation logic, and configurable intervals — tripling the surface area of the connection management layer. | Serve stale cache when SSE is disconnected. Surface `isConnected: false` to the developer. If reconnection repeatedly fails, set `error` state. Let the developer decide to trigger a manual refresh. |

---

## Feature Dependencies

```
SkyStateClient (core cache + pub/sub + SSE)
    └──required by──> SkyStateProvider
                          └──required by──> useProjectConfig(path)
                                                └──enhances──> default/fallback value
                                                └──enhances──> isLoading state
                                                └──enhances──> error state

SkyStateClient
    └──required by──> useProjectConfigStatus()

initialData prop
    └──enhances──> SkyStateProvider (SSR hydration, no dependency on hook)

granular path subscriptions
    └──requires──> SkyStateClient pub/sub with path-level subscriber registry
    └──requires──> useSyncExternalStore (not useState) in the hook

TypeScript generic path types
    └──enhances──> useProjectConfig (optional, additive)
    └──requires──> TypeScript 4.1+ template literal types (compile-time only)
```

### Dependency Notes

- **`SkyStateClient` is the load-bearing unit:** Everything else is a thin React wrapper. The client owns the `EventSource`, the in-memory cache, the pub/sub registry, and the reconnection logic. The provider just holds an instance and passes it through context.
- **`useSyncExternalStore` requires a stable snapshot function:** The `getSnapshot` function must return the same reference when the path value has not changed. This requires the cache to preserve object identity for unchanged paths, which in turn requires that updates only mutate affected paths (or produce a full new cache entry with `structuredClone` / shallow diff).
- **`initialData` is independent of streaming:** It pre-populates the cache synchronously before mount. The SSE stream then starts and will update the cache when it receives an event — even if that first event echoes the same version as `initialData`.
- **Granular path subscriptions conflict with returning the full config object:** The hook must choose one model. `useProjectConfig()` (no path) returns the full blob and re-renders on any change. `useProjectConfig('a.b')` returns a slice and only re-renders when that slice changes. Both are valid; the pub/sub must support both modes.

---

## MVP Definition

### Launch With (V1)

Minimum needed for developers to adopt the SDK in production without workarounds.

- [ ] `SkyStateClient` — in-memory cache, pub/sub event emitter, SSE `EventSource` with exponential backoff reconnection. This is the engine.
- [ ] `SkyStateProvider` — React context holder for one client instance. Accepts `projectSlug`, `environmentSlug`, `apiUrl`, and optional `initialData`.
- [ ] `useProjectConfig(path?, fallback?)` — `useSyncExternalStore`-based hook. Returns `{ value, isLoading, error }`. Path is dot-notation string or undefined (full blob).
- [ ] Loading state — `isLoading: true` until first value arrives from cache or stream.
- [ ] Error state — `error: SkyStateError | null` surfaced from SSE connection failures or HTTP errors on initial fetch.
- [ ] Default/fallback value — returned when path is missing or SDK not yet ready.
- [ ] TypeScript generics — `useProjectConfig<T>(path, fallback: T)` with typed return.
- [ ] Cleanup on unmount — provider closes SSE connection and clears subscriptions.
- [ ] Single shared SSE connection — multiple hooks share the same `EventSource` via the client.

### Add After Validation (V1.x)

Add once the core works and real developers are using it.

- [ ] `useProjectConfigStatus()` — connection status hook. Trigger: developers building "live indicator" UI or debugging disconnections.
- [ ] `initialData` / SSR hydration — Trigger: first Next.js or Remix user reports hydration mismatch. Straightforward to add without breaking hook API.
- [ ] Granular path subscriptions with zero-unnecessary-rerenders — Trigger: first report of performance issue in a component tree with many `useProjectConfig` calls. The hook API supports paths from day one; the optimization is in the pub/sub implementation.

### Future Consideration (V2+)

Defer until V2 user-state work defines the product direction.

- [ ] User context / targeting — requires V2 end-user identity model.
- [ ] TypeScript path type inference — nice DX but significant type complexity. Additive, can be layered on without breaking changes.
- [ ] OpenFeature provider adapter — defer until V2 feature-flag-oriented API is shaped.
- [ ] Suspense support — defer until React's guidance on suspending `useSyncExternalStore` values matures.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `SkyStateClient` (cache + SSE + pub/sub) | HIGH | HIGH | P1 |
| `SkyStateProvider` | HIGH | LOW | P1 |
| `useProjectConfig(path, fallback)` | HIGH | MEDIUM | P1 |
| Loading / error / value return shape | HIGH | LOW | P1 |
| SSE reconnection with exponential backoff | HIGH | MEDIUM | P1 |
| Single shared SSE connection | HIGH | MEDIUM | P1 |
| TypeScript generics | MEDIUM | LOW | P1 |
| Cleanup on unmount | HIGH | LOW | P1 |
| `initialData` for SSR hydration | MEDIUM | LOW | P2 |
| `useProjectConfigStatus()` | LOW | LOW | P2 |
| Granular path subscriptions (zero rerenders) | MEDIUM | HIGH | P2 |
| TypeScript path type inference | LOW | HIGH | P3 |
| OpenFeature adapter | LOW | MEDIUM | P3 |
| Suspense support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for V1 launch
- P2: Should have, add after V1 validates
- P3: Future consideration

---

## Competitor Feature Analysis

| Feature | LaunchDarkly | ConfigCat | Unleash | GrowthBook | Our Approach |
|---------|--------------|-----------|---------|------------|--------------|
| Provider component | `withLDProvider` / `asyncWithLDProvider` | `ConfigCatProvider` | `FlagProvider` | `GrowthBookProvider` | `SkyStateProvider` |
| Primary hook | `useFlags()` (all flags), `useFlag(key)` | `useFeatureFlag(key, default)` | `useFlag(name)`, `useVariant(name)` | `useFeatureIsOn(key)`, `useFeatureValue(key, default)` | `useProjectConfig(path?, fallback?)` |
| Real-time mechanism | SSE streaming (automatic) | Polling (auto/lazy/manual) | Polling (configurable interval) | SSE optional (`streaming: true`) | SSE streaming (always on) |
| Shared connection | Yes (one per client) | Yes (one per provider) | Yes (one per FlagProvider) | Yes (one per GrowthBook instance) | Yes (one per SkyStateClient) |
| Loading state | Via `withLDProvider` options | `isLoading` from `useFeatureFlag` | `useFlagsStatus()` | `FeaturesReady` component | `isLoading` from `useProjectConfig` |
| Default values | Yes (flag default) | Yes (explicit parameter) | No (flags are boolean) | Yes (second parameter) | Yes (second parameter) |
| TypeScript support | Yes (separate type package) | Yes (bundled) | Yes (bundled) | Yes (generic type parameter) | Yes (generic type parameter) |
| SSR / hydration | `localStorage` bootstrap | Not documented | Not documented | `initSync()`, `getPayload()` | `initialData` prop (P2) |
| Granular subscriptions | No (full flag map rerenders) | No (per-flag hook rerenders on any change) | No | No | Yes (path-level, P2 optimization) |
| Path-based JSON access | No (flat key space) | No (flat key space) | No | No | Yes — `useProjectConfig('a.b.c')` is our differentiator |

---

## Sources

- [LaunchDarkly React Web SDK Reference](https://launchdarkly.com/docs/sdk/client-side/react/react-web) — HIGH confidence, official docs
- [LaunchDarkly React Client SDK v3.9.0 API](https://launchdarkly.github.io/react-client-sdk/) — HIGH confidence, official API reference
- [ConfigCat React SDK Reference](https://configcat.com/docs/sdk-reference/react/) — HIGH confidence, official docs
- [Unleash React SDK Documentation](https://docs.getunleash.io/sdks/react) — HIGH confidence, official docs
- [GrowthBook React SDK](https://docs.growthbook.io/lib/react) — HIGH confidence, official docs
- [OpenFeature React SDK Reference](https://openfeature.dev/docs/reference/sdks/client/web/react/) — HIGH confidence, official docs
- [Firebase Remote Config Real-Time Updates](https://firebase.google.com/docs/remote-config/real-time) — HIGH confidence, official docs
- [React useSyncExternalStore Reference](https://react.dev/reference/react/useSyncExternalStore) — HIGH confidence, official React docs (note: docs warn against suspending on external store values)
- [GrowthBook SSE Streaming](https://docs.growthbook.io/lib/react) — HIGH confidence (confirmed `streaming: true` option in GrowthBook SDK)
- [DevCycle Bootstrap / SSR](https://docs.devcycle.com/sdk/server-side-sdks/node/node-bootstrapping/) — MEDIUM confidence, verified via official DevCycle docs
- Existing SkyState codebase: `packages/typescript/react/src/use-settings.ts` — HIGH confidence, direct code inspection

---

*Feature research for: SkyState React SDK (`@skystate/react`) — real-time config via SSE*
*Researched: 2026-03-04*
