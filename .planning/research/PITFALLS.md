# Pitfalls Research

**Domain:** SSE streaming on .NET/Cloud Run + React SDK with useSyncExternalStore
**Researched:** 2026-03-04
**Confidence:** HIGH (verified against official docs, multiple sources, real post-mortems)

---

## Critical Pitfalls

### Pitfall 1: Cloud Run Hard-Kills SSE Connections at the Default 5-Minute Timeout

**What goes wrong:**
Cloud Run's default request timeout is 5 minutes (300 seconds). Any SSE connection open longer than this receives a 504 and is terminated by the platform. Clients reconnect immediately, creating a rolling churn of short-lived connections instead of stable long-lived ones. The problem is invisible in local development (Kestrel has no request timeout by default).

**Why it happens:**
Cloud Run treats SSE as a regular HTTP request. The default timeout is designed for short-lived REST requests. Developers test locally or on Azure-style platforms without hitting this and only discover it in production when users report dropped connections every few minutes.

**How to avoid:**
Set `--timeout 3600` (1 hour, the maximum) when deploying to Cloud Run:
```bash
gcloud run deploy skystate-api --timeout 3600 ...
```
Also set it in the CloudFormation/IaC config so it survives redeployment. For the SSE endpoint itself, the server should proactively close and invite reconnect at ~50–55 minutes (before Cloud Run's hard kill), returning `retry: 30000` to control the client reconnect delay.

**Warning signs:**
- Clients reconnecting exactly on a 5-minute cycle in production logs
- SSE working fine locally but dropping in staging
- 504 errors appearing on the `/stream` endpoint in Cloud Run logs

**Phase to address:** SSE endpoint implementation phase — must be set in Cloud Run service config before first SSE deployment.

---

### Pitfall 2: ASP.NET Core Buffers the SSE Response — Nothing Reaches the Client

**What goes wrong:**
ASP.NET Core buffers response data by default. Writing to the response body without calling `FlushAsync()` after each event means the client receives nothing until the buffer fills (typically ~4KB–16KB) or the connection closes. Effectively, SSE becomes a delayed batch dump rather than a real-time stream. This is invisible when running Kestrel locally because Kestrel flushes more aggressively than production reverse proxies.

**Why it happens:**
Developers follow REST endpoint patterns — write data, return. The SSE loop looks like: write event, write event, write event. Without explicit `FlushAsync()` after each write, the response transport layer accumulates bytes instead of pushing them immediately.

**How to avoid:**
After every `await response.WriteAsync(eventLine)` call, always follow with:
```csharp
await response.Body.FlushAsync(cancellationToken);
```
In .NET 10, if using the built-in `TypedResults.ServerSentEvents`, flushing is handled automatically. If writing manually to the response stream (which this project likely does given its Minimal API + Dapper style), explicit flush is mandatory. Set headers before writing:
```csharp
response.Headers["Content-Type"] = "text/event-stream";
response.Headers["Cache-Control"] = "no-cache, no-transform";
response.Headers["X-Accel-Buffering"] = "no";  // disables nginx-level buffering
```

**Warning signs:**
- Clients receive events in large batches rather than one at a time
- SSE works locally but not in staging/production
- Heartbeat events arrive in clumps instead of every 15–20 seconds

**Phase to address:** SSE endpoint implementation phase — must be validated with an end-to-end streaming test against the actual Cloud Run deployment, not just local Kestrel.

---

### Pitfall 3: Proxy/CDN Buffering Swallows Events for Corporate or Firewalled Users

**What goes wrong:**
The SSE wire format (chunked Transfer-Encoding without Content-Length) is legally bufferable by HTTP proxies. Intermediate proxies — corporate HTTP gateways, older Squid/Varnish instances, some CDNs — may buffer the entire stream before forwarding it to the client. Clients on these networks receive no events until the connection closes, making real-time push effectively broken for a subset of users. This is unpredictable, affects only certain network paths, and is extremely difficult to debug remotely.

**Why it happens:**
SSE relies on chunked encoding to signal "stream in progress." The HTTP/1.1 spec allows — but does not require — proxies to forward chunks immediately. Old or misconfigured proxies treat a missing Content-Length as an incomplete response to be buffered. Adding `X-Accel-Buffering: no` controls only nginx, not downstream proxies outside your control.

**How to avoid:**
- Serve the SSE endpoint over HTTPS only (encrypts the stream from third-party proxies)
- Set `Cache-Control: no-cache, no-transform` on every SSE response
- Ensure the API is served over HTTP/2 (Cloud Run supports HTTP/2 natively) — HTTP/2 multiplexes over a single TLS connection and sidesteps most proxy-buffering issues
- Send regular heartbeat comments (`: heartbeat\n\n`) every 15 seconds; some proxies flush on data received
- Document this as a known limitation for users on highly-restricted corporate networks; long polling is the escape hatch

**Warning signs:**
- Bug reports of "SSE not working" that are network-path-specific (works at home, not at office)
- Users on VPNs reporting delayed or missing real-time updates
- Heartbeats visible in server logs but not received by specific clients

**Phase to address:** SSE endpoint implementation phase, plus documentation of known limitation. Do not attempt to solve completely — it is architecturally unsolvable without switching to long polling.

---

### Pitfall 4: Missing Cancellation Token Handling Creates Ghost Connections and Memory Leaks

**What goes wrong:**
When a client closes their browser tab or navigates away, the browser terminates the TCP connection. If the server-side SSE loop does not observe `HttpContext.RequestAborted`, the loop continues running — holding memory, iterating the event loop, and potentially trying to write to a closed socket — until the next write throws an exception or the Cloud Run instance is recycled. With hundreds of concurrent SSE connections, ghost loops accumulate and cause memory pressure.

**Why it happens:**
SSE loops look like infinite `while` loops. Developers add `try/catch` for socket errors but forget to pass `HttpContext.RequestAborted` to the loop's `CancellationToken`. The exception path eventually cleans up, but there is an unbounded lag between disconnect and cleanup.

**How to avoid:**
Always bind the loop to `HttpContext.RequestAborted`:
```csharp
app.MapGet("/project/{slug}/config/{slug}/stream", async (HttpContext ctx) =>
{
    var ct = ctx.RequestAborted;
    try
    {
        while (!ct.IsCancellationRequested)
        {
            await SendHeartbeatAsync(ctx.Response, ct);
            await Task.Delay(15_000, ct);
        }
    }
    catch (OperationCanceledException) { /* client disconnected — normal */ }
    finally
    {
        // cleanup: remove from connection registry if any
    }
});
```
Also wrap `OperationCanceledException` / `TaskCanceledException` at the endpoint level so it is not logged as a 500 error — client disconnect is expected behavior, not an error.

**Warning signs:**
- Memory usage grows continuously on the Cloud Run instance and never stabilizes
- High thread or task count in application metrics
- Server logs showing write errors to closed sockets long after clients have disconnected

**Phase to address:** SSE endpoint implementation phase — treat as a correctness requirement, not an optimization.

---

### Pitfall 5: useSyncExternalStore getSnapshot Returns New Objects on Every Call — Infinite Re-Render Loop

**What goes wrong:**
`useSyncExternalStore` calls `getSnapshot` on every render to check if the store has changed. If `getSnapshot` returns a new object or array reference each time (even with identical data), React sees a perpetually changing value, schedules a re-render, calls `getSnapshot` again, gets a new reference, and loops infinitely. This crashes the React component tree with a "Maximum update depth exceeded" error.

**Why it happens:**
The SDK's `getSnapshot` implementation for a path subscription (e.g., `useProjectConfig('featureFlags')`) needs to return a slice of the config object. The intuitive implementation constructs and returns a new object:
```typescript
// WRONG — new object reference every call
getSnapshot: () => ({ value: cache.get(path) })
```

**How to avoid:**
Cache the last snapshot value and return the cached reference when the underlying data has not changed:
```typescript
let lastSnapshot: unknown = undefined;
let lastVersion = -1;

const getSnapshot = () => {
    const current = cache.get(path);
    const version = cache.getVersion();
    if (version === lastVersion) return lastSnapshot;
    lastSnapshot = current;
    lastVersion = version;
    return lastSnapshot;
};
```
Use value equality (deep comparison or version counter from the cache) to decide when to invalidate. The core SDK cache must expose a stable version or revision counter to make this pattern possible.

**Warning signs:**
- "Maximum update depth exceeded" errors in the React console
- Components re-rendering continuously in the React DevTools profiler
- CPU usage spiking to 100% after SSE events arrive

**Phase to address:** React SDK implementation phase — must be caught during unit testing with React Testing Library and StrictMode enabled.

---

### Pitfall 6: subscribe Function Defined Inline — Causes Constant Resubscription

**What goes wrong:**
If the `subscribe` function passed to `useSyncExternalStore` is defined inside the component (or hook) without memoization, React detects a new `subscribe` function reference on every render. This causes React to unsubscribe from the store and resubscribe on every single render, which in an SSE-backed store means tearing down and recreating EventSource connections continuously.

**Why it happens:**
The `useProjectConfig` hook wraps `useSyncExternalStore` internally. The naive implementation creates `subscribe` inline:
```typescript
// WRONG — new function reference on every useProjectConfig call
const subscribe = (callback: () => void) => store.subscribe(path, callback);
useSyncExternalStore(subscribe, getSnapshot);
```

**How to avoid:**
Either define `subscribe` as a stable function outside the hook (using the path as a key), or use `useCallback`:
```typescript
const subscribe = useCallback(
    (callback: () => void) => store.subscribe(path, callback),
    [store, path]
);
useSyncExternalStore(subscribe, getSnapshot);
```
The recommended pattern for the `@skystate/react` SDK is to generate stable `subscribe`/`getSnapshot` pairs keyed by path during `SkyStateProvider` initialization, not inside each `useProjectConfig` call.

**Warning signs:**
- DevTools show components unsubscribing and resubscribing to the store on every render
- EventSource connections being opened and closed at high frequency in the Network tab
- Performance regressions when multiple components call `useProjectConfig`

**Phase to address:** React SDK implementation phase — caught by code review of the hook implementation and e2e testing with multiple subscribers.

---

### Pitfall 7: React StrictMode Double-Mounts Tear Down EventSource During Development

**What goes wrong:**
In React 18+ development mode, StrictMode mounts components, unmounts them, and mounts them again. This exercises the cleanup path of `useSyncExternalStore`'s `subscribe` return value. If the EventSource cleanup function closes the underlying SSE connection (and it should), the connection is created, destroyed, and recreated on every development mount. This is correct behavior but causes confusion: SSE appears broken or disconnecting in dev mode, then works fine in production.

**Why it happens:**
Developers see two connection open/close cycles in the Network tab during development and assume the SSE implementation is broken, potentially adding workarounds that prevent proper cleanup in production.

**How to avoid:**
- Accept this as correct behavior — do not add guards like `if (connectionRef.current) return` that skip cleanup
- Document in the SDK that StrictMode causes a double-connect cycle in development
- The `SkyStateProvider`-level singleton EventSource (one per provider, not per hook) reduces the impact: StrictMode only causes two connections at the provider level, not per `useProjectConfig` subscriber

**Warning signs:**
- Seeing two SSE connections opening and closing in devtools during development page load
- Team members filing bugs about "SSE reconnecting constantly in dev mode"

**Phase to address:** React SDK implementation phase — document this behavior in SDK README before shipping.

---

### Pitfall 8: DB Table Rename Without a View Shim Breaks the Running API Mid-Deploy

**What goes wrong:**
`ALTER TABLE project_state RENAME TO project_config` is a fast operation, but it is not zero-downtime. The moment it executes, any running instance of the API still holding compiled Dapper queries against `project_state` will throw SQL exceptions. On Cloud Run, multiple instances may be running simultaneously. A naive rename leaves a window — potentially minutes — where old instances crash on every request.

**Why it happens:**
Developers treat table renames as a "just run the migration" operation analogous to code deployment. They do not account for the overlap window where old code and new code run simultaneously against the same database.

**How to avoid:**
Use PostgreSQL's transactional DDL to perform the rename and create a compatibility view atomically:
```sql
BEGIN;
ALTER TABLE project_state RENAME TO project_config;
CREATE VIEW project_state AS SELECT * FROM project_config;
COMMIT;
```
This runs in a single transaction. Old API instances reading/writing `project_state` continue working via the view. After all instances have rolled to new code referencing `project_config`, drop the view:
```sql
DROP VIEW project_state;
```
Critical: PostgreSQL updatable views support INSERT/UPDATE/DELETE, so the write path through the view works. However, do not add `NOT NULL` columns to `project_config` while the `project_state` view is live — inserts through the view will fail because the new column is not in the view's SELECT list.

**Warning signs:**
- SQL errors like `relation "project_state" does not exist` appearing in Cloud Run logs immediately after migration
- 500 errors on all API endpoints for 30–60 seconds during deploy

**Phase to address:** DB migration phase (URL restructure + terminology rename) — must be executed before any code change that references `project_config`.

---

### Pitfall 9: URL Restructure Without Backward Compatibility Breaks Existing SDK Users

**What goes wrong:**
Changing the public read endpoint from `/state/{id}` (or whatever the current pattern is) to `/project/{slug}/config/{slug}` without a redirect or deprecation period will 404 every client that has hardcoded the old URL. This includes the published CLI, any users who hardcoded the URL in their applications, and existing polling integrations. The breakage is silent on the server side (it returns 404) but catastrophic on the client side.

**Why it happens:**
V1 is the first major URL restructure. The team is aware of the internal changes but underestimates how many external consumers (CLI, docs, direct API users) rely on the old URLs.

**How to avoid:**
- Audit all existing public endpoints in `openapi.json` and the CLI source before renaming
- Add HTTP 301 permanent redirects from old URL pattern to new URL pattern at the API level, or at the nginx/Cloud Run ingress level
- Bump the CLI version and document the URL change prominently
- Keep redirects in place for at least one minor version cycle

**Warning signs:**
- CLI commands that worked before returning 404 after URL rename
- Open GitHub issues from users who hardcoded the old state endpoint URL

**Phase to address:** URL restructure phase — must include redirect setup as a required step, not a post-launch cleanup.

---

### Pitfall 10: HTTP/1.1 Browser Connection Limit Blocks SSE When Multiple Tabs Are Open

**What goes wrong:**
HTTP/1.1 enforces a maximum of 6 TCP connections per origin per browser. Each open `EventSource` connection permanently occupies one connection (SSE responses never complete). A user with 4 open SkyState dashboard tabs consumes 4 of their 6 available connections to the API domain, leaving only 2 for all other API calls. At 6 tabs, all REST calls block until an SSE connection is freed. This bug report is marked "Won't Fix" in both Chrome and Firefox.

**Why it happens:**
The SSE endpoint and the REST API share the same origin. Developers testing with a single tab never hit this limit.

**How to avoid:**
Serve the API over HTTP/2 (Cloud Run supports HTTP/2 natively — verify it is enabled and not downgraded by load balancer config). HTTP/2 multiplexes all requests over a single TLS connection; the 6-connection limit does not apply. Confirm with:
```bash
curl -I --http2 https://api.skystate.io/health
```
The response must show `HTTP/2`. If the load balancer or ingress terminates TLS and proxies with HTTP/1.1, the limit still applies between browser and load balancer.

**Warning signs:**
- REST API calls hanging when multiple dashboard tabs are open
- Network tab showing connections queued in "Stalled" state
- Issue only reproducible with 6+ open tabs

**Phase to address:** SSE endpoint implementation phase — verify HTTP/2 is active end-to-end before shipping.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-process SSE fan-out (no Redis/pub-sub) | Simple to implement, no infrastructure | Works only with a single Cloud Run instance; write events on instance A do not reach SSE clients on instance B | Acceptable for V1 if Cloud Run min-instances=1 and this is documented; must revisit before scale-out |
| No heartbeat on SSE connection | Less code | Load balancers and proxies close "idle" connections within 30–60 seconds, causing constant client reconnects | Never — add heartbeat as table stakes |
| Skipping `Last-Event-ID` replay | Faster first implementation | Clients that reconnect after a config update miss the change until the next write event | Acceptable for V1 if config is always fetchable via REST on reconnect |
| No connection count instrumentation | Faster to ship | Cannot detect connection leaks or fan-out failures in production | Never — add at least a basic counter metric |
| Skipping compatibility view during DB rename | One migration instead of two | Brief 404 window during deploys; breaks multi-instance rolling updates | Never — the view costs 5 minutes and prevents production incidents |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cloud Run + SSE | Deploying with default 5-minute timeout | Set `--timeout 3600` in deploy config; also set at the service YAML level |
| Cloud Run + SSE | Assuming HTTP/2 is automatic | Verify with `curl -I --http2`; load balancer TLS termination may downgrade to HTTP/1.1 |
| ASP.NET Core + SSE | Using `IAsyncEnumerable<T>` return type without verifying streaming | The JSON serializer buffers `IAsyncEnumerable` by default unless using NDJSON mode; prefer direct response body writes with explicit `FlushAsync` |
| nginx / reverse proxy + SSE | Forgetting `proxy_buffering off` | Set `X-Accel-Buffering: no` header in response, and `proxy_buffering off` in nginx config |
| React SDK + useSyncExternalStore | Defining `subscribe` inside the hook body | Define stable subscribe functions outside the component or memoize with `useCallback` |
| React SDK + StrictMode | Adding early-return guards to "fix" double-mount | Accept double-connect in dev mode; do not add guards that break production cleanup |
| PostgreSQL + table rename | Running `ALTER TABLE RENAME` with live traffic | Use transactional rename + updatable view shim; drop view after all instances updated |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| One EventSource per `useProjectConfig` subscriber | Opening hundreds of SSE connections per page with many `useProjectConfig` calls | Singleton EventSource at the `SkyStateProvider` level; all hooks share one connection | Breaks immediately on pages with more than 6 `useProjectConfig` calls |
| No backplane for multi-instance fan-out | Config writes on instance A not pushed to clients on instance B | Use Redis pub/sub or Cloud Pub/Sub as backplane; or enforce single-instance with min/max=1 | Breaks as soon as Cloud Run scales to 2+ instances |
| Reconnection storm after deploy | All clients reconnect simultaneously when new revision deploys, spiking CPU/DB load | Jitter the `retry:` value per connection (e.g., `Math.random() * 10000 + 5000`); proactively close connections with scheduled drain before deploy | Breaks at ~50+ concurrent SSE clients |
| getSnapshot creating new objects every render | Infinite re-render loop, CPU spike | Cache snapshot by version counter in the store | Breaks immediately when any component mounts |
| Ghost SSE loops (missing cancellation) | Memory leak on server; growing task count | Always observe `HttpContext.RequestAborted` in the SSE loop | Breaks gradually; noticeable at ~100+ concurrent connections |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| SSE endpoint accessible without API key authentication | Anyone can stream config from any project by guessing slugs | The SSE stream endpoint must require the same API key authentication as other read endpoints; public endpoints are acceptable but must be intentional per-project |
| Not rate-limiting SSE connections per API key | A single key could open thousands of connections, exhausting server resources | Apply connection-count rate limiting per API key at the SSE endpoint; reject or queue connections above a threshold |
| Sending full config blob on every SSE event | Leaks config data to unintended subscribers if the stream is not properly authenticated | For V1 full-blob config, this is acceptable; ensure auth is enforced before the stream is opened, not after the first event |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual indicator of SSE connection state in SDK | Users have no feedback when connection drops; config appears stale silently | Expose a `connectionStatus` property from `useSyncExternalStore` or a companion hook; at minimum let the SDK emit a disconnect event |
| Reconnection storms after a deploy force a hard page reload to get new config | Users see stale config after SkyState API deploys | The SDK should reconnect automatically and re-apply config on the next successful SSE message; no page reload needed |
| `useProjectConfig` returning `undefined` on initial mount before SSE connects | UI flashes or shows wrong default state | The SDK must serve the last-known cached value immediately on mount (from REST fetch), then stream updates — never `undefined` if a value exists |

---

## "Looks Done But Isn't" Checklist

- [ ] **SSE buffering:** Events arrive one-at-a-time (not in batches) when tested against the real Cloud Run deployment — not just local Kestrel
- [ ] **Cloud Run timeout:** Service deployed with `--timeout 3600`, verified in `gcloud run services describe`
- [ ] **HTTP/2:** `curl -I --http2 https://[api-host]/project/.../config/.../stream` returns `HTTP/2`
- [ ] **Cancellation cleanup:** Disconnecting the client (closing tab) causes the server-side SSE loop to exit within 1 second, verified in logs
- [ ] **Heartbeat:** SSE heartbeat comment sent every 15 seconds, visible in browser Network tab as `: heartbeat`
- [ ] **getSnapshot stability:** `useProjectConfig` with a stable config value causes zero re-renders when measured in React DevTools profiler
- [ ] **subscribe stability:** Adding/removing `useProjectConfig` consumers does not open/close the underlying EventSource connection
- [ ] **StrictMode:** App runs in StrictMode in development without console errors or infinite loops
- [ ] **DB rename:** Old endpoint (`project_state` table reference) continues to work during the deploy window when both old and new code instances run simultaneously
- [ ] **URL redirects:** Old public URL pattern returns HTTP 301 to new URL, not 404

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cloud Run 5-minute timeout discovered post-launch | LOW | Update service config, redeploy; clients auto-reconnect |
| SSE buffering — clients getting no events | LOW | Add `FlushAsync` calls and `X-Accel-Buffering: no` header, redeploy |
| getSnapshot infinite loop deployed to production | MEDIUM | Hotfix the getSnapshot caching logic; publish new SDK patch version; existing users on old SDK continue to see the loop until they update |
| DB rename caused 5-minute outage | HIGH | Restore from snapshot or run reverse rename (`ALTER TABLE project_config RENAME TO project_state`); replay migration with view shim; requires coordinated downtime |
| Multi-instance fan-out failure discovered at scale | HIGH | Implement Redis pub/sub backplane; requires infra change and API redesign; mitigation is to cap Cloud Run max-instances=1 as a temporary fix |
| HTTP/1.1 connection limit blocking users with many tabs | MEDIUM | Enable HTTP/2 at load balancer level; verify no TLS termination causing downgrade; requires infra config change |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Cloud Run 5-min timeout | SSE endpoint implementation | `gcloud run services describe` shows timeout=3600 |
| ASP.NET Core response buffering | SSE endpoint implementation | End-to-end test against Cloud Run showing per-event delivery |
| Proxy buffering (corporate networks) | SSE endpoint implementation | Set required headers; document known limitation |
| Missing cancellation token cleanup | SSE endpoint implementation | Load test: disconnect clients, confirm no ghost tasks in metrics |
| getSnapshot new-object infinite loop | React SDK implementation | React StrictMode + profiler shows zero re-renders on stable config |
| subscribe inline — constant resubscription | React SDK implementation | DevTools show no unsubscribe/resubscribe cycles on re-render |
| StrictMode double-mount confusion | React SDK implementation | Document behavior; verify cleanup runs correctly |
| DB table rename without view shim | DB migration phase | Zero 500 errors during rolling deploy with mixed old/new instances |
| URL restructure breaking existing consumers | URL restructure phase | CLI commands and old URLs return 301, not 404 |
| HTTP/1.1 6-connection limit | SSE endpoint implementation | `curl --http2` confirms HTTP/2 end-to-end |

---

## Sources

- [Cloud Run Request Timeout Configuration](https://docs.cloud.google.com/run/docs/configuring/request-timeout) — official GCP docs; max 60 minutes, default 5 minutes
- [Cloud Run Concurrency and Memory](https://docs.cloud.google.com/run/docs/about-concurrency) — official GCP docs; memory scales with concurrent connections
- [Graceful Shutdowns on Cloud Run](https://cloud.google.com/blog/topics/developers-practitioners/graceful-shutdowns-cloud-run-deep-dive) — 10-second SIGTERM window before SIGKILL
- [useSyncExternalStore — React Official Docs](https://react.dev/reference/react/useSyncExternalStore) — getSnapshot stability rules, subscribe cleanup requirements
- [Server-Sent Events — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — Last-Event-ID, reconnection, EventSource behavior
- [The Pitfalls of EventSource over HTTP/1.1](https://textslashplain.com/2019/12/04/the-pitfalls-of-eventsource-over-http-1-1/) — 6-connection-per-domain limit, HTTP/2 mitigation
- [SSE Are Still Not Production Ready — DEV Community](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) — real post-mortem: proxy buffering caused 20-minute login delays
- [Postgres Table Rename Zero Downtime — brandur.org](https://brandur.org/fragments/postgres-table-rename) — updatable view shim pattern, transactional DDL
- [Zero-Downtime Postgres Migrations — GoCardless](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/) — production migration patterns
- [ASP.NET Core CancellationTokens — andrewlock.net](https://andrewlock.net/using-cancellationtokens-in-asp-net-core-minimal-apis/) — HttpContext.RequestAborted in minimal APIs
- [IAsyncEnumerable Buffering — GitHub Issue](https://github.com/dotnet/aspnetcore/issues/45916) — buffering behavior with IAsyncEnumerable
- [SSE at Scale — Shopify Engineering](https://shopify.engineering/server-sent-events-data-streaming) — fan-out architecture, BFCM real-world scale
- [Scaling SSE Architecture — Artera](https://innovation.artera.io/blog/our-journey-to-a-scalable-sse-architecture/) — Redis backplane for multi-instance fan-out
- [use-sync-external-store npm](https://www.npmjs.com/package/use-sync-external-store) — compatibility shim for older React versions

---
*Pitfalls research for: SSE streaming + React SDK + Cloud Run (SkyState v1.0)*
*Researched: 2026-03-04*
