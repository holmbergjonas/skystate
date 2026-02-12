import { describe, it, expect } from 'vitest';
import { detectBump, computeNextVersion, generateUnifiedDiff } from '../../../src/lib/diff.js';

// ---------------------------------------------------------------------------
// detectBump
// ---------------------------------------------------------------------------

describe('detectBump', () => {
  it('returns patch when only values change', () => {
    expect(detectBump({ a: 1 }, { a: 2 })).toBe('patch');
  });

  it('returns patch for identical states', () => {
    expect(detectBump({ a: 1 }, { a: 1 })).toBe('patch');
  });

  it('returns minor when keys are added', () => {
    expect(detectBump({ a: 1 }, { a: 1, b: 2 })).toBe('minor');
  });

  it('returns major when keys are removed', () => {
    expect(detectBump({ a: 1, b: 2 }, { a: 1 })).toBe('major');
  });

  it('returns major when value type changes (string -> number)', () => {
    expect(detectBump({ a: 'hello' }, { a: 42 })).toBe('major');
  });

  it('returns major for null to non-null transition', () => {
    expect(detectBump({ a: null }, { a: 'value' })).toBe('major');
  });

  it('returns major for non-null to null transition', () => {
    expect(detectBump({ a: 'value' }, { a: null })).toBe('major');
  });

  it('returns major for array/object mismatch', () => {
    expect(detectBump({ a: [1, 2] }, { a: { x: 1 } })).toBe('major');
    expect(detectBump({ a: { x: 1 } }, { a: [1, 2] })).toBe('major');
  });

  it('returns patch for array content changes', () => {
    expect(detectBump({ a: [1, 2, 3] }, { a: [3, 2, 1] })).toBe('patch');
  });

  it('returns minor for deep key addition', () => {
    expect(
      detectBump(
        { nested: { a: 1 } },
        { nested: { a: 1, b: 2 } },
      ),
    ).toBe('minor');
  });

  it('returns major for deep key removal', () => {
    expect(
      detectBump(
        { nested: { a: 1, b: 2 } },
        { nested: { a: 1 } },
      ),
    ).toBe('major');
  });

  it('handles empty objects', () => {
    expect(detectBump({}, {})).toBe('patch');
    expect(detectBump({}, { a: 1 })).toBe('minor');
    expect(detectBump({ a: 1 }, {})).toBe('major');
  });

  it('handles deeply nested structures', () => {
    const old = { level1: { level2: { level3: { value: 'a' } } } };
    const updated = { level1: { level2: { level3: { value: 'b' } } } };
    expect(detectBump(old, updated)).toBe('patch');
  });
});

// ---------------------------------------------------------------------------
// computeNextVersion
// ---------------------------------------------------------------------------

describe('computeNextVersion', () => {
  it('increments major and resets minor/patch', () => {
    const result = computeNextVersion({ major: 1, minor: 2, patch: 3 }, 'major');
    expect(result).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('increments minor and resets patch', () => {
    const result = computeNextVersion({ major: 1, minor: 2, patch: 3 }, 'minor');
    expect(result).toEqual({ major: 1, minor: 3, patch: 0 });
  });

  it('increments patch only', () => {
    const result = computeNextVersion({ major: 1, minor: 2, patch: 3 }, 'patch');
    expect(result).toEqual({ major: 1, minor: 2, patch: 4 });
  });

  it('works from 0.0.0', () => {
    expect(computeNextVersion({ major: 0, minor: 0, patch: 0 }, 'major')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
    });
    expect(computeNextVersion({ major: 0, minor: 0, patch: 0 }, 'minor')).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
    });
    expect(computeNextVersion({ major: 0, minor: 0, patch: 0 }, 'patch')).toEqual({
      major: 0,
      minor: 0,
      patch: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// generateUnifiedDiff
// ---------------------------------------------------------------------------

describe('generateUnifiedDiff', () => {
  it('returns empty diff for identical inputs', () => {
    const json = JSON.stringify({ a: 1 }, null, 2);
    const result = generateUnifiedDiff(json, json, 'old', 'new');
    expect(result.lines).toEqual([]);
    expect(result.stats).toEqual({ added: 0, removed: 0 });
  });

  it('produces + lines for additions', () => {
    const oldJson = JSON.stringify({ a: 1 }, null, 2);
    const newJson = JSON.stringify({ a: 1, b: 2 }, null, 2);
    const result = generateUnifiedDiff(oldJson, newJson, 'old', 'new');

    const addedLines = result.lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    expect(addedLines.length).toBeGreaterThan(0);
    expect(result.stats.added).toBeGreaterThan(0);
  });

  it('produces - lines for removals', () => {
    const oldJson = JSON.stringify({ a: 1, b: 2 }, null, 2);
    const newJson = JSON.stringify({ a: 1 }, null, 2);
    const result = generateUnifiedDiff(oldJson, newJson, 'old', 'new');

    const removedLines = result.lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
    expect(removedLines.length).toBeGreaterThan(0);
    expect(result.stats.removed).toBeGreaterThan(0);
  });

  it('includes --- and +++ headers with labels', () => {
    const oldJson = JSON.stringify({ a: 1 }, null, 2);
    const newJson = JSON.stringify({ a: 2 }, null, 2);
    const result = generateUnifiedDiff(oldJson, newJson, 'staging v1.0.0', 'staging v1.0.1');

    expect(result.lines[0]).toBe('--- staging v1.0.0');
    expect(result.lines[1]).toBe('+++ staging v1.0.1');
  });

  it('includes @@ hunk headers', () => {
    const oldJson = JSON.stringify({ a: 1 }, null, 2);
    const newJson = JSON.stringify({ a: 2 }, null, 2);
    const result = generateUnifiedDiff(oldJson, newJson, 'old', 'new');

    const hunkHeaders = result.lines.filter((l) => l.startsWith('@@'));
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty old string (new state creation)', () => {
    const newJson = JSON.stringify({ a: 1 }, null, 2);
    const result = generateUnifiedDiff('', newJson, 'old', 'new');

    expect(result.stats.added).toBeGreaterThan(0);
    expect(result.stats.removed).toBe(0);
  });

  it('generates multiple hunks for far-apart changes', () => {
    // Create JSON with many lines, change first and last
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`key${i.toString().padStart(2, '0')}`] = i;

    const oldJson = JSON.stringify(obj, null, 2);
    const modObj = { ...obj, key00: 999, key19: 999 };
    const newJson = JSON.stringify(modObj, null, 2);

    const result = generateUnifiedDiff(oldJson, newJson, 'old', 'new', 1);
    const hunkHeaders = result.lines.filter((l) => l.startsWith('@@'));
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(2);
  });
});
