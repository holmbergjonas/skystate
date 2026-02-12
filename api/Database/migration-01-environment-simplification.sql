-- Phase 1 DB Migration: Environment Simplification
-- Run BEFORE deploying new code

-- Step 1: Add new columns to project_state
ALTER TABLE project_state
  ADD COLUMN project_id UUID,
  ADD COLUMN environment TEXT;

-- Step 2: Backfill from environment table
UPDATE project_state ps
SET project_id = e.project_id,
    environment = e.slug
FROM environment e
WHERE ps.environment_id = e.environment_id;

-- Step 3: Make new columns NOT NULL after backfill
ALTER TABLE project_state
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN environment SET NOT NULL;

-- Step 4: Add FK and CHECK constraints
ALTER TABLE project_state
  ADD CONSTRAINT fk_project_state_project
    FOREIGN KEY (project_id) REFERENCES project (project_id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_project_state_environment
    CHECK (environment IN ('development', 'staging', 'production'));

-- Step 5: Replace unique constraint (was on environment_id + version)
ALTER TABLE project_state
  DROP CONSTRAINT IF EXISTS project_state_environment_id_major_minor_patch_key;
ALTER TABLE project_state
  ADD CONSTRAINT project_state_project_env_version_key
    UNIQUE (project_id, environment, major, minor, patch);

-- Step 6: Add index for common query pattern
CREATE INDEX IF NOT EXISTS idx_project_state_project_env
  ON project_state (project_id, environment);

-- Step 7: Drop old FK column
ALTER TABLE project_state
  DROP COLUMN environment_id;

-- Step 8: Drop environment table
DROP TABLE IF EXISTS environment;
