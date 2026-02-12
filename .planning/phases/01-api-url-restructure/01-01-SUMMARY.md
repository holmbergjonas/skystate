---
phase: 01-api-url-restructure
plan: 01
subsystem: api, database
tags: [dapper, postgresql, csharp, environment-simplification, rename, migration]

# Dependency graph
requires: []
provides:
  - ProjectConfig model with ProjectId and Environment string fields
  - IProjectConfigRepository interface and Dapper implementation (all SQL rewritten)
  - IProjectConfigService interface and implementation with environment validation
  - MeterResult.Ok with Tier for downstream Cache-Control
  - DB migration script for environment simplification
  - Updated installation.sql without environment table
affects: [01-02, 01-03, phase-02, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Environment as fixed string enum (development/staging/production) validated in service layer"
    - "Direct project_id FK in project_state table replacing environment table JOIN"
    - "DISTINCT ON (project_id, environment) for per-env latest version queries"

key-files:
  created:
    - api/SkyState.Api/Models/ProjectConfig.cs
    - api/SkyState.Api/Repositories/ProjectConfigRepository.cs
    - api/SkyState.Api/Services/ProjectConfigService.cs
    - api/Database/migration-01-environment-simplification.sql
  modified:
    - api/SkyState.Api/Models/MeterResult.cs
    - api/SkyState.Api/Models/SlugLookupResult.cs
    - api/SkyState.Api/Services/BillingService.cs
    - api/SkyState.Api/Services/MeteringService.cs
    - api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs
    - api/SkyState.Api/Repositories/RepositoryCollectionExtensions.cs
    - api/SkyState.Api/Services/ServiceCollectionExtensions.cs
    - api/Database/installation.sql

key-decisions:
  - "ProjectStateId property name kept as-is in ProjectConfig model to match Dapper MatchNamesWithUnderscores mapping from DB column project_state_id"
  - "BillingService environment count computed from project count * tier environments (not queried) since environments are fixed per tier"
  - "CheckEnvironmentLimitAsync trivially passes since environments are no longer user-managed resources"
  - "SlugLookupResult.Success updated to reference ProjectConfig instead of ProjectState"

patterns-established:
  - "Environment validation via HashSet in service layer before any repository call"
  - "ProjectConfig model uses ProjectStateId (not ProjectConfigId) to match DB column mapping"

requirements-completed: [API-01, API-03]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 01 Plan 01: Data Layer Rename & Environment Simplification Summary

**ProjectConfig model/repository/service replacing ProjectState with environment simplified from DB table to fixed string enum, all SQL queries rewritten to use direct project_id FK**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T07:37:00Z
- **Completed:** 2026-03-05T07:41:07Z
- **Tasks:** 2
- **Files modified:** 18 (7 created, 5 modified, 6 deleted)

## Accomplishments
- Created ProjectConfig model with ProjectId (direct FK) and Environment (string enum) fields, replacing EnvironmentId GUID
- Rewrote all 10 SQL queries in ProjectConfigRepository to use direct `project_id` JOIN and `ps.environment` filter (no more environment table JOINs)
- Created ProjectConfigService with environment validation (development/staging/production only)
- Extended MeterResult.Ok with Tier parameter for downstream Cache-Control headers
- Created complete DB migration script for existing databases
- Updated installation.sql schema (environment table removed, project_state has project_id + environment columns)
- Updated BillingService to remove IEnvironmentRepository dependency and use IProjectConfigRepository
- Updated MeteringService to pass user tier in MeterResult.Ok
- Updated RetentionPrunerService to resolve IProjectConfigRepository
- Deleted 6 obsolete files (ProjectState.cs, ProjectStateRepository.cs, ProjectStateService.cs, Environment.cs, EnvironmentRepository.cs, EnvironmentService.cs)
- Updated DI registrations in both Repository and Service collection extensions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ProjectConfig model, repository, service with environment-simplified SQL** - `6dcb56b` (feat)
2. **Task 2: Update BillingService, RetentionPruner, MeteringService, remove Environment layer, update DI** - `22b1836` (feat)

## Files Created/Modified
- `api/SkyState.Api/Models/ProjectConfig.cs` - New model with ProjectId and Environment string (replaces ProjectState)
- `api/SkyState.Api/Repositories/ProjectConfigRepository.cs` - New repository with all SQL rewritten for direct project_id FK
- `api/SkyState.Api/Services/ProjectConfigService.cs` - New service with environment validation
- `api/Database/migration-01-environment-simplification.sql` - 8-step migration: add columns, backfill, constraints, drop environment table
- `api/Database/installation.sql` - Updated schema without environment table
- `api/SkyState.Api/Models/MeterResult.cs` - Ok record extended with Tier parameter
- `api/SkyState.Api/Models/SlugLookupResult.cs` - Success record updated to reference ProjectConfig
- `api/SkyState.Api/Services/BillingService.cs` - Removed IEnvironmentRepository, uses IProjectConfigRepository
- `api/SkyState.Api/Services/MeteringService.cs` - Passes user tier in MeterResult.Ok
- `api/SkyState.Api/BackgroundServices/RetentionPrunerService.cs` - Resolves IProjectConfigRepository
- `api/SkyState.Api/Repositories/RepositoryCollectionExtensions.cs` - IProjectConfigRepository, removed IEnvironmentRepository
- `api/SkyState.Api/Services/ServiceCollectionExtensions.cs` - IProjectConfigService, removed IEnvironmentService

**Deleted files:**
- `api/SkyState.Api/Models/ProjectState.cs`
- `api/SkyState.Api/Models/Environment.cs`
- `api/SkyState.Api/Repositories/ProjectStateRepository.cs`
- `api/SkyState.Api/Repositories/EnvironmentRepository.cs`
- `api/SkyState.Api/Services/ProjectStateService.cs`
- `api/SkyState.Api/Services/EnvironmentService.cs`

## Decisions Made
- ProjectStateId property name kept as-is in ProjectConfig model to preserve Dapper's `MatchNamesWithUnderscores` mapping from the `project_state_id` DB column. Renaming would cause silent null GUID mapping.
- BillingService environment count derived from `projectCount * environmentsPerTier` rather than querying the DB, since environments are now fixed per tier.
- CheckEnvironmentLimitAsync made trivially passing (always returns Success) since environments are no longer user-managed resources that can exceed limits.
- SlugLookupResult.Success updated to use ProjectConfig in Task 1 to avoid circular dependency issues.
- Migration script includes `ON DELETE CASCADE` on the new project_id FK to match the original environment table behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated SlugLookupResult to reference ProjectConfig**
- **Found during:** Task 1 (ProjectConfigService creation)
- **Issue:** SlugLookupResult.Success referenced ProjectState, but ProjectConfigService.GetLatestBySlugAsync needed to return ProjectConfig
- **Fix:** Changed `Success(ProjectState State, ...)` to `Success(ProjectConfig Config, ...)` in SlugLookupResult.cs
- **Files modified:** api/SkyState.Api/Models/SlugLookupResult.cs
- **Verification:** ProjectConfigService compiles correctly with the updated type
- **Committed in:** 6dcb56b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for type consistency between new ProjectConfigService and SlugLookupResult. No scope creep.

## Issues Encountered
- Build errors after Task 2 are all confined to Endpoints/ files (15 errors in ProjectStateEndpoints.cs, PublicStateEndpoints.cs, EnvironmentEndpoints.cs) as expected. These are addressed in Plan 02.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data layer (model + repository + service) fully renamed and restructured
- All SQL queries rewritten for simplified environment schema
- BillingService, MeteringService, and RetentionPrunerService updated
- Ready for Plan 02 (endpoint rename/restructure) which will resolve remaining compile errors in Endpoints/ files
- Ready for Plan 03 (test updates) which will update test projects

## Self-Check: PASSED

All created files verified present. All commits verified in git log. All deleted files confirmed removed.

---
*Phase: 01-api-url-restructure*
*Completed: 2026-03-05*
