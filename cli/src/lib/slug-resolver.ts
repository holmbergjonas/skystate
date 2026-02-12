/**
 * Slug resolver -- maps human-friendly project slugs to API UUIDs
 * and validates environment slugs locally.
 *
 * Session-scoped cache: Map lives at module level, naturally cleared on process exit.
 * Used by every command that takes --project or --env slugs.
 */

import type { HttpClient } from './http-client.js';
import { ApiError, CliError } from './errors.js';

// Module-level cache -- lives for duration of CLI process
const projectCache = new Map<string, string>();

interface ProjectResponse {
  projectId: string;
  name: string;
  slug: string;
}

/**
 * Valid fixed environment slugs.
 * Environments are no longer user-managed -- they are fixed strings.
 */
const VALID_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/**
 * Resolve a project slug to its UUID.
 * Uses GET /projects/by-slug/{slug}.
 * Caches result for the lifetime of the process.
 *
 * @throws CliError with actionable hint if slug not found
 */
export async function resolveProject(
  client: HttpClient,
  slug: string,
): Promise<string> {
  const cached = projectCache.get(slug);
  if (cached) return cached;

  try {
    const { data } = await client.get<ProjectResponse>(
      `/projects/by-slug/${encodeURIComponent(slug)}`,
    );
    projectCache.set(slug, data.projectId);
    return data.projectId;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new CliError(
        `Project '${slug}' not found. Run: skystate projects list`,
      );
    }
    throw err;
  }
}

/**
 * Validate an environment slug locally.
 * Environments are fixed strings (development, staging, production) --
 * no API call is needed.
 *
 * @returns The validated slug string
 * @throws CliError if the slug is not a valid environment
 */
export function resolveEnvironment(slug: string): string {
  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(slug)) {
    throw new CliError(
      `Invalid environment "${slug}". Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
    );
  }
  return slug;
}
