import { test, expect } from '@playwright/test';
import { createProject, deleteAllProjects } from './helpers';

const uid = () => Math.random().toString(36).slice(2, 10);

test.describe('Project Management', () => {
  test.beforeEach(async () => { await deleteAllProjects(); });

  test('create a new project via the project selector', async ({ page }) => {
    const projectName = `E2E Test ${uid()}`;
    const projectSlug = `e2e-test-${uid()}`;

    // Navigate to app (auto-auth in test mode)
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Create a project (handles NewProjectPage or dropdown path)
    await createProject(page, projectName, projectSlug);

    // Verify default environments were created by navigating to Config tab
    await page.getByRole('link', { name: 'Config' }).click();

    // Should see the environments table with at least Development and Production
    // Use role=cell to target table cells (avoids hidden spans in the always-mounted StateTab)
    await expect(page.getByRole('cell', { name: 'Development', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('cell', { name: 'Production', exact: true })).toBeVisible();
  });
});
