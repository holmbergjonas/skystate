import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('auto-authenticates and redirects from login page', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // In test mode, should auto-redirect away from /login
    // Verify AppShell renders
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Fresh user has no projects → NewProjectPage heading should be visible
    await expect(
      page.getByRole('heading', { name: 'Create a new project' })
    ).toBeVisible();
  });

  test('navigating to / auto-authenticates', async ({ page }) => {
    // In test mode, going directly to / should auto-authenticate
    await page.goto('/');

    // Should see AppShell directly (no redirect to /login)
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    // Fresh user has no projects → NewProjectPage is shown
    await expect(page.getByText('Create a new project')).toBeVisible();
  });
});
