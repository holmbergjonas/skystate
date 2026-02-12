import { test, expect } from '@playwright/test';
import { createProject, deleteAllProjects } from './helpers';

const uid = () => Math.random().toString(36).slice(2, 10);

test.describe('Environment Management', () => {
  test.beforeEach(async () => { await deleteAllProjects(); });

  test('create and verify a new environment', async ({ page }) => {
    const id = uid();
    const projectName = `Env Test ${id}`;
    const projectSlug = `env-test-${id}`;
    const envName = `Staging ${id}`;
    const envSlug = `staging-${id}`;

    // Create a project first
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    await createProject(page, projectName, projectSlug);

    // Navigate to Config tab
    await page.getByRole('link', { name: 'Config' }).click();

    // Wait for environments to fully load (table must show default envs)
    await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('cell', { name: 'Development', exact: true })).toBeVisible({ timeout: 10_000 });

    // Free tier allows only 2 environments; delete one default to make room
    const devRow = page.locator('tr', { has: page.getByRole('cell', { name: 'Development', exact: true }) });
    await devRow.getByRole('button', { name: 'Remove' }).click();
    // Fresh env has no state → simple confirmation appears
    await page.getByRole('button', { name: 'Remove' }).last().click();
    // Wait for the row to disappear
    await expect(page.getByRole('cell', { name: 'Development', exact: true })).not.toBeVisible({ timeout: 10_000 });

    // Click "Add environment"
    await page.getByRole('button', { name: 'Add environment' }).click();

    // Fill in environment creation form
    await expect(page.getByText('Add an environment')).toBeVisible();

    // The environment form has Name and Slug inputs
    const envNameInput = page.locator('input[placeholder="e.g., Staging"]');
    await envNameInput.fill(envName);

    const envSlugInput = page.locator('input[placeholder="e.g., staging"]');
    await envSlugInput.clear();
    await envSlugInput.fill(envSlug);

    // Click Create
    await page.getByRole('button', { name: 'Create' }).last().click();

    // Wait for the form panel to close (confirms success)
    await expect(page.getByText('Add an environment')).not.toBeVisible({ timeout: 10_000 });

    // Verify the new environment appears in the table
    await expect(page.getByRole('cell', { name: envName })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('cell', { name: envSlug })).toBeVisible();
  });
});
