# Plan: Use docker-compose for CI E2E Tests

## Context

The CI workflow has 3 E2E jobs (`cli-e2e-tests`, `dashboard-e2e-tests`, `client-contract-tests`) that each manually set up PostgreSQL + API + (optionally) Nginx. This is redundant — the project already has `docker-compose.yaml` + `nginx.conf` defining the same stack. The E2E tests are already designed for docker-compose (CLI defaults to `http://skystate_proxy:80/api`, Dashboard defaults to `http://skystate_proxy:80`).

The `client-contract-tests` job (just added) should be **removed** — once the other two jobs route through the Nginx proxy via docker-compose, it's redundant.

---

## Changes

### 1. Create `docker-compose.ci.yml` (NEW)

Override file for CI use: `docker compose -f docker-compose.yaml -f docker-compose.ci.yml up -d`

Adds/overrides:
- **`skystate_db`** — PostgreSQL 17 with `installation.sql` + `migrations.sql` mounted as init scripts (`/docker-entrypoint-initdb.d/`)
- **`skystate_api`** — swap `dotnet watch` → `dotnet run`, set `EnableTestAuth=true`, inline all env vars (CI has no `.env.local`), add healthcheck on `/health`, depend on `skystate_db: service_healthy`
- **`skystate_dashboard`** — add healthcheck, skip `npm install` (host does it for dashboard E2E), set test mode env vars
- **`skystate_proxy`** — depend on API + dashboard health, add healthcheck
- **`skystate_stripe`** — override to `alpine sleep infinity` (no-op, can't delete services in override)
- **`networks: skystate: external: false`** — override so compose creates the network
- **`dashboard_node_modules`** — named volume to isolate container's `node_modules` from host's (prevents race condition with Playwright install)

### 2. Modify `docker-compose.yaml` (MINIMAL)

Replace host-specific volume mounts on `skystate_api` with named volumes:
```
- /home/user/.aspnet/DataProtection-Keys:/home/user/.aspnet/DataProtection-Keys  →  REMOVE
- /home/user/.nuget/packages:/home/user/.nuget/packages  →  nuget_cache:/home/user/.nuget/packages
```
Add `nuget_cache:` to the `volumes:` section. This improves portability for all developers, not just CI.

### 3. Modify `.github/workflows/workflow-test.yml`

**Rewrite `cli-e2e-tests`:**
- Remove: `services:` block, `setup-dotnet`, `psql` schema steps, `dotnet run &`, health poll
- Add: `touch .env.local`, `docker compose -f docker-compose.yaml -f docker-compose.ci.yml up -d`, wait for `localhost:8080/api/health`, show logs on failure
- Set `SKYSTATE_API_URL: http://localhost:8080/api` (through proxy)

**Rewrite `dashboard-e2e-tests`:**
- Same docker-compose setup
- Install dashboard deps + Playwright on host BEFORE `docker compose up` (avoids node_modules race)
- Override dashboard command in CI to `npm run dev -- --host 0.0.0.0` (skip npm install — host already did it)
- Set `E2E_BASE_URL: http://localhost:8080`

**Remove `client-contract-tests`:** Entirely — the other two jobs now test through the proxy.

### 4. Possibly modify `api/Dockerfile.dev`

Add `curl` if not already in the .NET SDK image (needed for API healthcheck). The .NET SDK 10.0 image is Debian-based and likely has curl — verify first.

---

## Key design decisions

- **`touch .env.local`** in CI workflow — docker-compose merge can't clear `env_file` lists (they're additive), so we create an empty file to satisfy the base file's reference
- **Named volume `dashboard_node_modules`** in CI override — prevents race between container's `npm install` and host's `npm ci` for Playwright
- **Both jobs always start the full stack** (db + api + dashboard + proxy) — simpler than conditional service selection, and the dashboard startup happens in parallel with API build anyway
- **Tests run on host, connect to `localhost:8080`** (the proxy's published port) — standard pattern for Playwright + docker-compose

---

## Files

| File | Action |
|------|--------|
| `docker-compose.ci.yml` | CREATE |
| `docker-compose.yaml` | MODIFY (volume mounts) |
| `.github/workflows/workflow-test.yml` | MODIFY (rewrite 2 jobs, remove 1) |
| `api/Dockerfile.dev` | MAYBE MODIFY (curl) |

---

## Verification

1. Locally: `touch .env.local && docker compose -f docker-compose.yaml -f docker-compose.ci.yml up -d` — all services should become healthy
2. `curl http://localhost:8080/api/health` — should return 200 through proxy
3. Push to a branch, open PR — `cli-e2e-tests` and `dashboard-e2e-tests` should pass, `client-contract-tests` should be gone
4. Existing jobs (`api-unit-tests`, `api-integration-tests`, `api-e2e-tests`, `dashboard-tests`, etc.) should be unaffected
