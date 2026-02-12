# Tiered Error Handling Strategy

## Context

SkyState has no unified error handling strategy. Errors are handled ad-hoc per feature with inline text, and there's no distinction between a transient glitch and a full outage. The API has no global exception handler (raw .NET 500s can leak), the health endpoint doesn't check DB connectivity, and the dashboard has no toast system, no error boundaries, and no way to communicate severity tiers to users.

This plan introduces a three-tier error hierarchy:

| Tier | Condition | Dashboard UI | CLI UX |
|------|-----------|-------------|--------|
| **1. Transient** | Single 500 | Silent retry → toast if retry fails | Exponential backoff retry |
| **2. Degraded** | DB down / 503 | Amber global banner | Specific "database issues" message |
| **3. Unreachable** | API offline | Full-page takeover overlay | Health check diagnostics |

---

## Part 1: API Changes

### 1A. Global Exception Middleware

**New file:** `api/SkyState.Api/Middleware/GlobalExceptionMiddleware.cs`

Catches all unhandled exceptions and returns structured JSON. Prevents raw stack traces from reaching clients.

- `NpgsqlException` / `PostgresException` / connection `TimeoutException` → **503** with `{"error":"service_degraded","message":"We're experiencing delays processing data. Please try again shortly."}` + `Retry-After: 30` header
- All other unhandled exceptions → **500** with `{"error":"internal_error","message":"An unexpected error occurred. Please try again."}`
- Logs full exception via `ILogger` (never in response body)

**Modify:** `api/SkyState.Api/Program.cs` — register middleware after `UseSerilogRequestLogging()`, before `UseRouting()`:
```csharp
app.UseMiddleware<GlobalExceptionMiddleware>();
```

### 1B. Enhanced Health Endpoint

**Modify:** `api/SkyState.Api/Endpoints/HealthEndpoint.cs`

Currently returns static `"ok"`. Add actual DB connectivity check:
- Execute `SELECT 1` with 3-second timeout via `NpgsqlConnection`
- Success → **200** `{"status":"ok","database":"connected"}`
- DB failure → **503** `{"status":"degraded","database":"unreachable"}`
- Keep `AllowAnonymous` + `RequireCors("PublicApi")`

### 1C. Normalize 500 Fallbacks in Endpoints

**Modify:** `api/SkyState.Api/Endpoints/ProjectEndpoints.cs` (and similar)

Replace bare `Results.StatusCode(500)` catch-all arms with `Results.Json(new ErrorResponse("internal_error", "..."), statusCode: 500)` so all 500s are structured JSON.

---

## Part 2: Dashboard Changes

### 2A. Expand API Status Store to Three Tiers

**Modify:** `dashboard/src/lib/api-status.ts`

Replace the `available: boolean` model with a three-tier state:

```typescript
type ApiTier = 'healthy' | 'degraded' | 'unreachable';
```

New exports (replacing `setApiAvailable`):
- `reportSuccess()` — resets all counters, tier → `healthy`
- `reportDegraded()` — on 503, tier → `degraded` (single 503 is enough — it means DB is down)
- `reportFailure()` — on network error, increments counter, tier → `unreachable` after threshold (2)

Snapshot shape changes from `{ available, dismissed }` to `{ tier, dismissed }`.

Tier priority: `unreachable` > `degraded` > `healthy`. A network failure during degraded escalates to unreachable. Any success resets to healthy.

### 2B. Retry with Exponential Backoff

**Modify:** `dashboard/src/lib/api.ts`

