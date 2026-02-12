# Architecture Research

**Domain:** Real-time config push via SSE — SDK integration with existing .NET 10 minimal API
**Researched:** 2026-03-04
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT (SDK consumer app)                        │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    @skystate/react                                  │ │
│  │  useProjectConfig('featureFlags.darkMode')                          │ │
│  │       ↓ useSyncExternalStore(store.subscribe, store.getSnapshot)    │ │
│  └───────────────────────────┬─────────────────────────────────────────┘ │
│                              │ subscribe / getSnapshot                   │
│  ┌───────────────────────────▼─────────────────────────────────────────┐ │
│  │                    @skystate/core  ConfigStore                      │ │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐    │ │
│  │  │  ConfigCache │  │  PubSubEmitter   │  │  SseClient         │    │ │
│  │  │  (snapshot)  │  │  (listener set)  │  │  (EventSource)     │    │ │
│  │  └──────┬───────┘  └────────┬─────────┘  └──────────┬─────────┘    │ │
│  │         │    update         │   notify               │ onmessage    │ │
│  │         └───────────────────┴────────────────────────┘              │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                              │ EventSource HTTP GET                       │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│                         API (.NET 10)                                    │
│                              │                                           │
│  ┌───────────────────────────▼──────────────────────────────────────┐   │
│  │  GET /project/{slug}/config/{slug}/stream                        │   │
│  │  PublicConfigEndpoints  (no OutputCache, no auth, CORS open)     │   │
│  │       ↓ TypedResults.ServerSentEvents(IAsyncEnumerable<T>)       │   │
│  └───────────────────────────┬──────────────────────────────────────┘   │
│                              │ subscribe/yield                           │
│  ┌───────────────────────────▼──────────────────────────────────────┐   │
│  │  ConfigBroadcaster  (singleton)                                  │   │
│  │  ConcurrentDictionary<Guid, Channel<ConfigSseEvent>>             │   │
│  │  + Subscribe(projectSlug, envSlug) → ChannelReader               │   │
│  │  + Unsubscribe(connectionId)                                     │   │
│  │  + Broadcast(projectSlug, envSlug, payload)                      │   │
│  └───────────────────────────┬──────────────────────────────────────┘   │
│                              │ notify on write                           │
│  ┌───────────────────────────▼──────────────────────────────────────┐   │
│  │  POST /project/{id}/config/{envId}  (write endpoint)             │   │
│  │  → ProjectConfigService.CreateAsync(...)                         │   │
│  │  → IOutputCacheStore.EvictByTagAsync("public-configs")           │   │
│  │  → IConfigBroadcaster.Broadcast(projectSlug, envSlug, payload)   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│  ┌───────────────────────────▼──────────────────────────────────────┐   │
│  │  GET /project/{slug}/config/{slug}  (REST read, OutputCached)    │   │
│  │  60s cache, public, same data source                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                               │
                 ┌─────────────▼────────────┐
                 │  PostgreSQL 17           │
                 │  project_config table    │
                 └──────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `PublicConfigEndpoints` (API) | SSE stream endpoint + REST read endpoint; no auth; CORS open | Minimal API `MapGet` with `TypedResults.ServerSentEvents` |
| `ConfigBroadcaster` (API, singleton) | Fan-out: per-connection `Channel<T>`, `Subscribe`, `Unsubscribe`, `Broadcast` | `ConcurrentDictionary` of bounded `Channel<ConfigSseEvent>` |
| `ProjectConfigService` (API) | Write config, evict OutputCache, call broadcaster | Same pattern as existing `ProjectStateService` |
| `SseClient` (`@skystate/core`) | Open `EventSource`, receive events, parse JSON, call `onUpdate` callback | Wraps native `EventSource`; handles `onerror` with backoff |
| `ConfigCache` (`@skystate/core`) | Hold the current config snapshot; invalidate on update | Plain object with version-keyed snapshot reference |
| `PubSubEmitter` (`@skystate/core`) | Maintain a `Set<() => void>` of React subscriber callbacks; call all on update | Thin event emitter; no external dep |
| `ConfigStore` (`@skystate/core`) | Compose SseClient + ConfigCache + PubSubEmitter into a `useSyncExternalStore`-compatible object | Singleton per `(apiUrl, projectSlug, envSlug)` tuple |
| `useProjectConfig` (`@skystate/react`) | Hook that calls `useSyncExternalStore` against a shared `ConfigStore`; returns typed path value | React 19, concurrent-safe |
| `SkyStateProvider` (`@skystate/react`) | React context that holds the shared `ConfigStore` instance; prevents duplicate connections per project/env | React `createContext` + `useRef` |

