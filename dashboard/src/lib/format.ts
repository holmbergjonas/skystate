/**
 * Pretty-print a JSON string with empty objects expanded to multi-line
 * so the editor feels welcoming to type between the braces.
 */
export function formatJson(raw: string): string {
  const formatted = JSON.stringify(JSON.parse(raw), null, 2);
  if (formatted === '{}') return '{\n\n}';
  return formatted.replace(
    /^(\s*"[^"]+": )\{\}(,?)$/gm,
    (_m, prefix: string, comma: string) => {
      const indent = prefix.match(/^\s*/)![0];
      return `${prefix}{\n\n${indent}}${comma}`;
    },
  );
}

/**
 * Format a version object as a string with optional prefix.
 */
export function formatVersion(v: { major: number; minor: number; patch: number }, prefix = ''): string {
  return `${prefix}${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Format a byte count into a human-readable size string.
 * Uses 1024-based units with KB as minimum resolution.
 * Examples: 0 -> "0 KB", 42 -> "0.0 KB", 1536 -> "1.5 KB", 1048576 -> "1.0 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Format an ISO date string into a relative time string.
 * < 1 min -> "just now", < 60 min -> "N min ago", < 24 hr -> "N hr ago",
 * < 7 days -> "N days ago", otherwise -> locale date string.
 */
export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Format a cent amount as a dollar string (e.g. 900 -> "$9.00").
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Derive a URL-safe slug from a name.
 */
export function deriveSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
