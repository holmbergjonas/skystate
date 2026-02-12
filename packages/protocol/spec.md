# SkyState Client Protocol Specification

Version: 1.0.0

## Overview

SkyState is a cloud state management service. Clients connect over HTTPS to read and write versioned JSON state scoped to projects and environments. This document defines the wire protocol that every client implementation must conform to.

## Base URL

All endpoints are relative to the SkyState API base URL (e.g. `https://api.skystate.io`).

## Transport

- HTTPS only
- JSON request/response bodies (`Content-Type: application/json`)
- UTF-8 encoding

---

## 1. Authentication

### 1.1 Auth Model

SkyState uses GitHub OAuth for user authentication. The OAuth flow is browser-based and produces a session managed by the server. Clients operating outside a browser context (game engines, CLI tools) should use the **API key** model described below.

### 1.2 Authenticated Requests

All authenticated endpoints require a GitHub token in the `Authorization` header:

```
Authorization: Bearer <github_token>
```

The server validates this token against the GitHub API and caches the result for up to 5 minutes.

### 1.3 Public Read (No Auth)

The public state endpoint requires no authentication. Any client can read the latest state for a project/environment using its slugs.

### 1.4 Error Response (401)

```json
{
  "error": "unauthorized",
  "message": "Invalid or expired token"
}
```

---

## 2. Data Model

### 2.1 Project

| Field       | Type   | Description                    |
|-------------|--------|--------------------------------|
| projectId   | UUID   | Unique identifier              |
| name        | string | Display name                   |
| slug        | string | URL-safe identifier (per user) |
| apiKeyHash  | string | Hashed API key                 |
| createdAt   | ISO8601| Creation timestamp             |
| updatedAt   | ISO8601| Last update timestamp          |

### 2.2 Environment

| Field         | Type   | Description                         |
|---------------|--------|-------------------------------------|
| environmentId | UUID   | Unique identifier                   |
| projectId     | UUID   | Parent project                      |
| name          | string | Display name                        |
| slug          | string | URL-safe identifier (per project)   |
| color         | string | Hex color code (e.g. `#6b7280`)     |
| createdAt     | ISO8601| Creation timestamp                  |
| updatedAt     | ISO8601| Last update timestamp               |

### 2.3 State Version

| Field          | Type    | Description                             |
|----------------|---------|-----------------------------------------|
| projectStateId | UUID    | Unique identifier for this version      |
| environmentId  | UUID    | Parent environment                      |
| major          | integer | Semantic version major                  |
| minor          | integer | Semantic version minor                  |
| patch          | integer | Semantic version patch                  |
| state          | string  | JSON-serialized state payload           |
| comment        | string? | Optional version comment                |
| stateSizeBytes | integer | Size of state payload in bytes          |
| createdAt      | ISO8601 | Creation timestamp                      |

### 2.4 Version Ordering

Versions are ordered by `(major DESC, minor DESC, patch DESC)`. The "latest" version is the one with the highest semantic version tuple.

---

## 3. Endpoints

### 3.1 Public State Read

Read the latest state for a project/environment without authentication.

```
GET /state/{projectSlug}/{environmentSlug}
```

**Auth:** None

**Slug format:** Lowercase alphanumeric and hyphens only (`^[a-z0-9-]+$`).

**Response (200):**
```json
{
  "version": { "major": 1, "minor": 2, "patch": 3 },
  "lastModified": "2025-01-15T10:30:00.0000000Z",
  "state": { }
}
```

The `version` field is a Version object (see §2.3). The `state` field contains the parsed JSON object (not a string).

**Caching headers:**
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- `ETag: "<version>"`
- `Last-Modified: <RFC7231 date>`

Clients SHOULD respect these caching headers and use conditional requests (`If-None-Match`, `If-Modified-Since`) where supported.

**Errors:**
| Status | Error Code           | Cause                     |
|--------|----------------------|---------------------------|
| 400    | invalid_slug_format  | Slug contains bad chars   |
| 404    | not_found            | Slug combination unknown  |

---

### 3.2 Projects

#### List Projects

```
GET /projects
```

**Auth:** Required

