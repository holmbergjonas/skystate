---
phase: 02-core-sdk
verified: 2026-03-05T11:36:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 2: Core SDK Verification Report

**Phase Goal:** The @skystate/core package provides a ConfigStore that maintains a cached copy of project config with granular path-level change notifications, fetched via HTTP polling
**Verified:** 2026-03-05T11:36:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ConfigStore fetches config via HTTP and keeps an in-memory cache that updates on re-fetch | VERIFIED | `config-store.ts` constructs `HttpClient`, calls `http.start()` in constructor, `handleUpdate` calls `cache.update(envelope)` on each response. Tests: "after successful fetch -> isLoading=false, getSnapshot returns fetched values" passes. |
| 2 | Subscribing to a specific key path (e.g., `features.darkMode`) only triggers the callback when that path's value changes, not on unrelated config changes | VERIFIED | `PubSubEmitter.emit()` iterates registry and calls only callbacks whose registered path is in the `changedPaths` Set. `ConfigCache.update()` returns only changed dot-paths via structural sharing. Test: "subscribe + emit non-matching path does not call callback" passes. ConfigStore test confirms callback fires on path match and not on prior subscription before related change. |
| 3 | ConfigStore performs an initial HTTP fetch so the first config value is available immediately | VERIFIED | `ConfigStore` constructor calls `this.http.start()` unconditionally. With `initialConfig`, `cache.update(syntheticEnvelope)` is called before `http.start()`, making values available immediately. Test: "constructor with initialConfig -> getSnapshot returns values immediately, isLoading=true" passes. |
| 4 | ConfigStore re-fetches on page visibility change and respects Cache-Control headers from the API | VERIFIED | `HttpClient.setupVisibilityListener()` attaches `visibilitychange` event listener (guarded by `typeof document !== 'undefined'`). `onVisibilityChange()` re-fetches when `elapsed >= maxAgeMs`. `parseMaxAge()` extracts `max-age` from `Cache-Control` header via regex. Tests: "visibility change triggers re-fetch when cache expired" and "Cache-Control max-age=60 schedules re-fetch after 60 seconds" both pass. |
| 5 | Object identity is stable for unchanged paths — `Object.is(prevSnapshot, nextSnapshot)` returns true when the config has not changed | VERIFIED | `structuralShare()` in `config-cache.ts` recursively compares prev/next and returns the prev reference when deeply equal. Test: "identical update returns empty changedPaths and preserves identity" asserts `Object.is(cache.get('features'), prevFeatures)` is true; sibling test also asserts sibling path references are preserved when only one path changes. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/config-cache.ts` | ConfigCache class with structural sharing and path resolution | VERIFIED | 213 lines. Exports `ConfigCache`. Contains `structuralShare`, `collectChangedPaths`, `getByPath`. Imports `ConfigEnvelope` from `./types.js`. |
| `packages/core/src/config-cache.test.ts` | Unit tests for ConfigCache | VERIFIED | 171 lines. 12 tests covering identity preservation, path resolution, arrays, nulls, primitives. All pass. |
| `packages/core/src/pubsub.ts` | PubSubEmitter class with path-keyed subscription registry | VERIFIED | 64 lines. Exports `PubSubEmitter`. Uses `Map<string, Set<() => void>>` with boolean guard for idempotent unsubscribe. |
| `packages/core/src/pubsub.test.ts` | Unit tests for PubSubEmitter | VERIFIED | 137 lines. 10 tests covering subscribe, emit, unsubscribe, clear, size, non-matching paths. All pass. |
| `packages/core/src/http-client.ts` | HttpClient with fetch, Cache-Control, visibility change | VERIFIED | 193 lines. Exports `HttpClient`. Constructs URL as `/project/{slug}/config/{envSlug}`, attaches `X-SkyState-Client` header, parses `Cache-Control max-age`, handles visibility change. |
| `packages/core/src/http-client.test.ts` | Unit tests for HttpClient | VERIFIED | 425 lines. 11 tests covering URL construction, headers, scheduling, visibility, dispose. All pass. |
| `packages/core/src/config-store.ts` | ConfigStore facade and getOrCreateStore singleton factory | VERIFIED | 157 lines. Exports `ConfigStore` and `getOrCreateStore`. Composes ConfigCache + PubSubEmitter + HttpClient. `subscribe`/`getSnapshot` are useSyncExternalStore-compatible. |
| `packages/core/src/config-store.test.ts` | Unit tests for ConfigStore | VERIFIED | 321 lines. 15 tests covering init, fetch, subscribe, dispose, singleton. All pass. |
| `packages/core/package.json` | Core package manifest with test/lint/build scripts | VERIFIED | Contains `vitest`, `eslint`, `typescript-eslint` devDependencies. Scripts: `test`, `test:watch`, `lint`, `build`, `typecheck`. |
| `packages/core/vitest.config.ts` | Test configuration for core package | VERIFIED | Contains `defineConfig`, `globals: true`, `environment: 'node'`, `include: ['src/**/*.test.ts']`, `passWithNoTests: true`. |
| `packages/core/eslint.config.js` | ESLint flat config matching CLI pattern | VERIFIED | Contains `tseslint`, `js.configs.recommended`, `tseslint.configs.recommended`. Matches CLI pattern exactly. |
| `packages/core/src/types.ts` | ConfigEnvelope, ConfigStoreOptions, Version types | VERIFIED | `ConfigEnvelope.config: unknown` (not `.state`). `ConfigStoreOptions` includes `initialConfig?: unknown` and `clientHeader?: string`. |
| `packages/react/package.json` | React package with correct core dependency path | VERIFIED | `"@skystate/core": "file:../core"` — correct flattened path. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/react/package.json` | `packages/core/` | `file:../core` dependency | VERIFIED | `"@skystate/core": "file:../core"` confirmed in react/package.json. `npx tsc --noEmit` passes for react package. |
| `packages/react/tsconfig.json` | `packages/core/` | TypeScript project reference | VERIFIED | `"references": [{ "path": "../core" }]` confirmed. |
| `packages/core/src/types.ts` | API response shape | `config: unknown` field (not `.state`) | VERIFIED | `ConfigEnvelope.config: unknown` matches Phase 1 OpenAPI spec shape. |
| `packages/core/src/config-cache.ts` | `packages/core/src/types.ts` | imports `ConfigEnvelope` | VERIFIED | Line 1: `import type { ConfigEnvelope } from './types.js'` |
| `packages/core/src/http-client.ts` | `packages/core/src/types.ts` | imports `ConfigEnvelope` | VERIFIED | Line 1: `import type { ConfigEnvelope } from './types.js'` |
| `packages/core/src/http-client.ts` | API endpoint | URL construction `/project/{slug}/config/` | VERIFIED | `buildUrl()` returns `` `${this.apiUrl}/project/${this.projectSlug}/config/${this.environmentSlug}` `` |
| `packages/core/src/config-store.ts` | `config-cache.ts` | composes ConfigCache | VERIFIED | Line 3: `import { ConfigCache } from './config-cache.js'`. Used in constructor: `this.cache = new ConfigCache()`. |
| `packages/core/src/config-store.ts` | `pubsub.ts` | composes PubSubEmitter | VERIFIED | Line 4: `import { PubSubEmitter } from './pubsub.js'`. Used in constructor: `this.pubsub = new PubSubEmitter()`. |
| `packages/core/src/config-store.ts` | `http-client.ts` | composes HttpClient | VERIFIED | Line 5: `import { HttpClient } from './http-client.js'`. Used in constructor: `this.http = new HttpClient(...)`. |
| `packages/core/src/index.ts` | All components | public exports | VERIFIED | Exports `ConfigStore`, `getOrCreateStore`, `ConfigCache`, `PubSubEmitter`, `HttpClient`, `SkyStateError`, and all types. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORE-01 | 02-01, 02-02 | ConfigCache stores config in memory with stable object identity for unchanged paths | SATISFIED | `config-cache.ts` implements structural sharing via `structuralShare()`. `Object.is` identity preserved for unchanged subtrees. 12 tests passing including "identical update returns empty changedPaths and preserves identity". |
| CORE-02 | 02-02 | PubSubEmitter provides granular key-path subscription registry with path-level notifications | SATISFIED | `pubsub.ts` implements `Map<string, Set<callback>>` registry. `emit()` calls only callbacks whose registered path is in `changedPaths`. 10 tests passing including "subscribe + emit non-matching path does not call callback". |
| CORE-03 | 02-03 | HttpClient fetches config via HTTP, respects Cache-Control, re-fetches on page visibility change | SATISFIED | `http-client.ts` fetches from `/project/{slug}/config/{envSlug}`, parses `max-age` from `Cache-Control` and schedules re-fetch via `setTimeout`, listens for `visibilitychange` and re-fetches when cache expired. 11 tests passing. SSR guard: `typeof document !== 'undefined'`. |
| CORE-04 | 02-01, 02-03 | ConfigStore composes cache + pub/sub + HTTP client; one instance per (apiUrl, project, env) tuple | SATISFIED | `config-store.ts` composes all three. `getOrCreateStore()` maintains a module-level `Map<string, ConfigStore>` keyed by `apiUrl|projectSlug|environmentSlug`. `dispose()` removes from registry. 15 tests passing including singleton tests. |

