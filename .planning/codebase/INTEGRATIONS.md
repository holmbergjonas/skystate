# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**Payment Processing:**
- Stripe - Subscription billing, checkout, customer portal, tier management
  - SDK/Client: `Stripe.net` v50.3.0 (`api/SkyState.Api/SkyState.Api.csproj`)
  - Client registration: `StripeClient` scoped DI in `api/SkyState.Api/Services/ServiceCollectionExtensions.cs`
  - Service: `api/SkyState.Api/Services/StripeService.cs`
  - Config section: `Stripe` in `appsettings.json`
  - Auth env vars (prod, via GCP Secret Manager): `skystate-stripe-secret-key`, `skystate-stripe-webhook-secret`, `skystate-stripe-hobby-price-id`, `skystate-stripe-pro-price-id`, `skystate-stripe-boost-price-id`
  - Auth env vars (local): `STRIPE_API_KEY` in `.env.local`

**Identity Provider:**
- GitHub OAuth 2.0 - User authentication for both web dashboard and CLI
  - No SDK — raw `HttpClient` calls to `https://github.com/login/oauth/authorize` and `https://github.com/login/oauth/access_token`
  - OAuth service: `api/SkyState.Api/Services/GitHubOAuthService.cs`
  - Token validation: `api/SkyState.Api/Authentication/GitHubTokenHandler.cs` (validates token against `https://api.github.com/user` on each request, cached 5 min)
  - Config section: `GitHub` in `appsettings.json`
  - Auth env vars (prod): `skystate-github-client-id`, `skystate-github-client-secret` via GCP Secret Manager
  - Auth env vars (local): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` in `.env.local`
  - Scopes requested: `read:user user:email`
  - Callback URL: `http://localhost:8080/api/auth/github/callback` (local), `https://staging-api.skystate.io/auth/github/callback` (staging)

## Data Storage

