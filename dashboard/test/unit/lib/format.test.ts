import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatJson, formatVersion, formatBytes, formatRelativeTime, capitalize, deriveSlug, formatCents } from '@/lib/format';

// ---------------------------------------------------------------------------
// formatJson
// ---------------------------------------------------------------------------

describe('formatJson', () => {
  it('expands empty root object to multi-line', () => {
    expect(formatJson('{}')).toBe('{\n\n}');
  });

  it('expands nested empty objects to multi-line', () => {
    const result = formatJson('{"nested":{}}');
    // The nested {} should be expanded with newlines inside
    expect(result).toContain('"nested": {');
    expect(result).not.toContain('"nested": {}');
  });

  it('preserves valid JSON round-trip', () => {
    const input = '{"a":1,"b":"hello","c":[1,2,3]}';
    const result = formatJson(input);
    // Should be parseable and equivalent
    expect(JSON.parse(result)).toEqual(JSON.parse(input));
  });

  it('pretty-prints with indentation', () => {
    const result = formatJson('{"key":"value"}');
    expect(result).toContain('  "key"');
  });
});

// ---------------------------------------------------------------------------
// formatVersion
// ---------------------------------------------------------------------------

describe('formatVersion', () => {
  it('formats version without prefix', () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('formats version with prefix', () => {
    expect(formatVersion({ major: 0, minor: 0, patch: 1 }, 'v')).toBe('v0.0.1');
  });

  it('handles zero version', () => {
    expect(formatVersion({ major: 0, minor: 0, patch: 0 })).toBe('0.0.0');
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 KB');
  });

  it('formats sub-KB bytes', () => {
    expect(formatBytes(500)).toBe('0 KB');
  });

  it('formats KB range', () => {
    expect(formatBytes(1536)).toBe('2 KB');
  });

  it('formats MB range', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('formats small byte count', () => {
    expect(formatBytes(42)).toBe('0 KB');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 1 minute ago', () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-28T12:00:00Z');
    vi.setSystemTime(now);
    expect(formatRelativeTime('2026-02-28T11:59:30Z')).toBe('just now');
  });

  it('returns "N min ago" for less than 60 minutes', () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-28T12:00:00Z');
    vi.setSystemTime(now);
    expect(formatRelativeTime('2026-02-28T11:45:00Z')).toBe('15 min ago');
  });

  it('returns "N hr ago" for less than 24 hours', () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-28T12:00:00Z');
    vi.setSystemTime(now);
    expect(formatRelativeTime('2026-02-28T09:00:00Z')).toBe('3 hr ago');
  });

  it('returns "N days ago" for less than 7 days', () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-28T12:00:00Z');
    vi.setSystemTime(now);
    expect(formatRelativeTime('2026-02-25T12:00:00Z')).toBe('3 days ago');
  });

  it('returns locale date string for more than 7 days', () => {
    vi.useFakeTimers();
    const now = new Date('2026-02-28T12:00:00Z');
    vi.setSystemTime(now);
    const result = formatRelativeTime('2026-02-10T12:00:00Z');
    // Should be a date string, not a relative time
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
  });
});

// ---------------------------------------------------------------------------
// formatCents
// ---------------------------------------------------------------------------

describe('formatCents', () => {
  it('formats zero cents', () => {
    expect(formatCents(0)).toBe('$0.00');
  });

  it('formats whole dollar amount', () => {
    expect(formatCents(900)).toBe('$9.00');
  });

  it('formats dollars and cents', () => {
    expect(formatCents(1999)).toBe('$19.99');
  });

  it('formats sub-dollar amount', () => {
    expect(formatCents(50)).toBe('$0.50');
  });
});

// ---------------------------------------------------------------------------
// capitalize
// ---------------------------------------------------------------------------

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('handles empty string', () => {
    expect(capitalize('')).toBe('');
  });

  it('handles already capitalized', () => {
    expect(capitalize('A')).toBe('A');
  });

  it('only capitalizes first letter', () => {
    expect(capitalize('hello world')).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// deriveSlug
// ---------------------------------------------------------------------------

describe('deriveSlug', () => {
  it('converts to lowercase with hyphens', () => {
    expect(deriveSlug('My Project')).toBe('my-project');
  });

  it('strips special characters', () => {
    expect(deriveSlug('Hello! World@#')).toBe('hello-world');
  });

  it('converts spaces to hyphens', () => {
    expect(deriveSlug('one two three')).toBe('one-two-three');
  });

  it('handles already valid slug', () => {
    expect(deriveSlug('my-project')).toBe('my-project');
  });

  it('handles empty string', () => {
    expect(deriveSlug('')).toBe('');
  });
});
