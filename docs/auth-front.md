# Auth Gateway Service — Technical Specification

**Version:** 1.2 Draft (Aligned with existing data model)
**Date:** 2026-02-18

---

## 1. Overview

The Auth Gateway is a centralized authentication service that provides branded, secure login experiences for customers (project owners) whose end-users need to authenticate against our API. Each project can configure its own SSO client, enabling per-project branded login pages and identity provider selection.

Firebase Authentication handles identity provider integration, token issuance, refresh, and user storage. The Auth Gateway wraps Firebase with a branded UI layer and project-level configuration. **No custom token minting is required** — the service uses Firebase ID tokens directly.

---

## 2. Goals and Constraints

### Goals
- Minimal integration effort for customers (redirect-based flow)
- Per-project branded login experience (logo, colors, app name)
- Support for Google, Apple, and Microsoft as identity providers
- Secure token-based authentication using Firebase ID tokens
- Free or near-zero cost at low-to-moderate scale (< 50K MAU)
- Align with existing data model (users, projects, environments)

### Constraints
- Single Firebase project owned and operated by us
- No customer-side Firebase SDK dependency — pure redirect-based flow
- No username/password auth (federated IDPs only, for v1)
- Firebase ID tokens used directly (no custom JWT layer)
- 1-to-1 mapping between projects and SSO clients

---

## 3. Architecture

### 3.1 Components

```
┌──────────────────┐     ┌────────────────────┐     ┌──────────────┐
│  Customer's App  │────▶│   Auth Gateway      │────▶│  Firebase    │
│  (browser)       │◀────│                     │◀────│  Auth        │
└──────────────────┘     │  - Login Page UI    │     └──────┬───────┘
                         │  - SSO Client Conf  │            │
                         │  - Session Handler  │     ┌──────▼───────┐
                         └────────────────────┘     │  Google /    │
                                                    │  Apple /     │
                         ┌────────────────────┐     │  Microsoft   │
                         │  Your API          │     └──────────────┘
                         │  (verifies tokens  │
                         │   via Firebase      │
                         │   Admin SDK)        │
                         └────────────────────┘
```

**Auth Gateway** — A web application consisting of:
- **Login Page** — Dynamic, branded HTML/JS page that invokes Firebase Auth SDK
- **SSO Client Config** — Per-project configuration stored in the `sso_client` table
- **Session Handler** — Backend that maps Firebase auth results to project-scoped end-user sessions
- **Admin API** — Endpoints for project owners to configure their SSO client

**Firebase Auth** — Handles all IDP communication, OAuth flows, token issuance, token refresh, and user identity storage.

**Your API** — Validates Firebase ID tokens using the Firebase Admin SDK. Resolves the end-user and project context via the `end_user` and `sso_client` tables.

### 3.2 Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Login Page | Static HTML/JS + Firebase JS SDK | Hosted on CDN or simple web server |
| SSO Client Config | PostgreSQL (`sso_client` table) | Extends existing project model |
| Session Handler | Node.js / Python backend | Maps Firebase result to project callback |
| Hosting | Firebase Hosting, Vercel, or similar | Low cost, CDN-backed |

---

## 4. Data Model

### 4.1 Existing Tables (Unchanged)

The Auth Gateway integrates with the existing data model. The `user` table represents **project owners** (your customers — the developers). The `project` table represents their applications.

### 4.2 New Table

One new table is added: `sso_client` (per-project auth configuration). No end-user data is stored — the Auth Gateway is stateless with respect to end-users. A login counter on `sso_client` tracks usage.

```sql
-- 7. SSO Client Configuration (1-to-1 with project)
create table sso_client
(
    sso_client_id   uuid primary key default uuidv7(),
    project_id      uuid unique  not null references project (project_id) on delete cascade,
    display_name    text         not null,  -- shown on login page
    logo_data       text,                   -- base64-encoded logo image
    logo_media_type text,                   -- e.g., 'image/png', 'image/svg+xml'
    primary_color   text         not null default '#2563EB',
    allowed_idps    text[]       not null default '{"google"}',
    callback_urls   text[]       not null,  -- whitelisted redirect URIs
    enabled         boolean      not null default true,
    login_count     bigint       not null default 0,  -- incremented on each successful login
    created_at      timestamptz       default now(),
    updated_at      timestamptz       default now()
);

create index idx_sso_client_project on sso_client (project_id);
```

### 4.3 Entity Relationships

```
user (project owner)
 └── project
      ├── sso_client  (1-to-1, login page branding & config)
      └── environment
           └── project_state
```

- A **user** (project owner) owns one or more **projects**
- Each **project** has exactly one **sso_client** configuration
- **End-users are not stored** — the Auth Gateway validates tokens statelessly

