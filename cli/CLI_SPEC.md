# SkyState CLI Specification

**Binary:** `skystate`
**Version:** v1.0 spec (targets API v1.2)

---

## 1. Overview and Philosophy

The SkyState CLI provides complete parity with the web dashboard using CLI-native patterns.
Every dashboard feature — projects, environments, state management, usage meters, billing — is
available as a composable command. Output goes to stdout, errors to stderr, and every command
exits with a meaningful code.

### Design Principles

- **Machine-readable by default when piped.** Output format auto-detects: `table` for TTY, `json`
  when stdout is not a TTY (pipe, redirect, script).
- **Subcommand hierarchy mirrors resources.** Commands group naturally: `skystate projects`,
  `skystate envs`, `skystate state`, `skystate billing`.
- **Composable with standard Unix tools.** Output is designed to pipe to `jq`, `grep`, shell
  scripts, and CI workflows.
- **No hidden side effects.** Destructive commands require explicit confirmation. Prompts are
  skipped with `--force` for scripting.
- **Credentials never on the command line.** Auth token comes from config file or environment
  variable, never a flag.

### Global Flags

These flags apply to every command:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `json\|table\|plain` | `table` (TTY), `json` (pipe) | Output format |
| `--quiet` | bool | false | Suppress informational output; only print result data |
| `--verbose` | bool | false | Include HTTP headers, timing, and debug info in stderr |
| `--api-url` | string | `https://api.skystate.dev` | Override API base URL |
| `--project` | string | config default | Override default project slug |
| `--env` | string | config default | Override default environment slug |

`--format plain` outputs one value per line with no table borders; useful for `grep` and simple
`for` loops.

`--verbose` always writes to stderr, never stdout, so it does not break piping.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error (network, unexpected, validation) |
| `2` | Authentication error (no token, expired, 401) |
| `78` | Limit exceeded (402 — project/env/storage limit reached) |
| `79` | Rate limited (429 — monthly API request limit exceeded) |

### Token Resolution Order

1. `SKYSTATE_TOKEN` environment variable
2. `~/.config/skystate/credentials.json` `.token` field

---

## 2. Authentication

Mirrors: `LoginPage.tsx`, GitHub OAuth flow via `AuthEndpoints.cs`

### `skystate auth login`

Opens a browser window to complete GitHub OAuth. After the OAuth redirect, the token is stored
locally. Designed for interactive sessions.

**Synopsis:**
```
skystate auth login [--api-url <url>]
```

**Flow:**
1. CLI opens `<api-url>/auth/github` in the default browser (or prints the URL with `--no-browser`)
2. User completes GitHub OAuth in browser
3. API redirects back to a local callback server on a random port
4. Token extracted from redirect, written to `~/.config/skystate/credentials.json`

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-browser` | bool | false | Print URL instead of opening browser |

**Success output (stdout):**
```
Logged in as jane@example.com (Jane Doe)
Token written to ~/.config/skystate/credentials.json
```

**Error cases:**
- OAuth callback not received within 60s: stderr `Login timed out`, exit 1
- Browser cannot be opened: falls back to `--no-browser` behavior automatically

---

### `skystate auth logout`

Clears the stored token.

**Synopsis:**
```
skystate auth logout
```

**Success output:**
```
Logged out. Token removed from ~/.config/skystate/credentials.json
```

No error if not logged in — idempotent.

---

### `skystate auth status`

Shows current authentication state and user info.

**Synopsis:**
```
skystate auth status [--format <format>]
```

**Success output (table):**
```
USER        EMAIL                 DISPLAY NAME   SSO PROVIDER   TIER
u-abc123    jane@example.com      Jane Doe        github         pro
```

**Success output (json):**
```json
{
  "userId": "u-abc123",
  "email": "jane@example.com",
  "displayName": "Jane Doe",
  "ssoProvider": "github",
  "tier": "pro",
  "boostMultiplier": 1
}
```

**Error cases:**
- No token stored: stderr `Not authenticated. Run: skystate auth login`, exit 2

---

## 3. Projects

Mirrors: `ProjectSelector.tsx`, `SettingsTab.tsx` (Project Settings section), `ProjectEndpoints.cs`

### `skystate projects list`

List all projects owned by the authenticated user.

**Synopsis:**
```
skystate projects list [--format <format>]
```

**Success output (table):**
```
NAME           SLUG              CREATED
My App         my-app            2024-01-15
Analytics      analytics-prod    2024-03-02
```

**Success output (json):**
```json
[
  {
    "projectId": "...",
    "name": "My App",
    "slug": "my-app",
    "createdAt": "2024-01-15T00:00:00Z",
    "updatedAt": "2024-01-15T00:00:00Z"
  }
]
```

**Error cases:**
- Auth error: exit 2

---

### `skystate projects create <name>`

Create a new project. Auto-creates Development and Production environments by default
(mirrors dashboard behavior in `ProjectSelector.tsx`).

**Synopsis:**
```
skystate projects create <name> [--slug <slug>] [--no-default-envs]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<name>` | Human-readable project name |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--slug` | string | auto-derived from name | URL-safe identifier (lowercase, alphanumeric, hyphens) |
| `--no-default-envs` | bool | false | Skip creating default environments |