**Response (200):**
```json
[
  {
    "projectId": "uuid",
    "name": "My Game",
    "slug": "my-game",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
]
```

#### Get Project by ID

```
GET /projects/{projectId}
```

#### Get Project by Slug

```
GET /projects/by-slug/{slug}
```

#### Create Project

```
POST /projects
```

**Request:**
```json
{
  "name": "My Game",
  "slug": "my-game",
  "apiKeyHash": "sha256hash"
}
```

**Response (201):**
```json
{
  "projectId": "uuid"
}
```

#### Update Project

```
PUT /projects/{projectId}
```

**Request:**
```json
{
  "name": "New Name",
  "apiKeyHash": "newsha256hash"
}
```

**Response:** 204 No Content

#### Delete Project

```
DELETE /projects/{projectId}
```

**Response:** 204 No Content (cascades to environments and state versions)

---

### 3.3 Environments

#### List Environments

```
GET /projects/{projectId}/environments
```

**Auth:** Required

**Response (200):**
```json
[
  {
    "environmentId": "uuid",
    "projectId": "uuid",
    "name": "Production",
    "slug": "production",
    "color": "#6b7280",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
]
```

#### Get Environment

```
GET /projects/{projectId}/environments/{environmentId}
```

#### Create Environment

```
POST /projects/{projectId}/environments
```

**Request:**
```json
{
  "name": "Staging",
  "slug": "staging",
  "color": "#6b7280"
}
```

**Response (201):**
```json
{
  "environmentId": "uuid",
  "initialStateId": "uuid"
}
```

Creating an environment automatically creates an initial state version `0.0.0`.

#### Update Environment

```
PUT /projects/{projectId}/environments/{environmentId}
```

**Request:**
```json
{
  "name": "New Name",
  "color": "#ef4444"
}
```

**Response:** 204 No Content

#### Delete Environment

```
DELETE /projects/{projectId}/environments/{environmentId}
```

**Response:** 204 No Content (cascades to state versions)

---

### 3.4 State Versions

All state version endpoints are scoped under a project state context.

#### Get State by ID

```
GET /projectstates/{projectStateId}
```

**Auth:** Required

#### List All Versions for Environment

```
GET /projectstates/{projectId}/environment/{environmentId}
```

**Auth:** Required

**Response (200):** Array of state version objects, ordered by version descending.

#### Get Latest Version

```
GET /projectstates/{projectId}/environment/{environmentId}/latest
```

**Auth:** Required

#### Create State Version

```
POST /projectstates/{projectId}/environment/{environmentId}
```

**Auth:** Required

**Request:**
```json
{
  "major": 1,
  "minor": 2,
  "patch": 3,
  "state": "{\"key\": \"value\"}",
  "comment": "Added new field"
}
```

The `state` field MUST be a JSON-serialized string.

**Response (201):**
```json
{
  "projectStateId": "uuid"
}
```

**Optimistic concurrency:** The server rejects the request if a version with equal or higher `(major, minor, patch)` already exists. Clients should read the latest version, increment appropriately, then write.

**Errors:**
| Status | Error Code    | Cause                           |
|--------|---------------|---------------------------------|
| 403    | over_limit    | Billing tier limit exceeded     |
| 404    | not_found     | Project or environment unknown  |

#### Rollback to Version

```
POST /projectstates/{projectId}/environment/{environmentId}/rollback/{targetProjectStateId}
```

**Auth:** Required

**Request:**
```json
{
  "major": 1,
  "minor": 2,
  "patch": 4,
  "state": "{\"key\": \"value\"}",
  "comment": "Rollback to version 1.2.3"
}
```

The server copies the target version's state into a new version. Version number auto-increments based on the difference from the target:
- Different major → increment major, reset minor and patch to 0
- Different minor → increment minor, reset patch to 0
- Same major and minor → increment patch

**Response (201):**
```json
{
  "projectStateId": "uuid"
}
```

---

### 3.5 Users

#### Get Current User

```
GET /users/me
```

**Auth:** Required

