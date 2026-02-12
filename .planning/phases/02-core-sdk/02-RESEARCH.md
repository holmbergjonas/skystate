# Phase 2: Core SDK - Research

**Researched:** 2026-03-05
**Domain:** TypeScript SDK architecture -- ConfigStore with cache, pub/sub, HTTP polling
**Confidence:** HIGH

## Summary

Phase 2 builds the `@skystate/core` package into a proper config store engine. The core challenge is designing three composable pieces -- ConfigCache (stable object identity), PubSubEmitter (path-level subscriptions), and HttpClient (Cache-Control-aware polling with visibility-change triggers) -- that compose into a ConfigStore compatible with React's `useSyncExternalStore` in Phase 3.

The existing codebase has a minimal `fetchSettings` function, `SkyStateError` class, and type definitions. The API response shape changed in Phase 1 from `{ state }` to `{ config }`, so the existing `StateEnvelope` type must be renamed to `ConfigEnvelope`. The package must also be relocated from `packages/typescript/core/` to `packages/core/` as the first task.

**Primary recommendation:** Build three focused classes (ConfigCache, PubSubEmitter, HttpClient) with a ConfigStore facade that composes them. ConfigCache owns structural sharing for stable object identity. PubSubEmitter provides `subscribe(path, callback)` + `getSnapshot(path)` compatible with `useSyncExternalStore`. HttpClient handles fetch, Cache-Control parsing, and visibility-change re-fetch. No external dependencies needed -- all implementable with standard Web APIs and ~300 lines of TypeScript.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- When a re-fetch fails after initial load, **keep serving cached config** but **surface the error** in the hook return (`{ value, isLoading, error }`)
- Every subscriber gets the error signal alongside the cached value -- no separate "opt-in" error channel
- No aggressive retry on fetch failure -- avoid thundering herd on a struggling API
- Visibility change still triggers re-fetch as normal
- Cache-Control expiry triggers the next natural re-fetch
- Conservative retry policy: Claude's discretion on whether a single delayed retry makes sense, but default is no retry
- SDK accepts `initialState` (from a local `skystate.config.json` file) as a constructor/provider option
- `skystate.config.json` is created by CLI: `skystate config pull --env <environment>`
- On app load: SDK serves `initialState` immediately with `isLoading: true`, starts HTTP fetch in background
- If fetch succeeds: live config replaces `initialState`, `isLoading: false`
- If fetch fails: `initialState` stays as current value, `error` is populated, `isLoading: false`
- If no `initialState` and fetch fails: pure error state, no config available
- Fallback chain for a specific key: (1) Live fetched value, (2) Key from `initialState`, (3) In-code fallback value, (4) `undefined` + error
- Core tracks `lastFetched: Date | null` and `error: Error | null`
- No `isStale` flag or connection state machine
- No manual `refetch()` method -- only automatic triggers (visibility change, Cache-Control expiry)
- Core HttpClient attaches `X-SkyState-Client` header: `@skystate/core/0.1.0`
- Core must allow the wrapper SDK to override/extend the header value
- Flatten `packages/typescript/core/` to `packages/core/` and `packages/typescript/react/` to `packages/react/`
- Package restructure is the **first task** before building the new engine

### Claude's Discretion
- Internal architecture of ConfigCache, PubSubEmitter, HttpClient composition
- Path resolution implementation (dot-notation traversal of config JSON)
- Object identity stability mechanism (structural sharing, snapshots, etc.)
- Whether to include a single delayed retry on fetch failure (conservative default: no)
- Test structure and tooling choices
- Whether existing `fetchSettings` function is refactored or replaced

