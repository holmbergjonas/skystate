import { test, expect } from '@playwright/test';
import { createProject, deleteAllProjects } from './helpers';

const uid = () => Math.random().toString(36).slice(2, 10);

test.describe('State Editing', () => {
  test.beforeEach(async () => { await deleteAllProjects(); });

  test('edit and push state via the JSON editor', async ({ page }) => {
    const id = uid();
    const projectName = `State Test ${id}`;
    const projectSlug = `state-test-${id}`;

    // Create a project (which auto-creates default environments)
    await page.goto('/');
    await expect(page.getByText('SkyState', { exact: true })).toBeVisible();

    await createProject(page, projectName, projectSlug);

    // Should be on State tab by default
    // Wait for the state editor area to load
    await page.waitForTimeout(2000); // Allow state versions to load

    // Click the Edit button to enter edit mode
    const editButton = page.getByRole('button', { name: 'Edit' });
    await expect(editButton).toBeVisible({ timeout: 10_000 });
    await editButton.click();

    // The CodeMirror editor should be active now
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 5_000 });

    // Clear existing content and insert new JSON
    // Use insertText to bypass CodeMirror's closeBrackets auto-completion
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('{"hello": "world", "version": 1}');

    // Wait for the editor to process the change
    await page.waitForTimeout(500);

    // The PushUpdateBar should be visible with a Save button
    const saveButton = page.getByRole('button', { name: /Save/i });
    await expect(saveButton).toBeVisible({ timeout: 5_000 });
    await saveButton.click();

    // Wait for the save to complete
    // After a successful push, the editor exits edit mode
    // The Edit button should reappear
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10_000 });

    // Verify the pushed state is displayed
    await expect(page.getByText('"hello"')).toBeVisible();
    await expect(page.getByText('"world"')).toBeVisible();
  });
});
