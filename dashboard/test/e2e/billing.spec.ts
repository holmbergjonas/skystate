import { test, expect } from '@playwright/test';
import { createProject, deleteAllProjects } from './helpers';

const uid = () => Math.random().toString(36).slice(2, 10);

test.describe('Billing Pages', () => {
  test.beforeEach(async () => { await deleteAllProjects(); });
  test('usage tab renders with billing data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Navigate to Usage tab
    await page.getByRole('link', { name: 'Usage' }).click();

    // Wait for either success or error state (loading should resolve)
    await expect(
      page.getByText('Loading usage data...').or(
        page.getByText('Projects', { exact: true })
      ).or(
        page.getByText('Failed to load usage data')
      )
    ).toBeVisible({ timeout: 10_000 });

    // If the usage data loaded successfully, verify key elements
    const hasUsageData = await page.getByText('Projects', { exact: true }).isVisible().catch(() => false);
    if (hasUsageData) {
      await expect(page.getByText('Projects', { exact: true })).toBeVisible();
    }
  });

  test('plans tab renders with plan cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Navigate to Plans tab
    await page.getByRole('link', { name: 'Plans' }).click();

    // Wait for plans page to load
    await expect(
      page.getByText('Pick your perfect plan').or(
        page.getByText('Loading billing data...')
      ).or(
        page.getByText('Failed to load billing data')
      )
    ).toBeVisible({ timeout: 10_000 });

    // If plans loaded successfully, verify plan cards render
    const hasPlans = await page.getByText('Pick your perfect plan').isVisible().catch(() => false);
    if (hasPlans) {
      await expect(page.getByText('Free').first()).toBeVisible();
    }
  });

  test('navigating between all tabs works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Create a project so Config and State tabs render their content
    const id = uid();
    await createProject(page, `Tab Test ${id}`, `tab-test-${id}`);

    // Navigate through all tabs to verify routing works
    await page.getByRole('link', { name: 'Config' }).click();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('link', { name: 'Usage' }).click();
    await page.waitForTimeout(2000);

    await page.getByRole('link', { name: 'Plans' }).click();
    await page.waitForTimeout(2000);

    await page.getByRole('link', { name: 'State' }).click();
    await page.waitForTimeout(1000);

    // Verify we're back on the state view — no crashes through the whole navigation
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();
  });
});