---

## Recommended Project Structure

```
packages/
├── typescript/
│   ├── core/src/
│   │   ├── types.ts              # ConfigEnvelope, SkyStateConfig, Version (update naming)
│   │   ├── error.ts              # SkyStateError (existing)
│   │   ├── fetch-config.ts       # REST fetch (rename from fetch-settings.ts)
│   │   ├── sse-client.ts         # EventSource wrapper, reconnect, parse
│   │   ├── config-cache.ts       # Snapshot holder, getSnapshot(), update()
│   │   ├── pub-sub-emitter.ts    # subscribe(cb)/unsubscribe(cb)/notify()
│   │   ├── config-store.ts       # Composes above 3; singleton factory
│   │   └── index.ts              # Public exports
│   └── react/src/
│       ├── provider.tsx          # SkyStateProvider (Context + ConfigStore lifecycle)
│       ├── use-project-config.ts # useProjectConfig hook (useSyncExternalStore)
│       └── index.ts              # Public exports

api/SkyState.Api/
├── Endpoints/
│   ├── PublicConfigEndpoints.cs  # REST read + SSE stream (replaces PublicStateEndpoints.cs)
│   └── ProjectConfigEndpoints.cs # Authenticated write endpoints (replaces ProjectStateEndpoints.cs)
├── Services/
│   ├── ConfigBroadcaster.cs      # NEW: singleton fan-out service
│   ├── IConfigBroadcaster.cs     # NEW: interface for DI
│   └── ProjectConfigService.cs   # Rename + add Broadcast call on write
```

---

## Architectural Patterns

### Pattern 1: SSE Fan-Out via Per-Connection Channel (API)

**What:** The `ConfigBroadcaster` singleton keeps a `ConcurrentDictionary` of `Channel<ConfigSseEvent>`. When a client opens the SSE stream, a new bounded channel is created for that connection and its `ChannelReader` is passed to `TypedResults.ServerSentEvents`. When a write happens, `Broadcast` writes to every channel. When the client disconnects (CancellationToken fires), the channel is removed.

**When to use:** Any time you need fan-out SSE to N concurrent clients reading the same resource. The Channel-per-client model avoids locking; each write is a non-blocking `TryWrite`.

**Trade-offs:** In-process only — two Cloud Run instances won't share a broadcaster. For V1 with a single replica, this is fine. Multi-instance scale requires a pub/sub backplane (Pub/Sub, Redis Streams) — defer to V2.

**Example:**

```csharp
// IConfigBroadcaster.cs
public interface IConfigBroadcaster
{
    ChannelReader<ConfigSseEvent> Subscribe(string projectSlug, string envSlug, Guid connectionId);
    void Unsubscribe(Guid connectionId);
    void Broadcast(string projectSlug, string envSlug, ConfigSseEvent payload);
}

// ConfigBroadcaster.cs
public class ConfigBroadcaster : IConfigBroadcaster
{
    private record Subscription(string ProjectSlug, string EnvSlug,
        Channel<ConfigSseEvent> Channel);

    private readonly ConcurrentDictionary<Guid, Subscription> _connections = new();

    public ChannelReader<ConfigSseEvent> Subscribe(
        string projectSlug, string envSlug, Guid connectionId)
    {
        var channel = Channel.CreateBounded<ConfigSseEvent>(
            new BoundedChannelOptions(16) { FullMode = BoundedChannelFullMode.DropOldest });
        _connections[connectionId] = new Subscription(projectSlug, envSlug, channel);
        return channel.Reader;
    }

    public void Unsubscribe(Guid connectionId)
        => _connections.TryRemove(connectionId, out _);

    public void Broadcast(string projectSlug, string envSlug, ConfigSseEvent payload)
    {
        foreach (var (_, sub) in _connections)
            if (sub.ProjectSlug == projectSlug && sub.EnvSlug == envSlug)
                sub.Channel.Writer.TryWrite(payload);
    }
}
```

