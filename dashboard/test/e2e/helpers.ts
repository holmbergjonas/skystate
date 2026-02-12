import { expect, type Page } from '@playwright/test';

/** Auth headers matching VITE_TEST_* values (baked into the dashboard build). */
const TEST_AUTH_HEADERS: Record<string, string> = {
  'X-Test-GitHub-Id': process.env.VITE_TEST_GITHUB_ID ?? 'gh_dev_12345',
  'X-Test-Email': process.env.VITE_TEST_EMAIL ?? 'dev@example.com',
  'X-Test-Name': process.env.VITE_TEST_NAME ?? 'Dev User',
};

/**
 * Deletes every project owned by the test user via the API.
 * Call before tests that create projects to stay within free-tier limits.
 */
export async function deleteAllProjects() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://skystate_proxy:80';
  const res = await fetch(`${baseURL}/api/projects`, { headers: TEST_AUTH_HEADERS });
  const projects: { projectId: string }[] = await res.json();
  await Promise.all(
    projects.map(p =>
      fetch(`${baseURL}/api/projects/${p.projectId}`, {
        method: 'DELETE',
        headers: TEST_AUTH_HEADERS,
      }),
    ),
  );
}

/**
 * Creates a project, handling both UI paths:
 * - No projects exist → NewProjectPage shown in-page with "Create a new project" heading
 * - Projects exist → dropdown chevron → "New project" modal
 *
 * Waits for API data to load before detecting which path to use.
 */
export async function createProject(page: Page, name: string, slug: string) {
  // Wait for API requests to settle so we know which UI state we're in
  await page.waitForLoadState('networkidle');

  const nameInput = page.locator('input[placeholder="My Awesome App"]');
  const onNewProjectPage = await nameInput.isVisible();

  if (onNewProjectPage) {
    // Full-page NewProjectPage form
    await nameInput.fill(name);
    const slugInput = page.locator('input[placeholder="my-awesome-app"]');
    await slugInput.clear();
    await slugInput.fill(slug);
    await page.getByRole('button', { name: 'Create project' }).click();
  } else {
    // Dropdown → modal flow
    const trigger = page.locator('button', { has: page.locator('svg.lucide-chevron-down') }).first();
    await trigger.click();
    await page.getByText('New project').click();

    await page.locator('input[placeholder="My Awesome App"]').fill(name);
    const slugInput = page.locator('input[placeholder="my-awesome-app"]');
    await slugInput.clear();
    await slugInput.fill(slug);
    await page.getByRole('button', { name: 'Create' }).click();
  }

  // Wait for project to appear in the project selector
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
}