**Slug derivation:** Lowercase, replace spaces and special chars with hyphens, trim leading/trailing hyphens. Example: `"My App"` becomes `my-app`.

**Success output:**
```
Created project my-app
  Development environment created
  Production environment created
```

With `--format json`:
```json
{
  "projectId": "...",
  "slug": "my-app",
  "environments": ["development", "production"]
}
```

**Error cases:**
- Name/slug already taken: stderr `Project slug "my-app" already exists`, exit 1
- Project limit reached: stderr `Project limit reached. Upgrade to create more projects.`, exit 78
- Slug format invalid: stderr `Slug must be lowercase alphanumeric with hyphens`, exit 1

---

### `skystate projects get <slug>`

Show details for a single project.

**Synopsis:**
```
skystate projects get <slug> [--format <format>]
```

**Success output (table):**
```
NAME      My App
SLUG      my-app
CREATED   2024-01-15
UPDATED   2024-03-10
```

**Error cases:**
- Not found: stderr `Project "my-app" not found`, exit 1

---

### `skystate projects update <slug>`

Update a project's name. Slug cannot be changed after creation (enforced by API).

**Synopsis:**
```
skystate projects update <slug> --name <new-name>
```

**Flags:**

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--name` | string | yes | New project name |

**Success output:**
```
Updated project my-app
```

**Error cases:**
- Not found: exit 1
- `--name` not provided: exit 1 with usage hint

---

### `skystate projects delete <slug>`

Permanently delete a project and all associated environments and state versions.

**Synopsis:**
```
skystate projects delete <slug> [--force]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--force` | bool | false | Skip interactive confirmation (for scripts) |

**Interactive confirmation (TTY, no `--force`):**
```
This will permanently delete project "my-app" and all its data.
Type the project slug to confirm: _
```

User must type the slug exactly. Any other input aborts with exit 1.

**Non-interactive (`--force`):**
```
skystate projects delete my-app --force
```
No prompt. Deletes immediately.

**Success output:**
```
Deleted project my-app
```

**Error cases:**
- Not found: exit 1
- Confirmation mismatch (interactive): stderr `Aborted`, exit 1

---

### `skystate projects select <slug>`

Set the default project for subsequent commands. Persists to `~/.config/skystate/config.json`.

**Synopsis:**
```
skystate projects select <slug>
```

**Success output:**
```
Default project set to: my-app
```

All subsequent commands that need `--project` will use `my-app` unless overridden.

---

## 4. Environments

Mirrors: `SettingsTab.tsx` (Environments section), `EnvironmentEndpoints.cs`

All environment commands accept `--project <slug>` to override the default project. If no project
is specified (via flag or config), commands error with: `No project selected. Run: skystate projects select <slug>`

### `skystate envs list`

List environments for the current project.

**Synopsis:**
```
skystate envs list [--project <slug>] [--format <format>]
```

**Success output (table):**
```
NAME          SLUG          COLOR
Development   development   #22c55e
Staging       staging       #f59e0b
Production    production    #ef4444
```

**Success output (json):**
```json
[
  {
    "environmentId": "...",
    "name": "Development",
    "slug": "development",
    "color": "#22c55e",
    "createdAt": "2024-01-15T00:00:00Z"
  }
]
```

---

### `skystate envs create <name>`

Create a new environment within the current project.

**Synopsis:**
```
skystate envs create <name> [--slug <slug>] [--color <hex>] [--project <slug>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--slug` | string | auto-derived from name | Environment slug (immutable after creation) |
| `--color` | string | `#6b7280` | Hex color code for visual identification |
| `--project` | string | config default | Project slug |

**Success output:**
```
Created environment staging in project my-app
```

**Error cases:**
- Environment limit reached: stderr `Environment limit reached. Upgrade to add more.`, exit 78
- Slug already exists in project: stderr `Environment slug "staging" already exists`, exit 1

---

### `skystate envs update <slug>`

Update an environment's display name or color. Slug cannot be changed.

**Synopsis:**
```
skystate envs update <slug> [--name <name>] [--color <hex>] [--project <slug>]
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--name` | string | New display name |
| `--color` | string | New hex color |
| `--project` | string | Project slug |

At least one of `--name` or `--color` must be provided.

**Success output:**
```
Updated environment staging
```

---

### `skystate envs delete <slug>`

Delete an environment and all its state versions.

**Synopsis:**
```
skystate envs delete <slug> [--force] [--project <slug>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--force` | bool | false | Skip confirmation |
| `--project` | string | config default | Project slug |

**Interactive confirmation:**
```
This will permanently delete environment "staging" and all its state versions.
Confirm? [y/N] _
```

**Success output:**
```
Deleted environment staging from project my-app
```

---

### `skystate envs select <slug>`

Set the default environment for subsequent commands.

**Synopsis:**
```
skystate envs select <slug> [--project <slug>]
```

**Success output:**
```
Default environment set to: staging (project: my-app)
```

---

## 5. State Management

Mirrors: `StateTab.tsx`, `push-utils.ts`, `ProjectStateEndpoints.cs`

All state commands accept `--project <slug>` and `--env <slug>` to override defaults.

Semantic versioning follows the same logic as the dashboard:
- **major**: key removals or type changes (breaking)
- **minor**: key additions (non-breaking structural)
- **patch**: value-only changes

When `--bump` is omitted, the version bump is auto-detected by diffing against the current
latest state using the same diff analysis as the dashboard.

### `skystate state get`

Fetch the latest state as JSON to stdout. Designed for piping.

**Synopsis:**
```
skystate state get [--version <major.minor.patch>] [--project <slug>] [--env <slug>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--version` | string | latest | Specific version to fetch (e.g. `1.2.3`) |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Success output (stdout — raw JSON, not wrapped):**
```json
{
  "theme": "dark",
  "maxItems": 100,
  "features": { "betaMode": false }
}
```

Note: `skystate state get` outputs the state body directly, not the version envelope. Use
`--format json` for the full envelope including version and timestamps:
```json
{
  "version": { "major": 1, "minor": 2, "patch": 3 },
  "lastModified": "2024-03-10T12:00:00Z",
  "state": { ... }
}
```

**Error cases:**
- Version not found: stderr `Version 1.2.3 not found`, exit 1
- No state yet: stderr `No state exists for this environment`, exit 1
- Auth error: exit 2

---

### `skystate state history`

List version history for the current environment.

**Synopsis:**
```
skystate state history [--limit <n>] [--project <slug>] [--env <slug>] [--format <format>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | int | 50 | Max versions to return |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Success output (table):**
```
VERSION   SIZE      COMMENT                           DATE
1.3.0     2.4 KB    Add dark mode config              2024-03-10 12:00
1.2.1     2.1 KB    Fix default locale                2024-03-08 09:15
1.2.0     2.1 KB    Add locale settings               2024-03-07 14:30
1.1.0     1.8 KB    Promoted from staging v1.1.0      2024-03-05 11:00
1.0.0     1.2 KB    (no comment)                      2024-01-15 09:00
```

**Success output (json):**
```json
[
  {
    "version": "1.3.0",
    "major": 1,
    "minor": 3,
    "patch": 0,
    "stateSizeBytes": 2457,
    "comment": "Add dark mode config",
    "createdAt": "2024-03-10T12:00:00Z"
  }
]
```

---

### `skystate state push <file|->`

Push a new state version from a file or stdin. This is the primary way to update state
programmatically or from scripts.

**Synopsis:**
```
skystate state push <file|-> [--bump major|minor|patch] [--comment <message>] [--project <slug>] [--env <slug>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<file>` | Path to JSON file to push |
| `-` | Read JSON from stdin |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--bump` | `major\|minor\|patch` | auto-detected | Version bump type |
| `--comment` | string | none | Commit message for this version |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Auto-detect bump:** When `--bump` is omitted, the CLI diffs the new state against the current
latest and applies:
- `major` if any keys are removed or types change
- `minor` if any keys are added
- `patch` if only values change

**Success output:**
```
Pushed state to my-app/staging
  1.2.1 -> 1.2.2 (patch)
```

With `--format json`:
```json
{
  "projectStateId": "...",
  "version": "1.2.2",
  "bump": "patch"
}
```

**Error cases:**
- Invalid JSON: stderr `Invalid JSON: <parse error>`, exit 1
- Storage limit exceeded: stderr `Storage limit reached. Upgrade to push more state.`, exit 78
- Rate limit exceeded (429): stderr `Monthly API request limit exceeded. Resets <date>. Upgrade for higher limits.`, exit 79

---

### `skystate state edit`

Open the current state in `$EDITOR`, push on save and exit. Falls back to `$VISUAL`, then
`vi` if neither is set.

**Synopsis:**
```
skystate state edit [--bump major|minor|patch] [--comment <message>] [--project <slug>] [--env <slug>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--bump` | `major\|minor\|patch` | auto-detected | Version bump type |
| `--comment` | string | none | Commit message |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Flow:**
1. Fetch current latest state and write to a temp file
2. Open temp file in `$EDITOR`
3. On editor exit: validate JSON, diff against original
4. If no changes: print `No changes made. Nothing pushed.`, exit 0
5. If changes: push with auto-detected or explicit bump, print success

**Error cases:**
- Editor exits non-zero: stderr `Editor exited with error`, exit 1
- Invalid JSON after edit: stderr `Invalid JSON. Edit again? [y/N]`, re-opens editor on `y`

---

### `skystate state diff`

Show unified diff between the current state and the previous version, or compare against another
environment's latest state.

**Synopsis:**
```
skystate state diff [--env-compare <slug>] [--version <v1>] [--against <v2>] [--project <slug>] [--env <slug>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--env-compare` | string | none | Compare current env state with another env's latest state |
| `--version` | string | latest | Source version to diff from |
| `--against` | string | previous | Version to diff against |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Success output (stdout — unified diff format):**
```diff
--- staging v1.2.1  2024-03-08T09:15:00Z
+++ staging v1.3.0  2024-03-10T12:00:00Z
@@ -1,6 +1,7 @@
 {
   "theme": "dark",
-  "maxItems": 100,
+  "maxItems": 250,
+  "darkModeEnabled": true,
   "features": {
     "betaMode": false
   }
 }
```

**Diff stats line (stderr):** `+2 -1 ~0`

**Cross-environment comparison:**
```
skystate state diff --env-compare production
```
Shows diff between `staging` latest and `production` latest (mirrors dashboard compare mode).

---

### `skystate state promote <target-env>`

Promote the current environment's latest state to a target environment. Creates a new version
in the target environment with an auto-generated comment noting the promotion source.

**Synopsis:**
```
skystate state promote <target-env> [--bump major|minor|patch] [--comment <message>] [--project <slug>] [--env <slug>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<target-env>` | Slug of the environment to promote into |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--bump` | `major\|minor\|patch` | auto-detected | Version bump for target env |
| `--comment` | string | `Promoted from <env> v<ver>` | Override auto-generated comment |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Source environment slug |

**Auto-generated comment format:** `Promoted from staging v1.3.0`

**Success output:**
```
Promoted staging v1.3.0 -> production
  production: 1.0.5 -> 1.1.0 (minor)
```

**Error cases:**
- Target env not found: exit 1
- Storage limit: exit 78
- Source equals target: stderr `Cannot promote to same environment`, exit 1

---

### `skystate state rollback <version>`

Roll back to a specific historical version. Creates a new version in the current environment
with the content of the target version. The rolled-back version retains its history entry.

**Synopsis:**
```
skystate state rollback <version> [--confirm] [--project <slug>] [--env <slug>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<version>` | Version string to roll back to (e.g. `1.1.0`) |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--confirm` | bool | false | Skip interactive confirmation |
| `--project` | string | config default | Project slug |
| `--env` | string | config default | Environment slug |

**Interactive confirmation:**
```
Roll back staging to v1.1.0?
This will create a new version (1.3.1) with the content of v1.1.0.
Confirm? [y/N] _
```

**Success output:**
```
Rolled back staging to v1.1.0
  New version: 1.3.1 (patch)
```

**Error cases:**
- Version not found: stderr `Version 1.1.0 not found in staging history`, exit 1
- Storage limit: exit 78

---

## 6. Public State Read

Mirrors: `PublicStateEndpoints.cs` — no authentication required

### `skystate state fetch <project-slug> <env-slug>`

Read the public state for any project/environment without authentication. Intended for use in
application code, CI scripts, and edge deployments.

**Synopsis:**
```
skystate state fetch <project-slug> <env-slug> [--api-url <url>] [--format <format>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<project-slug>` | Project slug (publicly visible) |
| `<env-slug>` | Environment slug (publicly visible) |

**Success output (stdout — raw state JSON):**
```json
{
  "theme": "dark",
  "maxItems": 100
}
```

With `--format json` (full envelope):
```json
{
  "version": { "major": 1, "minor": 3, "patch": 0 },
  "lastModified": "2024-03-10T12:00:00Z",
  "state": { ... }
}
```

**With `--verbose` (writes to stderr):**
```
< HTTP/2 200
< X-RateLimit-Limit: 200
< X-RateLimit-Remaining: 156
< X-RateLimit-Reset: 1711929600
< X-RateLimit-Warning: Rate limit exceeded; requests will be blocked above 110%
< Cache-Control: public, max-age=60, stale-while-revalidate=300
< ETag: "1.3.0"
```

**Error cases:**
- Not found: stderr `Project or environment not found`, exit 1
- Rate limited (429): stderr `Rate limit exceeded for this account. Retry after <date>`, exit 79
- Invalid slug format: stderr `Invalid slug format`, exit 1

**Note:** This endpoint is CDN-cached for up to 60 seconds. Use `--verbose` to inspect caching
headers. Cached responses do not count against API request limits.

---

## 7. Usage and Billing

Mirrors: `UsageTab.tsx`, `UsageMeter.tsx`, `PlanCards.tsx`, `OverLimitBanner.tsx`,
`BillingEndpoints.cs`, `InvoiceEndpoints.cs`

### `skystate usage`

Show current resource usage across all meters. Includes projects, environments, storage, and
API requests.

**Synopsis:**
```
skystate usage [--resource projects|environments|storage|api-requests] [--format <format>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--resource` | string | all | Show a single resource meter |

**Success output (table — all resources):**
```
RESOURCE        USED      LIMIT       PERCENT   STATUS
Projects        2         3           67%       ok
Environments    8         unlimited   -         ok
Storage         4.2 MB    10 MB       42%       ok
API Requests    1,847     2,000       92%       warning
  resets        Mar 1, 2026
```

Status values: `ok`, `warning` (80-100%), `limit` (100%), `grace` (100-110%), `blocked` (>110%)

**Success output (json):**
```json
{
  "tier": "hobby",
  "boostMultiplier": 1,
  "projects": { "count": 2, "limit": 3, "percent": 67 },
  "environments": { "count": 8, "limit": null, "percent": null },
  "storage": { "bytes": 4404019, "limit": 10485760, "percent": 42, "formatted": "4.2 MB / 10 MB" },
  "apiRequests": {
    "count": 1847,
    "limit": 2000,
    "percent": 92,
    "resetDate": "2026-03-01T00:00:00Z",
    "status": "warning"
  },
  "overLimit": []
}
```

**Over-limit banner:** When any resource is in `overLimit`, a warning is printed to stderr:
```
WARNING: Project creation is blocked -- you've reached your project limit.
WARNING: State creation is blocked -- you've exceeded your storage limit.
Run: skystate billing upgrade <tier>
```

---

### `skystate billing status`

Show current billing plan, tier, boost multiplier, and renewal date.

**Synopsis:**
```
skystate billing status [--format <format>]
```

**Success output (table):**
```
TIER         BOOST   RENEWAL
hobby        1x      Mar 1, 2026
```

**Success output (json):**
```json
{
  "tier": "hobby",
  "boostMultiplier": 1,
  "currentPeriodEnd": "2026-03-01T00:00:00Z",
  "retentionDays": 90
}
```

---

### `skystate billing plans`

Show all available plans with limits and pricing.

**Synopsis:**
```
skystate billing plans [--format <format>]
```

**Success output (table):**
```
TIER     PRICE   PROJECTS   ENVIRONMENTS   STORAGE   RETENTION   API REQUESTS
free     $0      1          2/project      500 KB    30 days     200/mo
hobby    $5/mo   3          Unlimited      10 MB     90 days     2,000/mo
pro      $15/mo  10         Unlimited      100 MB    Unlimited   20,000/mo
```

Boosts: Pro plan supports stackable Pro Boost add-ons at $10/mo each. Each boost adds 1x
multiplier to all limits (e.g. 2x boost = 200 MB storage, 40,000 API requests).

**Success output (json):**
```json
[
  {
    "id": "free",
    "name": "Free",
    "price": "$0",
    "limits": {
      "projects": 1,
      "environments": 2,
      "storage": "500 KB",
      "retentionDays": 30,
      "apiRequestsPerMonth": 200
    }
  },
  {
    "id": "hobby",
    "name": "Hobby",
    "price": "$5/mo",
    "limits": {
      "projects": 3,
      "environments": null,
      "storage": "10 MB",
      "retentionDays": 90,
      "apiRequestsPerMonth": 2000
    }
  },
  {
    "id": "pro",
    "name": "Pro",
    "price": "$15/mo",
    "limits": {
      "projects": 10,
      "environments": null,
      "storage": "100 MB",
      "retentionDays": null,
      "apiRequestsPerMonth": 20000
    }
  }
]
```

---

### `skystate billing upgrade <tier>`

Initiate a plan upgrade by opening the Stripe checkout session in a browser.

**Synopsis:**
```
skystate billing upgrade <tier> [--no-browser]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<tier>` | Target tier: `hobby` or `pro` |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-browser` | bool | false | Print Stripe checkout URL instead of opening browser |

**Flow:**
1. CLI calls `POST /billing/checkout` with the target tier
2. API returns a Stripe Checkout URL
3. CLI opens URL in browser (or prints it with `--no-browser`)

**Success output:**
```
Opening Stripe checkout for Pro plan...
Complete checkout in your browser.
```

With `--no-browser`:
```
Checkout URL: https://checkout.stripe.com/pay/cs_live_...
```

**Error cases:**
- Invalid tier: stderr `Unknown tier "enterprise". Valid tiers: hobby, pro`, exit 1
- Already on higher tier: stderr `You are already on the pro plan`, exit 1

**Note for downgrade:** To downgrade, use `skystate billing portal` to access the Stripe portal.
Downgrades are subject to soft-lock behavior — existing data is preserved, new resource creation
is blocked until within the lower tier limits.

---

### `skystate billing boost`

Purchase or update a Pro Boost add-on (Pro plan only). Each boost adds 1x multiplier to all
resource limits.

**Synopsis:**
```
skystate billing boost [--quantity <n>] [--no-browser]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--quantity` | int | current + 1 | Total boost quantity to set |
| `--no-browser` | bool | false | Print URL instead of opening browser |

If you have an existing boost subscription, `skystate billing boost` updates the quantity inline
via `PUT /billing/boost` (no Stripe redirect needed). If you have no boost yet, it initiates a
new checkout via `POST /billing/boost/checkout`.

**Success output (quantity update):**
```
Boost updated to 2x. New limits apply immediately.
```

**Success output (new checkout):**
```
Opening Stripe checkout for Pro Boost...
```

**Error cases:**
- Not on Pro plan: stderr `Pro Boost requires the Pro plan. Upgrade first.`, exit 1

---

### `skystate billing portal`

Open the Stripe Customer Portal in a browser. Use for managing subscriptions, payment methods,
and downgrades.

**Synopsis:**
```
skystate billing portal [--no-browser]
```

**Success output:**
```
Opening Stripe customer portal...
```

With `--no-browser`:
```
Portal URL: https://billing.stripe.com/session/...
```

---

### `skystate billing invoices`

List billing invoices.

**Synopsis:**
```
skystate billing invoices [--format <format>]
```

**Success output (table):**
```
INVOICE ID     PERIOD                  AMOUNT    STATUS
inv-abc123     Feb 1 – Mar 1, 2026     $5.00     paid
inv-xyz789     Jan 1 – Feb 1, 2026     $5.00     paid
```

**Success output (json):**
```json
[
  {
    "invoiceId": "inv-abc123",
    "amountPaidCents": 500,
    "status": "paid",
    "billingPeriodStart": "2026-02-01T00:00:00Z",
    "billingPeriodEnd": "2026-03-01T00:00:00Z",
    "createdAt": "2026-02-01T00:00:00Z"
  }
]
```

---

## 8. Configuration

CLI-specific configuration. No dashboard equivalent — manages local CLI preferences.

Config file: `~/.config/skystate/config.json`
Credentials file: `~/.config/skystate/credentials.json`

### `skystate config set <key> <value>`

Set a config value.

**Synopsis:**
```
skystate config set <key> <value>
```

**Supported keys:**

| Key | Type | Description |
|-----|------|-------------|
| `api_url` | string | API base URL |
| `default_project` | string | Default project slug |
| `default_env` | string | Default environment slug |
| `format` | `json\|table\|plain` | Default output format |

**Example:**
```
skystate config set default_project my-app
skystate config set format json
```

**Success output:**
```
Set default_project = my-app
```

---

### `skystate config get <key>`

Get a single config value.

**Synopsis:**
```
skystate config get <key>
```

**Success output (stdout, plain):**
```
my-app
```

**Error cases:**
- Unknown key: stderr `Unknown config key "foo"`, exit 1
- Key not set: empty stdout, exit 0

---

### `skystate config list`

Show all current configuration.

**Synopsis:**
```
skystate config list [--format <format>]
```

**Success output (table):**
```
KEY               VALUE
api_url           https://api.skystate.dev
default_project   my-app
default_env       staging
format            table
```

**Success output (json):**
```json
{
  "api_url": "https://api.skystate.dev",
  "default_project": "my-app",
  "default_env": "staging",
  "format": "table"
}
```

---

### `skystate config path`

Print the path to the config file. Useful for locating or backing up config.

**Synopsis:**
```
skystate config path
```

**Success output:**
```
/home/jane/.config/skystate/config.json
```

---

## 9. Piping and Scripting Examples

The CLI is designed to work naturally with Unix pipelines. All JSON output is valid and stable
for use with `jq`, `xargs`, and shell scripts.

### Extract data from state

```bash
# Get a specific field from state
skystate state get | jq '.users | length'

# Get a nested value
skystate state get --env production | jq -r '.featureFlags.darkMode'
```

### Copy state between environments

```bash
# Promote by copying state content via pipe
skystate state get --env staging | skystate state push - --env production --bump minor --comment "Manual promote"
```

### Copy state between projects

```bash
# Get from one project, push to another
skystate state get --project project-a --env production | \
  skystate state push - --project project-b --env production --comment "Copied from project-a"
```

### List slugs for scripting

```bash
# Get all project slugs
skystate projects list --format json | jq -r '.[].slug'

# Loop over projects
for slug in $(skystate projects list --format json | jq -r '.[].slug'); do
  echo "Project: $slug"
  skystate state get --project "$slug" --env production | jq '.version'
done
```

### Push with git commit message as comment

```bash
skystate state push config.json --bump patch --comment "$(git log -1 --pretty=%s)"
```

### Check storage usage programmatically

```bash
# Exit non-zero if storage is above 80%
PERCENT=$(skystate usage --format json | jq '.storage.percent')
if [ "$PERCENT" -gt 80 ]; then
  echo "Storage warning: ${PERCENT}% used"
  exit 1
fi
```

### Check API request usage and alert

```bash
skystate usage --format json | jq -r '
  if .apiRequests.percent > 90
  then "WARNING: API requests at \(.apiRequests.percent)% (\(.apiRequests.count)/\(.apiRequests.limit))"
  else "OK: \(.apiRequests.percent)% used"
  end
'
```

### Use exit codes in deployment scripts

```bash
# Push state, fail deployment on error
skystate state push deploy/config.json --env production --bump patch \
  --comment "Deploy $(git rev-parse --short HEAD)" \
  || { echo "State push failed (exit $?)"; exit 1; }

# Handle specific errors
skystate state push config.json --env production
EXIT=$?
case $EXIT in
  0)  echo "Push succeeded" ;;
  78) echo "Storage limit reached — upgrade required"; exit 1 ;;
  79) echo "Rate limited — will retry next month" ;;
  *)  echo "Push failed with exit $EXIT" ;;