All 4 requirements in scope for Phase 2 are SATISFIED. No orphaned requirements.

---

### Anti-Patterns Found

No anti-patterns detected in phase-modified files.

| File | Pattern | Severity | Result |
|------|---------|----------|--------|
| All `packages/core/src/*.ts` | TODO/FIXME/placeholder comments | Scanned | None found |
| Implementation files | `return null` / `return {}` / `return []` stubs | Scanned | Only legitimate returns (e.g., `return []` for "no changed paths") — not stubs |
| Implementation files | Console.log-only handlers | Scanned | None found |

---

### Human Verification Required

None. All success criteria are verifiable programmatically through the test suite. The 48 tests cover all observable behaviors including HTTP fetch, Cache-Control scheduling, visibility change, structural sharing, and singleton deduplication.

---

### Test Suite Summary

```
 PASS  src/pubsub.test.ts         (10 tests)
 PASS  src/config-cache.test.ts   (12 tests)
 PASS  src/config-store.test.ts   (15 tests)
 PASS  src/http-client.test.ts    (11 tests)

 Test Files  4 passed (4)
       Tests  48 passed (48)
```

TypeScript strict mode: CLEAN (both `packages/core` and `packages/react`)
ESLint zero-warnings: CLEAN

---

### Additional Notes

**Test Coverage Nuance (non-blocking):** The ConfigStore test "subscribe(path, cb) fires cb only when that path changes on update" (line 113) does not exercise a full re-fetch cycle for path selectivity — the comment in the test acknowledges difficulty triggering a scheduled re-fetch without Cache-Control. However, this behavior is fully covered at the unit level: `PubSubEmitter` test "subscribe + emit non-matching path does not call callback" directly verifies selective dispatch, and the wiring in `config-store.ts` (lines 123-125) correctly passes `changedPaths` from `ConfigCache.update()` directly to `PubSubEmitter.emit()`. The unit test coverage is sufficient to establish correctness.

**Structural sharing correctness:** The `collectChangedPaths` function correctly includes ancestor paths when descendants change (e.g., if `features.darkMode` changes, both `features` and `""` are included), enabling parent-level subscribers to receive notifications. This is verified by the "change one nested key" test in config-cache.test.ts.

---

*Verified: 2026-03-05T11:36:00Z*
*Verifier: Claude (gsd-verifier)*