### 4.4 Identity Strategy

End-user identity is handled entirely by Firebase at runtime. The Auth Gateway does not persist end-user records. The IDP's native identity (provider + user ID) is available in the Firebase ID token for your API to use if needed, but is not stored by the Auth Gateway.

This means:
- **Minimal data storage** — no PII for end-users
- **Migration-safe** — the IDP's native identity (in the token) is not tied to Firebase
- **Consistent** — the `user` table uses the same `sso_provider` + `sso_user_id` pattern for project ownersn UID is not stored — it is an implementation detail of the current auth backend.

### 4.4 Terminology

| Term | Meaning | Table |
|---|---|---|
| User / Project Owner | Your customer — the developer who creates projects | `user` |
| Project | A customer's application that integrates with your API | `project` |
| SSO Client | The login configuration for a project | `sso_client` |
| End-User | A person who authenticates via the Auth Gateway to use a customer's app | `end_user` |

---

## 5. SSO Client Configuration

### 5.1 Setup

When a project owner creates a project, they can configure an SSO client through the admin portal or API.

**`sso_client` fields:**

| Field | Description |
|---|---|
| `project_id` | Links to the project (1-to-1) |
| `display_name` | Shown on the login page (e.g., "ACME Corp") |
| `logo_data` | Base64-encoded logo image (validated and stored at upload time) |
| `logo_media_type` | MIME type of the logo: `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp` |
| `primary_color` | Hex color for login page branding |
| `allowed_idps` | Array of enabled providers: `{"google", "apple", "microsoft"}` |
| `callback_urls` | Whitelisted redirect URIs |
| `enabled` | Toggle to disable auth for a project |

### 5.2 Example Configuration

```json
{
  "project_id": "01956a3b-...",
  "display_name": "ACME Corp",
  "logo_data": "iVBORw0KGgoAAAANSUhEUgAA...",
  "logo_media_type": "image/png",
  "primary_color": "#2563EB",
  "allowed_idps": ["google", "apple"],
  "callback_urls": [
    "https://app.acme.com/auth/callback",
    "http://localhost:3000/auth/callback"
  ],
  "enabled": true
}
```

### 5.3 Identifying Projects in Auth Flows

The Auth Gateway uses the **project slug** (from the `project` table) to identify which SSO client to load. This avoids exposing internal UUIDs in URLs.

```
https://auth.yourservice.com/login?project=acme-corp&redirect_uri=...
```

The backend resolves `acme-corp` → `project.slug` → `project.project_id` → `sso_client`.

---

## 6. Authentication Flow

### 6.1 Flow Overview

```
Step 1:  Customer's app redirects end-user to Auth Gateway /login
Step 2:  Auth Gateway resolves project slug → loads sso_client config
Step 3:  Renders branded login page (logo, colors, IDP buttons)
Step 4:  End-user clicks an IDP button (e.g., "Continue with Google")
Step 5:  Firebase SDK initiates OAuth → redirects to IDP
Step 6:  End-user authenticates at IDP (e.g., Google login screen)
Step 7:  IDP redirects back to Auth Gateway
Step 8:  Firebase SDK receives auth result (Firebase ID token)
Step 9:  Auth Gateway backend verifies the Firebase ID token
Step 10: Backend creates or updates end_user record (sso_provider + sso_user_id + project)
Step 11: Backend generates a short-lived exchange code
Step 12: Redirects end-user to customer's callback_url with code + state
```

### 6.2 What the End-User Sees

```
Customer's site
  → Your branded login page (project's logo and colors)
    → Google/Apple/Microsoft login screen
      → Your login page (brief success state)
        → Back to customer's site (with code)
```

Firebase is never visible to the end-user.

### 6.3 Endpoint Specification

#### `GET /login`

Initiates the login flow.

| Param | Required | Description |
|---|---|---|
| `project` | Yes | Project slug (from `project.slug`) |
| `redirect_uri` | Yes | Must match a registered callback URL in `sso_client` |
| `state` | Recommended | Opaque value for CSRF protection, returned unchanged |

**Example:**
```
GET https://auth.yourservice.com/login
  ?project=acme-corp
  &redirect_uri=https://app.acme.com/auth/callback
  &state=xyz123
```

**Behavior:**
1. Resolves `acme-corp` to a project
2. Loads the project's `sso_client` config
3. Validates that `redirect_uri` is in `sso_client.callback_urls`
4. Validates that `sso_client.enabled` is true
5. Renders the branded login page

#### `POST /exchange`

Exchanges a short-lived code for tokens. Called by the customer's backend.

**Request:**
```json
{
  "code": "TEMP_EXCHANGE_CODE",
  "project": "acme-corp"
}
```

