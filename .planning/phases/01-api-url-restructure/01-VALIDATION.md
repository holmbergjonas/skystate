---
phase: 1
slug: api-url-restructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | xUnit (C# API), Vitest (CLI/Protocol) |
| **Config file** | `api/SkyState.Api.UnitTests/SkyState.Api.UnitTests.csproj`, `cli/vitest.config.ts`, `packages/protocol/vitest.config.ts` |
| **Quick run command** | `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/` |
| **Full suite command** | `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/ && cd ../cli && npm run typecheck && npm run build && cd ../packages/protocol && npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/`
- **After every plan wave:** Run `cd api && dotnet test SkyState.Api.UnitTests/ && dotnet test SkyState.Api.IntegrationTests/ && cd ../cli && npm run typecheck && npm run build && cd ../packages/protocol && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | API-01 | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectStateEndpointTests.GetPublicState"` | ✅ (needs URL update) | ⬜ pending |
| 01-01-02 | 01 | 1 | API-01 | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectStateEndpointTests.GetPublicState_ValidSlugs"` | ✅ (needs URL update) | ⬜ pending |
| 01-01-03 | 01 | 1 | API-01 | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "PublicStateMeteringTests"` | ✅ (needs URL update) | ⬜ pending |
| 01-01-04 | 01 | 1 | API-03 | integration | `cd api && dotnet test SkyState.Api.IntegrationTests/ --filter "ProjectStateEndpointTests"` | ✅ (needs URL update) | ⬜ pending |
| 01-01-05 | 01 | 1 | API-03 | e2e | `cd api && dotnet test SkyState.Api.EndToEndTests/ --filter "ProjectStateEndpointTests"` | ✅ (needs URL update, requires PostgreSQL) | ⬜ pending |
| 01-01-06 | 01 | 1 | API-03 | e2e | `cd api && dotnet test SkyState.Api.EndToEndTests/ --filter "CrudLifecycleTests"` | ✅ (needs URL update, requires PostgreSQL) | ⬜ pending |
| 01-02-01 | 02 | 1 | CLI-01 | build | `cd cli && npm run typecheck && npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. Tests need URL and type name updates but no new test files or framework changes are needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
