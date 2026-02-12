# SkyState

## What This Is

SkyState is a headless state synchronization service for developers. It provides shared, real-time JSON state that updates for all connected clients when someone writes to it — no infrastructure setup required. It follows a progressive value model: enters codebases as a lightweight live config tool (feature flags, maintenance banners, kill switches) and grows into per-user persistent state (V2) and real-time session sync (V3).

## Core Value

Developers can push JSON config from a dashboard or CLI and have all connected clients receive updates in real-time, with zero infrastructure setup.

## Current Milestone: v1.0 — Remote Config

**Goal:** Ship project-level remote config with a polling-based React SDK for consuming config, and the dashboard/CLI for managing it.

**Target features:**
- HTTP polling-based config fetch with Cache-Control caching
- React SDK with `useProjectConfig` hook (granular path subscriptions)
- URL restructure to `/project/{slug}/config/{slug}` pattern
- Dashboard and CLI updated to match new terminology ("Config")

## Requirements

### Validated

<!-- Shipped and confirmed working in codebase. -->

- ✓ GitHub OAuth authentication for dashboard/admin — existing
- ✓ Project CRUD with slugs and API keys — existing
- ✓ Multi-environment system (dev/staging/prod) with color coding — existing
- ✓ Versioned JSON state storage with semantic versioning — existing
- ✓ State history, diff, rollback, and cross-environment promotion — existing
- ✓ Public state read endpoint (unauthenticated, cached, rate-limited) — existing
- ✓ CLI with auth, project/env management, state push/pull/diff/promote/rollback — existing
- ✓ Dashboard with JSON editor (CodeMirror), version history, diff viewer, promote — existing
- ✓ Billing with Stripe (free/hobby/pro tiers, boost add-ons) — existing
- ✓ Usage metering with per-project API request limits — existing
- ✓ Retention pruning background service — existing
- ✓ OpenAPI spec for public state endpoint — existing
- ✓ GCP Cloud Run deployment (API), Firebase Hosting (dashboard) — existing

### Active

<!-- V1 scope — building toward these. -->

- [ ] URL restructure: public read at `/project/{slug}/config/{slug}`, authenticated at `/project/{id}/config/...`
- [ ] Core SDK: cache + pub/sub event emitter with granular key-path subscriptions
- [ ] Core SDK: HTTP polling client with Cache-Control and visibility-change re-fetch
- [ ] React SDK: `useProjectConfig('path')` hook using `useSyncExternalStore`
- [ ] React SDK: `SkyStateProvider` component wrapping shared cache instance
- [ ] Dashboard: rename "State" → "Config" in tabs, labels, and UI copy
- [ ] CLI: update endpoint URLs to match new `/project/{id}/config/...` pattern

### Out of Scope

<!-- Explicit boundaries. -->

- End-user authentication (Firebase) — V2 scope, no concept of end-user identity in V1
- User-level state (`useUserState`) — V2 scope
- Session-level state (`useSessionState`) — V3 scope
- WebSocket support — not needed for V1 read-only config; V2+
- JSON Patch / RFC 6902 — V2+, V1 uses full blob replace
- `increment`/`decrement` modifiers — V2+
- Svelte, Vue, vanilla JS SDKs — V2 scope
- BYOA auth (Clerk, Supabase, custom JWT) — V3 scope
- Non-web SDKs (Godot, Unity, Python) — unscoped
- Self-hosted deployment option — unscoped

## Context

SkyState has a mature codebase with a working API (C# .NET 10), dashboard (React 19), CLI (TypeScript/Commander.js), and infrastructure (GCP Cloud Run + Cloud SQL + Firebase Hosting). The core data flow — push versioned JSON from CLI/dashboard, read it publicly via REST — works end-to-end.

V1 delivers remote config as a polling-based service — no SSE in V1 (eliminated due to costs). The main engineering work is:
1. Building the Core + React SDK with proper cache/pub-sub architecture (HTTP polling, Cache-Control)
2. URL restructure + terminology alignment ("config" not "state")
3. Dashboard and CLI alignment to new endpoints and terminology

The existing billing, environment, versioning, and deployment infrastructure carries forward unchanged.

**Tech stack:** C# .NET 10 (API), PostgreSQL 17 (DB), React 19 + Vite 7 + Zustand 5 (dashboard), TypeScript + Commander.js (CLI), GCP Cloud Run + Firebase Hosting (infra).

## Constraints

- **Tech stack**: Existing C#/.NET API, React dashboard, TypeScript CLI — no rewrites
- **Database**: PostgreSQL 17 via Dapper (no EF Core) — table rename requires migration
- **Real-time tech**: No SSE/WebSocket in V1 (polling + Cache-Control only); SSE deferred to V2, WebSockets to V3
- **SDK architecture**: `useSyncExternalStore` required (not useState/Context) per spec §8
- **V1 is read-only for SDK consumers**: Writes happen via dashboard or CLI only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| No SSE in V1 (polling only) | SSE eliminated from V1 due to costs; HTTP polling with Cache-Control is sufficient for remote config; SSE deferred to V2 | ✓ Decided |
| Keep POST + semver for writes | Gives version history, rollback, diff for free; PUT blob replace would lose history | ✓ Good |
| No end-user auth in V1 | Read-only config has no concept of end-user identity; Firebase auth deferred to V2 | — Pending |
| GitHub OAuth stays for admin | Already working, battle-tested; Firebase is for end-user auth only | ✓ Good |
| URL restructure to `/project/.../config/...` | Clearer semantics; separates "config" (V1) from future "userstate" (V2) | — Pending |
| DB table rename `project_state` → `project_config` | Full-stack consistency with new terminology | — Pending |
| Full blob replace on config publish | Config blobs are small (<10KB); diffing overhead not justified for V1 | ✓ Good |

---
*Last updated: 2026-03-04 after initialization*