esac
```

### CI/CD pipeline integration

```bash
# Read production config in CI without credentials (public endpoint)
CONFIG=$(skystate state fetch my-app production)
FEATURE_FLAG=$(echo "$CONFIG" | jq -r '.featureFlags.maintenanceMode')
if [ "$FEATURE_FLAG" = "true" ]; then
  echo "Maintenance mode active, skipping deploy"
  exit 0
fi
```

### Auto-detect format for CI vs terminal

```bash
# In CI (stdout is not a TTY), format defaults to json automatically
# No need to specify --format json in scripts
skystate projects list | jq '.[].name'
```

---

## 10. Error Handling

All error messages are written to stderr. Exit codes are consistent and documented.

### 402 Limit Exceeded (exit 78)

Occurs when a resource limit is reached (project limit, environment limit, storage limit).

**Stderr format:**
```
Error: Storage limit reached. Upgrade your plan to continue.
Current: 9.8 MB / 10 MB (98%)
Run: skystate billing upgrade pro
```

Resources that trigger 402:
- Creating a project beyond tier limit (`code: LIMIT_PROJECTS`)
- Creating an environment beyond tier limit (`code: LIMIT_ENVIRONMENTS`)
- Pushing state that would exceed storage limit (`code: LIMIT_STORAGE`)
- Rolling back state that would exceed storage limit

**Note:** Existing data is never deleted. Only new resource creation is blocked.

### 429 Rate Limited (exit 79)

Occurs when the monthly API request count exceeds 110% of the tier limit. Only affects the
public state read endpoint (`skystate state fetch`).

**Stderr format:**
```
Error: Monthly API request limit exceeded.
Current: 225 / 200 (112%)
Resets: Mar 1, 2026 00:00 UTC (in 8 days)
Upgrade for higher limits: skystate billing upgrade hobby
```

**Retry-After** header is shown with `--verbose`.

### Network Errors (exit 1)

```
Error: Network error -- check your connection and try again.
```

### Authentication Errors (exit 2)

```
Error: Not authenticated. Run: skystate auth login
```

Or for expired tokens:
```
Error: Session expired. Run: skystate auth login
```

### Validation Errors (exit 1)

```
Error: Invalid JSON in state/config.json: unexpected token at line 12
Error: Slug must be lowercase alphanumeric with hyphens (e.g. "my-project")
```

### Storage Warning Header

When pushing state and you are approaching the storage limit (>= 80% used), a warning is
printed to stderr (does not affect exit code):
```
Warning: Storage at 85% (8.5 MB / 10 MB). Consider upgrading.
```

This mirrors the `X-SkyState-Storage-Warning` response header from the API.

---

## Appendix: Command Reference Summary

```
skystate auth login [--no-browser]
skystate auth logout
skystate auth status