**Response:**
```json
{
  "token": "FIREBASE_ID_TOKEN",
  "refresh_token": "FIREBASE_REFRESH_TOKEN",
  "user": {
    "end_user_id": "01956a3b-...",
    "firebase_uid": "firebase-uid-abc123",
    "email": "user@example.com",
    "display_name": "Jane Doe",
    "idp": "google.com"
  },
  "expires_in": 3600
}
```

#### `POST /refresh`

Refreshes an expired token. Called by the customer's backend.

**Request:**
```json
{
  "refresh_token": "FIREBASE_REFRESH_TOKEN",
  "project": "acme-corp"
}
```

**Response:**
```json
{
  "token": "NEW_FIREBASE_ID_TOKEN",
  "expires_in": 3600
}
```

#### `POST /verify` (Optional Convenience Endpoint)

Verifies a token and returns structured user info.

**Request:**
```json
{
  "token": "FIREBASE_ID_TOKEN",
  "project": "acme-corp"
}
```

**Response:**
```json
{
  "valid": true,
  "user": {
    "end_user_id": "01956a3b-...",
    "firebase_uid": "firebase-uid-abc123",
    "email": "user@example.com",
    "display_name": "Jane Doe",
    "idp": "google.com",
    "project_id": "01956a3b-..."
  },
  "expires_at": "2026-02-18T15:00:00Z"
}
```

---

## 7. Token Details

### 7.1 Firebase ID Token

The service uses Firebase ID tokens directly. These are JWTs signed by Google.

**Key properties:**
- Signed with RS256 by Google
- Verifiable via Google's public keys at `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`
- Expires after **1 hour**
- Contains: `uid`, `email`, `name`, `sign_in_provider`, `iss`, `aud`, `exp`, `iat`

### 7.2 Token Lifetimes

| Token | Lifetime | Notes |
|---|---|---|
| Firebase ID token | 1 hour | Auto-refreshable via `/refresh` |
| Firebase refresh token | ~indefinite | Valid until user is disabled or revoked |
| Exchange code | 60 seconds | Single-use |

---

## 8. API Authentication (Consumer Side)

### 8.1 Making Authenticated Requests

Customers attach the Firebase ID token and project slug to API requests:

```
GET https://api.yourservice.com/some-endpoint
Authorization: Bearer FIREBASE_ID_TOKEN
X-Project: acme-corp
```

### 8.2 API-Side Token Validation

Your API validates requests by:

1. Extracting the token from the `Authorization` header
2. Verifying it using the **Firebase Admin SDK** (`verifyIdToken()`)
3. Extracting the `firebase_uid` from the verified token
4. Resolving the project from the `X-Project` header via `project.slug`
5. Confirming an `end_user` record exists for this `firebase_uid` + `project_id`
6. Optionally: checking the project's `api_key_hash` for additional verification
7. Processing the request with `end_user_id` and `project_id` in context