### Deferred Ideas (OUT OF SCOPE)
- CLI `skystate config pull --env <env>` saving to `skystate.config.json` file format -- may need Phase 4 CLI work
- Backend logging of `X-SkyState-Client` header -- V2 scope (passive telemetry)
- Backend enforcement of minimum client version (`426 Upgrade Required`) -- V2 scope
- Manual `refetch()` method on ConfigStore -- not needed for V1
- ETag support for conditional requests -- deferred per Phase 1 decisions
- Non-TypeScript SDKs (Godot, Unity, Python) -- future

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-01 | ConfigCache stores config in memory with stable object identity for unchanged paths | Structural sharing pattern via recursive JSON comparison; `Object.is` identity preserved for unchanged subtrees -- see Architecture Pattern 1 |
| CORE-02 | PubSubEmitter provides granular key-path subscription registry with path-level notifications | Map-based subscriber registry keyed by dot-path; diff detection on cache update triggers only affected paths -- see Architecture Pattern 2 |
| CORE-03 | HttpClient fetches config via HTTP, respects Cache-Control, re-fetches on page visibility change | `document.visibilitychange` event + `max-age` timer scheduling; Cache-Control header parsing from `response.headers` -- see Architecture Pattern 3 |
| CORE-04 | ConfigStore composes cache + pub/sub + HTTP client; one instance per (apiUrl, project, env) tuple | Facade pattern composing three internal classes; singleton registry keyed by `${apiUrl}|${projectSlug}|${envSlug}` -- see Architecture Pattern 4 |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.9.3 | Language | Already used across project |
| tsc | (bundled) | Build tool | Already used for core package (no bundler) |
| Vitest | ^4.0.18 | Testing | Already used in CLI and dashboard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ESLint | ^10.0.2 | Linting | Match CLI convention (latest in project) |
| @eslint/js | ^10.0.1 | ESLint base config | Match CLI pattern |
| typescript-eslint | ^8.56.1 | TS ESLint rules | Match CLI pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom structural sharing | Immer / Immutable.js | Overkill -- config objects are small JSON, custom ~50-line recursive compare is sufficient and zero-dep |
| Custom Cache-Control parser | cache-control-parser npm | Overkill -- we only need `max-age` extraction, a regex suffices |
| Custom pub/sub | EventEmitter / mitt | Pub/sub needs path-level granularity not provided by generic emitters; custom is simpler than adapting |

**Installation:**
```bash
cd packages/core
npm install --save-dev typescript@~5.9.3 vitest@^4.0.18 eslint@^10.0.2 @eslint/js@^10.0.1 typescript-eslint@^8.56.1 globals
```

No runtime dependencies. The package uses only built-in browser/Node APIs (`fetch`, `document.visibilitychange`, `AbortController`).

## Architecture Patterns

### Recommended Project Structure (after restructure)
```
packages/
├── core/                    # @skystate/core (moved from packages/typescript/core/)
│   ├── src/
│   │   ├── index.ts         # Public exports
│   │   ├── types.ts         # ConfigEnvelope, Version, SkyStateConfig, etc.
│   │   ├── error.ts         # SkyStateError (kept from existing)
│   │   ├── config-cache.ts  # ConfigCache -- structural sharing + stable identity
│   │   ├── pubsub.ts        # PubSubEmitter -- path-level subscription registry
│   │   ├── http-client.ts   # HttpClient -- fetch + Cache-Control + visibility
│   │   └── config-store.ts  # ConfigStore -- facade composing the three above
│   ├── src/
│   │   ├── config-cache.test.ts
│   │   ├── pubsub.test.ts
│   │   ├── http-client.test.ts
│   │   └── config-store.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── eslint.config.js
├── react/                   # @skystate/react (moved from packages/typescript/react/)
│   ├── src/
│   │   ├── index.ts
│   │   └── use-settings.ts  # (existing, will be replaced in Phase 3)
│   ├── package.json
│   └── tsconfig.json
└── protocol/                # @skystate/protocol (stays in place)
```

Note: Tests are colocated with source files per project convention (`*.test.ts` alongside `*.ts`).

### Pattern 1: ConfigCache -- Structural Sharing for Stable Object Identity (CORE-01)

**What:** A cache that stores the current config and, on update, produces a new root object only where values actually changed. Unchanged subtrees keep the same object reference.

**When to use:** Every time a fetch returns new config data.

**Key insight:** Since `useSyncExternalStore` uses `Object.is` to decide whether to re-render, and the requirement is that `useProjectConfig('features.darkMode')` only re-renders when `features.darkMode` changes, the cache must preserve object identity for unchanged paths.