skystate projects list
skystate projects create <name> [--slug] [--no-default-envs]
skystate projects get <slug>
skystate projects update <slug> --name <name>
skystate projects delete <slug> [--force]
skystate projects select <slug>

skystate envs list [--project]
skystate envs create <name> [--slug] [--color] [--project]
skystate envs update <slug> [--name] [--color] [--project]
skystate envs delete <slug> [--force] [--project]
skystate envs select <slug> [--project]

skystate state get [--version] [--project] [--env]
skystate state history [--limit] [--project] [--env]
skystate state push <file|-> [--bump] [--comment] [--project] [--env]
skystate state edit [--bump] [--comment] [--project] [--env]
skystate state diff [--env-compare] [--version] [--against] [--project] [--env]
skystate state promote <target-env> [--bump] [--comment] [--project] [--env]
skystate state rollback <version> [--confirm] [--project] [--env]
skystate state fetch <project-slug> <env-slug> [--api-url]

skystate usage [--resource]
skystate billing status
skystate billing plans
skystate billing upgrade <tier> [--no-browser]
skystate billing boost [--quantity] [--no-browser]
skystate billing portal [--no-browser]
skystate billing invoices

skystate config set <key> <value>
skystate config get <key>
skystate config list
skystate config path
```

---

*This is a behavioral specification. It does not prescribe implementation language, framework,
or library choices. Any CLI tool that implements these commands with the described inputs,
outputs, and exit codes satisfies this specification.*
