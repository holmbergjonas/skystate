# CLAUDE.md

## Project Overview

SkyState is a cloud state management SaaS that provides developers with durable, versioned state accessible from the terminal, SDKs, or a web dashboard — no infrastructure setup required. Think feature flags / remote configuration with versioning, environments, and a CLI-first workflow.

## Repository Structure

```
skystate/
├── api/                        # C# .NET 10 backend API
│   ├── Database/               # PostgreSQL schema (installation.sql)
│   ├── SkyState.Api/           # Main API project
│   │   ├── Authentication/     # GitHub OAuth + JWT + test auth
│   │   ├── Endpoints/          # Minimal API endpoint groups
│   │   ├── Models/             # Domain models / DTOs
│   │   ├── Repositories/      # Data access layer (Dapper)
│   │   └── Services/          # Business logic layer
│   ├── SkyState.Api.UnitTests/
│   ├── SkyState.Api.IntegrationTests/
│   └── SkyState.Api.EndToEndTests/
├── cli/                        # TypeScript CLI (Commander.js)
│   └── src/
│       ├── commands/           # CLI commands (auth, projects, envs, state, billing, config)
│       └── lib/                # Shared utilities (http-client, output, config, errors)
├── dashboard/                  # React 19 + TypeScript web app
│   └── src/
│       ├── api/                # API client types
│       ├── components/         # Shared UI components (Radix/shadcn)
│       ├── features/           # Feature modules (login, settings, state, usage)
│       ├── layout/             # App shell, top bar, tab bar, project selector
│       ├── store/              # Zustand state stores
│       └── styles/             # Global styles
├── packages/
│   ├── protocol/               # OpenAPI spec + JSON schemas + tests
│   └── typescript/
│       ├── core/               # @skystate/core client library
│       └── react/              # @skystate/react hooks
├── infrastructure/             # AWS CloudFormation (staging.yml)
├── docs/                       # Product vision, auth docs, migration guides
├── landing/                    # Static landing page
├── docker-compose.yaml         # Local dev environment
├── nginx.conf                  # Dev proxy config
└── up.sh                       # Starts local dev: docker compose --env-file ./.env.local up
```

## Tech Stack