**Implementation approach:**
```typescript
// Recursive structural sharing -- returns previous reference for unchanged subtrees
function structuralShare<T>(prev: T, next: T): T {
  // Same primitive or same reference? Return prev (stable identity)
  if (Object.is(prev, next)) return prev;

  // Not both objects? Value changed, return next
  if (
    typeof prev !== 'object' || prev === null ||
    typeof next !== 'object' || next === null
  ) {
    return next;
  }

  // Arrays: compare element by element
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return next;
    let allSame = true;
    const shared = next.map((item, i) => {
      const result = structuralShare(prev[i], item);
      if (result !== prev[i]) allSame = false;
      return result;
    });
    return allSame ? prev : (shared as T);
  }

  // Objects: compare key by key
  const prevObj = prev as Record<string, unknown>;
  const nextObj = next as Record<string, unknown>;
  const prevKeys = Object.keys(prevObj);
  const nextKeys = Object.keys(nextObj);
  if (prevKeys.length !== nextKeys.length) return next;

  let allSame = true;
  const shared: Record<string, unknown> = {};
  for (const key of nextKeys) {
    if (!(key in prevObj)) return next;
    shared[key] = structuralShare(prevObj[key], nextObj[key]);
    if (shared[key] !== prevObj[key]) allSame = false;
  }
  return allSame ? prev : (shared as T);
}
```

**ConfigCache class interface:**
```typescript
class ConfigCache {
  private config: unknown = undefined;
  private envelope: ConfigEnvelope | null = null;

  /** Update cache with new data. Returns list of changed dot-paths. */
  update(envelope: ConfigEnvelope): string[];

  /** Get value at a dot-separated path. Returns stable reference. */
  get(path: string): unknown;

  /** Get entire config. Returns stable reference. */
  getConfig(): unknown;

  /** Get full envelope (version, lastModified, config). */
  getEnvelope(): ConfigEnvelope | null;
}
```

**How changed paths are detected:** After structural sharing, walk both old and new config trees. For each path where `Object.is(old, new)` is false, add that dot-path (and all ancestor paths) to the changed set.

**Critical detail:** The root path `""` (empty string) should be treated as "entire config" subscription. Any change triggers root subscribers.

### Pattern 2: PubSubEmitter -- Path-Level Subscription Registry (CORE-02)

**What:** A subscription manager where listeners register for specific dot-paths and only get called when their path's value changes.

**When to use:** React hooks subscribe to specific paths; ConfigStore calls `emit(changedPaths)` after each cache update.

**Interface (useSyncExternalStore compatible):**
```typescript
class PubSubEmitter {
  /** Subscribe a callback to a specific path. Returns unsubscribe function. */
  subscribe(path: string, callback: () => void): () => void;

  /** Notify all subscribers whose paths are in the changed set. */
  emit(changedPaths: Set<string>): void;

  /** Get count of active subscriptions (for debugging/testing). */
  get size(): number;

  /** Remove all subscriptions (for dispose). */
  clear(): void;
}
```

**Implementation:** A `Map<string, Set<() => void>>` keyed by dot-path. When `emit` is called with a set of changed paths, iterate the map and call callbacks for matching paths. The root path `""` matches all changes.

**useSyncExternalStore compatibility:** React's `useSyncExternalStore(subscribe, getSnapshot)` expects:
- `subscribe(callback)` returns an unsubscribe function
- `getSnapshot()` returns a referentially stable value (compared via `Object.is`)

The PubSubEmitter provides the `subscribe` half. The `getSnapshot` half comes from ConfigCache's `get(path)` which returns stable references via structural sharing.

### Pattern 3: HttpClient -- Fetch + Cache-Control + Visibility (CORE-03)

**What:** An HTTP client that fetches config from the API, respects Cache-Control max-age for re-fetch scheduling, and triggers re-fetch on page visibility change.

**Key behaviors:**
1. **Initial fetch:** On creation, immediately fetch config
2. **Cache-Control max-age:** Parse `Cache-Control: public, max-age=60` from response headers. Schedule next fetch after `max-age` seconds using `setTimeout`.
3. **Visibility change:** Listen for `document.visibilitychange`. When `document.visibilityState === 'visible'`, trigger re-fetch if the previous max-age timer has expired.
4. **Error handling:** On fetch failure after initial load, keep cached config, surface error.
5. **Telemetry header:** Attach `X-SkyState-Client: @skystate/core/0.1.0` to every request.

