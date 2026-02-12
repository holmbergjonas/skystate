/**
 * Shared utilities for CLI E2E tests.
 *
 * These tests exercise the CLI's http-client against a real API + PostgreSQL,
 * using test auth headers (SKYSTATE_TEST_AUTH_GITHUB_ID) to authenticate
 * via the API's TestAuthHandler without needing real OAuth credentials.
 */

import { createHttpClient, type HttpClient } from '../../src/lib/http-client.js';

// Default API URL for local docker-compose stack
const DEFAULT_API_URL = 'http://skystate_proxy:80/api';

/** Generate an 8-char random ID for unique resource naming. */
export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

// ---------------------------------------------------------------------------
// API response types matching the C# models
// ---------------------------------------------------------------------------

export interface CreateProjectResponse {
  projectId: string;
}

export interface CreateEnvironmentResponse {
  environmentId: string;
  initialStateId: string;
}

export interface CreateStateResponse {
  projectStateId: string;
}

export interface ProjectResponse {
  projectId: string;
  name: string;
  slug: string;
  apiKeyHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentResponse {
  environmentId: string;
  projectId: string;
  name: string;
  slug: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStateResponse {
  projectStateId: string;
  environmentId: string;
  major: number;
  minor: number;
  patch: number;
  state: string;
  comment: string | null;
  createdAt: string;
  stateSizeBytes: number;
}

export interface PublicStateResponse {
  version: string;
  lastModified: string;
  state: unknown;
}

export interface UserResponse {
  userId: string;
  email: string | null;
  displayName: string | null;
  ssoProvider: string;
  subscriptionTier: string;
  boostMultiplier: number;
}

export interface BillingStatusResponse {
  tier: string;
  boostMultiplier: number;
  projects: { count: number; limit: number | null };
  environments: { count: number; limit: number | null };
  storage: { bytes: number; limit: number | null };
  apiRequests: { count: number; limit: number | null; resetDate: string };
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/**
 * Create an authenticated HTTP client for E2E tests.
 * Sets SKYSTATE_TEST_AUTH_GITHUB_ID env var so the CLI http-client
 * sends test auth headers (X-Test-GitHub-Id, etc.).
 */
export function createTestClient(testId: string): HttpClient {
  const apiUrl = process.env.SKYSTATE_API_URL ?? DEFAULT_API_URL;

  // Set test auth env vars -- the http-client reads these in its request() function
  process.env.SKYSTATE_TEST_AUTH_GITHUB_ID = `cli-e2e-${testId}`;
  process.env.SKYSTATE_TEST_AUTH_EMAIL = `cli-e2e-${testId}@test.com`;
  process.env.SKYSTATE_TEST_AUTH_NAME = 'CLI E2E Test User';

  return createHttpClient({
    apiUrl,
    verbose: false,
    version: '0.0.0-e2e',
  });
}

/**
 * Create an unauthenticated HTTP client for testing public endpoints.
 * Uses auth: false on individual requests to skip auth headers.
 */
export function createPublicClient(): HttpClient {
  const apiUrl = process.env.SKYSTATE_API_URL ?? DEFAULT_API_URL;

  return createHttpClient({
    apiUrl,
    verbose: false,
    version: '0.0.0-e2e',
  });
}