**Example (Node.js):**
```javascript
const admin = require('firebase-admin');

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const projectSlug = req.headers['x-project'];

  if (!token || !projectSlug) {
    return res.status(401).json({ error: 'Missing credentials' });
  }

  try {
    // 1. Verify Firebase token
    const decoded = await admin.auth().verifyIdToken(token);

    // 2. Resolve project
    const project = await db.query(
      'SELECT project_id FROM project WHERE slug = $1',
      [projectSlug]
    );
    if (!project.rows.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const projectId = project.rows[0].project_id;

    // 3. Verify end-user belongs to project
    const endUser = await db.query(
      `SELECT end_user_id FROM end_user 
       WHERE sso_provider = $1 AND sso_user_id = $2 AND project_id = $3`,
      [decoded.firebase.sign_in_provider, 
       decoded.firebase.identities[decoded.firebase.sign_in_provider]?.[0],
       projectId]
    );
    if (!endUser.rows.length) {
      return res.status(403).json({ error: 'User not registered for this project' });
    }

    req.user = {
      endUserId: endUser.rows[0].end_user_id,
      firebaseUid: decoded.uid,
      email: decoded.email,
      projectId
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

---

## 9. Login Page UI

### 9.1 Behavior

The login page is served at `/login`. It:

1. Reads `project`, `redirect_uri`, and `state` from the query string
2. Resolves the project slug → fetches `sso_client` config
3. Validates that `redirect_uri` matches a registered callback URL
4. Validates that the SSO client is enabled
5. Renders a branded page with:
   - Project logo (`sso_client.logo_data` rendered as inline `data:` URI) and display name (`sso_client.display_name`)
   - Primary color (`sso_client.primary_color`) applied to buttons and accents
   - One button per allowed IDP from `sso_client.allowed_idps`
6. On button click, invokes Firebase Auth SDK (`signInWithPopup` or `signInWithRedirect`)
7. On success, sends the Firebase ID token to the backend
8. Backend creates/updates the `end_user` record, generates an exchange code, and redirects to the customer's `redirect_uri`

### 9.2 Error Handling

| Scenario | Behavior |
|---|---|
| Unknown project slug | Show error page: "Application not found" |
| SSO client disabled | Show error page: "Authentication is not available for this application" |
| Invalid `redirect_uri` | Show error page (never redirect to an unregistered URI) |
| IDP not in `allowed_idps` | Button not rendered |
| User cancels IDP login | Return to login page with option to retry |
| Firebase auth failure | Show user-friendly error with retry option |

---

## 10. Security Considerations

### 10.1 Mandatory

- **HTTPS only** — All endpoints served over TLS
- **Callback URL validation** — Redirect URIs must exactly match a URL in `sso_client.callback_urls`. No wildcard or partial matching
- **State parameter** — Recommended for CSRF protection, returned unchanged in the callback
- **Exchange codes** — Short-lived (60s), single-use codes to avoid token leakage in URLs
- **Rate limiting** — On `/login`, `/exchange`, `/verify`, and `/refresh`
- **X-Project validation** — API must verify the end-user → project mapping, not trust the header alone
- **API key as secondary auth** — Consider requiring the project's API key (from `project.api_key_hash`) alongside the Firebase token for API calls

### 10.2 Recommended

- **Refresh token rotation** — Issue new refresh tokens on each `/refresh` call
- **Logging and monitoring** — Log all auth events for audit
- **CSP headers** — Content Security Policy on the login page to prevent XSS
- **End-user rate limits** — Per-project rate limits on login attempts to prevent abuse

---

## 11. Customer Integration Guide (Summary)

### Step 1: Create an SSO Client
Configure branding and callback URLs via the admin portal or API.

### Step 2: Redirect to Login
```
GET https://auth.yourservice.com/login
  ?project=YOUR_PROJECT_SLUG
  &redirect_uri=YOUR_CALLBACK_URL
  &state=RANDOM_STATE
```

### Step 3: Handle Callback
Your callback URL receives `?code=TEMP_CODE&state=RANDOM_STATE`. Verify the state matches.

### Step 4: Exchange Code for Token
```
POST https://auth.yourservice.com/exchange

{
  "code": "TEMP_CODE",
  "project": "YOUR_PROJECT_SLUG"
}
```

**Response:**
```json
{
  "token": "FIREBASE_ID_TOKEN",
  "refresh_token": "FIREBASE_REFRESH_TOKEN",
  "user": {
    "end_user_id": "01956a3b-...",
    "email": "user@example.com",
    "display_name": "Jane Doe"
  },
  "expires_in": 3600
}
```

### Step 5: Call the API
```
GET https://api.yourservice.com/endpoint
Authorization: Bearer FIREBASE_ID_TOKEN
X-Project: YOUR_PROJECT_SLUG
```

### Step 6: Refresh When Expired
```
POST https://auth.yourservice.com/refresh

{
  "refresh_token": "FIREBASE_REFRESH_TOKEN",
  "project": "YOUR_PROJECT_SLUG"
}
```

---

## 12. What Firebase Handles vs. What We Build

| Concern | Handled by | Notes |
|---|---|---|
| IDP integration (Google, Apple, MS) | Firebase | OAuth flows, PKCE, token exchange |
| Token issuance | Firebase | Firebase ID tokens (JWT, RS256) |
| Token refresh | Firebase (via Auth Gateway proxy) | 1-hour tokens, indefinite refresh |
| Token verification | Firebase Admin SDK | Used by your API |
| User identity storage | Firebase | UID, email, provider info |
| Branded login page | Auth Gateway | Custom UI per project via `sso_client` |
| Project configuration | Auth Gateway | `sso_client` table |
| End-user ↔ project mapping | Auth Gateway | `end_user` table |
| Exchange code flow | Auth Gateway | Secure token delivery |
| Rate limiting | Auth Gateway | Protect endpoints from abuse |

---

## 13. Future Considerations (Out of Scope for v1)

- Email/password authentication
- Multi-factor authentication (MFA)
- Customer self-service admin portal for SSO client config
- Webhooks for end-user events (signup, login, account deletion)
- Custom claims in Firebase tokens (Firebase supports setting custom claims via Admin SDK — could embed `project_id` and `end_user_id` directly in the token)
- Per-environment SSO clients (e.g., different branding for staging vs. production)
- Consent / scope management
- Account linking (end-user signs in with Google, later also links Apple)
- SAML support for enterprise customers
- End-user management API (list, disable, delete end-users per project)