**Cache-Control parsing:**
```typescript
function parseMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = cacheControl.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
```

**Visibility change pattern:**
```typescript
// Only in browser environments (check for document existence)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      this.onVisibilityChange();
    }
  });
}
```

**Re-fetch scheduling logic:**
```
After successful fetch:
  1. Parse max-age from response headers
  2. Record fetchedAt = Date.now()
  3. Schedule setTimeout(refetch, maxAge * 1000)

On visibility change (page becomes visible):
  1. If Date.now() - fetchedAt >= maxAge * 1000 → refetch immediately
  2. Otherwise → no-op (data still fresh per Cache-Control)
```

**API response shape (from OpenAPI spec / Phase 1):**
```json
{
  "version": { "major": 1, "minor": 0, "patch": 0 },
  "lastModified": "2025-01-15T10:30:00.0000000Z",
  "config": { "level": 1, "score": 0 }
}
```

**IMPORTANT:** The API returns `config` (not `state`). The existing `StateEnvelope` type has `.state`. This must be updated to `ConfigEnvelope` with `.config`.

**URL pattern:** `GET /project/{projectSlug}/config/{environmentSlug}` (from Phase 1).

### Pattern 4: ConfigStore -- Facade Composition (CORE-04)

**What:** The public-facing class that composes ConfigCache + PubSubEmitter + HttpClient. One instance per `(apiUrl, projectSlug, environmentSlug)` tuple.

**Constructor options:**
```typescript
interface ConfigStoreOptions {
  apiUrl: string;
  projectSlug: string;
  environmentSlug: string;
  initialConfig?: unknown;        // From skystate.config.json
  clientHeader?: string;          // Override for wrapper SDKs (e.g., @skystate/react/0.1.0)
}
```

**Public API (designed for useSyncExternalStore consumption in Phase 3):**
```typescript
class ConfigStore {
  constructor(options: ConfigStoreOptions);

  /** Subscribe to changes at a specific path. Returns unsubscribe. */
  subscribe(path: string, callback: () => void): () => void;

  /** Get snapshot at path. Returns stable reference via structural sharing. */
  getSnapshot(path: string): unknown;

  /** Get loading state. */
  get isLoading(): boolean;

  /** Get last error (null if no error). */
  get error(): Error | null;

  /** Get last successful fetch timestamp. */
  get lastFetched(): Date | null;

  /** Clean up: cancel timers, remove visibility listener, clear subscriptions. */
  dispose(): void;
}
```

**Singleton registry:**
```typescript
const stores = new Map<string, ConfigStore>();

function getOrCreateStore(options: ConfigStoreOptions): ConfigStore {
  const key = `${options.apiUrl}|${options.projectSlug}|${options.environmentSlug}`;
  let store = stores.get(key);
  if (!store) {
    store = new ConfigStore(options);
    stores.set(key, store);
  }
  return store;
}
```

**initialConfig flow:**
1. If `initialConfig` provided, seed ConfigCache immediately
2. Set `isLoading: true` and begin HTTP fetch
3. On fetch success: update cache (structural sharing), set `isLoading: false`, emit changed paths
4. On fetch failure: keep `initialConfig` in cache, set `error`, set `isLoading: false`, emit (error changed)

### Anti-Patterns to Avoid

- **Creating new objects in getSnapshot:** `useSyncExternalStore` calls `getSnapshot` on every render. If it returns a new object each time, React enters an infinite re-render loop. The ConfigCache must return cached references.
- **Subscribing to the whole config when only one path is needed:** Defeats the purpose of path-level granularity. Each `useProjectConfig('path')` must subscribe only to that path.
- **Polling on a fixed interval:** The API sends `Cache-Control: public, max-age=N` with values from 10s (dev) to 900s (free/prod). Respect this instead of hardcoding an interval.
- **Fetching when the page is hidden:** Wasted requests. Only fetch on visibility change (page becomes visible) or when max-age timer expires while the page is visible.
- **Re-creating ConfigStore on every React render:** Must be a singleton per (apiUrl, project, env) tuple, typically held by a Provider.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deep equality comparison | Custom JSON.stringify comparison | Recursive structural sharing with Object.is | Structural sharing preserves references, stringify doesn't |
| Event system | Generic EventEmitter adaptation | Custom path-keyed Map<string, Set<callback>> | Path-level granularity is the core requirement; generic emitters add indirection |
| HTTP caching | Full HTTP cache layer | Parse only `max-age` from Cache-Control header | We only need re-fetch scheduling, not a full cache layer |

