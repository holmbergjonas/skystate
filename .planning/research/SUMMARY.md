# Project Research Summary

**Project:** SkyState v1.0 Live Config
**Domain:** SSE streaming + React SDK (real-time config push — additive milestone on existing SaaS)
**Researched:** 2026-03-04
**Confidence:** HIGH

## Executive Summary

SkyState's v1.0 Live Config milestone extends an existing, working SaaS product by adding real-time config push via Server-Sent Events and a production-grade React SDK. The implementation pattern is well-understood: a singleton `ConfigBroadcaster` on the API side fans events out to per-client `Channel<T>` queues, which feed `TypedResults.ServerSentEvents` streams; on the SDK side, a `ConfigStore` composes an `EventSource` wrapper, an in-memory cache, and a `Set`-based pub/sub emitter into the exact shape that `useSyncExternalStore` requires. Crucially, no new packages are needed on either side — every primitive is built into .NET 10 and React 19.

The benchmark for this SDK is LaunchDarkly, ConfigCat, Unleash, and GrowthBook. Developers who have used those products arrive with specific expectations: a `Provider` component, a `useProjectConfig` hook that accepts a dot-notation path and a fallback, `{ value, isLoading, error }` return shape, typed generics, automatic reconnection, and a single shared SSE connection per provider. The competitive differentiator SkyState can deliver from day one that none of those competitors offer is path-granular subscriptions — `useProjectConfig('features.darkMode')` subscribes at the path level, so components only re-render when their specific slice changes.

The primary risks are operational, not architectural: Cloud Run's default 5-minute request timeout silently kills SSE connections; ASP.NET Core's response buffering prevents events from reaching clients if `TypedResults.ServerSentEvents` is not used correctly; and the `useSyncExternalStore` `getSnapshot` contract is easy to violate, producing infinite re-render loops. There is also a structural migration risk: renaming `project_state` to `project_config` in the DB must use a transactional rename-plus-view-shim pattern to survive the rolling deploy window. All of these pitfalls are well-documented and have clear prevention strategies — none require rethinking the architecture.

---

## Key Findings

### Recommended Stack

