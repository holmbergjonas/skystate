/**
 * Pure functions for version bump detection and next version computation.
 *
 * Used by state push (auto-detect bump type from structural diff) and
 * state diff (unified diff generation between JSON states).
 *
 * No I/O, no side effects — all functions are pure.
 */

export type BumpType = 'major' | 'minor' | 'patch';

/**
 * Detect version bump type from structural diff between two JSON values.
 *
 * - major: keys removed or value types changed at any depth
 * - minor: keys added at any depth (no removals or type changes)
 * - patch: only value changes (same keys, same types)
 *
 * Arrays are compared by JSON.stringify (ordering changes are patch-level).
 */
export function detectBump(oldState: unknown, newState: unknown): BumpType {
  let hasAdded = false;

  function compare(oldVal: unknown, newVal: unknown): 'major' | 'minor' | 'patch' {
    // Null/non-null mismatch = major
    if (oldVal === null && newVal !== null) return 'major';
    if (oldVal !== null && newVal === null) return 'major';

    // Type change = major
    if (typeof oldVal !== typeof newVal) return 'major';

    // Both objects (not arrays, not null)
    if (
      typeof oldVal === 'object' &&
      oldVal !== null &&
      typeof newVal === 'object' &&
      newVal !== null
    ) {
      const oldIsArray = Array.isArray(oldVal);
      const newIsArray = Array.isArray(newVal);

      // Array/object mismatch = major
      if (oldIsArray !== newIsArray) return 'major';

      // Both arrays: compare by serialization (ordering changes = patch)
      if (oldIsArray && newIsArray) {
        return JSON.stringify(oldVal) !== JSON.stringify(newVal) ? 'patch' : 'patch';
      }

      // Both plain objects: compare key sets and recurse
      const oldObj = oldVal as Record<string, unknown>;
      const newObj = newVal as Record<string, unknown>;
      const oldKeys = new Set(Object.keys(oldObj));
      const newKeys = new Set(Object.keys(newObj));

      // Removed keys = major
      for (const key of oldKeys) {
        if (!newKeys.has(key)) return 'major';
      }

      // Added keys = minor
      for (const key of newKeys) {
        if (!oldKeys.has(key)) hasAdded = true;
      }

      // Recurse into shared keys
      for (const key of oldKeys) {
        if (newKeys.has(key)) {
          const result = compare(oldObj[key], newObj[key]);
          if (result === 'major') return 'major';
        }
      }

      return hasAdded ? 'minor' : 'patch';
    }

    // Primitives: compare with ===
    return oldVal !== newVal ? 'patch' : 'patch';
  }

  return compare(oldState, newState);
}

/**
 * Compute the next version given a current version and bump type.
 *
 * - major: increment major, reset minor and patch to 0
 * - minor: increment minor, reset patch to 0
 * - patch: increment patch
 */
export function computeNextVersion(
  current: { major: number; minor: number; patch: number },
  bump: BumpType,
): { major: number; minor: number; patch: number } {
  switch (bump) {
    case 'major':
      return { major: current.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case 'patch':
      return {
        major: current.major,
        minor: current.minor,
        patch: current.patch + 1,
      };
  }
}

// ---------------------------------------------------------------------------
// Unified Diff Generation
// ---------------------------------------------------------------------------

export interface DiffStats {
  added: number;
  removed: number;
}

interface EditOp {
  type: 'keep' | 'remove' | 'add';
  line: string;
}

/**
 * Compute LCS (Longest Common Subsequence) table for two string arrays.
 * Standard O(NM) dynamic programming algorithm.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Backtrack through LCS table to produce edit operations.
 */
function backtrackEdits(
  dp: number[][],
  a: string[],
  b: string[],
): EditOp[] {
  const ops: EditOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'keep', line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', line: b[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', line: a[i - 1] });
      i--;
    }
  }

  return ops.reverse();
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Group edit operations into unified diff hunks with context lines.
 */