**Key insight:** This SDK is deliberately minimal (zero runtime dependencies). Every piece is small enough to implement correctly in <100 lines. The complexity is in the composition, not the individual parts.

## Common Pitfalls

### Pitfall 1: getSnapshot Returns New Object Every Call
**What goes wrong:** React detects different reference via `Object.is`, re-renders, calls getSnapshot again, gets new object, infinite loop.
**Why it happens:** Wrapping the cached value in a new object like `{ value: cache.get(path) }` in the getSnapshot function.
**How to avoid:** `getSnapshot` must return the exact reference from ConfigCache. Any wrapping (adding `isLoading`, `error`) must happen in the hook layer (Phase 3), not in the store's getSnapshot.
**Warning signs:** "Maximum update depth exceeded" error in React, or `getSnapshot` warning in console.

### Pitfall 2: Structural Sharing Mishandles Arrays
**What goes wrong:** Arrays of objects where order changes (e.g., `[{id:1}, {id:2}]` vs `[{id:2}, {id:1}]`) are compared positionally, causing unnecessary identity changes.
**Why it happens:** Naive index-by-index comparison doesn't account for reordering.
**How to avoid:** For V1 remote config use case, positional comparison is correct and sufficient. Config values are set by developers (not reordered by users). Document this as a known limitation.
**Warning signs:** Unnecessary re-renders when config array contents didn't actually change.

### Pitfall 3: Timer Leak on Dispose
**What goes wrong:** `setTimeout` for max-age re-fetch fires after ConfigStore is disposed, causing fetch on a destroyed store.
**Why it happens:** Forgetting to `clearTimeout` in dispose, or not removing the `visibilitychange` event listener.
**How to avoid:** Track all active timer IDs and event listeners. `dispose()` clears them all. Set a `disposed` flag and check it before any async callback executes.
**Warning signs:** Fetch errors in console after navigating away from a page that used SkyState.

### Pitfall 4: TypeScript Module Resolution After Move
**What goes wrong:** After moving `packages/typescript/core/` to `packages/core/`, the `@skystate/react` package can't find `@skystate/core`.
**Why it happens:** `file:../core` path in `@skystate/react`'s package.json now points to wrong location. TypeScript project references also break.
**How to avoid:** Update ALL cross-references in the same task: (1) `package.json` dependency path `file:../../typescript/core` -> `file:../core`, (2) `tsconfig.json` project references, (3) Any workspace config.
**Warning signs:** `Cannot find module '@skystate/core'` errors.

### Pitfall 5: Response Shape Mismatch (state vs config)
**What goes wrong:** SDK expects `response.state` but API now returns `response.config`.
**Why it happens:** Phase 1 renamed the URL and response field from `state` to `config`, but the SDK types weren't updated.
**How to avoid:** Rename `StateEnvelope` to `ConfigEnvelope`, change `.state` to `.config`. This is a breaking change to the SDK's public API types.
**Warning signs:** `config` value is always `undefined` despite successful fetch.

### Pitfall 6: SSR / Node.js Environment Crash
**What goes wrong:** `document is not defined` error when running in Node.js (SSR, tests).
**Why it happens:** Referencing `document.addEventListener('visibilitychange', ...)` without guarding.
**How to avoid:** Guard all browser-only APIs with `typeof document !== 'undefined'`. In Node/test environments, visibility features simply don't activate.
**Warning signs:** Server-side render crash, test failures.

## Code Examples

### Cache-Control max-age Parsing
```typescript
// Source: Standard HTTP Cache-Control header format (MDN)
function parseMaxAge(headers: Headers): number | null {
  const cc = headers.get('cache-control');
  if (!cc) return null;
  const match = cc.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
```