### Pattern 2: SSE Endpoint without OutputCache (API)

**What:** SSE endpoints must NOT use `CacheOutput` — they are long-lived streaming connections, not discrete cacheable responses. The existing `OutputCache` policy named `"PublicState"` must not be applied. Instead, register the SSE endpoint with `.NoCache()` or simply omit `.CacheOutput()` entirely.

**When to use:** Always for streaming endpoints; never cache `text/event-stream` responses.

**Trade-offs:** None. The REST read sibling (`GET /project/{slug}/config/{slug}`) retains its 60s `OutputCache`. Both coexist under the same public endpoint group.

**Example:**

```csharp
// PublicConfigEndpoints.cs
public static void MapPublicConfigEndpoints(this WebApplication app)
{
    // REST read — keeps OutputCache (60s, keyed by slugs)
    app.MapGet("/project/{projectSlug}/config/{environmentSlug}", ...)
        .CacheOutput("PublicConfig")
        .AllowAnonymous()
        .RequireCors("PublicApi");

    // SSE stream — NO CacheOutput; long-lived connection
    app.MapGet("/project/{projectSlug}/config/{environmentSlug}/stream",
        async (string projectSlug, string environmentSlug,
               IConfigBroadcaster broadcaster, CancellationToken ct) =>
        {
            var connectionId = Guid.NewGuid();
            var reader = broadcaster.Subscribe(projectSlug, environmentSlug, connectionId);

            try
            {
                return TypedResults.ServerSentEvents(
                    reader.ReadAllAsync(ct),
                    eventType: "config");
            }
            finally
            {
                broadcaster.Unsubscribe(connectionId);
            }
        })
        .AllowAnonymous()
        .RequireCors("PublicApi");
        // No .CacheOutput() — intentional
}
```

### Pattern 3: Write Endpoint Triggers Cache Eviction and SSE Broadcast

**What:** When a config write succeeds, the endpoint does two things atomically (in the same request handler): (1) evict the OutputCache tag so the REST read endpoint serves fresh data on the next request, and (2) call `ConfigBroadcaster.Broadcast` so connected SSE clients receive the new config immediately. This is the same pattern already used in `ProjectStateEndpoints.cs` for cache eviction.

**When to use:** Every config mutation path — create, rollback, promote.

**Example:**

```csharp
// Inside the POST /project/{id}/config/{envId} handler:
var result = await configService.CreateAsync(userId, projectId, envId, body);
if (result is not ServiceResult<Guid>.Success(var newId))
    return ...; // error

// 1. Evict REST cache
await cache.EvictByTagAsync(PublicConfigEndpoints.CacheTag, default);

// 2. Push SSE event to all connected clients for this project/env
var payload = new ConfigSseEvent(
    Version: newVersion.ToString(),
    LastModified: DateTimeOffset.UtcNow.ToString("O"),
    Config: newConfigJson);
broadcaster.Broadcast(projectSlug, envSlug, payload);

return Results.Created(...);
```

### Pattern 4: ConfigStore Singleton Factory (SDK core)

**What:** A `ConfigStore` composes `SseClient + ConfigCache + PubSubEmitter` and exposes the three things `useSyncExternalStore` needs: `subscribe(callback)`, `getSnapshot()`, and `getServerSnapshot()`. Only one `ConfigStore` per `(apiUrl, projectSlug, envSlug)` triple should exist — a `WeakRef`-keyed or `Map`-keyed factory prevents duplicate `EventSource` connections when multiple `useProjectConfig` calls target the same config.

**When to use:** Always. Without a singleton store per tuple, each `useProjectConfig` call would open a separate SSE connection.

**Trade-offs:** `Map`-keyed singletons live until explicitly destroyed. `SkyStateProvider` owns creation/destruction via React lifecycle (`useEffect` cleanup).

**Example:**

