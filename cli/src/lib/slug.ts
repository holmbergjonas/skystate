/**
 * Convert a display name to a URL-safe slug.
 *
 * Lowercases, replaces non-alphanumeric runs with hyphens, and trims leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
