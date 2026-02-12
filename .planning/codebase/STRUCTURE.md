# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
skystate/
├── api/                            # C# .NET 10 backend API
│   ├── Database/                   # PostgreSQL schema (installation.sql)
│   ├── SkyState.Api/               # Main API project
│   │   ├── Authentication/         # JWT handler, test auth handler, DI extensions
│   │   ├── BackgroundServices/     # RetentionPrunerService (daily pruner)
│   │   ├── Endpoints/              # Minimal API endpoint groups (one file per resource)
│   │   ├── Models/                 # Domain records, DTOs, result types
│   │   ├── Repositories/           # Dapper data access (one file per table)
│   │   ├── Services/               # Business logic (one file per domain)
│   │   ├── Program.cs              # Entry point: DI, middleware, endpoint registration
│   │   └── appsettings*.json       # Configuration (tiers, Stripe, GitHub, Serilog)
│   ├── SkyState.Api.UnitTests/     # xUnit unit tests
│   ├── SkyState.Api.IntegrationTests/ # xUnit integration tests (with PostgreSQL)
│   └── SkyState.Api.EndToEndTests/ # xUnit E2E tests (full stack)
├── cli/                            # TypeScript CLI (Commander.js)
│   ├── src/
│   │   ├── commands/               # One file per command group (auth, projects, envs, state, billing, config)
│   │   │   └── index.ts            # Registers all command groups on root program
│   │   ├── lib/                    # Shared utilities
│   │   │   ├── http-client.ts      # Authenticated HTTP client with retry + verbose logging
│   │   │   ├── config.ts           # Read/write ~/.skystate/credentials.json config file
│   │   │   ├── errors.ts           # CliError, AuthError, LimitError, RateLimitError, etc.
│   │   │   ├── output.ts           # Table/JSON/plain output formatter
│   │   │   ├── slug-resolver.ts    # Resolve project/env slugs to UUIDs via API
│   │   │   ├── diff.ts             # Structural diff, bump detection, unified diff generation
│   │   │   ├── spinner.ts          # TTY spinner wrapper
│   │   │   ├── prompt.ts           # Interactive yes/no confirmation prompts
│   │   │   ├── colors.ts           # Terminal color helpers
│   │   │   └── version.ts          # Read CLI version from package.json
│   │   └── cli.ts                  # Entry point: Commander program, global options, main()
│   ├── test/
│   │   ├── unit/
│   │   │   ├── commands/           # Unit tests for command handlers
│   │   │   └── lib/                # Unit tests for lib utilities
│   │   └── e2e/                    # End-to-end CLI tests (require running API)
│   └── dist/                       # tsup build output (not committed)
├── dashboard/                      # React 19 + TypeScript web app
│   └── src/
│       ├── api/
│       │   └── types.ts            # TypeScript types mirroring API models
│       ├── components/
│       │   ├── ui/                 # Radix UI / shadcn primitives (Button, Input, etc.)
│       │   └── ServiceBanner.tsx   # Global service unavailability banner
│       ├── features/               # Feature modules (self-contained per domain)
│       │   ├── login/              # LoginPage (GitHub OAuth redirect)
│       │   ├── projects/           # NewProjectPage
│       │   ├── settings/           # SettingsTab (project/env/retention config)
│       │   ├── state/              # StateTab, editor, version list, diff viewer
│       │   └── usage/              # UsageTab (metrics), PlansTab (Stripe billing)
│       ├── layout/                 # App shell, top bar, tab bar, project selector
│       │   ├── AppShell.tsx        # Authenticated shell: bootstrap data, routing
│       │   └── TopBar.tsx          # Project selector + tab navigation
│       ├── lib/                    # Shared utilities
│       │   ├── api.ts              # `api` object: typed fetch wrapper for all endpoints
│       │   ├── api-error.ts        # ApiError class
│       │   ├── api-status.ts       # Reactive api-available store (drives ServiceBanner)
│       │   ├── auth.ts             # Token management (sessionStorage), test mode helpers
│       │   └── utils.ts            # cn() classname utility
│       ├── store/                  # Zustand global state
│       │   ├── index.ts            # Composes all slices into single useStore
│       │   ├── types.ts            # StoreState type and slice type definitions
│       │   ├── auth-slice.ts       # User identity state
│       │   ├── projects-slice.ts   # Projects list, selection, CRUD
│       │   ├── environments-slice.ts # Environments list, selection, CRUD
│       │   ├── states-slice.ts     # State version list, promote target cache
│       │   ├── billing-slice.ts    # Billing status
│       │   └── state-tab-slice.ts  # State tab UI state (selected env, active view)
│       ├── styles/                 # Global CSS
│       └── App.tsx                 # Root component: auth check, routes
│   ├── test/
│   │   ├── unit/                   # Vitest component/unit tests (mirrors src/ structure)
│   │   └── e2e/                    # Playwright E2E tests
│   └── dist/                       # Vite production build output (not committed)
├── packages/
│   ├── protocol/                   # OpenAPI spec + JSON schemas + schema tests
│   │   ├── openapi.json            # OpenAPI 3.x specification
│   │   ├── schemas/                # JSON Schema files per resource type
│   │   └── tests/                  # Vitest schema validation tests
│   └── typescript/
│       ├── core/                   # @skystate/core — public SDK
│       │   └── src/
│       │       ├── fetch-settings.ts  # fetchSettings() - reads public state by slug
│       │       ├── types.ts           # SkyStateConfig, StateEnvelope, Version
│       │       └── error.ts           # SkyStateError
│       └── react/                  # @skystate/react — React hooks
│           └── src/
│               ├── use-settings.ts # useSettings() hook wrapping fetchSettings
│               └── index.ts
├── infrastructure/
│   └── staging.yml                 # AWS CloudFormation stack (ECS, RDS, CloudFront, ALB)
├── landing/                        # Static landing page (HTML/CSS)
├── docs/                           # Product documentation, auth docs, plans
├── .github/
│   └── workflows/
│       ├── workflow-test.yml       # CI: all test jobs on PR to master
│       ├── deploy-staging.yml      # CD: triggers on push to master
│       └── workflow-deploy.yml     # Reusable deploy workflow (called by deploy-staging)
├── docker-compose.yaml             # Local dev: proxy, api, dashboard, stripe-cli, postgres
├── nginx.conf                      # Local dev proxy: /api → api:5148, / → dashboard:5173
├── up.sh                           # Starts local dev stack (docker compose --env-file .env.local)
└── CLAUDE.md                       # Project context and conventions for Claude
```

## Directory Purposes

**`api/SkyState.Api/Endpoints/`:**
- Purpose: HTTP surface — one static class per resource group
- Contains: `ProjectStateEndpoints.cs`, `ProjectEndpoints.cs`, `EnvironmentEndpoints.cs`, `BillingEndpoints.cs`, `WebhookEndpoints.cs`, `AuthEndpoints.cs`, `UserEndpoints.cs`, `InvoiceEndpoints.cs`, `PublicStateEndpoints.cs`, `HealthEndpoint.cs`, `PingEndpoint.cs`
- All registered via `EndpointExtensions.cs` → `MapSkyStateEndpoints()`

**`api/SkyState.Api/Services/`:**
- Purpose: Business logic, billing enforcement, external service integration
- Contains: `ProjectStateService.cs`, `ProjectService.cs`, `EnvironmentService.cs`, `BillingService.cs`, `MeteringService.cs`, `StripeService.cs`, `WebhookService.cs`, `UserService.cs`, `InvoiceService.cs`, `GitHubOAuthService.cs`, `CurrentUserService.cs`
- All registered via `ServiceCollectionExtensions.cs`

**`api/SkyState.Api/Repositories/`:**
- Purpose: All PostgreSQL queries via Dapper
- Contains: One repository per table: `UserRepository.cs`, `ProjectRepository.cs`, `EnvironmentRepository.cs`, `ProjectStateRepository.cs`, `InvoiceRepository.cs`, `WebhookEventRepository.cs`, `ApiRequestCounterRepository.cs`
- All registered as singletons via `RepositoryCollectionExtensions.cs`

**`api/SkyState.Api/Models/`:**
- Purpose: Shared domain types used across all layers
- Contains: Domain records (`User.cs`, `Project.cs`, `Environment.cs`, `ProjectState.cs`), result types (`ServiceResult.cs`, `SlugLookupResult.cs`, `MeterResult.cs`), DTOs (`LimitResponse.cs`, `BillingStatus.cs`, `TierSettings.cs`, `MeteringSettings.cs`), request/response bodies

**`dashboard/src/features/`:**
- Purpose: Self-contained feature modules. Each feature owns its pages, components, and hooks.
- Key files: `features/state/StateTab.tsx` (main editor/history view), `features/settings/SettingsTab.tsx` (project/env/retention config), `features/usage/UsageTab.tsx` and `PlansTab.tsx` (billing UI), `features/login/LoginPage.tsx`

**`cli/src/commands/`:**
- Purpose: One file per command group, each exports `Command` instances
- Contains: `auth.ts` (login, logout, status), `projects.ts`, `envs.ts`, `state.ts`, `billing.ts`, `config.ts`
- Entry: `index.ts` registers all commands with `registerCommands(program)`

**`packages/protocol/`:**
- Purpose: API contract — OpenAPI spec and JSON schemas. Tests validate schemas are internally consistent and match the spec.
- Generated: No (hand-maintained)
- Key files: `openapi.json`, `schemas/*.schema.json`

## Key File Locations

**Entry Points:**
- `api/SkyState.Api/Program.cs`: API startup, DI, middleware
- `dashboard/src/App.tsx`: Dashboard root, auth check, routing
- `cli/src/cli.ts`: CLI program definition and main()

**Configuration:**
- `api/SkyState.Api/appsettings.json`: Default config (tiers, metering, logging levels)
- `api/SkyState.Api/appsettings.Development.json`: Dev overrides
- `dashboard/vite.config.ts`: Vite config, dev proxy to API
- `cli/tsconfig.json`: TypeScript strict config for CLI
- `dashboard/tsconfig.json`: TypeScript strict config for dashboard

**Core Logic:**
- `api/SkyState.Api/Services/BillingService.cs`: Tier limit enforcement
- `api/SkyState.Api/Services/MeteringService.cs`: Public API rate metering
- `api/SkyState.Api/Repositories/ProjectStateRepository.cs`: State versioning SQL
- `api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs`: Daily retention pruning
- `api/SkyState.Api/Endpoints/PublicStateEndpoints.cs`: Unauthenticated read endpoint with output cache
- `cli/src/lib/http-client.ts`: CLI HTTP client with auth, retry, verbose mode
- `cli/src/lib/diff.ts`: State diff and version bump auto-detection
- `dashboard/src/lib/api.ts`: Dashboard API client (`api` object)
- `dashboard/src/store/index.ts`: Zustand store composition

**Database Schema:**
- `api/Database/installation.sql`: Complete schema (all CREATE TABLE statements)

**Testing:**
- `api/SkyState.Api.UnitTests/`: C# unit tests (no database)
- `api/SkyState.Api.IntegrationTests/`: C# integration tests (require PostgreSQL service)
- `api/SkyState.Api.EndToEndTests/`: Full-stack E2E (require PostgreSQL + schema + CLI build)
- `cli/test/unit/`: Vitest unit tests for CLI lib and commands
- `cli/test/e2e/`: Vitest E2E tests for CLI (require running API)
- `dashboard/test/unit/`: Vitest component tests
- `dashboard/test/e2e/`: Playwright browser E2E tests
- `packages/protocol/tests/`: Vitest JSON schema validation tests

## Naming Conventions

**Files (API/C#):**
- PascalCase: `ProjectStateService.cs`, `BillingEndpoints.cs`, `UserRepository.cs`
- Suffix by layer: `*Endpoints.cs`, `*Service.cs`, `*Repository.cs`
- DI wiring: `*CollectionExtensions.cs`

**Files (TypeScript/CLI/Dashboard):**
- kebab-case: `http-client.ts`, `slug-resolver.ts`, `api-error.ts`
- Feature components: PascalCase: `StateTab.tsx`, `LoginPage.tsx`
- Store slices: kebab-case with `-slice.ts` suffix: `projects-slice.ts`

**Directories:**
- API: PascalCase matching C# namespace (`Endpoints/`, `Services/`, `Repositories/`)
- Dashboard/CLI: kebab-case (`features/`, `lib/`, `commands/`)

**C# naming:**
- Interfaces prefixed `I`: `IProjectService`, `IUserRepository`
- Records for models: `record User`, `record Project`
- Static endpoint classes: `ProjectEndpoints`, `BillingEndpoints`

**TypeScript naming:**
- Interfaces for types: `interface Project`, `interface BillingStatus`
- Store slice creators: `createProjectsSlice`, `createStatesSlice`

## Where to Add New Code

**New API resource (e.g., new domain entity):**
- Model: `api/SkyState.Api/Models/MyEntity.cs`
- Repository interface + class: `api/SkyState.Api/Repositories/MyEntityRepository.cs` — register in `RepositoryCollectionExtensions.cs`
- Service interface + class: `api/SkyState.Api/Services/MyEntityService.cs` — register in `ServiceCollectionExtensions.cs`
- Endpoints: `api/SkyState.Api/Endpoints/MyEntityEndpoints.cs` — add `MapMyEntityEndpoints()` call in `EndpointExtensions.cs`
- Tests: `api/SkyState.Api.UnitTests/` for service logic, `api/SkyState.Api.IntegrationTests/` for repository queries

**New CLI command group:**
- Implementation: `cli/src/commands/mygroup.ts` — export named `Command` instances
- Registration: Add to `registerCommands()` in `cli/src/commands/index.ts`
- Tests: `cli/test/unit/commands/mygroup.test.ts`

**New dashboard feature:**
- Feature directory: `dashboard/src/features/myfeature/`
- Components: `dashboard/src/features/myfeature/MyFeaturePage.tsx`
- Store slice (if needed): `dashboard/src/store/myfeature-slice.ts` — add to `StoreState` type in `store/types.ts` and compose in `store/index.ts`
- API types: Add to `dashboard/src/api/types.ts`
- API calls: Add to `dashboard/src/lib/api.ts`
- Route: Add to `AppShell.tsx` tab routing
- Tests: `dashboard/test/unit/features/myfeature/`

**New shared UI component:**
- Radix/shadcn primitives: `dashboard/src/components/ui/`
- App-level components: `dashboard/src/components/`

**Utilities:**
- CLI shared helpers: `cli/src/lib/`
- Dashboard shared helpers: `dashboard/src/lib/`

## Special Directories

**`api/SkyState.Api/bin/` and `api/SkyState.Api/obj/`:**
- Purpose: .NET build output
- Generated: Yes
- Committed: No (in `.gitignore`)

**`cli/dist/`:**
- Purpose: tsup bundle output (`skystate` CLI binary + types)
- Generated: Yes
- Committed: No

**`dashboard/dist/`:**
- Purpose: Vite production build
- Generated: Yes
- Committed: No

**`.planning/`:**
- Purpose: GSD planning documents (milestones, phases, codebase analysis)
- Generated: Partially (by GSD tooling)
- Committed: Yes

**`test-results/`:**
- Purpose: Test output artifacts (e.g., Playwright traces, JUnit XML)
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-04*