**Response (200):**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "displayName": "User Name",
  "avatarUrl": "https://avatars.githubusercontent.com/..."
}
```

#### Update Current User

```
PUT /users/me
```

**Auth:** Required

**Request:**
```json
{
  "displayName": "New Name",
  "avatarUrl": "https://..."
}
```

**Response:** 204 No Content

---

### 3.6 Billing

#### Get Billing Status

```
GET /billing/status
```

**Auth:** Required

**Response (200):**
```json
{
  "tier": "free",
  "subscriptionStatus": null,
  "currentPeriodEnd": null,
  "usage": {
    "documentCount": 3,
    "storageBytes": 15240
  },
  "limits": {
    "maxDocuments": 10,
    "maxStorageBytes": 1048576
  },
  "isOverLimit": false
}
```

**Tier limits:**
| Tier | Max Documents | Max Storage |
|------|---------------|-------------|
| free | 10            | 1 MB        |
| paid | 100           | 10 MB       |

#### Create Checkout Session

```
POST /billing/checkout
```

**Request:**
```json
{
  "successUrl": "https://app.example.com/billing?success=true",
  "cancelUrl": "https://app.example.com/billing?canceled=true"
}
```

**Response (200):**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

#### Create Customer Portal Session

```
POST /billing/portal
```

**Request:**
```json
{
  "returnUrl": "https://app.example.com/billing"
}
```

**Response (200):**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

---

## 4. Error Format

All errors follow a consistent shape:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

**Standard error codes:**

| Code                | HTTP Status | Meaning                          |
|---------------------|-------------|----------------------------------|
| validation_error    | 400         | Invalid request body or params   |
| invalid_slug_format | 400         | Slug contains invalid characters |
| unauthorized        | 401         | Missing or invalid auth token    |
| over_limit          | 403         | Billing tier limit exceeded      |
| not_found           | 404         | Resource does not exist          |
| checkout_error      | 400         | Stripe checkout failed           |
| portal_error        | 400         | Stripe portal failed             |

---

## 5. Client Implementation Requirements

### 5.1 Minimum Viable Client

A conforming client MUST implement:

1. **Public state read** — `GET /state/{projectSlug}/{environmentSlug}`
2. **Response parsing** — Deserialize the `state` JSON field into a native data structure
3. **Cache respect** — Honor `Cache-Control` and `ETag` headers where the platform supports it
4. **Error handling** — Parse error responses and surface error codes to the caller

### 5.2 Full Client

A full client additionally implements:

1. **Authentication** — Attach `Authorization: Bearer <token>` to requests
2. **Project CRUD** — Create, read, update, delete projects
3. **Environment CRUD** — Create, read, update, delete environments
4. **State versioning** — Create versions with optimistic concurrency, list history, rollback
5. **Billing** — Read billing status, create checkout/portal sessions

### 5.3 Conventions by Platform

Each client should use idiomatic patterns for its platform:

| Platform    | Pattern                        | Example                     |
|-------------|--------------------------------|-----------------------------|
| TypeScript  | Async functions, Promises      | `await client.getState()`   |
| React       | Hooks                          | `useGameState("my-game")`   |
| Vue         | Composables                    | `useGameState("my-game")`   |
| Svelte      | Stores                         | `gameState.subscribe()`     |
| GDScript    | Signals, coroutines            | `state_changed.emit()`      |
| C#          | async/await, events            | `await client.GetStateAsync()` |
| Rust        | Result types, async            | `client.get_state().await?` |
| Python      | async/await or sync            | `client.get_state()`        |

---

## 6. Conformance Testing

Test fixtures in `protocol/tests/fixtures/` define input/output pairs that every client must pass. Each fixture is a JSON file:

```json
{
  "name": "public_read_success",
  "description": "Read latest state via public endpoint",
  "request": {
    "method": "GET",
    "path": "/state/my-game/production"
  },
  "response": {
    "status": 200,
    "body": {
      "version": { "major": 1, "minor": 0, "patch": 0 },
      "lastModified": "2025-01-15T10:30:00.0000000Z",
      "state": { "level": 1, "score": 0 }
    }
  }
}
```

Clients must demonstrate correct serialization, deserialization, header handling, and error parsing for all fixtures.
