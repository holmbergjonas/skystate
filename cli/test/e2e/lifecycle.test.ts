/**
 * CLI E2E lifecycle tests.
 *
 * Exercises the full project -> environment -> state pipeline against a real
 * API + PostgreSQL, mirroring the C# CrudLifecycleTests. Uses the CLI's
 * http-client with test auth headers (SKYSTATE_TEST_AUTH_GITHUB_ID).
 *
 * Tests skip gracefully when the API is not available.
 */

import { describe, it, expect } from 'vitest';
import {
  createTestClient,
  createPublicClient,
  uid,
  type CreateProjectResponse,
  type CreateEnvironmentResponse,
  type CreateStateResponse,
  type ProjectResponse,
  type EnvironmentResponse,
  type ProjectStateResponse,
  type PublicStateResponse,
  type UserResponse,
  type BillingStatusResponse,
} from './helpers.js';
import { ApiError } from '../../src/lib/errors.js';

describe('CLI E2E: Full lifecycle', () => {
  it('auth status: returns user profile and billing', async () => {
    const id = uid();
    const client = createTestClient(id);

    const { data: user } = await client.get<UserResponse>('/users/me');
    expect(user.email).toBe(`cli-e2e-${id}@test.com`);
    expect(user.displayName).toBe('CLI E2E Test User');
    expect(user.ssoProvider).toBe('github');

    const { data: billing } = await client.get<BillingStatusResponse>('/billing/status');
    expect(billing.tier).toBe('free');
    expect(billing.projects.count).toBe(0);
  });

  it('full CRUD lifecycle: project -> env -> state -> rollback -> public read -> cleanup', async () => {
    const id = uid();
    const projectSlug = `lifecycle-${id}`;
    const envSlug = `lifecycle-env-${id}`;
    const client = createTestClient(id);

    // ── PROJECT CRUD ──────────────────────────────────────────

    // 1. Create project
    const { data: createdProject, status: createProjStatus } =
      await client.post<CreateProjectResponse>('/projects', {
        name: 'Lifecycle Test Project',
        slug: projectSlug,
        apiKeyHash: `hash-lifecycle-${id}`,
      });
    expect(createProjStatus).toBe(201);
    expect(createdProject.projectId).toBeDefined();
    const projectId = createdProject.projectId;

    // 2. Read project by slug
    const { data: projectBySlug } =
      await client.get<ProjectResponse>(`/projects/by-slug/${projectSlug}`);
    expect(projectBySlug.name).toBe('Lifecycle Test Project');
    expect(projectBySlug.slug).toBe(projectSlug);

    // 3. List projects (verify it appears)
    const { data: projects } = await client.get<ProjectResponse[]>('/projects');
    expect(projects.some((p) => p.projectId === projectId)).toBe(true);

    // 4. Update project
    await client.put(`/projects/${projectId}`, {
      name: 'Lifecycle Updated Name',
      apiKeyHash: `hash-lifecycle-updated-${id}`,
    });

    // 5. Verify project update persisted
    const { data: updatedProject } =
      await client.get<ProjectResponse>(`/projects/${projectId}`);
    expect(updatedProject.name).toBe('Lifecycle Updated Name');

    // ── ENVIRONMENT CRUD ──────────────────────────────────────

    // 6. Create environment
    const { data: createdEnv, status: createEnvStatus } =
      await client.post<CreateEnvironmentResponse>(
        `/projects/${projectId}/environments`,
        { name: 'Lifecycle Env', slug: envSlug },
      );
    expect(createEnvStatus).toBe(201);
    expect(createdEnv.environmentId).toBeDefined();
    expect(createdEnv.initialStateId).toBeDefined();
    const environmentId = createdEnv.environmentId;
    const initialStateId = createdEnv.initialStateId;

    // 7. List environments (verify it appears)
    const { data: environments } = await client.get<EnvironmentResponse[]>(
      `/projects/${projectId}/environments`,
    );
    expect(environments.some((e) => e.environmentId === environmentId)).toBe(true);

    // 8. Update environment
    await client.put(`/projects/${projectId}/environments/${environmentId}`, {
      name: 'Lifecycle Env Updated',
      color: '#22c55e',
    });

    // 9. Verify environment update persisted
    const { data: updatedEnv } = await client.get<EnvironmentResponse>(
      `/projects/${projectId}/environments/${environmentId}`,
    );
    expect(updatedEnv.name).toBe('Lifecycle Env Updated');

    // ── STATE VERSION CRUD ────────────────────────────────────

    // 10. List states (should have initial 0.0.0 only)
    const { data: initialStates } = await client.get<ProjectStateResponse[]>(
      `/projectstates/${initialStateId}/environment/${environmentId}`,
    );
    expect(initialStates).toHaveLength(1);
    expect(initialStates[0].major).toBe(0);
    expect(initialStates[0].minor).toBe(0);
    expect(initialStates[0].patch).toBe(0);
    expect(initialStates[0].comment).toBe('Initial state');

    // 11. Push state 1.0.0
    const state100 = { key: 'v1', nested: { a: 1 } };
    const { data: createdState100, status: createState100Status } =
      await client.post<CreateStateResponse>(
        `/projectstates/${initialStateId}/environment/${environmentId}`,
        { Major: 1, Minor: 0, Patch: 0, State: JSON.stringify(state100), Comment: 'First release' },
      );
    expect(createState100Status).toBe(201);
    const stateId100 = createdState100.projectStateId;

    // 12. Push state 1.1.0
    const state110 = { key: 'v1', nested: { a: 1 }, added: 'field' };
    await client.post<CreateStateResponse>(
      `/projectstates/${initialStateId}/environment/${environmentId}`,
      { Major: 1, Minor: 1, Patch: 0, State: JSON.stringify(state110), Comment: 'Added field' },
    );

    // 13. List state history (should have 3: 1.1.0, 1.0.0, 0.0.0 in desc order)
    const { data: allStates } = await client.get<ProjectStateResponse[]>(
      `/projectstates/${initialStateId}/environment/${environmentId}`,
    );
    expect(allStates).toHaveLength(3);
    expect(allStates[0].major).toBe(1);
    expect(allStates[0].minor).toBe(1);
    expect(allStates[0].patch).toBe(0);
    expect(allStates[1].major).toBe(1);
    expect(allStates[1].minor).toBe(0);
    expect(allStates[1].patch).toBe(0);
    expect(allStates[2].major).toBe(0);
    expect(allStates[2].minor).toBe(0);
    expect(allStates[2].patch).toBe(0);

    // 14. Get latest state (should be 1.1.0)
    const { data: latestState } = await client.get<ProjectStateResponse>(
      `/projectstates/${initialStateId}/environment/${environmentId}/latest`,
    );
    expect(latestState.major).toBe(1);
    expect(latestState.minor).toBe(1);
    expect(latestState.patch).toBe(0);
    // Compare parsed JSON (PostgreSQL jsonb normalizes key order)
    expect(JSON.parse(latestState.state)).toEqual(state110);
    expect(latestState.comment).toBe('Added field');

    // 15. Get state by ID (verify specific version data)
    const { data: stateById } = await client.get<ProjectStateResponse>(
      `/projectstates/${stateId100}`,
    );
    expect(stateById.projectStateId).toBe(stateId100);
    expect(JSON.parse(stateById.state)).toEqual(state100);
    expect(stateById.comment).toBe('First release');

    // ── ROLLBACK ──────────────────────────────────────────────

    // 16. Rollback to 1.0.0 (creates 1.2.0)
    const { data: rollbackResult, status: rollbackStatus } =
      await client.post<CreateStateResponse>(
        `/projectstates/${initialStateId}/environment/${environmentId}/rollback/${stateId100}`,
      );
    expect(rollbackStatus).toBe(201);

    // 17. Verify rollback created correct version with original content
    const { data: rolledBackState } = await client.get<ProjectStateResponse>(
      `/projectstates/${rollbackResult.projectStateId}`,
    );
    expect(rolledBackState.major).toBe(1);
    expect(rolledBackState.minor).toBe(2);
    expect(rolledBackState.patch).toBe(0);
    expect(JSON.parse(rolledBackState.state)).toEqual(state100);
    expect(rolledBackState.comment).toBe('Rollback to version 1.0.0');

    // ── PUBLIC READ ───────────────────────────────────────────

    // 18. Public state fetch (no auth) with caching headers
    const publicClient = createPublicClient();
    const { data: publicState, headers: publicHeaders } =
      await publicClient.get<PublicStateResponse>(
        `/state/${projectSlug}/${envSlug}`,
        { auth: false },
      );

    // Verify response has state data
    expect(publicState.version).toBeDefined();
    expect(publicState.state).toBeDefined();

    // Verify caching headers
    expect(publicHeaders.get('cache-control')).toBeTruthy();
    expect(publicHeaders.get('etag')).toBeTruthy();

    // ── CLEANUP (DELETE) ──────────────────────────────────────

    // 19. Delete environment
    const { status: deleteEnvStatus } = await client.del(
      `/projects/${projectId}/environments/${environmentId}`,
    );
    expect(deleteEnvStatus).toBe(204);

    // 20. Verify environment is gone (expect 404 ApiError)
    await expect(
      client.get(`/projects/${projectId}/environments/${environmentId}`),
    ).rejects.toThrow(ApiError);

    // 21. Delete project
    const { status: deleteProjStatus } = await client.del(`/projects/${projectId}`);
    expect(deleteProjStatus).toBe(204);

    // 22. Verify project is gone (expect 404 ApiError)
    await expect(
      client.get(`/projects/${projectId}`),
    ).rejects.toThrow(ApiError);
  });

  it('billing status reflects resource usage', async () => {
    const id = uid();
    const client = createTestClient(id);

    // Create project + env + state
    const { data: proj } = await client.post<CreateProjectResponse>('/projects', {
      name: 'Billing Test',
      slug: `billing-${id}`,
      apiKeyHash: `hash-billing-${id}`,
    });
    const { data: env } = await client.post<CreateEnvironmentResponse>(
      `/projects/${proj.projectId}/environments`,
      { name: 'Prod', slug: `prod-${id}` },
    );
    await client.post(
      `/projectstates/${env.initialStateId}/environment/${env.environmentId}`,
      { Major: 1, Minor: 0, Patch: 0, State: '{"key":"value"}', Comment: 'First' },
    );

    // Check billing reflects usage
    const { data: billing } = await client.get<BillingStatusResponse>('/billing/status');
    expect(billing.projects.count).toBeGreaterThanOrEqual(1);
    expect(billing.environments.count).toBeGreaterThanOrEqual(1);
    expect(billing.storage.bytes).toBeGreaterThan(0);

    // Cleanup
    await client.del(`/projects/${proj.projectId}/environments/${env.environmentId}`);
    await client.del(`/projects/${proj.projectId}`);
  });
});
