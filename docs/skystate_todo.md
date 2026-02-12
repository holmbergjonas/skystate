# 2 do
# v1  Project state / config
I need to define terminology now. What will v3 look like. 
I dont like config in v1...
maybe overanalyzing

Always send state version as metadata/key/header?
Kanske tidigt ska bryta isär specen i api / cli / dashboard? 

Test first local component. I can use it myself? For something like maintenance banner?
But here is no prod environment. Should i create it first? Skip staging?
Use staging as if it is prod? Can just change urls later?

The rest of the components. zustand, vue, svelte, python, dotnet
Use the cli

Push settings to clients

## The One Thing That Does Affect V1
The only piece of our discussion that impacts your V1 implementation is the "Active Tab Cache Trap" I mentioned in my first response.

Since your V1 React SDK relies on the browser's Cache-Control and the visibilitychange event to know when to fetch fresh config data, you will miss updates for users who leave your app open on a second monitor for hours without ever switching away from the tab (meaning visibilitychange never fires).

To fix this in V1: You just need to add a lightweight, passive interval (e.g., setInterval checking every few seconds if the time since the last fetch has exceeded your tier's TTL) to complement the visibility event.

# v2: User state (read/write)
Auth-front
Read/write endpoint
Components. react, cli (same as react?), vue, svelte, dotnet?

# v2.1 Scale, trace
Migrations instead of update installation.sql
ELK-stack?
We need to be able to delete our way down to free tier again

# v2.1 More tiers
Free  - 30 unique end-user logins per month
Hobby - 100 End-user logins per month 
Pro   - 5000 end-user logins
      - Webhooks (for?) State changes?
End-user states? Just a total state count?

# v2.2 CLI Perfection
Polish CLI

# v3: Graceful exit: export + docker

# v4: Session state

# v5: Graceful exit: hosted solution?
Export
"Self"-host
Since you treat the state as a single JSON object, you can have a single button: "Generate Local Fallback." This doesn't just give them the JSON; it gives them a config.default.ts file they can drop into their React app immediately.
Maybe export docker-compose + compiled dotnet api + data as postgres import
- Add github actions to deploy everything to x, y and z

'appstate pull' instead of copy paste, for default state stored in root? Do i need a default state? Defined in code?

# v6: Stability
End-to-end
Chaos monkey
CDN cache
General optmizations
Statistics monitoring?

# v7: Form (unimportant, focus on devs for now)
Form for props
Multiple users and permissions for a project

# v8: Live/Game/Play
Push changes?

# Other
Store calculated usage on user table. Update in nightly run? Maybe just size, other variables are easy to calculate on the fly.

Support
Custom domain? Not needed?
DashboarD: Orange border around tier limit exceeded / reached? But only for requests and storage? Makes less sense for project and environment?

Maybe track usages (storage and request) per project instead of globally. Nice to show on the "Usage" page

Pro includes backups?