**Databases:**
- PostgreSQL 17
  - Connection: `ConnectionStrings:DefaultConnection` in `appsettings.json`; overridden at runtime by `DatabaseConnectionHelper` from env vars
  - Client: `Npgsql` 10.0.1 ADO.NET driver + `Dapper` 2.1.66 micro-ORM
  - All queries in repository layer: `api/SkyState.Api/Repositories/`
  - Local dev: `Host=skystate_db;Database=skystate;Username=admin;Password=admin`
  - Production (Cloud Run): Unix socket via `INSTANCE_UNIX_SOCKET=/cloudsql/skystate-staging:europe-west1:skystate-db`
  - TCP fallback: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` env vars

**File Storage:**
- GCP Cloud Storage - Used transiently during CI/CD only for DB migration SQL files; not used by the application at runtime
- No permanent file storage for user data

**Caching:**
- ASP.NET Core `IMemoryCache` (in-process) - GitHub token validation cache (5-min TTL in `GitHubTokenHandler`) and OAuth state cache (10-min TTL in `GitHubOAuthService`)
- ASP.NET Core Output Cache - Public state endpoint cached 60 seconds, tagged by `projectSlug`/`environmentSlug` (`api/SkyState.Api/Program.cs`)
- No external cache (no Redis)

## Authentication & Identity

**Auth Provider:**
- GitHub OAuth — single SSO provider; users are JIT-provisioned on first login via `IUserRepository.UpsertBySsoAsync()`
  - Implementation: `api/SkyState.Api/Authentication/GitHubTokenHandler.cs` — custom `AuthenticationHandler<AuthenticationSchemeOptions>` named `"GitHubToken"`
  - The GitHub OAuth access token itself is the bearer token — no JWT issued by SkyState
  - Token cached in-process (SHA-256 hash as key) to avoid per-request GitHub API calls
  - CLI flow: OAuth redirect with `flow=cli` param; callback returns HTML page with token for copy-paste

**API Key Auth:**
- Project-scoped API keys for SDK/programmatic access
  - API key hash stored in `project.api_key_hash` column (`api/Database/installation.sql`)
  - Used in `PublicStateEndpoints` for public state reads (`api/SkyState.Api/Endpoints/PublicStateEndpoints.cs`)

**Test Auth (non-production only):**
- `TestAuthHandler` scheme — activated when `EnableTestAuth=true` in config
  - Implementation: `api/SkyState.Api/Authentication/TestAuthHandler.cs`
  - Triggered by `X-Test-GitHub-Id` request header (bypasses GitHub API entirely)
  - `MultiAuth` policy scheme routes to either `GitHubToken` or `TestAuth` based on header presence

## Monitoring & Observability

**Error Tracking:**
- None — no external APM or error tracking service (no Sentry, Datadog, etc.)

**Logs:**
- Serilog structured logging (`Serilog.AspNetCore` 10.0.0 + `Serilog.Enrichers.Thread`)
- Configured via `appsettings.json` `Serilog` section
- Output: Console sink only (stdout) — Cloud Run captures stdout as Cloud Logging
- Request logging via `app.UseSerilogRequestLogging()` middleware
- Log levels: `Information` default in production, `Debug` in development
- Enriched with: `WithThreadId`, custom properties `App=skystate-api`, `Site=production/dev`

## CI/CD & Deployment

**Hosting:**
- API: GCP Cloud Run (`skystate-api` service, `europe-west1`, project `skystate-staging`)
- Dashboard: Firebase Hosting (`hosting:dashboard` target, serves `dashboard/dist`)
- Landing: Firebase Hosting (`hosting:landing` target, serves `landing/`)
- Container registry: GCP Artifact Registry (`skystate-api` repository)
- Database: GCP Cloud SQL PostgreSQL 17 (`skystate-db` instance)

**CI Pipeline:**
- GitHub Actions
  - Test workflow: `.github/workflows/workflow-test.yml` (called by deploy and PR workflows)
    - Jobs: API unit tests, API integration tests, API E2E tests (with Postgres service), dashboard lint/typecheck/build/tests, protocol tests, CLI typecheck/build/tests, CLI E2E tests, dashboard E2E tests, client backward-compatibility tests
  - Deploy workflow: `.github/workflows/workflow-deploy.yml` (reusable, called by `deploy-staging.yml`)
    - Steps: tests → DB migration (via `gcloud sql import`) → build & push Docker image → deploy to Cloud Run → deploy dashboard to Firebase → deploy landing to Firebase
  - Trigger: `.github/workflows/deploy-staging.yml` triggers on push to `master`
  - Auth: OIDC via Workload Identity Federation; service account `skystate-deploy@skystate-staging.iam.gserviceaccount.com`; WIF provider `projects/123212194289/locations/global/workloadIdentityPools/github/providers/github-actions`

## Webhooks & Callbacks

**Incoming (Stripe webhooks):**
- Endpoint: `POST /webhooks/stripe`
  - Implementation: `api/SkyState.Api/Endpoints/WebhookEndpoints.cs`
  - Processing: `api/SkyState.Api/Services/WebhookService.cs` (verification) → `api/SkyState.Api/Services/StripeService.cs` (business logic)
  - Signature verification: `Stripe-Signature` header validated against `Stripe:WebhookSecret`
  - Events handled: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
  - Idempotency: All events recorded in `webhook_event` table; duplicates detected via unique `stripe_event_id` constraint
  - Local dev: `stripe/stripe-cli:latest` Docker container forwards events from Stripe to `http://skystate_api:5148/webhooks/stripe`

**Outgoing:**
- None — no outgoing webhooks to external systems

## Environment Configuration

**Required env vars (production Cloud Run):**
- `INSTANCE_UNIX_SOCKET` - Cloud SQL Unix socket path (e.g. `/cloudsql/skystate-staging:europe-west1:skystate-db`)
- `DB_NAME`, `DB_USER`, `DB_PASSWORD` - Database credentials
- `GitHub__ClientId`, `GitHub__ClientSecret` - OAuth app credentials
- `GitHub__CallbackUrl`, `GitHub__FrontendUrl` - OAuth redirect URLs
- `Stripe__SecretKey`, `Stripe__WebhookSecret` - Stripe API authentication
- `Stripe__HobbyPriceId`, `Stripe__ProPriceId`, `Stripe__BoostPriceId` - Stripe price IDs
- `Jwt__SigningKey` - JWT signing key (referenced in deploy workflow, not yet wired in code)

**Required env vars (local dev, `.env.local`):**
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth app
- `STRIPE_API_KEY` - For Stripe CLI webhook forwarding

**Secrets location:**
- Production: GCP Secret Manager (secrets named `skystate-*`, accessed via Cloud Run `--set-secrets` flag)
- Local dev: `.env.local` file (gitignored) loaded by Docker Compose `env_file`

---

*Integration audit: 2026-03-04*
