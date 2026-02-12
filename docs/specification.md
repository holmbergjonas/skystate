# SkyState Requirements V2.4

*(Last Updated: Wednesday, March 5, 2026)*

---

## 1. Design Philosophy

SkyState is a **headless state synchronization service**. It is not a UI component library, a game engine networking layer, or an auth provider. The service provides shared JSON state that clients can fetch and cache efficiently.

**Core positioning:** SkyState follows a **progressive value model**. It enters codebases as a lightweight remote config tool (feature flags, maintenance banners, kill switches) and grows into per-user persistent state and eventually real-time multiplayer session sync.

The API is designed around a progressive complexity model:

- **~80% of use cases (Casual Sync):** Developers pass plain objects to the setter. They get Last-Write-Wins semantics effortlessly.
- **~15% of use cases (Atomic Operations):** Developers import lightweight modifier functions (`increment`, `decrement`) for safe concurrent math without learning RFC 6902.
- **~5% of use cases (Power Users):** Developers write raw JSON Patch arrays for complex state machines with explicit `test` guards.

---

## 2. State Levels & Architecture

| Level | Writers | Mutability | Storage Model | Concurrency Strategy | Version |
| --- | --- | --- | --- | --- | --- |
| **Project** | Server/admin only | Polling-based read (read-only for clients) | Blob | None (single writer) | V1 |
| **User** | Single user | Mutable KV | Blob w/ patch updates | Optimistic Concurrency (`test`) / LWW | V2 |
| **Session** | Multiple users | Mutable Sync | Shared Blob (in-memory/Redis) | LWW, Atomic `test`, `increment` ops | V3 |

**Note on User-level concurrency (V2):** The default User-level behavior is effectively "last PATCH wins" with no safety net. Developers must explicitly opt in to conflict protection by including `test` operations in their patches or using modifier functions. This should be clearly documented so developers with multi-tab or multi-device scenarios understand the tradeoff.

---

## 3. Authentication

SkyState provides a **default authentication path** for developers who don't have an existing auth solution, and will support a **bring-your-own-auth (BYOA) path** in a future release for developers who do.

### 3.1 Default Auth (V2) — Firebase

SkyState ships a thin login page that redirects to Firebase Authentication. This is the zero-config path for new developers. Auth is not required for V1 (read-only config push has no concept of end-user identity).

**How it works:**

1. The developer integrates SkyState's login page into their app (hosted component or redirect).
2. The login page presents standard OAuth options (Google, GitHub, etc.) and anonymous auth, all powered by Firebase.
3. Firebase issues a token upon successful login.
4. The client passes the Firebase token when connecting to SkyState (in the WebSocket handshake or as an Authorization header on REST calls).
5. SkyState validates the token directly against Firebase's public keys (auto-rotated, no developer configuration needed).
6. SkyState extracts the `uid` claim from the Firebase token and uses it for User-level state scoping (V2) and Session-level identity (V3).

**Developer onboarding:** Create a SkyState project, drop in the login page. No JWKS registration, no key management, no custom backend required.

### 3.2 BYOA Path (V3)

For developers who already use Clerk, Supabase, or a custom auth stack, SkyState will support direct token validation against the developer's auth provider.

**Planned approach:**

1. The developer registers their auth provider's JWKS URL (or uploads a public key) in the SkyState dashboard.
2. The client passes the provider-issued JWT when connecting to SkyState.
3. SkyState verifies the JWT signature against the registered keys.
4. SkyState extracts a configured `user_id` claim from the token.

This path is **not in V1 or V2 scope** but is architecturally accounted for — the token validation layer is designed to support multiple providers.

---

## 4. API (Server-Side)

### Project Level (V1) — Remote Config

- `GET /project/{projectSlug}/config/{envSlug}` — Fetch full config blob for a project environment. Returns `Cache-Control: public, max-age={TTL}` header where TTL depends on the project's subscription tier and environment. Clients rely on browser caching for efficient polling — no explicit SDK polling interval needed.
- `PUT /project/{projectId}/config/{envSlug}` — Update config blob (dashboard/CLI/admin only). Invalidates output cache so next read gets fresh data.

