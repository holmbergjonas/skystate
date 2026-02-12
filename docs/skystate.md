# Names
Domain: skystate.io
GitHub: skystate
npm: skystate
docker; skystate
X: skystateio
blsky: skystate.io

# Secrets
dotnet user-secrets set "GitHub:ClientId" "Iv23liisSia9ZdNGzzmJ"
dotnet user-secrets set "GitHub:ClientSecret" "ba496ed751b73dbd95ef51816437ae394ed65d94"

## Konkurrens
Firebase hooks är väldigt likt
- Prenumererar på data i database, något som ändras så omrendering
PocketBase
Convex
SupaBase
Hasura, automatiskt graphQL schema
Supabase

# Props 
Readonly
Base state
Feature toggles
Banners / welcome messages

# Store
Read / write and auth
Small games?
Can move from one console/platform to another, comp to phone in the same session.
Power dashboard
Infinite memory / Transparent state / Persistent heap

## Core Value
Developers get durable, versioned state for their services without leaving the editor — no hosting, no migrations, no pipelines.

# Use-cases
"Remote Configuration and Feature Flag" engine on steroids.

By making it Read-Only for end-users and Write-Only for the admin (the developer), you are solving a very specific, high-value problem: Dynamic App Behavior.


# The Market Use Cases
Developers are currently using high-end, expensive tools like LaunchDarkly, Statsig, or even Firebase Remote Config to do exactly this. A simpler, "AppState" version would be a hit for:

Live Game Config: Changing drop rates, event timers, or difficulty levels without a redeploy.

SaaS "Kill Switches": Instantly disabling a feature that is causing bugs.

Dynamic UI: Updating marketing banners, announcement bars, or pricing tiers in real-time.

CMS-Lite: Using it as a tiny Headless CMS for parts of the app that change frequently but don't need a full WordPress/Contentful setup.


# Why "Read-Only" is actually a Feature
In your marketing, don't frame it as a "limitation." Frame it as Security and Control.

"The Secure State: Update your app's behavior from your dashboard or CLI. Your users consume the state, but only you control the truth."

The Value Proposition
Zero Security Risk: You don't have to worry about malicious users "writing" to your database because the API keys for the client are read-only by design.

Performance: Read-only state is incredibly easy to cache at the Edge (CDN). You could make AppState blazing fast by pushing the state to a global network.

No Logic Needed: The developer doesn't have to write "Rules" or "Permissions." If it’s in the state, the app shows it.

How it would look for the Developer
Since it's read-only for the end-user, you'd provide two types of keys:

The Secret Key (Admin): Used in your backend or a CLI to state.set().

The Public Key (Client): Used in the frontend to state.get() or state.subscribe().

The "Dead Simple" Workflow
Dev runs: appstate set --key="holiday_mode" --value="true"

All Users' apps instantly flip to the holiday theme without a single page refresh.


# Pitches / use-cases
Simple to use with different frontend libraries.
Can start without end customers having logins. Only developers.

"SkyState: Backend infrastructure, without the infrastructure." or "One state object. Globally synced. Dead simple."

"App control panel"

Scheduled changes. At midnight...

Instead of simple true/false like feature toggles i can provide rick objects. "Down for maintenance until xxx"

Cache at edge-API instead of fetching from database. Can use api-key as filename?

Can store default values aswell?
Instead of hardcoding constants we can fetch from skystate.
DEFAULT_PAGE_SIZE
MAX_PAGE_SIZE
MAX_UPLOAD_MB
ALLOWED_EXTENSIONS
"Single-Page Setup": Everything (API keys, State Viewer, Usage) should be accessible without deep nesting.

Tweak animation speed, logos, colors. Brand refresh, breast cancer awareness
PR Can work with skystate instead of developers.
Product managers can work with it. Dont need to push minor quick fixes for changes. Examples...

News items?

Circuit breakers

All Users' apps instantly flip to the holiday theme without a single page refresh.