Add retry logic inside `request()`:
- **Only retry GET requests** (mutations could cause duplicates)
- Retry on: status 500 or network `TypeError`
- **Do NOT retry** 503 (DB is known-down, retrying won't help), 4xx, or AbortError
- Max 2 retries (3 total attempts), delays: ~1s, ~3s (with 20% jitter)
- If retry succeeds → user never sees the error
- If all retries fail → throw (caller handles)
- Replace `setApiAvailable(true/false)` calls with new `reportSuccess()` / `reportDegraded()` / `reportFailure()`
- On 503 response: call `reportDegraded()`, throw immediately (no retry)

### 2C. Toast Notification System (Tier 1 UI)

**New files:**
- `dashboard/src/components/ui/toast.tsx` — Radix Toast primitives (Provider, Root, Title, Description, Action, Close). Follow existing shadcn pattern from `alert-dialog.tsx`.
- `dashboard/src/lib/toast-store.ts` — Module-level store (same zero-dependency pattern as `api-status.ts`). `showToast({variant, title, description?, action?})` / `dismissToast(id)` / `subscribe()` / `getSnapshot()`. Deduplicates by title.
- `dashboard/src/components/ToastContainer.tsx` — Renders toast viewport, consumes `toast-store` via `useSyncExternalStore`.

Toast appearance:
- **Position:** fixed bottom-right (`bottom-4 right-4`)
- **Style:** dark card, left-border accent (red for error, amber for warning), max 3 visible
- **Content:** bold title, optional description, optional action button (e.g. "Retry"), dismiss X
- **Duration:** 5s default, 8s for errors, auto-dismiss

**Mount in:** `dashboard/src/App.tsx` — add `<ToastContainer />` alongside `<ServiceBanner />`

### 2D. Central Error Handler

**New file:** `dashboard/src/lib/api-error-handler.ts`

```typescript
export function handleApiError(error: unknown, context?: string): void
```

Decision logic:
- If tier is `unreachable` → suppress (full-page overlay handles it)
- If tier is `degraded` → suppress (banner handles it)
- If `ApiError` with status >= 500 → show error toast: "Something went wrong" + context
- If `TypeError` (network) below unreachable threshold → show toast: "Connection issue"
- 4xx errors → NOT toasted (handled inline by features)

### 2E. Update ServiceBanner for Tier 2 (Degraded)

**Modify:** `dashboard/src/components/ServiceBanner.tsx`

Two banner modes based on `tier`:
- `tier === 'degraded'`: **Amber banner** (`bg-amber-600`), `AlertTriangle` icon, text: "We're experiencing delays processing data." Dismiss button.
- `tier === 'unreachable'`: **Red banner** (existing `bg-destructive`), `WifiOff` icon, existing text. Retry + Dismiss buttons. (This banner will be hidden behind the overlay anyway, but keeps consistency if overlay is dismissed somehow.)

### 2F. Full-Page Takeover Overlay (Tier 3 UI)

**New file:** `dashboard/src/components/ServiceUnavailableOverlay.tsx`

Only renders when `tier === 'unreachable'`.

UI layout:
- `fixed inset-0 z-[100]` — covers everything including banner (z-50)
- Solid background (`bg-[var(--background)]`), centered content
- `ServerCrash` icon (lucide-react)
- Title: **"Service Unavailable"** (text-2xl)
- Subtitle: "SkyState is currently unreachable. We're working to restore service."
- **Retry button**: calls `GET /api/health` directly (not through api.ts to avoid recursive retry). On 200 → `reportSuccess()`, overlay disappears. On failure → "Still unavailable..."
- **Auto-poll**: `setInterval` every 15s hitting `/api/health`, clears when tier changes to healthy
- Fade-in animation (300ms)

**Mount in:** `dashboard/src/App.tsx` — add after `<ServiceBanner />`

### 2G. React Error Boundary

**New file:** `dashboard/src/components/ErrorBoundary.tsx`

Class component (required for error boundaries):
- Catches render-time JS crashes
- Fallback: centered card with `AlertTriangle` icon, "Something went wrong", error message (not stack trace), "Reload page" button

**Mount in:** `dashboard/src/App.tsx` — wrap `<Routes>` content

### 2H. Wire Stores to Toast System

**Modify Zustand store slices** — add `handleApiError()` call alongside existing error state:

- `dashboard/src/store/projects-slice.ts` — `loadProjects()`
- `dashboard/src/store/environments-slice.ts` — `loadEnvironments()`
- `dashboard/src/store/states-slice.ts` — `loadStateVersions()`
- `dashboard/src/store/billing-slice.ts` — `loadBilling()`, `loadInvoices()`

Pattern:
```typescript
catch (err) {
  set({ resourceError: (err as Error).message, resourceLoading: false });
  handleApiError(err, 'Failed to load resource');  // ← add this
}
```

**Keep as-is** (no toast — these are contextual inline errors):
- StateTab push/promote/rollback error handling (402 limit, 404 conflict messages)
- SettingsTab form-level inline errors
- NewProjectPage form-level error

### 2I. Updated `App.tsx` Structure

```tsx
<ErrorBoundary>
  <ServiceBanner />
  <ServiceUnavailableOverlay />
  <ToastContainer />
  <Routes>
    ...
  </Routes>
</ErrorBoundary>
```

---

## Part 3: CLI Changes

### 3A. Exponential Backoff Retry

**Modify:** `cli/src/lib/http-client.ts`

Replace current single-retry logic in `requestWithRetry()`:
- Max 3 retries (4 total attempts)
- Delays: 1s → 2s → 4s (exponential, capped at 10s, ±20% jitter)
- **GET requests**: retry on `NetworkError` or 500
- **Mutation requests (POST/PUT/DELETE)**: retry only on `NetworkError` (server may have processed a 500)
- **Never retry**: 503 (known DB issue), 4xx, auth errors
- Fix misleading `"Authenticating..."` message on line 296 → `"Retrying in Xs... (attempt N/M)"`
- Update `isRetryable()` to exclude 503

### 3B. Handle 503 Specifically

**Modify:** `cli/src/lib/http-client.ts` (`handleHttpError`)

Add before the generic 5xx handler:
```typescript
if (status === 503) {
  throw new ServiceUnavailableError(message || 'Service is experiencing database issues');
}
```

### 3C. New `ServiceUnavailableError` Class

**Modify:** `cli/src/lib/errors.ts`

```typescript
export class ServiceUnavailableError extends CliError {
  constructor(message = 'Service temporarily unavailable. Please try again shortly.') {
    super(message, 1, 'The database may be down. Try again in a few minutes.');
    this.name = 'ServiceUnavailableError';
  }
}
```

### 3D. Health Check Diagnostics on Total Failure

**Modify:** `cli/src/cli.ts` (global error handler)

When a `NetworkError` is the final error (all retries exhausted), attempt a lightweight `GET /health` check:
- Health returns 200 → "API is reachable but the request failed. Try again."
- Health returns 503 → "API is reachable but the database is currently unavailable."
- Health unreachable → "The SkyState API appears to be offline."

---

## Tier Interaction Matrix

| Scenario | Toast? | Banner? | Overlay? |
|----------|--------|---------|----------|
| Single 500, retry succeeds | No | No | No |
| Single 500, retry fails | Yes | No | No |
| 503 response | No | Yes (amber) | No |
| 503 then another 500 | No (suppressed) | Yes (amber) | No |
| 1 network failure | Yes (toast) | No | No |
| 2+ network failures | No (suppressed) | No | Yes |
| 503 then 2 network failures | No | No | Yes (escalated) |
| Recovery from any tier | Clear naturally | Hides | Fades out |

Key rule: `handleApiError()` checks current tier before showing toast. If `degraded` or `unreachable`, the toast is suppressed since the banner/overlay already communicates the problem.

---

## Files Summary

**New files (7):**
1. `api/SkyState.Api/Middleware/GlobalExceptionMiddleware.cs`
2. `dashboard/src/components/ui/toast.tsx`
3. `dashboard/src/lib/toast-store.ts`
4. `dashboard/src/components/ToastContainer.tsx`
5. `dashboard/src/lib/api-error-handler.ts`
6. `dashboard/src/components/ServiceUnavailableOverlay.tsx`
7. `dashboard/src/components/ErrorBoundary.tsx`

**Modified files (14):**
1. `api/SkyState.Api/Program.cs`
2. `api/SkyState.Api/Endpoints/HealthEndpoint.cs`
3. `api/SkyState.Api/Endpoints/ProjectEndpoints.cs` (and similar — normalize 500 fallbacks)
4. `dashboard/src/lib/api-status.ts`
5. `dashboard/src/lib/api.ts`
6. `dashboard/src/components/ServiceBanner.tsx`
7. `dashboard/src/App.tsx`
8. `dashboard/src/store/projects-slice.ts`
9. `dashboard/src/store/environments-slice.ts`
10. `dashboard/src/store/states-slice.ts`
11. `dashboard/src/store/billing-slice.ts`
12. `cli/src/lib/http-client.ts`
13. `cli/src/lib/errors.ts`
14. `cli/src/cli.ts`

---

## Verification

1. **API middleware**: `dotnet test SkyState.Api.UnitTests/` — add tests for middleware (NpgsqlException → 503, generic → 500)
2. **Health endpoint**: `curl /health` with DB up → 200, DB down → 503
3. **Dashboard Tier 1**: Kill API briefly, reload dashboard — single 500 should retry silently; if retry fails, toast appears
4. **Dashboard Tier 2**: Stop PostgreSQL — API returns 503 → amber banner shows "experiencing delays"
5. **Dashboard Tier 3**: Stop API entirely → overlay appears, auto-polls health, clears when API returns
6. **Error boundary**: Force a render error → fallback UI shows instead of white screen
7. **CLI retry**: `skystate projects list` with flaky API → see retry messages, exponential delays
8. **CLI 503**: `skystate projects list` with DB down → "Service is experiencing database issues"
9. **CLI diagnostics**: `skystate projects list` with API down → health check provides specific message
10. **Full build**: `npm run build` in dashboard + CLI, `dotnet build` API — no regressions