```typescript
// config-store.ts
export interface ConfigStore {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => ConfigEnvelope | null;
  getServerSnapshot: () => null;
  destroy: () => void;
}

export function createConfigStore(config: SkyStateConfig): ConfigStore {
  let snapshot: ConfigEnvelope | null = null;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((fn) => fn());
  }

  const sseClient = createSseClient({
    url: `${config.apiUrl}/project/${config.projectSlug}/config/${config.environmentSlug}/stream`,
    onEvent(event: ConfigSseEvent) {
      // Only update if version changed (prevents spurious re-renders)
      if (snapshot?.version !== event.version) {
        snapshot = { version: event.version, lastModified: event.lastModified, config: event.config };
        notify();
      }
    },
  });

  return {
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getSnapshot() {
      return snapshot; // stable reference until next SSE event updates it
    },
    getServerSnapshot() {
      return null; // SSE is client-only
    },
    destroy() {
      sseClient.close();
      listeners.clear();
    },
  };
}
```

### Pattern 5: useSyncExternalStore for Granular Path Subscriptions (React SDK)

**What:** `useProjectConfig('featureFlags.darkMode')` subscribes to the whole `ConfigStore` but returns only the value at the given path. Because `getSnapshot` must return a stable reference when data has not changed, the hook compares the extracted value by identity before returning — React's `Object.is` check prevents unnecessary re-renders for components subscribed to unaffected paths.

**When to use:** The primary SDK consumption pattern. Do not use `useState` + `useEffect` (the existing `useSettings` stub) because that pattern is unsafe for concurrent rendering and causes tearing.

**Example:**

```typescript
// use-project-config.ts
import { useSyncExternalStore } from 'react';
import { useContext } from 'react';
import { SkyStateContext } from './provider.js';

export function useProjectConfig<T = unknown>(path: string): T | undefined {
  const store = useContext(SkyStateContext);
  if (!store) throw new Error('useProjectConfig must be used inside <SkyStateProvider>');

  return useSyncExternalStore(
    store.subscribe,
    () => getAtPath<T>(store.getSnapshot(), path),
    () => undefined, // server snapshot: undefined (no SSE on server)
  );
}

function getAtPath<T>(envelope: ConfigEnvelope | null, path: string): T | undefined {
  if (!envelope) return undefined;
  return path.split('.').reduce<unknown>((obj, key) =>
    obj != null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
    envelope.config) as T | undefined;
}
```

---

## Data Flow

### Initial Connection Flow

```
SkyStateProvider mounts
    ↓
createConfigStore(config) → SseClient.connect()
    ↓ EventSource opens to /project/{slug}/config/{slug}/stream
API: Subscribe → new Channel<ConfigSseEvent>
    ↓ connection held open (text/event-stream)
First SSE event arrives (API sends current config on connect)
    ↓ onEvent callback
ConfigCache.snapshot updated → PubSubEmitter.notify()
    ↓
useSyncExternalStore detects snapshot changed (getSnapshot ref changed)
    ↓
React re-renders component with new path value
```

### Config Write Flow (Dashboard/CLI)

```
User publishes new config via Dashboard or CLI
    ↓
POST /project/{id}/config/{envId} (authenticated)
    ↓
ProjectConfigService.CreateAsync → DB write (PostgreSQL)
    ↓ (parallel)
IOutputCacheStore.EvictByTagAsync("public-configs")   ← REST cache invalidated
IConfigBroadcaster.Broadcast(slug, slug, event)        ← SSE pushed to all clients
    ↓ Channel.Writer.TryWrite (non-blocking per connection)
Each client's ChannelReader yields the event
    ↓ TypedResults.ServerSentEvents flushes to each connection
EventSource.onmessage fires in browser
    ↓
ConfigCache updated, PubSubEmitter.notify()
    ↓
useSyncExternalStore triggers re-render of all subscribed components
```

### Reconnect Flow

```
EventSource connection drops (network blip, server restart)
    ↓
Browser automatically reconnects (built-in EventSource behavior)
  sends Last-Event-ID header if API includes event IDs
    ↓
API: new Subscribe call → new Channel created
    ↓ First event: API sends current config state (so client is never stale)
ConfigCache updated if version differs from last snapshot
```

### Key Data Flows

