# Context Primer: SkyState Architecture & Recent Decisions

Project Overview:
We are building SkyState, a headless state synchronization service with a progressive value model. It is designed to enter codebases as a lightweight remote config tool and scale up to real-time multiplayer session sync.

    V1 (Project Level): Read-only remote config (feature flags, banners). Uses HTTP polling and browser Cache-Control (no WebSockets).

    V2 (User Level): Per-user persistent state using JSON Patch (RFC 6902) with custom increment/decrement operations. Introduces WebSockets and Firebase Auth.

    V3 (Session Level): Multi-user real-time state sync with BYOA (Bring Your Own Auth).

Recent Architectural Decisions & Refinements:

1. Data Structures & Concurrency (JSON Patch)

    The Problem: Using standard JSON Patch on Arrays in highly concurrent environments (V3) causes "index-shifting" false conflicts (e.g., User A deletes index 0, causing User B's test operation on index 2 to fail because the item moved to index 1).

    The Solution: We will explicitly document and recommend that developers use ID-keyed dictionaries (objects) instead of arrays for collections (e.g., inventory: { "item_123": {...} }) to safely isolate concurrent mutations.

2. SDK UX: Optimistic vs. Pessimistic Updates

    Default: The V2/V3 SDKs will default to Optimistic Updates (instant local mutation, background sync, automatic rollback on 409 Conflict) for a 0ms latency feel.

    Escape Hatch: The SDK hooks will expose network metadata (isMutating, isSynced) so developers can easily opt into building Pessimistic UIs (disabling buttons and waiting for server confirmation) if an action is destructive or high-stakes.

3. CI/CD & Contract Testing

    Old Approach: Rolling back the git repository 30 days and running E2E tests against the new backend.

    New Approach ("Frozen SDK" Matrix): We will run the E2E test suite against a dynamic matrix of historical Git tags (e.g., v1.0.0, v1.1.0) representing our official "support window" (e.g., the last 6-12 months). Once a version ages out of the window, it drops from the CI matrix, freeing us to delete legacy backend code.

4. API Lifecycle Management & Client Telemetry

    Header Injection: All SDKs and CLIs must attach an X-SkyState-Client: <platform>/<version> header to every HTTP and WebSocket request.

    V1 Scope (Passive): The backend will purely log this header for observability. No blocking logic. This builds the telemetry we need to safely deprecate versions later.

    V2 Scope (Active Enforcement): The backend will read two hardcoded variables from appsettings.json (MinimumClientVersion and DeprecatedClientVersion).

        If client < Minimum: Backend short-circuits with 426 Upgrade Required. The SDK catches this and throws a fatal error, halting all sync/polling.

        If client >= Minimum but < Deprecated: Backend processes normally but attaches a Warning: 299 HTTP header. The SDK catches this and logs a warning to the developer's console.




# Default config 

To make a "default config" work across V1 (Remote Config), V2 (User State), and V3 (Session State), you need to treat the default as the "Base Layer" of a state sandwich.

The "Init Failure" scenario is critical because if the SDK can't hit the API on the first try, the app needs something to render. Here is the technically crisp way to handle this for all three:
🛠️ The Implementation: The InitialState Bundle

Instead of the developer just passing a projectId, they provide a local JSON object (or a path to one) during SDK initialization.
1. V1 (Project/Remote Config)

    Source: CLI pulls from API (skystate pull).

    Behavior: This is the hard fallback. If the network is down or the API returns a 404/500, the SDK returns the values from this local JSON.

    UX: The app works immediately. Feature flags default to whatever was "pulled" last by the dev.

2. V2 (User State)

    Source: Developer-defined "New User Template."

    Behavior: This is the seed data. When a new user logs in (Firebase Auth), the backend checks if they have a state record. If not, it uses this template to create one.

    Client Side: If the SDK fails to fetch the user state on init, it uses this local template so the UI doesn't crash (e.g., inventory: []).

3. V3 (Session State)

    Source: Developer-defined "Room/Lobby Template."

    Behavior: This defines the Starting Conditions of a session. When the first person creates a room, this JSON defines the board state, timer, etc.

    Client Side: While waiting to connect to the WebSocket, the UI can optimistically render based on this template.

🚀 Recommendation: Option 1 (CLI Automation)

I strongly recommend Option 1 (CLI pulls it from API) for the following reasons:

    Single Source of Truth: You edit your config in the SkyState Dashboard/CLI, then run skystate pull. This generates a skystate.config.json in your project.

    Type Safety: The CLI can generate TypeScript Types based on that JSON. So when the dev calls useProjectConfig('hero.hp'), the IDE knows hp is a number.

    No "Manual Drift": If a dev creates the file manually (Option 2), they will inevitably forget to update it when they add new flags in the dashboard, leading to crashes when the "fallback" is missing a key.

How to feed this to Claude:

    "We are going with Option 1. The CLI will provide a pull command to fetch a snapshot of the Project Config (V1) and User/Session Templates (V2/V3) into a local skystate.config.json. The SDK must accept this JSON as an initialState argument. If the initial network request fails, the SDK must merge this local JSON into the state so the app remains functional."