### Dot-Path Resolution
```typescript
// Resolve 'features.darkMode' against a config object
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
```

### Visibility Change with Freshness Check
```typescript
// Source: MDN Page Visibility API
private setupVisibilityListener(): void {
  if (typeof document === 'undefined') return;

  this.visibilityHandler = () => {
    if (document.visibilityState === 'visible' && this.isCacheExpired()) {
      this.refetch();
    }
  };
  document.addEventListener('visibilitychange', this.visibilityHandler);
}

private isCacheExpired(): boolean {
  if (!this.fetchedAt || !this.maxAgeMs) return true;
  return Date.now() - this.fetchedAt >= this.maxAgeMs;
}
```

### useSyncExternalStore-Compatible Subscribe/GetSnapshot
```typescript
// This is what Phase 3's React hook will consume:
// const value = useSyncExternalStore(
//   (cb) => store.subscribe('features.darkMode', cb),
//   () => store.getSnapshot('features.darkMode')
// );

// subscribe returns unsubscribe function -- matches useSyncExternalStore contract
subscribe(path: string, callback: () => void): () => void {
  return this.pubsub.subscribe(path, callback);
}

// getSnapshot returns stable reference -- matches Object.is requirement
getSnapshot(path: string): unknown {
  return this.cache.get(path);
}
```

### Telemetry Header with Override Support
```typescript
// Default: '@skystate/core/0.1.0'
// React override: '@skystate/react/0.1.0 (@skystate/core/0.1.0)'
private buildHeaders(): HeadersInit {
  const clientHeader = this.clientHeaderOverride
    ?? `@skystate/core/${VERSION}`;

  return {
    'Accept': 'application/json',
    'X-SkyState-Client': clientHeader,
  };
}
```

## State of the Art

| Old Approach (current SDK) | New Approach (Phase 2) | Impact |
|---------------------------|------------------------|--------|
| `fetchSettings()` -- one-shot fetch, no caching | ConfigStore -- cached, auto-refreshing | Components always have latest config |
| `StateEnvelope` with `.state` property | `ConfigEnvelope` with `.config` property | Matches Phase 1 API response |
| URL: `/state/{projectSlug}/{envSlug}` | URL: `/project/{projectSlug}/config/{envSlug}` | Matches Phase 1 URL restructure |
| `useState` + `useEffect` in React hook | `useSyncExternalStore` compatibility (Phase 3) | Concurrent-safe, no tearing |
| No re-fetch capability | Cache-Control + visibility change re-fetch | Config stays fresh |
| `packages/typescript/core/` | `packages/core/` | Flatter, cleaner structure |

**Deprecated/outdated:**
- `fetchSettings` function: Will be replaced by HttpClient class
- `StateEnvelope` type: Renamed to `ConfigEnvelope` with `.config` instead of `.state`
- `useSettings` hook (in react package): Will be replaced in Phase 3, but temporarily updated to import from new location
- `FetchSettingsOptions` type: Replaced by `ConfigStoreOptions`

## Open Questions

1. **Timer behavior when page is hidden for extended periods**
   - What we know: Browsers throttle/suspend `setTimeout` in background tabs
   - What's unclear: If a max-age timer fires while the tab is hidden, should the re-fetch happen immediately or wait for visibility change?
   - Recommendation: Do NOT fetch while hidden. On visibility change, check if cache is expired and fetch if so. This avoids wasted requests and works correctly with browser throttling.

2. **ConfigStore disposal and re-creation**
   - What we know: One ConfigStore per (apiUrl, project, env) tuple via singleton registry
   - What's unclear: When should a singleton entry be removed from the registry?
   - Recommendation: `dispose()` removes from registry. React Provider calls `dispose()` on unmount (Phase 3). New mount creates fresh instance.

3. **initialConfig type safety**
   - What we know: `initialConfig` is `unknown` since it comes from a JSON file
   - What's unclear: Should ConfigStore accept a generic type parameter `ConfigStore<T>` for type-safe path access?
   - Recommendation: Keep `unknown` in core. Type narrowing happens in React hooks via `useProjectConfig<T>(path, fallback)` in Phase 3. Core is type-agnostic.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `packages/core/vitest.config.ts` -- needs creation in Wave 0 |
