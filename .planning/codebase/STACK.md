# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- C# 13 / .NET 10 - API backend (`api/SkyState.Api/`)
- TypeScript 5.9 - Dashboard (`dashboard/`), CLI (`cli/`), SDK packages (`packages/typescript/`)

**Secondary:**
- SQL (PostgreSQL dialect) - Database schema and migrations (`api/Database/installation.sql`, `api/Database/migrations.sql`)
- HTML/CSS - Landing page (`landing/`), Tailwind CSS in dashboard

## Runtime

**Environment:**
- .NET 10 (target framework `net10.0`) - API
- Node.js >=20 (CLI `engines.node`), Node 22 used in CI, Node 25-slim in Docker dev

**Package Manager:**
- npm - Dashboard, CLI, Protocol packages
- NuGet - .NET packages
- Lockfiles: `package-lock.json` present in all Node workspaces

## Frameworks

**Core:**
- ASP.NET Core 10 Minimal API - HTTP API layer (`api/SkyState.Api/`) — no controllers, endpoints as extension methods
- React 19 - Dashboard UI (`dashboard/src/`)
- Commander.js 14 with `@commander-js/extra-typings` - CLI (`cli/src/cli.ts`)

**State Management:**
- Zustand 5 - Dashboard global state (`dashboard/src/store/`)

**Routing:**
- React Router 7 - Dashboard client-side routing (`dashboard/src/App.tsx`)

**Styling:**
- Tailwind CSS 4 (via `@tailwindcss/vite` Vite plugin) - Dashboard
- Radix UI primitives + shadcn/ui - Dashboard component system (`dashboard/src/components/ui/`)

**Build:**
- Vite 7 with `@vitejs/plugin-react-swc` - Dashboard (`dashboard/vite.config.ts`)
- tsup 8 (ESM output, `target: node20`) - CLI bundle (`cli/tsup.config.ts`)
- `tsc` direct - SDK packages (`packages/typescript/core/`, `packages/typescript/react/`)

**Testing:**
- Vitest 4 - Dashboard unit tests (`dashboard/test/unit/`) and CLI unit/e2e tests (`cli/test/`)
- Playwright 1.58 - Dashboard E2E tests (`dashboard/test/e2e/`, config at `dashboard/playwright.config.ts`)
- xUnit v3 (1.1.0) with xunit.runner.visualstudio - .NET tests (all three test projects)
- NSubstitute 5.3 - Mocking in .NET unit tests (`api/SkyState.Api.UnitTests/`)
- Microsoft.AspNetCore.Mvc.Testing 10 - In-process integration/E2E tests for .NET

## Key Dependencies

**Critical:**
- `Dapper` 2.1.66 - Micro-ORM for all DB queries; no EF Core (`api/SkyState.Api/SkyState.Api.csproj`)
- `Npgsql` 10.0.1 - PostgreSQL ADO.NET driver (`api/SkyState.Api/`)
- `Stripe.net` 50.3.0 - Official Stripe .NET SDK for billing (`api/SkyState.Api/`)
- `Serilog.AspNetCore` 10.0.0 + `Serilog.Enrichers.Thread` 4.0.0 - Structured logging (`api/SkyState.Api/`)
- `Scalar.AspNetCore` 2.12.37 - OpenAPI UI (replaces Swagger) at `/scalar`
- `Microsoft.AspNetCore.OpenApi` 10.0.3 - OpenAPI document generation

**Dashboard UI:**
- `radix-ui` 1.4.3 - Headless primitive components
- `lucide-react` 0.563 - Icon library
- `@uiw/react-codemirror` 4.25 + `@codemirror/lang-json` - JSON editor in state editor UI
- `class-variance-authority` + `clsx` + `tailwind-merge` - shadcn/ui class utilities

**CLI:**
- `ansis` 3 - ANSI color output
- `cli-table3` 0.6 - Terminal table formatting
- `ora` 8 - Terminal spinners
- `fastest-levenshtein` 1.0 - Fuzzy command suggestions

**Protocol Validation:**
- `ajv` 8 + `ajv-formats` 3 - JSON Schema validation against OpenAPI spec (`packages/protocol/`)

## Configuration

**Environment (API):**
- `appsettings.json` - Base config (`api/SkyState.Api/appsettings.json`)
- `appsettings.Development.json` - Dev overrides with test auth enabled
- Docker Compose env vars override connection strings at runtime
- `DatabaseConnectionHelper.BuildConnectionString()` inspects `INSTANCE_UNIX_SOCKET` (Cloud Run), then `DB_HOST` (ECS/TCP), then falls back to `appsettings.json`
- GCP Secret Manager injects secrets at Cloud Run deploy time via `--set-secrets` in `workflow-deploy.yml`

**API config sections:**
- `ConnectionStrings:DefaultConnection` - PostgreSQL connection string
- `Stripe:SecretKey`, `Stripe:WebhookSecret`, `Stripe:HobbyPriceId`, `Stripe:ProPriceId`, `Stripe:BoostPriceId`
- `GitHub:ClientId`, `GitHub:ClientSecret`, `GitHub:CallbackUrl`, `GitHub:FrontendUrl`
- `TierSettings:Tiers` - Per-tier limits (MaxProjects, MaxEnvironments, MaxStorageBytes, RetentionDays, MaxApiRequestsPerMonth)
- `MeteringSettings:WarningThresholdMultiplier`, `MeteringSettings:BlockThresholdMultiplier`
- `EnableTestAuth` - Enables `TestAuthHandler` in non-production environments

**Environment (Dashboard/CLI):**
- `VITE_API_BASE_URL` - API base URL (default `/api`)
- `VITE_TEST_MODE` - Enable test auth bypass
- `VITE_TEST_GITHUB_ID`, `VITE_TEST_EMAIL`, `VITE_TEST_NAME` - Test user details
- `API_PROXY_TARGET` - Docker Compose injects this for Vite proxy target

**Build:**
- `dashboard/vite.config.ts` - Vite config with path alias `@/` → `./src/`
- `dashboard/tsconfig.app.json` - TypeScript strict mode, ES2022 target
- `cli/tsconfig.json` - TypeScript strict mode, ES2022 target, `noUnusedLocals/Parameters`
- `api/SkyState.Api/SkyState.Api.csproj` - `TreatWarningsAsErrors=true`, `Nullable=enable`, `ImplicitUsings=disable`

## Platform Requirements

**Development:**
- Docker + Docker Compose (local dev stack via `./up.sh`)
- `.env.local` file required with GitHub OAuth credentials and Stripe API key
- Services: Nginx proxy (`:8080`), API (`:5148` internal), Dashboard (`:5173` internal), PostgreSQL (`:5432`), Stripe CLI (webhook forwarding)
- Available runtimes in dev: `dotnet`, `node`, `psql`, `pg_isready`, `curl`

**Production:**
- GCP Cloud Run (API, `europe-west1`, project `skystate-staging`)
- GCP Cloud SQL PostgreSQL 17 (instance `skystate-db`)
- Firebase Hosting (dashboard and landing page)
- GCP Artifact Registry (Docker images)
- GCP Secret Manager (all secrets injected at deploy time)
- CI/CD: GitHub Actions (OIDC auth via Workload Identity Federation, no long-lived keys)

---

*Stack analysis: 2026-03-04*