**Environments** are a fixed enum, not user-configurable:

| Tier | Available Environments |
|------|----------------------|
| Free | `development`, `production` |
| Hobby | `development`, `staging`, `production` |
| Pro | `development`, `staging`, `production` |

**Cache-Control TTL by tier and environment:**

| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 10s | n/a | 900s (15 min) |
| Hobby | 10s | 10s | 300s (5 min) |
| Pro | 10s | 10s | 60s (1 min) |

**Rate limiting by tier and environment:**

| Tier | `development` | `staging` | `production` |
|------|--------------|-----------|-------------|
| Free | 60 req/min | n/a | 1000 req/min |
| Hobby | 60 req/min | 60 req/min | Unlimited |
| Pro | 60 req/min | 60 req/min | Unlimited |

Non-production environments get strict rate limiting (they're for testing, not serving end users). Rate limiting uses .NET's `PartitionedRateLimiter` keyed on the `envSlug` route parameter — blocked requests return `429 Too Many Requests` without hitting the database.

**Note:** SSE streaming was considered for V1 but rejected due to infrastructure costs (long-lived connections, single-instance constraint). The polling + Cache-Control model provides sufficient freshness for remote config use cases (feature flags, banners, kill switches) at a fraction of the cost.

### User Level (V2)

- `GET /user/state?keys=a,b,c` — Batched key fetch.
- `PATCH /user/state` — Standard JSON Patch (RFC 6902) array for partial updates.
- `WebSocket wss://api.skystate.../user/state` — Bi-directional stream for real-time user state sync. WebSockets are introduced in V2 when clients need to write.

### Session Level (V3)

- `GET /session/:id/state` — Fetch the current snapshot of the session state.
- `WebSocket wss://api.skystate.../session/:id` — Bi-directional stream for routing JSON Patches in real-time.

### Custom Operations (V2+)

The backend JSON Patch parser extends RFC 6902 with the following custom operations:

- `increment` — Atomically adds a numeric value at the target path.
- `decrement` — Atomically subtracts a numeric value at the target path.

**Edge case behavior for `increment`/`decrement`:**

- If the target path **does not exist**, the server initializes the value to `0` before applying the operation.
- If the target path holds a **non-numeric value**, the server rejects the operation with a `400 Bad Request`.

---

## 5. SDK Design

### 5.1 Cross-Platform Principle

Because the protocol is standard HTTP, WebSockets, and JSON, SDKs can be built for any language. Each SDK wraps the same wire protocol with the host platform's native reactivity or event model.

However, a good SDK is far more than JSON serialization. Each platform requires meaningful engineering for connection lifecycle management, reconnection with backoff, optimistic update buffering, and thread marshalling (e.g., Unity must dispatch WebSocket callbacks to the main thread). These are not trivial to port.

### 5.2 SDK Roadmap

**V1: React SDK — Project-Level Remote Config**

```ts
const maintenance = useProjectConfig('maintenance')
// { active: true, message: "Back in 10 minutes" }
// Fetched on load, cached by browser. Re-fetches on tab visibility change.

const betaEnabled = useProjectConfig('feature_flags.beta_ui')
// true / false — updates visible to clients after Cache-Control TTL expires.
```

Read-only for clients. Updates happen via the dashboard or CLI. Clients receive updates when the browser cache expires (TTL-based, per tier and environment).

**V2: React SDK — User-Level State**

All mutable hooks return a third metadata object to handle network latency, rollback states, and conflict resolution.

```ts
const [theme, setTheme, { isLoading, error }] = useUserState('theme', 'dark')
// Setter syncs to server via PATCH in the background.
// Default value only used when the server returns null (first to mount wins).
```

**The setter is a smart router.** It inspects the payload and generates the appropriate JSON Patch operations:

```ts
// 1. Plain values → generates 'replace' ops (LWW)
setTheme('light')

// 2. Modifier functions → generates atomic ops
setProfile({ loginCount: increment(1) })

// 3. Mixed payloads → generates a combined atomic patch array
setProfile({ loginCount: increment(1), theme: 'dark' })

// 4. Raw patch arrays → passed through directly (escape hatch)
setProfile([
  { op: 'test', path: '/theme', value: 'dark' },
  { op: 'replace', path: '/theme', value: 'light' }
])
```

**V2: Vanilla JS/TS Core Extraction**

Extract the framework-agnostic internals (WebSocket lifecycle, cache, batching, patch routing) into a standalone package. React SDK becomes a thin wrapper over this core.

**V2: Svelte SDK**

Thin wrapper over the vanilla core using Svelte's reactive primitives (runes/stores). Targets an underserved, enthusiastic community with strong use-case alignment.

**V2: Vue SDK**

Composable wrappers over the vanilla core. Low incremental effort after Svelte.

**V3: React/Svelte/Vue — Session-Level State**

```ts
const [board, setBoard, { isLoading, error }] = useSessionState('room-1', { score: 0 })
```

#### Optional Conflict Handler (V3)

```ts
const [board, setBoard, { isLoading, error }] = useSessionState(
  'room-1',
  { score: 0 },
  {
    onConflict: (serverState, attemptedPatch) => {
      // Developer decides: retry, notify user, merge, etc.
    }
  }
)
```

**Default behavior when `onConflict` is not provided:**

1. Roll back the local optimistic update to the last known server state.
2. Populate the `error` field in the hook metadata (e.g., `{ type: 'CONFLICT', serverState, attemptedPatch }`).

**Future (unscoped):**

- Godot (GDScript) — Autoload singleton, event-based. Targets indie turn-based/card game community.
- Unity (C#) — .dll package, event-based with main-thread marshalling.
- Python — Lightweight client for server-side state manipulation, IoT, or admin tooling.

---

## 6. Action Modifiers (V2+)

Modifiers are lightweight sentinel objects that developers import and pass into the standard setter. They abstract away JSON Patch syntax while keeping the SDK fully headless.

```ts
import { increment, decrement } from 'skystate'
```

| Modifier | Generated Patch Op | Example |
| --- | --- | --- |
| `increment(n)` | `{ op: 'increment', path, value: n }` | `setProfile({ score: increment(1) })` |
| `decrement(n)` | `{ op: 'decrement', path, value: n }` | `setProfile({ lives: decrement(1) })` |

**Modifier composition:** Modifiers can be mixed with plain values in a single setter call. The SDK generates a combined patch array containing both `replace` and atomic ops, applied as one atomic batch on the server.

```ts
// This produces a single patch array:
// [
//   { op: 'increment', path: '/score', value: 1 },
//   { op: 'replace', path: '/status', value: 'playing' }
// ]
setProfile({ score: increment(1), status: 'playing' })
```

### Wire Format

Modifier translation happens **client-side in the SDK**. By the time a message reaches the SkyState backend, it is always a standard JSON Patch array (with the custom `increment`/`decrement` ops). The backend never sees sentinel objects — it only parses one format.

This means each future SDK must reimplement the sentinel-to-patch transformation, but it keeps the backend simple and the wire protocol universal.

---

## 7. Concurrency & Conflict Resolution (V2+)

Conflicts are handled via the following hierarchy:

1. **Last-Write-Wins (LWW):** For standard `replace` operations (e.g., updating a cursor position or changing a theme), the server accepts the last patch it receives. This is the default for all plain-value setter calls.

2. **Optimistic Concurrency Control (OCC):** Developers can include a `test` operation in a raw patch array. If the server evaluates the `test` and it fails, the entire patch array is aborted and the client receives a `409 Conflict`.

3. **Atomic Math:** The `increment`/`decrement` modifiers bypass LWW entirely on numerical values, avoiding the lost-update problem for counters and scores.

---

## 8. Frontend SDK — Internal Mechanics

### Local Cache & Pub/Sub

- **Single Source of Truth:** One shared internal cache instance per `SkyState` provider.
- **Granular Subscriptions:** Components subscribe to specific object paths. `useProjectConfig('maintenance')` only re-renders when `/maintenance` changes, preventing global re-renders.
- **V1 Fetch Model:** The core SDK performs an HTTP fetch on initialization and caches the result. The browser's `Cache-Control` handling prevents redundant network requests within the TTL window. The SDK re-fetches when the page regains visibility (via `visibilitychange` event). No explicit polling interval — the browser cache acts as a free CDN.
- **Implementation Note:** The vanilla core must expose a pub/sub event emitter with granular key-path subscriptions from day one — this is foundational for all SDK wrappers. In React, `useProjectConfig` and `useUserState` should use `useSyncExternalStore` (not `useState`/`Context`) to subscribe to the core's event emitter. This avoids context-wide re-renders and gives React concurrent-mode compatibility for free.

### Network Optimization (V2+)

- **Request Batching:** Collect all `useUserState` key requests within a ~5ms window on mount to fire a single batched `GET` request.
- **Optimistic Updates:** On setter call, update the local cache immediately → re-render all subscribers → send the patch to the server.
- **Rollbacks:** If a backend `test` operation fails or the WebSocket connection drops during a write, the SDK rolls back the local cache to the last known server state, populates the `error` field, and fires `onConflict` if provided.

### Payload Routing (V2+)

When `setProfile(payload)` is called, the SDK applies the following logic:

1. If `payload` is an **Array**, treat it as a raw JSON Patch array and send it directly.
2. If `payload` is an **Object**, iterate over its keys:
   - If a value is a **modifier sentinel** (e.g., `increment(1)`), generate the corresponding custom op.
   - If a value is a **plain value**, generate a `replace` op.
   - Combine all generated ops into a single atomic patch array.

---

## 9. Explicitly Out of Scope (V1)

By choosing JSON Patch over Event Sourcing and CRDTs, the following use cases are unsupported by design:

- **Real-time Push (V1):** SSE/WebSocket streaming for project-level config is out of scope for V1 due to infrastructure costs. The polling + Cache-Control model provides sufficient freshness for remote config use cases. May be revisited in future versions if demand warrants.
- **Configurable Environments:** Environments are a fixed set (development/staging/production), not user-configurable. This simplifies the data model and enables tier-based caching/rate-limiting.
- **CDN (V1):** No CDN in front of the config API in V1. Browser Cache-Control headers provide client-side caching. CDN is a future optimization.
- **ETags (V1):** No ETag-based conditional requests in V1. Full JSON response on every cache miss. ETags deferred to when CDN is introduced.
- **True Offline-First Collaboration:** Long-term offline edits will overwrite online progress upon reconnection.
- **Real-time Text Editing:** Concurrent character-by-character typing in the same text field (requires CRDTs).
- **Concurrent Deep Array Reordering:** Simultaneous drag-and-drop actions on the exact same nested array elements may result in index shifting or dropped patches.
- **UI Components:** SkyState does not and will not ship rendered components. All conflict resolution and atomic operation logic is exposed through hooks and modifiers.
- **Physics / High-Frequency Sync:** SkyState is not designed for 30–60fps positional updates. WebSocket + JSON Patch introduces too much latency and bandwidth overhead for real-time physics. Developers needing this should use dedicated Netcode solutions alongside SkyState for their lobby/inventory/turn state.

### Size Guidance

Session state blobs (V3) should be kept reasonably small. Large blobs (500KB+) will degrade performance on reconnection (full snapshot transfer) and increase patch application overhead. If your session state approaches this range, consider splitting it across multiple session keys or moving infrequently-changing data to the User level. Formal size limits will be established based on beta usage patterns.

---

## 10. Release Phasing

### V1 — Remote Config

- **Backend:** Project-level config API with Cache-Control-based polling. Fixed environments (dev/staging/prod) with tier-based TTLs and rate limits.
- **SDK:** React only. `useProjectConfig` hook with browser-cache-aware fetching and page visibility re-fetch.
- **Dashboard:** Project creation, config editor, basic monitoring.
- **CLI:** `skystate config push/pull/diff` for config management. `skystate settings` for CLI configuration.
- **Use cases:** Feature flags, maintenance banners, kill switches, A/B config, remote announcements.

### V2 — User State & Multi-Framework

- **Backend:** User-level state APIs. JSON Patch with custom `increment`/`decrement` ops.
- **Auth:** Thin login page powered by Firebase. Zero-config for developers.
- **SDK:** Vanilla JS/TS core extraction. Svelte and Vue SDKs. React SDK extended with `useUserState`.
- **Use cases:** User preferences, saved progress, inventory, profile data, persistent per-user state.

### V3 — Session Sync & BYOA

- **Backend:** Session-level state APIs. WebSocket session sync. BYOA token validation.
- **SDK:** `useSessionState` across all frameworks. Optimistic updates, rollback, `onConflict`.
- **Auth:** BYOA support for Clerk, Supabase, custom JWTs.
- **Use cases:** Casual multiplayer, turn-based games, lobbies, collaborative app state, shared scoreboards.

### Not scoped

- Non-web SDKs (Godot, Unity, Python).
- Modifier expansion beyond `increment`/`decrement`.
- Formal blob size limits or throttling policies.
- Self-hosted deployment option.

---

## 11. Open Questions

1. **Vanilla core extraction timing:** Should the vanilla JS/TS core be extracted before or during Svelte SDK development? Extracting first is cleaner but delays Svelte; extracting during risks muddying the boundaries.

3. **Modifier expansion (V3+):** Should the modifier set grow beyond `increment`/`decrement`? Candidates include `arrayAppend`, `arrayRemove`, `setIfNull`, `max`, `min`. To be evaluated based on developer demand during beta.

4. **Ordering guarantees (V3):** The exact interleaving semantics between local optimistic patches and incoming WebSocket patches from other clients needs to be specified in the Cache Manager design. What happens when a local optimistic `increment` is in flight and a remote `replace` arrives for the same path?

5. **Session lifecycle (V3):** How are sessions created and destroyed? Time-based expiry? Explicit teardown? What happens to session state when all clients disconnect — is it persisted, and for how long?

6. **Rate limiting & abuse:** ~~What per-connection or per-project patch rate limits should be enforced to prevent abuse?~~ **Partially resolved (V1):** V1 uses partitioned rate limiting per environment — strict (60 req/min) for dev/staging, generous/unlimited for production, scaled by tier. V3 abuse prevention (game loop scenarios) remains open.

7. **Reconnection semantics (V3):** When a WebSocket reconnects after a drop, does the client receive a full snapshot, a delta since last known state, or just resume the patch stream? Full snapshot is simplest but scales poorly for large state blobs.

8. **BYOA scope (V3):** Should BYOA support arbitrary JWKS URLs (maximum flexibility) or a curated list of providers (Clerk, Supabase, Auth0) with pre-built validation? Curated is less work and better documented; arbitrary is more flexible but harder to support.

9. **V1 config push semantics:** ~~Should config updates be atomic (full blob replace) or support granular patching from the dashboard?~~ **Resolved:** V1 uses full blob replace on every config publish. Feature flag and maintenance configs are typically under 10KB — the engineering overhead of diffing, patch generation, and missed-patch recovery is not justified. Full replacement guarantees eventual consistency and keeps the V1 backend minimal. Granular patching deferred to V2+.

10. **V1 delivery model:** ~~Should V1 use SSE for real-time push or HTTP polling?~~ **Resolved:** V1 uses HTTP polling with browser Cache-Control headers acting as a "free CDN". SSE was rejected due to infrastructure costs (long-lived connections require `min-instances=max-instances=1`, no horizontal scaling). The polling model provides sufficient freshness for remote config use cases — production configs update within 1-15 minutes depending on tier, development environments within 10 seconds.