| Component   | Technology                                                     |
|-------------|----------------------------------------------------------------|
| API         | C# / .NET 10, ASP.NET Core minimal APIs, Dapper ORM           |
| Database    | PostgreSQL 17                                                  |
| Dashboard   | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Zustand 5   |
| CLI         | TypeScript, Commander.js 14, tsup bundler                      |
| Testing     | Vitest (TS), xUnit (C#), @testing-library/react                |
| Linting     | ESLint 9+ flat config, TypeScript strict mode                  |
| Infra       | AWS CloudFormation, ECS, RDS, CloudFront, ALB                  |
| CI/CD       | GitHub Actions                                                 |

## Development Commands

### Local environment (Docker)

```bash
./up.sh                  # Start all services (requires .env.local with GitHub OAuth creds)
```

Services start on:
- **http://localhost:8080** — Nginx proxy (dashboard + API)
- Dashboard: port 5173 (proxied)
- API: port 5148 (proxied at /api)
- PostgreSQL: port 5432

### Dashboard (`dashboard/`)

```bash
cd dashboard
npm install
npm run dev              # Vite dev server
npm run build            # Lint + typecheck + Vite production build
npm run lint             # ESLint only
npm test                 # Vitest run (single pass)
```

### CLI (`cli/`)

```bash
cd cli
npm install
npm run dev              # tsup watch mode
npm run build            # Lint + tsup bundle
npm run lint             # ESLint (--max-warnings 0)
npm run typecheck        # tsc --noEmit
npm test                 # Vitest run
npm run test:watch       # Vitest watch mode
```

### API (`api/`)

```bash
cd api
dotnet build SkyState.Api/
dotnet test SkyState.Api.UnitTests/
dotnet test SkyState.Api.IntegrationTests/
dotnet test SkyState.Api.EndToEndTests/     # Requires running PostgreSQL
```

### Protocol (`packages/protocol/`)

```bash
cd packages/protocol
npm install
npm test                 # Vitest — validates JSON schemas against OpenAPI spec
```

## CI Pipeline (PR checks)

All of these jobs run on PRs to master (`.github/workflows/workflow-test.yml`):

1. **API Unit Tests** — `dotnet test SkyState.Api.UnitTests/`
2. **API Integration Tests** — `dotnet test SkyState.Api.IntegrationTests/`
3. **API E2E Tests** — requires PostgreSQL service + schema + CLI build
4. **Dashboard Tests** — `npm run build` (lint + typecheck + vite build) then `npm test`
5. **Protocol Tests** — `npm test` in `packages/protocol/`
6. **CloudFormation Lint** — `cfn-lint infrastructure/*.yml`
7. **CLI Typecheck & Build** — `npm run typecheck` then `npm run build`

## Code Conventions

### TypeScript (CLI & Dashboard)

- **Strict mode** enabled everywhere (`strict: true` in tsconfig)
- **ESM modules** (`"type": "module"` in package.json)
- **ESLint 9+ flat config** with `--max-warnings 0` (zero tolerance for warnings)
- **No unused locals/parameters** enforced by TypeScript compiler
- Path alias in dashboard: `@/*` maps to `./src/*`
- Tests are colocated with source files as `*.test.ts` / `*.test.tsx`

### C# API

- **Minimal API** pattern (endpoints as extension methods, not controllers)
- **Repository pattern** for data access — all SQL via Dapper (no EF Core)
- **Service layer** for business logic, injected via DI
- **Endpoint groups** registered in `EndpointExtensions.cs` via `MapSkyStateEndpoints()`
- Database column mapping: `Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true`
- snake_case in PostgreSQL, PascalCase in C# models (auto-mapped)

### React / Dashboard

- **Functional components** with hooks only
- **Zustand** for global state management (stores in `src/store/`)
- **Feature-based organization** — each feature in `src/features/<name>/`
- **Radix UI + shadcn** component primitives in `src/components/ui/`
- **@testing-library/react** for component tests with jsdom
- Vite dev server proxies `/api` → `localhost:5148`

### CLI

- **Commander.js** with typed commands (`@commander-js/extra-typings`)
- **CliError** class for user-facing errors with graceful messages
- Output formatting abstraction supporting table, JSON, and plain text
- Config stored in user home directory

## Database Schema

PostgreSQL with these core tables (see `api/Database/installation.sql`):

- `user` — identity, SSO provider, Stripe billing, subscription tier
- `project` — user's projects with slug and hashed API key
- `environment` — environments per project (dev, staging, prod)
- `project_state` — versioned JSON state per environment
- Plus: `api_request_counter`, `invoice`, `webhook_event`

Subscription tiers: `free`, `hobby`, `pro` — each with project/env/storage/request limits.

## Authentication

- **GitHub OAuth** flow → server exchanges code → JIT user provisioning → JWT (HS256, 30-min expiry)
- API expects `Authorization: Bearer <token>` header
- **API keys** for project-scoped access (hash stored in DB)
- **Test mode**: `VITE_TEST_MODE=true` in dashboard auto-authenticates without GitHub login; `TestAuthHandler` in API for testing

## Environment Variables

### API (via docker-compose or ECS)

- `ConnectionStrings__DefaultConnection` — PostgreSQL connection string
- `GitHub__ClientId` / `GitHub__ClientSecret` — OAuth app credentials
- `GitHub__CallbackUrl` — OAuth callback URL
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — individual DB env vars (ECS)

### Dashboard

- `VITE_API_BASE_URL` — API base URL (default `/api`)
- `VITE_TEST_MODE` — enable test mode auth bypass
- `VITE_TEST_GITHUB_ID`, `VITE_TEST_EMAIL`, `VITE_TEST_NAME` — test user details

## Key Files

- `api/SkyState.Api/Program.cs` — API entry point, DI registration, middleware pipeline
- `api/Database/installation.sql` — complete database schema
- `dashboard/src/App.tsx` — dashboard root component and routing
- `cli/src/cli.ts` — CLI entry point
- `packages/protocol/openapi.json` — OpenAPI specification
- `infrastructure/staging.yml` — AWS CloudFormation stack
- `.github/workflows/workflow-test.yml` — CI test matrix