1. **Write → SSE push → component re-render:** Dashboard/CLI write triggers broadcaster which fans out to all `EventSource` connections; each SDK client updates its cache and notifies React.
2. **Path-granular subscription:** `useProjectConfig('a.b')` only causes the subscribing component to re-render when the value at `a.b` actually changes, not on every config update.
3. **REST read coexistence:** The 60s OutputCache REST endpoint is unaffected by SSE. SDK consumers on low-latency paths use SSE; polling integrations or non-JS clients use REST.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–100 concurrent SSE connections | In-process `ConfigBroadcaster` singleton; Cloud Run default memory sufficient; no changes needed |
| 100–10k connections | Cloud Run scales horizontally but broadcaster is in-process → connections on different instances don't receive broadcasts from each other. **Fix:** Add a Pub/Sub topic: write endpoint publishes event; a background subscriber on each instance reads from the topic and calls `Broadcast` locally. |
| 10k+ connections | Cloud Run + Cloud Pub/Sub backplane is likely sufficient. If per-instance connection count is a bottleneck, evaluate moving SSE behind a dedicated streaming service. |

### Scaling Priorities

1. **First bottleneck:** Multi-instance fan-out gap. When Cloud Run scales past one instance, clients on replica B won't receive events for writes that land on replica A's in-process broadcaster. Fix is a Pub/Sub relay — this is V2 scope, not V1.
2. **Second bottleneck:** EventSource connection count per Cloud Run instance. Cloud Run has a 1000 concurrent request default limit. If SDK adoption is high, increase this limit or add horizontal replicas.

---

## Anti-Patterns

### Anti-Pattern 1: Applying OutputCache to the SSE Stream Endpoint

**What people do:** Copy the `.CacheOutput("PublicConfig")` call from the REST read endpoint onto the stream endpoint.
**Why it's wrong:** OutputCache buffers the entire response before sending. For SSE, this means the middleware either hangs waiting for the stream to finish (it never does) or truncates the stream on first flush. The connection will appear to hang or return garbled data.
**Do this instead:** Never apply `CacheOutput` to streaming endpoints. Register them with no cache policy, or explicitly `.CacheOutput(b => b.NoCache())` if a base policy would otherwise apply.

### Anti-Pattern 2: useState + useEffect for SSE in the React SDK

**What people do:** The existing `useSettings` stub uses `useState` + `useEffect` with `fetchSettings`. Extending this pattern to SSE (create EventSource in useEffect, call setState on message) is a common first instinct.
**Why it's wrong:** `useState` updates are async and batched; during concurrent rendering, React may render a component with stale state while a newer state update is queued. This causes tearing — different components see different versions of the config in the same render pass. React 18+ introduced `useSyncExternalStore` specifically to prevent this.
**Do this instead:** Use `useSyncExternalStore` with a stable external store. The store holds the snapshot outside React; `getSnapshot` returns the same reference until an update arrives.

### Anti-Pattern 3: New EventSource per useProjectConfig Call

**What people do:** Open a new `EventSource` inside `useProjectConfig` directly (no shared store, no provider pattern).
**Why it's wrong:** Each component instance subscribing to the same project/env would open a separate SSE connection. With 10 components on a page, that's 10 connections. This is wasteful and can hit browser per-origin connection limits (typically 6 for HTTP/1.1, though HTTP/2 multiplexes).
**Do this instead:** Create exactly one `EventSource` per `(apiUrl, projectSlug, envSlug)` inside `SkyStateProvider`. All `useProjectConfig` calls inside that provider share the same connection via `PubSubEmitter.subscribe`.

### Anti-Pattern 4: Broadcasting Unserialized Objects via Channel

**What people do:** Pass the raw `ProjectConfig` domain model through the `Channel<T>`, then serialize it per-client as it yields.
**Why it's wrong:** Each SSE subscriber yields from the same `IAsyncEnumerable`; serialization happens once per event but memory is shared. More importantly, if the domain model is mutable, late-reading subscribers may see modified state. Also couples the broadcaster to the domain model.
**Do this instead:** Serialize the SSE payload to a `ConfigSseEvent` record (immutable, value type) before broadcasting. The `Channel` holds the record; all readers get the same immutable data.

### Anti-Pattern 5: getSnapshot Returning a New Object Every Call

