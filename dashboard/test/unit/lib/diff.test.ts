import { describe, it, expect } from 'vitest';
import { buildLines, type DiffLine } from '@/lib/diff';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusCounts(lines: DiffLine[]) {
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0, structural: 0 };
  for (const l of lines) counts[l.status]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildLines', () => {
  it('returns unchanged lines and zero stats for identical objects', () => {
    const json = '{"a":1,"b":"hello"}';
    const { lines, stats } = buildLines(json, json);

    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.changed).toBe(0);
    expect(stats.hasTypeChange).toBe(false);

    // All non-structural lines should be unchanged
    const nonStructural = lines.filter(l => l.status !== 'structural');
    expect(nonStructural.every(l => l.status === 'unchanged')).toBe(true);
    // Left and right should match for unchanged lines
    for (const l of nonStructural) {
      expect(l.left).toBe(l.right);
    }
  });

  it('detects added keys', () => {
    const left = '{"a":1}';
    const right = '{"a":1,"b":2}';
    const { lines, stats } = buildLines(left, right);

    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBe(0);
    expect(stats.changed).toBe(0);

    const addedLines = lines.filter(l => l.status === 'added');
    expect(addedLines.length).toBeGreaterThan(0);
    // Added lines have empty left, non-empty right
    for (const l of addedLines) {
      expect(l.left).toBe('');
      expect(l.right).not.toBe('');
    }
  });

  it('detects removed keys', () => {
    const left = '{"a":1,"b":2}';
    const right = '{"a":1}';
    const { lines, stats } = buildLines(left, right);

    expect(stats.removed).toBeGreaterThan(0);
    expect(stats.added).toBe(0);
    expect(stats.changed).toBe(0);

    const removedLines = lines.filter(l => l.status === 'removed');
    expect(removedLines.length).toBeGreaterThan(0);
    // Removed lines have non-empty left, empty right
    for (const l of removedLines) {
      expect(l.left).not.toBe('');
      expect(l.right).toBe('');
    }
  });

  it('detects changed values (same type)', () => {
    const left = '{"a":1,"b":"old"}';
    const right = '{"a":1,"b":"new"}';
    const { lines, stats } = buildLines(left, right);

    expect(stats.changed).toBe(1);
    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.hasTypeChange).toBe(false);

    const changedLines = lines.filter(l => l.status === 'changed');
    expect(changedLines.length).toBe(1);
    expect(changedLines[0].left).toContain('"old"');
    expect(changedLines[0].right).toContain('"new"');
  });

  it('detects type changes (primitive to object)', () => {
    // hasTypeChange fires when one side is object/array and other is primitive
    const left = '{"a":"hello"}';
    const right = '{"a":{"nested":true}}';
    const { stats } = buildLines(left, right);

    expect(stats.hasTypeChange).toBe(true);
  });

  it('treats same-type value changes as changed (not type change)', () => {
    const left = '{"a":"hello"}';
    const right = '{"a":42}';
    const { stats } = buildLines(left, right);

    // Both are primitives at key level, so it's a "changed" value, not a type change
    expect(stats.changed).toBe(1);
  });

  it('handles nested object diffs recursively', () => {
    const left = '{"outer":{"inner":1}}';
    const right = '{"outer":{"inner":2}}';
    const { lines, stats } = buildLines(left, right);

    expect(stats.changed).toBe(1);
    const structuralLines = lines.filter(l => l.status === 'structural');
    expect(structuralLines.length).toBeGreaterThan(0);
  });

  it('handles array element diffs', () => {
    const left = '{"arr":[1,2,3]}';
    const right = '{"arr":[1,2,4]}';
    const { lines, stats } = buildLines(left, right);

    expect(stats.changed).toBe(1);
    const changedLines = lines.filter(l => l.status === 'changed');
    expect(changedLines.length).toBe(1);
  });

  it('handles array length changes (added elements)', () => {
    const left = '{"arr":[1]}';
    const right = '{"arr":[1,2,3]}';
    const { stats } = buildLines(left, right);

    expect(stats.added).toBeGreaterThan(0);
  });

  it('handles array length changes (removed elements)', () => {
    const left = '{"arr":[1,2,3]}';
    const right = '{"arr":[1]}';
    const { stats } = buildLines(left, right);

    expect(stats.removed).toBeGreaterThan(0);
  });

  it('handles empty objects', () => {
    const { lines, stats } = buildLines('{}', '{}');

    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.changed).toBe(0);
    // Should have structural braces
    const structuralLines = lines.filter(l => l.status === 'structural');
    expect(structuralLines.length).toBeGreaterThanOrEqual(2);
  });

  it('handles complex nested diff with mixed changes', () => {
    const left = '{"name":"Alice","age":30,"address":{"city":"NY","zip":"10001"},"tags":["admin"]}';
    const right = '{"name":"Bob","age":30,"address":{"city":"LA","state":"CA"},"tags":["admin","user"]}';
    const { lines, stats } = buildLines(left, right);

    // name changed, city changed
    expect(stats.changed).toBeGreaterThanOrEqual(2);
    // zip removed
    expect(stats.removed).toBeGreaterThan(0);
    // state added, "user" tag added
    expect(stats.added).toBeGreaterThan(0);

    const counts = statusCounts(lines);
    expect(counts.structural).toBeGreaterThan(0);
  });

  it('handles primitive JSON values (non-objects)', () => {
    const { lines, stats } = buildLines('"hello"', '"world"');

    expect(stats.changed).toBe(1);
    expect(lines.length).toBe(1);
    expect(lines[0].status).toBe('changed');
  });

  it('handles null to string value change', () => {
    const left = '{"a":null}';
    const right = '{"a":"value"}';
    const { stats } = buildLines(left, right);

    // null and string are both primitives at key level — changed, not type change
    expect(stats.changed).toBe(1);
  });

  it('handles adding a key to an empty object', () => {
    const { stats } = buildLines('{}', '{"key":"value"}');

    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBe(0);
  });
});
