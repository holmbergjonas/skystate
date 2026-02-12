/**
 * Interactive confirmation prompts for destructive CLI commands.
 *
 * Prompts write to stderr (not stdout) to avoid breaking piped output.
 * Non-TTY contexts must use --force to skip prompts.
 */

import { createInterface } from 'node:readline/promises';
import { CliError } from './errors.js';

/**
 * Check if stdin is interactive (TTY).
 * Non-TTY contexts (pipes, CI) must use --force.
 */
export function requireInteractive(force: boolean): void {
  if (!force && !process.stdin.isTTY) {
    throw new CliError(
      'Use --force to skip confirmation in non-interactive mode',
    );
  }
}

/**
 * Prompt for y/N confirmation. Returns true if user types y/Y.
 */
export async function confirmYesNo(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

/**
 * Prompt user to type a slug to confirm deletion.
 * Returns true only if typed slug matches exactly.
 */
export async function confirmSlug(
  message: string,
  expectedSlug: string,
): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `${message}\nType the project slug to confirm: `,
    );
    return answer.trim() === expectedSlug;
  } finally {
    rl.close();
  }
}
