-- =============================================================================
-- SkyState Database Migrations
-- =============================================================================
-- This file contains idempotent ALTER statements for schema changes that have
-- been merged into installation.sql but have not yet been applied to all
-- existing environments.
--
-- Lifecycle:
--   1. Add migrations here as ALTER TABLE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
--   2. Run after installation.sql on every deploy (both files, in order)
--   3. Once all target environments are current, the migration can be removed
--      from this file (the change is already in installation.sql for fresh installs)
--
-- Run order: installation.sql first, then this file.
-- Both files are idempotent — safe to run multiple times.
-- =============================================================================

-- Migration 2026-03-04: Add last_stripe_error column to user table
-- Captured in installation.sql at commit 6c9636a but not yet deployed to staging.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_stripe_error TEXT;
