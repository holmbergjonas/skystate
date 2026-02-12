# Stack Research

**Domain:** SSE streaming + React SDK with cache/pub-sub (additive milestone on existing SaaS)
**Researched:** 2026-03-04
**Confidence:** HIGH

---

## Scope

This file covers only NEW stack additions needed for v1.0 Live Config. The existing stack
(C# .NET 10, PostgreSQL 17, React 19, Vite 7, Zustand 5, TypeScript 5.9, Commander.js) is
validated and unchanged.

---

## Recommended Stack Additions

### Server Side: ASP.NET Core SSE

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `TypedResults.ServerSentEvents` | Built-in (.NET 10) | SSE streaming endpoint | Native to .NET 10 — no NuGet package needed. Accepts `IAsyncEnumerable<SseItem<T>>`, writes `text/event-stream` content-type, handles flushing. Designed for Minimal APIs. |
| `System.Threading.Channels` | Built-in (.NET 10) | Per-client async message queue | Framework-included. `Channel<T>.CreateUnbounded()` gives each SSE client its own async queue. The singleton broadcast service writes to all per-client channels on config publish. |
| `System.Net.ServerSentEvents` | Built-in (.NET 10) | `SseItem<T>`, `SseParser`, `SseFormatter` types | Companion BCL namespace. `SseItem<T>` carries the event name, ID, and payload — enables `Last-Event-ID` replay for reconnecting clients. |

**No new NuGet packages required.** All SSE primitives ship with .NET 10.

### Client Side: @skystate/core (new capabilities)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Native `EventSource` (Web API) | Baseline (widely available since 2022, ~96% global support) | SSE connection from SDK to API | Zero dependencies. Handles reconnection automatically with exponential backoff. Sends `Last-Event-ID` header on reconnect for server-side replay. Supported in all modern browsers (Chrome 6+, Firefox 6+, Safari 5+, Edge 79+). |
| Custom `ConfigCache` class (zero deps) | N/A — hand-rolled | In-memory cache + pub/sub event emitter | The required pub/sub pattern is trivially implemented with a plain `Set<() => void>` of listener callbacks. No library adds value at this scale. See pattern below. |

**No new npm packages required for @skystate/core.** The package currently has zero runtime dependencies and should stay that way. The cache + pub/sub is ~40 lines of TypeScript.

### Client Side: @skystate/react (new hook)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `useSyncExternalStore` | Built-in (React 18+, used via React 19) | Subscribe to `ConfigCache` without tearing | Required by spec §8 and correct by design. Unlike `useState + useEffect`, this hook is concurrent-mode safe — React reads the snapshot synchronously during render, eliminating "tearing" where different components see different cache states during the same render pass. |

**No new npm packages required for @skystate/react.** `useSyncExternalStore` is imported from `react` (already a peer dependency).

---

## Key Patterns

### API: Per-Project Channel Fan-Out

`Channel<T>` is single-consumer — each item is dequeued by exactly one reader. For SSE
broadcasting (N clients watching the same project/config), the pattern is:

```
Singleton ConfigBroadcastService
  └── ConcurrentDictionary<string, List<Channel<ConfigUpdate>>>
        key = "{projectSlug}:{envSlug}"
        value = one Channel<ConfigUpdate> per connected client

On config write:
  1. Look up channels by project+env key
  2. Write the update to EVERY channel in the list

On client connect:
  1. Create a new Channel<ConfigUpdate> for this connection
  2. Add it to the project's channel list
  3. Inject ChannelReader into TypedResults.ServerSentEvents(reader.ReadAllAsync(ct))

On client disconnect (CancellationToken cancellation):
  1. Remove the channel from the list
  2. Channel is GC'd
```

This is the correct fan-out pattern — NOT a single shared channel.

### @skystate/core: ConfigCache (hand-rolled pub/sub)

```typescript
type Listener = () => void;

class ConfigCache {
  private snapshot: unknown = null;
  private listeners = new Set<Listener>();

  update(data: unknown): void {
    this.snapshot = data;
    this.listeners.forEach(l => l());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): unknown {
    return this.snapshot;
  }
}
```

This is the exact shape `useSyncExternalStore` requires: a stable `subscribe` that returns
an unsubscribe function, and a `getSnapshot` that returns the same reference when data has
not changed.

### @skystate/react: useProjectConfig hook

```typescript
import { useSyncExternalStore } from 'react';

function useProjectConfig<T>(path?: string): T | null {
  const cache = useContext(SkyStateContext); // shared ConfigCache instance
  const data = useSyncExternalStore(
    cache.subscribe.bind(cache),
    cache.getSnapshot.bind(cache),
    () => null // getServerSnapshot — null for SSR, config is client-only
  );
  return path ? getPath(data, path) : data as T;
}
```

`getServerSnapshot` returns `null` because config is not available during SSR (this is correct
and intentional — the spec requires client-only consumption).

---

## Installation

```bash
# @skystate/core — NO new packages needed
# @skystate/react — NO new packages needed

# All new capabilities use:
# - Native browser EventSource (no polyfill — 96% global support)
# - useSyncExternalStore (built into React 19)
# - TypedResults.ServerSentEvents (built into .NET 10)
# - System.Threading.Channels (built into .NET 10)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Native `EventSource` (no polyfill) | `event-source-polyfill` npm package | Only if IE11 or Opera Mini support is required. SkyState's developer audience does not use these browsers; polyfill adds bundle weight for zero practical benefit. |
| Hand-rolled `ConfigCache` (Set of listeners) | `mitt` (200b) or `nanoevents` (107b) | If the project needed a general-purpose event bus with named event types. For this use case — one event type ("config updated") per cache instance — the overhead of a library is not justified. |
| Hand-rolled `ConfigCache` | `eventemitter3` (1KB) | Only if hierarchical wildcard subscriptions or once-only listeners are needed. V1 does not need these. |
| `TypedResults.ServerSentEvents` (.NET 10 built-in) | SignalR | SignalR is bidirectional (WebSocket + fallbacks). V1 is read-only push only — SSE is simpler, firewall-friendly, and requires no hub setup. Defer SignalR to V2 if needed. |
| Per-client `Channel<T>` fan-out | Single shared `Channel<T>` | A single channel is correct for single-consumer worker patterns. For broadcasting, each client MUST have its own channel — a shared channel delivers each message to only one reader. |
| `useSyncExternalStore` | `useState + useEffect` | Only in non-concurrent React (React 17 and below). `useSettings` in the current `@skystate/react` uses this pattern — it should be migrated to `useSyncExternalStore` as part of this milestone. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `event-source-polyfill` | Adds ~16KB bundle weight for browsers that don't exist in developer tooling. EventSource is Baseline-widely-available since July 2022. | Native `new EventSource(url)` |
| Single shared `Channel<T>` for SSE broadcast | Items are dequeued by ONE reader — other connected clients miss events. This is a silent data loss bug. | `ConcurrentDictionary<string, List<Channel<T>>>` with per-client channels |
| `useState + useEffect` in the React SDK | Susceptible to tearing in React 19 concurrent mode: components can read different cache states during the same render. This is why the existing `useSettings` hook should be replaced. | `useSyncExternalStore` |
| SignalR for V1 | Requires hub infrastructure, bidirectional protocol overhead, and a separate NuGet package. Config push is unidirectional. | `TypedResults.ServerSentEvents` (built-in) |
| WebSockets for V1 | Higher complexity (upgrade handshake, framing protocol, stateful connection management). SSE is HTTP/1.1 native, simpler to proxy and secure. WebSocket deferred to V2 per spec. | Server-Sent Events |
| Node.js `EventEmitter` in @skystate/core | Node-only API — breaks in browsers. The SDK must run in both environments. | Plain `Set<Listener>` pattern (universal) |

---

## Cloud Run SSE Configuration

Cloud Run requires specific settings for long-lived SSE connections:

**Request timeout:** Default is 5 minutes — must be increased. Maximum is 60 minutes.
Set to 3600 seconds (60 minutes) in the Cloud Run service configuration. Clients reconnect
automatically via EventSource's built-in reconnection, so 60-minute max is acceptable for V1.

**Nginx/proxy buffering:** If a reverse proxy sits in front of Cloud Run, SSE responses must
have buffering disabled. Set response header `X-Accel-Buffering: no` from the .NET API to
instruct any upstream nginx to disable buffering for that response. Also set
`Cache-Control: no-cache` (required by SSE spec).

**Keep-alive pings:** Send a comment (`: ping\n\n`) every 15-30 seconds from the server to
prevent load balancer idle timeout disconnections. The EventSource client silently discards
comments — no client-side handling needed.

**HTTP/2:** Cloud Run supports HTTP/2. SSE works over both HTTP/1.1 and HTTP/2. On HTTP/2,
multiple SSE streams share a single connection, which is more efficient.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `TypedResults.ServerSentEvents` | .NET 10+ only | Not available in .NET 8 or .NET 9. Project already targets .NET 10. |
| `useSyncExternalStore` | React 18+ | Available since React 18. Project targets React 19. No compatibility concerns. |
| Native `EventSource` | All modern browsers (Baseline widely available July 2022) | No polyfill needed for developer tooling audience. |
| `System.Threading.Channels` | .NET Core 3.0+ | Available for years — no version concern. |

---

## Sources

- [milanjovanovic.tech: Server-Sent Events in ASP.NET Core and .NET 10](https://www.milanjovanovic.tech/blog/server-sent-events-in-aspnetcore-and-dotnet-10) — TypedResults.ServerSentEvents API, Channel<T> + IAsyncEnumerable pattern, SseItem<T> with Last-Event-ID replay (HIGH confidence)
- [khalidabuhakmeh.com: Server-Sent Events in ASP.NET Core and .NET 10](https://khalidabuhakmeh.com/server-sent-events-in-aspnet-core-and-dotnet-10) — CancellationToken disconnect handling, singleton broadcast service pattern (HIGH confidence)
- [react.dev: useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — Official React docs: API signature, subscribe/getSnapshot contract, immutability requirements, getServerSnapshot (HIGH confidence)
- [Microsoft Learn: System.Threading.Channels](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) — Channel<T> single-consumer behavior, why per-client channels are required for fan-out (HIGH confidence)
- [caniuse.com: Server-sent events](https://caniuse.com/eventsource) — 95.93% global support, Baseline widely available since July 2022 (HIGH confidence)
- [Google Cloud: Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) — 60-minute maximum, reconnection design recommendation (HIGH confidence)
- [oneuptime.com: Configure SSE through Nginx](https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view) — X-Accel-Buffering: no header, proxy_read_timeout configuration (MEDIUM confidence)
- [github.com/ai/nanoevents README](https://github.com/ai/nanoevents/blob/main/README.md) — Typed event emitter pattern evaluation (MEDIUM confidence — considered but not recommended)
- [npm-compare.com: mitt vs eventemitter3](https://npm-compare.com/eventemitter3,events,mitt,pubsub-js) — Library comparison for pub/sub (MEDIUM confidence — considered but not recommended)

---
*Stack research for: SkyState v1.0 Live Config — SSE streaming + React SDK*
*Researched: 2026-03-04*