function groupIntoHunks(ops: EditOp[], contextLines: number): Hunk[] {
  // Find indices of change operations
  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'keep') changeIndices.push(i);
  }

  if (changeIndices.length === 0) return [];

  // Group changes into hunk ranges (with context)
  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = Math.max(0, changeIndices[0] - contextLines);
  let rangeEnd = Math.min(ops.length - 1, changeIndices[0] + contextLines);

  for (let c = 1; c < changeIndices.length; c++) {
    const newStart = Math.max(0, changeIndices[c] - contextLines);
    const newEnd = Math.min(ops.length - 1, changeIndices[c] + contextLines);

    if (newStart <= rangeEnd + 1) {
      // Merge with current range
      rangeEnd = newEnd;
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = newStart;
      rangeEnd = newEnd;
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });

  // Build hunks from ranges
  const hunks: Hunk[] = [];
  for (const range of ranges) {
    // Compute line numbers: track old and new line positions
    let oldLine = 1;
    let newLine = 1;
    for (let i = 0; i < range.start; i++) {
      if (ops[i].type === 'keep' || ops[i].type === 'remove') oldLine++;
      if (ops[i].type === 'keep' || ops[i].type === 'add') newLine++;
    }

    const hunkOldStart = oldLine;
    const hunkNewStart = newLine;
    let hunkOldCount = 0;
    let hunkNewCount = 0;
    const lines: string[] = [];

    for (let i = range.start; i <= range.end; i++) {
      const op = ops[i];
      switch (op.type) {
        case 'keep':
          lines.push(` ${op.line}`);
          hunkOldCount++;
          hunkNewCount++;
          break;
        case 'remove':
          lines.push(`-${op.line}`);
          hunkOldCount++;
          break;
        case 'add':
          lines.push(`+${op.line}`);
          hunkNewCount++;
          break;
      }
    }

    hunks.push({
      oldStart: hunkOldStart,
      oldCount: hunkOldCount,
      newStart: hunkNewStart,
      newCount: hunkNewCount,
      lines,
    });
  }

  return hunks;
}

/**
 * Generate unified diff lines from two JSON strings.
 *
 * Uses line-based comparison of pretty-printed JSON.
 * Produces git-style output: ---/+++ headers, @@ hunks, -/+ prefixed lines.
 *
 * @param oldJson - Previous state as pretty-printed JSON (empty string for new state)
 * @param newJson - New state as pretty-printed JSON
 * @param oldLabel - Label for --- header (e.g., "staging v1.2.1  2024-03-08T09:15:00Z")
 * @param newLabel - Label for +++ header
 * @param contextLines - Lines of context around changes (default 3, matching git)
 * @returns Object with diff lines array and stats
 */
export function generateUnifiedDiff(
  oldJson: string,
  newJson: string,
  oldLabel: string,
  newLabel: string,
  contextLines: number = 3,
): { lines: string[]; stats: DiffStats } {
  // Split into line arrays, normalize trailing newlines
  const oldLines = oldJson ? oldJson.split('\n') : [];
  const newLines = newJson ? newJson.split('\n') : [];

  // Remove trailing empty lines from split
  while (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
  while (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();

  // If identical, return empty
  if (JSON.stringify(oldLines) === JSON.stringify(newLines)) {
    return { lines: [], stats: { added: 0, removed: 0 } };
  }

  // Compute LCS and edit script
  const dp = lcsTable(oldLines, newLines);
  const ops = backtrackEdits(dp, oldLines, newLines);

  // Group into hunks
  const hunks = groupIntoHunks(ops, contextLines);

  // Build output
  const output: string[] = [];
  output.push(`--- ${oldLabel}`);
  output.push(`+++ ${newLabel}`);

  let added = 0;
  let removed = 0;

  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    for (const line of hunk.lines) {
      output.push(line);
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }

  return { lines: output, stats: { added, removed } };
}
