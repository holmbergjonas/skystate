# Login
1. Client initiates login                                                                        
   Client → GET http://localhost:5149/auth/github-login
   ← 302 Redirect to github.com/login/oauth/authorize?client_id=...&scope=user:email

2. User authenticates on GitHub              
   User → Logs in on github.com, clicks "Authorize"
   GitHub → 302 Redirect back to /signin-github?code=XXXXX

3. Server-side token exchange (invisible to client)
   Server → POST github.com/login/oauth/access_token  (exchanges code for GitHub token)
   Server → GET  api.github.com/user                   (fetches user profile)
   Server → Upserts user in database (JIT provisioning)
   Server → Generates a SkyState JWT (30-min, HS256, contains userId + github_id)
   Server → Drops the temporary cookie

4. Client receives JWT
   GET /auth/github-callback
   ← 200 { "token": "eyJhbG...", "expiresIn": 1800 }

5. Client uses JWT for all subsequent API calls
   GET /projects
   Authorization: Bearer eyJhbG...
   ← 200 [{ project data scoped to this user }]

6. After 30 minutes — token expires, no refresh
   GET /projects
   Authorization: Bearer eyJhbG...  (expired)
   ← 401 Unauthorized
   Client must redo the entire GitHub OAuth flow from step 1