| Quick run command | `cd packages/core && npx vitest run` |
| Full suite command | `cd packages/core && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | ConfigCache structural sharing preserves identity for unchanged paths | unit | `cd packages/core && npx vitest run src/config-cache.test.ts` | No -- Wave 0 |
| CORE-01 | ConfigCache returns new references only for changed subtrees | unit | `cd packages/core && npx vitest run src/config-cache.test.ts` | No -- Wave 0 |
| CORE-02 | PubSubEmitter notifies only subscribers of changed paths | unit | `cd packages/core && npx vitest run src/pubsub.test.ts` | No -- Wave 0 |
| CORE-02 | PubSubEmitter subscribe returns working unsubscribe function | unit | `cd packages/core && npx vitest run src/pubsub.test.ts` | No -- Wave 0 |
| CORE-03 | HttpClient fetches from correct URL with correct headers | unit | `cd packages/core && npx vitest run src/http-client.test.ts` | No -- Wave 0 |
| CORE-03 | HttpClient parses Cache-Control max-age and schedules re-fetch | unit | `cd packages/core && npx vitest run src/http-client.test.ts` | No -- Wave 0 |
| CORE-03 | HttpClient re-fetches on visibility change when cache expired | unit | `cd packages/core && npx vitest run src/http-client.test.ts` | No -- Wave 0 |
| CORE-04 | ConfigStore composes cache + pubsub + http; initial fetch populates cache | unit | `cd packages/core && npx vitest run src/config-store.test.ts` | No -- Wave 0 |
| CORE-04 | ConfigStore serves initialConfig immediately, replaces on fetch success | unit | `cd packages/core && npx vitest run src/config-store.test.ts` | No -- Wave 0 |
| CORE-04 | ConfigStore keeps cached config on re-fetch failure, surfaces error | unit | `cd packages/core && npx vitest run src/config-store.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/core && npx vitest run`
- **Per wave merge:** `cd packages/core && npx vitest run && cd ../react && npx tsc --noEmit`
- **Phase gate:** Full suite green + `tsc --noEmit` passes for both core and react packages

### Wave 0 Gaps
- [ ] `packages/core/vitest.config.ts` -- test configuration (match CLI pattern)
- [ ] `packages/core/eslint.config.js` -- lint configuration (match CLI pattern)
- [ ] `packages/core/package.json` -- add test/lint scripts, add vitest + eslint devDependencies
- [ ] Framework install: `cd packages/core && npm install --save-dev vitest@^4.0.18 eslint@^10.0.2 @eslint/js@^10.0.1 typescript-eslint@^8.56.1 globals`
- [ ] Note: The package restructure (`packages/typescript/core/` -> `packages/core/`) must happen first, before any test infrastructure is set up

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/typescript/core/src/` -- current types, error class, fetch function
- Existing codebase: `packages/protocol/openapi.json` -- API response shape (ConfigEnvelope with `config` field)
- Existing codebase: `api/SkyState.Api/Endpoints/PublicConfigEndpoints.cs` -- Cache-Control implementation (tier-based max-age from 10s to 900s)
- [React Official Docs: useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) -- subscribe/getSnapshot contract, Object.is comparison, immutability requirement
- [MDN: Document visibilitychange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) -- Page Visibility API
- [MDN: Cache-Control header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) -- max-age directive format

### Secondary (MEDIUM confidence)
- [Epic React: useSyncExternalStore Demystified](https://www.epicreact.dev/use-sync-external-store-demystified-for-practical-react-development-w5ac0) -- practical patterns
- [Structural Sharing definition](https://generalistprogrammer.com/glossary/structural-sharing) -- concept verification

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use across the project, versions confirmed from package.json files
- Architecture: HIGH -- patterns verified against React official docs (useSyncExternalStore contract), MDN (Page Visibility API, Cache-Control), and existing codebase (API response shape, Cache-Control implementation)
- Pitfalls: HIGH -- derived from React docs (getSnapshot stability requirement), codebase inspection (state->config rename), and standard browser API caveats (SSR safety)

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain -- no fast-moving dependencies)