The existing stack (C# .NET 10, PostgreSQL 17, React 19, TypeScript 5.9, Vite 7, Zustand 5, Commander.js 14) is unchanged. This milestone adds zero new packages.

**Core technologies:**
- `TypedResults.ServerSentEvents` (.NET 10 built-in): SSE streaming endpoint — native Minimal API integration, handles flushing automatically, accepts `IAsyncEnumerable<SseItem<T>>`
- `System.Threading.Channels` (.NET 10 built-in): Per-client async message queue for fan-out — `Channel.CreateBounded<T>` with `DropOldest` back-pressure policy
- `System.Net.ServerSentEvents` (.NET 10 built-in): `SseItem<T>` type for event ID and `Last-Event-ID` replay
- Native browser `EventSource` (no polyfill): 96% global support, Baseline widely available since July 2022 — zero bundle weight
- `useSyncExternalStore` (React 19 built-in): The only correct hook for subscribing to external stores in concurrent React — prevents tearing
- Hand-rolled `ConfigCache` + `PubSubEmitter` (~40 lines of TypeScript): A plain `Set<() => void>` of listener callbacks is the exact shape `useSyncExternalStore` requires; no library adds value here

**What NOT to use:** SignalR (over-engineered for unidirectional push), WebSockets (deferred to V2), `event-source-polyfill` (unnecessary), `useState + useEffect` for SSE subscriptions (unsafe in concurrent React), a single shared `Channel<T>` for broadcasting (delivers each event to only one reader — silent data loss).

See `.planning/research/STACK.md` for full rationale and alternatives considered.

### Expected Features

The `SkyStateClient` is the load-bearing unit. Everything else is a thin React wrapper over it.

**Must have (table stakes — V1 launch):**
- `SkyStateClient` — in-memory cache, pub/sub emitter, `EventSource` with exponential backoff reconnection; the engine for everything
- `SkyStateProvider` — React context holder for one `ConfigStore` instance; prevents duplicate SSE connections per project/env
- `useProjectConfig(path?, fallback?)` — `useSyncExternalStore`-based hook; returns `{ value, isLoading, error }` with dot-notation path support
- Loading state (`isLoading: boolean`) — true until first cache hit or SSE event
- Error state (`error: SkyStateError | null`) — surfaced on SSE failures; required by all competitor SDKs
- Default/fallback value parameter — eliminates `data?.features?.darkMode ?? false` ceremony at call sites
- Automatic SSE reconnection with exponential backoff and jitter — cap at 30s; pass `Last-Event-ID` on reconnect
- Single shared SSE connection per provider — multiple hooks share one `EventSource` via pub/sub
- TypeScript generics (`useProjectConfig<T>`) — typed return without inference magic
- Cleanup on unmount — provider calls `client.destroy()` in `useEffect` cleanup

**Should have (V1.x — add after validation):**
- `useProjectConfigStatus()` — connection status hook (`{ isConnected, lastUpdated, error }`) for dev tools and status indicators
- `initialData` prop for SSR hydration — prevents hydration mismatch in Next.js/Remix; straightforward to add without breaking hook API
- Granular path subscriptions with zero unnecessary re-renders — the hook API supports paths from day one; the pub/sub optimization ships when a performance complaint arrives

**Defer (V2+):**
- User context / targeting — requires V2 end-user identity model
- TypeScript path type inference (template literal types) — additive, can layer on later without breaking changes
- OpenFeature provider adapter — V2 scope when feature-flag API is shaped
- Suspense support — React's own docs warn against suspending on `useSyncExternalStore` values

**Anti-features (deliberately excluded):** Polling fallback, offline mode toggle, local override maps, flag variants/A-B testing API, multiple provider instances. Each of these either adds dead-code infrastructure for features not yet designed, duplicates the CLI workflow, or represents a category shift SkyState is not making in V1.

See `.planning/research/FEATURES.md` for competitor feature matrix and full rationale.

### Architecture Approach

The architecture has two cleanly separated halves that share only a data contract (`ConfigSseEvent`). The API side uses the `ConfigBroadcaster` singleton as a fan-out hub: each connecting SSE client gets its own `Channel<ConfigSseEvent>`, write endpoints call `Broadcast`, and `TypedResults.ServerSentEvents` consumes each client's `ChannelReader`. The SDK side uses `ConfigStore` (composes `SseClient + ConfigCache + PubSubEmitter`) as the external store, with `SkyStateProvider` creating/destroying one store per provider mount, and `useProjectConfig` calling `useSyncExternalStore` against it.

**Major components:**
1. `ConfigBroadcaster` (API, singleton) — `ConcurrentDictionary<Guid, Subscription>` fan-out; `Subscribe`/`Unsubscribe`/`Broadcast`; does not touch the DB
2. `PublicConfigEndpoints` (API) — SSE stream endpoint (no `CacheOutput`) + REST read (with 60s `OutputCache`); both under the same `/project/{slug}/config/{slug}` route prefix
3. `ProjectConfigService` (API) — writes config, evicts `OutputCache` by tag, then calls `broadcaster.Broadcast` — same two-step pattern already used in `ProjectStateEndpoints.cs`
4. `ConfigStore` (`@skystate/core`) — composes `SseClient + ConfigCache + PubSubEmitter`; exposes `subscribe`/`getSnapshot`/`getServerSnapshot`/`destroy`; singleton per `(apiUrl, projectSlug, envSlug)` tuple
5. `SkyStateProvider` (`@skystate/react`) — React context; creates `ConfigStore` in `useRef`, destroys in `useEffect` cleanup
6. `useProjectConfig` (`@skystate/react`) — calls `useSyncExternalStore` with stable `subscribe`/`getSnapshot` references; extracts path value via dot-notation traversal

**Build order dictated by dependency graph:** API `ConfigBroadcaster` first (no SDK dependencies), then API endpoints (adds `Broadcast` call and SSE route), then SDK `types`/`SseClient`/`ConfigCache`/`PubSubEmitter`, then `ConfigStore`, then `SkyStateProvider`, then `useProjectConfig`. Steps 1–2 and steps 4–6 can be parallelized.

See `.planning/research/ARCHITECTURE.md` for code examples, data flow diagrams, and anti-patterns.

### Critical Pitfalls

1. **Cloud Run 5-minute timeout kills SSE connections** — Set `--timeout 3600` in Cloud Run service config before first SSE deployment. Symptoms: clients reconnecting exactly on 5-minute cycles; 504 errors on `/stream` in Cloud Run logs. This is invisible in local Kestrel development.

2. **`useSyncExternalStore` `getSnapshot` returning new objects causes infinite re-render loop** — Cache the last snapshot reference and return it unchanged when the version has not changed. `Object.is(prev, next) === false` on every call means perpetual re-renders. This crashes with "Maximum update depth exceeded". Must be caught by unit tests with `StrictMode` enabled.

3. **DB table rename without view shim breaks API during rolling deploy** — `ALTER TABLE project_state RENAME TO project_config` + `CREATE VIEW project_state AS SELECT * FROM project_config` must run in a single transaction. Old instances continue working via the view; drop the view after all instances have rolled. A naked rename causes a 5-minute outage window.

4. **ASP.NET Core response buffering — no events reach client** — `TypedResults.ServerSentEvents` handles flushing automatically in .NET 10. If using manual response writes, `FlushAsync` after every event is mandatory. Also set `X-Accel-Buffering: no` response header to disable nginx-level buffering upstream.

5. **Missing `CancellationToken` on SSE loop — ghost connections and memory leak** — Always pass `HttpContext.RequestAborted` to the SSE loop. Wrap `OperationCanceledException` as expected behavior, not a 500 error. Ghost loops accumulate under sustained load and cause memory pressure that only a Cloud Run instance restart resolves.

6. **`subscribe` function defined inline in hook — constant resubscription tears down EventSource** — Stable `subscribe`/`getSnapshot` pairs must be defined outside the hook body (or memoized with `useCallback`). An unstable `subscribe` reference causes React to unsubscribe and resubscribe on every render, effectively reconnecting the SSE connection on every re-render.

7. **URL restructure breaking existing CLI and SDK consumers** — Add HTTP 301 redirects from old URL patterns before removing them. Audit `openapi.json` and CLI source for all references. Keep redirects for at least one minor version cycle.

See `.planning/research/PITFALLS.md` for full pitfall list, phase mapping, recovery strategies, and a "Looks Done But Isn't" verification checklist.

---

## Implications for Roadmap

The architecture research's build order is the natural phase structure. API work can start without touching the SDK; SDK core can be built and tested without a live API (mock the SSE endpoint). The DB migration is a gate that must happen before any API rename — it is a separate, atomic step.

### Phase 1: DB Migration — Rename `project_state` to `project_config`

**Rationale:** The DB rename is a blocking prerequisite for all subsequent API code changes. It must land first and use the transactional rename-plus-view-shim pattern (Pitfall 8) to survive rolling deploys. All later phases depend on the new table name.

**Delivers:** Schema aligned with v1.0 naming; backward-compatible view shim active; zero downtime during the deploy.

**Addresses:** Terminology consistency across DB, API, SDK, and docs.

**Avoids:** Pitfall 8 (DB rename mid-deploy outage). Requires the view shim; the view stays until Phase 2 API code is fully deployed.

**Research flag:** Standard pattern — PostgreSQL transactional DDL is well-documented. No additional research needed.

---

### Phase 2: API — URL Restructure, Endpoint Rename, and Cache Eviction Wiring

**Rationale:** Rename existing `PublicStateEndpoints` → `PublicConfigEndpoints` and `ProjectStateEndpoints` → `ProjectConfigEndpoints`, update URL segments from `/state/` to `/config/`, and add the `OutputCache` tag-eviction call on writes. This is pure refactoring — no new SSE infrastructure yet — and must land before Phase 3 to avoid conflicts. After this phase deploys and all instances roll, the view shim from Phase 1 can be dropped.

**Delivers:** Clean URL surface (`/project/{slug}/config/{slug}`), correct cache-eviction wiring on writes, HTTP 301 redirects from old URLs (Pitfall 9), view shim dropped.

**Addresses:** URL restructure for public SDK; consistent naming across API surface.

**Avoids:** Pitfall 9 (breaking existing SDK/CLI consumers during URL rename).

**Research flag:** Standard refactoring — no additional research needed.

---

### Phase 3: API — `ConfigBroadcaster` Singleton and SSE Stream Endpoint

**Rationale:** This is the core new API work. Add `ConfigBroadcaster` (singleton, DI-registered), add the SSE stream endpoint (`GET /project/{slug}/config/{slug}/stream`), and wire `broadcaster.Broadcast` into the write endpoint. Must be deployed with Cloud Run timeout set to 3600s and HTTP/2 confirmed end-to-end before shipping.

**Delivers:** Live SSE push — any config write is immediately delivered to all connected SDK clients for that project/env; no polling required.

**Uses:** `TypedResults.ServerSentEvents`, `System.Threading.Channels`, `CancellationToken` (Pitfalls 1, 2, 4).

**Implements:** `ConfigBroadcaster`, `PublicConfigEndpoints` SSE route, write-endpoint `Broadcast` call.

**Avoids:** Pitfall 1 (Cloud Run timeout), Pitfall 2 (response buffering), Pitfall 4 (ghost connections), Pitfall 3 (proxy buffering via headers), Pitfall 10 (HTTP/1.1 connection limit — verified via HTTP/2 check).

**Research flag:** Well-documented with multiple high-confidence sources. The "Looks Done But Isn't" checklist in PITFALLS.md is the verification list for this phase.

---

### Phase 4: SDK Core — `SseClient`, `ConfigCache`, `PubSubEmitter`, `ConfigStore`

**Rationale:** Build the load-bearing SDK engine independent of React. This can be unit-tested without a live API by pointing `SseClient` at a local mock or using a `MessageEvent` test harness. All React SDK work in Phase 5 depends on this being correct.

**Delivers:** `@skystate/core` updated with `SseClient` (EventSource wrapper with exponential backoff reconnection), `ConfigCache` (stable snapshot with version counter), `PubSubEmitter` (plain `Set<Listener>`), and `ConfigStore` (composes all three into `useSyncExternalStore`-compatible shape).

**Uses:** Native `EventSource`, zero new npm packages.

**Implements:** Architecture components 4 from the major components list.

**Avoids:** Pitfall 5 (`getSnapshot` new-object loop — version counter in cache), Pitfall 6 (stable `subscribe` reference), Anti-Pattern 3 (one EventSource per hook).

**Research flag:** Well-documented. Unit tests with `StrictMode` catch `getSnapshot` stability violations before they reach production.

---

### Phase 5: React SDK — `SkyStateProvider`, `useProjectConfig`, and Cleanup

**Rationale:** Thin React wrapper over the `ConfigStore` from Phase 4. Implement `SkyStateProvider` (creates/destroys store per lifecycle), `useProjectConfig` with `useSyncExternalStore`, and migrate the existing `useSettings` stub to the new pattern. Validate in StrictMode to surface double-mount behavior (Pitfall 7) before shipping.

**Delivers:** `@skystate/react` production-grade SDK — `SkyStateProvider`, `useProjectConfig(path?, fallback?)` with `{ value, isLoading, error }`, TypeScript generics, cleanup on unmount, single shared SSE connection per provider.

**Uses:** `useSyncExternalStore` (React 19 built-in), zero new npm packages.

**Implements:** Architecture components 5 and 6, all P1 features from FEATURES.md.

**Avoids:** Pitfall 5 (stable snapshot), Pitfall 6 (stable subscribe with `useCallback`), Pitfall 7 (document StrictMode double-mount behavior).

**Research flag:** Well-documented. React official docs are the primary source. StrictMode + React Testing Library is the verification environment.

---

### Phase 6: Integration, Verification, and Documentation

**Rationale:** End-to-end validation against the real Cloud Run deployment, not just local Kestrel. This phase exists because several pitfalls are invisible locally (Cloud Run timeout, response buffering, proxy buffering, HTTP/2 confirmation). The "Looks Done But Isn't" checklist from PITFALLS.md is this phase's acceptance criteria.

**Delivers:** Confirmed working SSE delivery end-to-end; Cloud Run timeout set and verified; HTTP/2 confirmed; heartbeat visible in Network tab; cancellation cleanup verified in logs; zero re-renders on stable config in React DevTools profiler; SDK README documenting StrictMode behavior and `isConnected` status.

**Addresses:** V1.x features that can be added without architectural change: `useProjectConfigStatus()`, `initialData` prop for SSR hydration.

**Research flag:** No additional research needed — verification is mechanical against the checklist.

---

### Phase Ordering Rationale

- **DB first, then API refactor, then new API features:** The DB rename is a gate for all code changes; the URL restructure must precede adding new SSE endpoints to the same endpoint group; `ConfigBroadcaster` depends on the endpoint structure being stable.
- **SDK core before React SDK:** `ConfigStore` correctness (especially `getSnapshot` stability) must be validated in isolation before layering React on top. A bug at the core level produces confusing React errors.
- **Integration phase last:** Cloud Run-specific pitfalls cannot be caught locally. A dedicated integration phase with the full checklist is more reliable than bolting verification onto each feature phase.
- **V1.x features (status hook, SSR hydration) deferred to Phase 6:** They do not block the core SSE push use case and are additive without breaking changes. Shipping them in Phase 6 after validation reduces V1 scope risk.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (ConfigBroadcaster):** If Cloud Run is configured with multiple instances for V1, the in-process broadcaster is insufficient — a Pub/Sub backplane is required. Research confirms this is a V2 concern only if `min-instances=1` is enforced; confirm this is acceptable before planning Phase 3 tasks.
- **Phase 6 (Integration):** Cloud Run HTTP/2 end-to-end behavior with the current load balancer/ingress setup may need investigation if the existing infrastructure terminates TLS and proxies with HTTP/1.1.

Phases with standard patterns (no research-phase needed):
- **Phase 1 (DB migration):** PostgreSQL transactional DDL with updatable view shim is well-documented with multiple production references.
- **Phase 2 (URL restructure):** Pure API refactoring with redirect setup — standard patterns.
- **Phase 4 (SDK core):** All patterns are derived from official React and MDN docs.
- **Phase 5 (React SDK):** `useSyncExternalStore` is the official React pattern for external stores; official React docs are the primary source.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official docs (.NET 10 release notes, React 19 official docs, MDN). Zero new packages — no dependency risk. |
| Features | HIGH | Cross-referenced against 6 competitor SDKs (LaunchDarkly, ConfigCat, Unleash, GrowthBook, OpenFeature, Firebase RC) using official documentation. |
| Architecture | HIGH | Two primary sources (Milan Jovanovic, Khalid Abuhakmeh) for .NET SSE patterns; official React docs for `useSyncExternalStore`. Patterns verified against existing codebase conventions. |
| Pitfalls | HIGH | Cloud Run timeout sourced from official GCP docs; DB rename pattern sourced from brandur.org (production post-mortem) and GoCardless engineering; SSE buffering from real post-mortems. |

**Overall confidence: HIGH**

### Gaps to Address

- **Multi-instance fan-out:** The in-process `ConfigBroadcaster` works only with a single Cloud Run instance. If V1 requires horizontal scale, a Cloud Pub/Sub backplane is required. Research identifies this clearly as a V2 concern — confirm with product that `min-instances=max-instances=1` is acceptable for V1 launch before committing to Phase 3 design.
- **`Last-Event-ID` replay support:** Research recommends passing event IDs and supporting replay on reconnect, but identifies this as "acceptable to skip in V1 if config is always fetchable via REST on reconnect." Decide during Phase 3 planning whether the REST fallback on reconnect is sufficient for V1 SLA.
- **Rate limiting on SSE connections per API key:** Security research flags that unlimited SSE connections per key is a DoS vector. Not architecturally blocking for V1, but should be scoped as a task within Phase 3.
- **Existing `useSettings` hook migration:** The current `@skystate/react` `useSettings` hook uses `useState + useEffect` — the pattern explicitly identified as unsafe for concurrent React. It must be migrated to `useSyncExternalStore` as part of Phase 5. This is not a gap but an explicit migration task to add to the phase.

---

## Sources

### Primary (HIGH confidence)
- [milanjovanovic.tech: Server-Sent Events in ASP.NET Core and .NET 10](https://www.milanjovanovic.tech/blog/server-sent-events-in-aspnetcore-and-dotnet-10) — `TypedResults.ServerSentEvents` API, `Channel<T>` + `IAsyncEnumerable` pattern
- [khalidabuhakmeh.com: Server-Sent Events in ASP.NET Core and .NET 10](https://khalidabuhakmeh.com/server-sent-events-in-aspnet-core-and-dotnet-10) — `CancellationToken` disconnect handling, singleton broadcaster pattern
- [react.dev: useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — `subscribe`/`getSnapshot` contract, immutability requirements, `getServerSnapshot`
- [Microsoft Learn: System.Threading.Channels](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) — `Channel<T>` single-consumer behavior, per-client fan-out pattern
- [Google Cloud: Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) — 60-minute maximum, reconnection design
- [LaunchDarkly, ConfigCat, Unleash, GrowthBook, OpenFeature, Firebase RC official SDK docs](https://launchdarkly.com/docs/sdk/client-side/react/react-web) — feature baseline and competitor analysis
- [brandur.org: Postgres Table Rename Zero Downtime](https://brandur.org/fragments/postgres-table-rename) — updatable view shim pattern
- [GoCardless: Zero-Downtime Postgres Migrations](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/) — production migration patterns
- [caniuse.com: Server-sent events](https://caniuse.com/eventsource) — 95.93% global support baseline

### Secondary (MEDIUM confidence)
- [oneuptime.com: Configure SSE through Nginx](https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view) — `X-Accel-Buffering: no` header, `proxy_read_timeout` configuration
- [textslashplain.com: Pitfalls of EventSource over HTTP/1.1](https://textslashplain.com/2019/12/04/the-pitfalls-of-eventsource-over-http-1-1/) — 6-connection-per-domain limit
- [dev.to: SSE Are Still Not Production Ready](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) — proxy buffering real post-mortem
- [Shopify Engineering: SSE at Scale](https://shopify.engineering/server-sent-events-data-streaming) — fan-out architecture at BFCM scale
- [antondevtips.com: Real-Time Server-Sent Events in ASP.NET Core and .NET 10](https://antondevtips.com/blog/real-time-server-sent-events-in-asp-net-core) — supplementary patterns

---
*Research completed: 2026-03-04*
*Ready for roadmap: yes*
