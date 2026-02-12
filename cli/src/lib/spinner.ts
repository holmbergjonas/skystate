/**
 * Spinner wrapper around ora for async operations.
 *
 * Writes to stderr only so piped stdout is never contaminated.
 * Auto-disables in non-TTY and CI environments (ora built-in behavior).
 */

import ora from 'ora';

/**
 * Wrap an async operation with a spinner that writes to stderr.
 *
 * @param message - Text shown next to the spinner
 * @param fn - Async function to execute while spinner is active
 * @returns The result of fn()
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  const spinner = ora({
    text: message,
    stream: process.stderr,
  }).start();

  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