**What people do:** In the `ConfigStore`, write `getSnapshot: () => ({ ...snapshot })` to "be safe".
**Why it's wrong:** `useSyncExternalStore` calls `getSnapshot` on every render and compares with `Object.is`. A new object reference every call means React thinks the store changed every render, causing infinite re-render loops.
**Do this instead:** Mutate the `snapshot` variable in place only when an SSE event arrives. Between events, `getSnapshot` returns the same object reference. React sees `Object.is(prev, next) === true` and skips the re-render.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Browser `EventSource` API | Native; no polyfill needed for V1 target environments | IE11 not supported; all modern browsers fine. For Node.js SDK (future), use `eventsource` npm package. |
| PostgreSQL | Unchanged — `ConfigBroadcaster.Broadcast` is called after the DB write succeeds | Broadcaster does not touch the DB |
| OutputCache (in-memory) | `EvictByTagAsync("public-configs")` called from write endpoint alongside Broadcast | Same tag-eviction pattern already used in existing `ProjectStateEndpoints.cs` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Write endpoint ↔ ConfigBroadcaster | Direct method call (`broadcaster.Broadcast(...)`) via DI injection | Synchronous TryWrite into Channel; non-blocking |
| SSE endpoint ↔ ConfigBroadcaster | `ChannelReader<ConfigSseEvent>` returned by `Subscribe`; read by `TypedResults.ServerSentEvents` | Channel is the only coupling; endpoint has no knowledge of other connections |
| SseClient ↔ ConfigCache | `onEvent` callback passes `ConfigSseEvent`; cache updates `snapshot` ref | Unidirectional push |
| ConfigCache + PubSubEmitter ↔ React | `useSyncExternalStore(subscribe, getSnapshot)` — React owns when to read | No React import in `@skystate/core`; React boundary is `@skystate/react` only |
| SkyStateProvider ↔ useProjectConfig | React Context holds `ConfigStore` instance | Store is created/destroyed with provider lifecycle via `useEffect` cleanup |

---

## Build Order Implications

The component dependency graph dictates this build sequence:

1. **API: ConfigBroadcaster** — No dependencies on new SDK code. Pure .NET singleton.
2. **API: URL restructure + ProjectConfigEndpoints** — Rename existing endpoints; add `broadcaster.Broadcast` call in write handler; add SSE endpoint using broadcaster.
3. **Core SDK: types + error** — Rename `StateEnvelope` → `ConfigEnvelope`, update paths. No logic change.
4. **Core SDK: SseClient** — Wraps `EventSource`; depends only on types.
5. **Core SDK: ConfigCache + PubSubEmitter** — Pure in-memory; no external deps.
6. **Core SDK: ConfigStore** — Composes above three. Exposes `subscribe`/`getSnapshot`/`destroy`.
7. **React SDK: SkyStateProvider** — Creates/destroys `ConfigStore` via React lifecycle.
8. **React SDK: useProjectConfig** — Calls `useSyncExternalStore`; depends on store and provider.

Steps 1–2 can be done without touching the SDK. Steps 4–6 can be done without touching the API (point `SseClient` at a local mock or the existing REST endpoint for initial testing). Steps 7–8 depend on step 6 being complete.

---

## Sources

- [Server-Sent Events in ASP.NET Core and .NET 10 — Milan Jovanovic](https://www.milanjovanovic.tech/blog/server-sent-events-in-aspnetcore-and-dotnet-10) (HIGH confidence — practical patterns verified)
- [Server-Sent Events in ASP.NET Core and .NET 10 — Khalid Abuhakmeh](https://khalidabuhakmeh.com/server-sent-events-in-aspnet-core-and-dotnet-10) (HIGH confidence — official-adjacent, .NET 10 specific)
- [useSyncExternalStore — React official docs](https://react.dev/reference/react/useSyncExternalStore) (HIGH confidence — primary source)
- [Output caching middleware in ASP.NET Core — Microsoft Docs](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output?view=aspnetcore-10.0) (HIGH confidence — official, .NET 10)
- [Real-Time Server-Sent Events in ASP.NET Core and .NET 10 — Anton Dev Tips](https://antondevtips.com/blog/real-time-server-sent-events-in-asp-net-core) (MEDIUM confidence — supplementary)

---
*Architecture research for: SkyState v1.0 SSE streaming + React SDK*
*Researched: 2026-03-04*
