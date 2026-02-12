// ---------------------------------------------------------------------------
// Recursive JSON Structural Diff Engine
// ---------------------------------------------------------------------------

type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'structural';

export interface DiffLine {
  left: string;
  right: string;
  status: DiffStatus;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
  hasTypeChange: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad = (depth: number): string => '  '.repeat(depth);

/**
 * Format any JSON value as indented lines (like JSON.stringify split by line).
 * Used for removed-only and added-only subtrees.
 */
function formatValue(value: unknown, depth: number, isLast: boolean): string[] {
  if (value === null || typeof value !== 'object') {
    const comma = isLast ? '' : ',';
    return [`${pad(depth)}${JSON.stringify(value)}${comma}`];
  }

  if (Array.isArray(value)) {
    const lines: string[] = [];
    lines.push(`${pad(depth)}[`);
    for (let i = 0; i < value.length; i++) {
      const childLines = formatValue(value[i], depth + 1, i === value.length - 1);
      lines.push(...childLines);
    }
    const comma = isLast ? '' : ',';
    lines.push(`${pad(depth)}]${comma}`);
    return lines;
  }

  // Object
  const keys = Object.keys(value as Record<string, unknown>);
  const lines: string[] = [];
  lines.push(`${pad(depth)}{`);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = (value as Record<string, unknown>)[k];
    const last = i === keys.length - 1;

    if (v !== null && typeof v === 'object') {
      // Nested object/array: key prefix on first line, then children
      if (Array.isArray(v)) {
        lines.push(`${pad(depth + 1)}"${k}": [`);
        for (let j = 0; j < v.length; j++) {
          const childLines = formatValue(v[j], depth + 2, j === v.length - 1);
          lines.push(...childLines);
        }
        const comma = last ? '' : ',';
        lines.push(`${pad(depth + 1)}]${comma}`);
      } else {
        lines.push(`${pad(depth + 1)}"${k}": {`);
        const objKeys = Object.keys(v as Record<string, unknown>);
        for (let j = 0; j < objKeys.length; j++) {
          const childLines = formatValue(
            (v as Record<string, unknown>)[objKeys[j]],
            depth + 2,
            j === objKeys.length - 1,
          );
          // Prepend key to the first child line
          const firstLine = childLines[0];
          const trimmed = firstLine.trimStart();
          childLines[0] = `${pad(depth + 2)}"${objKeys[j]}": ${trimmed}`;
          lines.push(...childLines);
        }
        const comma = last ? '' : ',';
        lines.push(`${pad(depth + 1)}}${comma}`);
      }
    } else {
      const comma = last ? '' : ',';
      lines.push(`${pad(depth + 1)}"${k}": ${JSON.stringify(v)}${comma}`);
    }
  }
  const comma = isLast ? '' : ',';
  lines.push(`${pad(depth)}}${comma}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Core recursive walk
// ---------------------------------------------------------------------------

function walkValue(
  left: unknown,
  right: unknown,
  depth: number,
  isLast: boolean,
  stats: DiffStats,
): DiffLine[] {
  const lines: DiffLine[] = [];
  const comma = isLast ? '' : ',';

  const leftType = left === null ? 'null' : Array.isArray(left) ? 'array' : typeof left;
  const rightType = right === null ? 'null' : Array.isArray(right) ? 'array' : typeof right;

  // Both undefined — shouldn't happen, but guard
  if (left === undefined && right === undefined) return lines;

  // Only in left (removed)
  if (right === undefined) {
    const formatted = formatValue(left, depth, isLast);
    for (const line of formatted) {
      lines.push({ left: line, right: '', status: 'removed' });
      stats.removed++;
    }
    return lines;
  }

  // Only in right (added)
  if (left === undefined) {
    const formatted = formatValue(right, depth, isLast);
    for (const line of formatted) {
      lines.push({ left: '', right: line, status: 'added' });
      stats.added++;
    }
    return lines;
  }

  // Type mismatch: format each side independently
  if (leftType !== rightType) {
    stats.hasTypeChange = true;
    const leftFormatted = formatValue(left, depth, isLast);
    const rightFormatted = formatValue(right, depth, isLast);
    const maxLen = Math.max(leftFormatted.length, rightFormatted.length);
    for (let i = 0; i < maxLen; i++) {
      const l = leftFormatted[i] ?? '';
      const r = rightFormatted[i] ?? '';
      const status: DiffStatus = l && r ? 'changed' : l ? 'removed' : 'added';
      lines.push({ left: l, right: r, status });
      if (status === 'changed') stats.changed++;
      else if (status === 'removed') stats.removed++;
      else if (status === 'added') stats.added++;
    }
    return lines;
  }

  // Both objects
  if (leftType === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const leftObj = left as Record<string, unknown>;
    const rightObj = right as Record<string, unknown>;
    const allKeys = Array.from(new Set([...Object.keys(leftObj), ...Object.keys(rightObj)])).sort();

    const openBrace = `${pad(depth)}{`;
    lines.push({ left: openBrace, right: openBrace, status: 'structural' });

    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      const lv = leftObj[key];
      const rv = rightObj[key];
      const keyIsLast = i === allKeys.length - 1;

      const hasLeft = key in leftObj;
      const hasRight = key in rightObj;

      if (hasLeft && hasRight) {
        // Both sides have this key
        const lvIsObj = lv !== null && typeof lv === 'object';
        const rvIsObj = rv !== null && typeof rv === 'object';

        if (lvIsObj && rvIsObj && Array.isArray(lv) === Array.isArray(rv)) {
          // Both are same container type — recurse with key prefix
          const isArr = Array.isArray(lv);
          const openText = `${pad(depth + 1)}"${key}": ${isArr ? '[' : '{'}`;
          lines.push({ left: openText, right: openText, status: 'structural' });

          if (isArr) {
            const leftArr = lv as unknown[];
            const rightArr = rv as unknown[];
            const maxLen = Math.max(leftArr.length, rightArr.length);
            for (let j = 0; j < maxLen; j++) {
              const childLines = walkValue(
                j < leftArr.length ? leftArr[j] : undefined,
                j < rightArr.length ? rightArr[j] : undefined,
                depth + 2,
                j === maxLen - 1,
                stats,
              );
              lines.push(...childLines);
            }
          } else {
            const childLines = walkObjectEntries(
              lv as Record<string, unknown>,
              rv as Record<string, unknown>,
              depth + 2,
              stats,
            );
            lines.push(...childLines);
          }

          const keyComma = keyIsLast ? '' : ',';
          const closeText = `${pad(depth + 1)}${isArr ? ']' : '}'}${keyComma}`;
          lines.push({ left: closeText, right: closeText, status: 'structural' });
        } else if (!lvIsObj && !rvIsObj) {
          // Both primitives
          const keyComma = keyIsLast ? '' : ',';
          if (lv === rv) {
            const text = `${pad(depth + 1)}"${key}": ${JSON.stringify(lv)}${keyComma}`;
            lines.push({ left: text, right: text, status: 'unchanged' });
          } else {
            const leftText = `${pad(depth + 1)}"${key}": ${JSON.stringify(lv)}${keyComma}`;
            const rightText = `${pad(depth + 1)}"${key}": ${JSON.stringify(rv)}${keyComma}`;
            lines.push({ left: leftText, right: rightText, status: 'changed' });
            stats.changed++;
          }
        } else {
          // Type mismatch at this key (one is obj/arr, other is primitive/null)
          stats.hasTypeChange = true;
          const keyComma = keyIsLast ? '' : ',';
          const leftFormatted = formatKeyValue(key, lv, depth + 1, keyComma);
          const rightFormatted = formatKeyValue(key, rv, depth + 1, keyComma);
          const maxLen = Math.max(leftFormatted.length, rightFormatted.length);
          for (let m = 0; m < maxLen; m++) {
            const l = leftFormatted[m] ?? '';
            const r = rightFormatted[m] ?? '';
            const status: DiffStatus = l && r ? 'changed' : l ? 'removed' : 'added';
            lines.push({ left: l, right: r, status });
            if (status === 'changed') stats.changed++;
            else if (status === 'removed') stats.removed++;
            else if (status === 'added') stats.added++;
          }
        }
      } else if (hasLeft && !hasRight) {
        // Removed key
        const keyComma = keyIsLast ? '' : ',';
        const formatted = formatKeyValue(key, lv, depth + 1, keyComma);
        for (const line of formatted) {
          lines.push({ left: line, right: '', status: 'removed' });
          stats.removed++;
        }
      } else {
        // Added key
        const keyComma = keyIsLast ? '' : ',';
        const formatted = formatKeyValue(key, rv, depth + 1, keyComma);
        for (const line of formatted) {
          lines.push({ left: '', right: line, status: 'added' });
          stats.added++;
        }
      }
    }

    const closeBrace = `${pad(depth)}}${comma}`;
    lines.push({ left: closeBrace, right: closeBrace, status: 'structural' });
    return lines;
  }

  // Both arrays
  if (Array.isArray(left) && Array.isArray(right)) {
    const openBracket = `${pad(depth)}[`;
    lines.push({ left: openBracket, right: openBracket, status: 'structural' });

    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      const childLines = walkValue(
        i < left.length ? left[i] : undefined,
        i < right.length ? right[i] : undefined,
        depth + 1,
        i === maxLen - 1,
        stats,
      );
      lines.push(...childLines);
    }

    const closeBracket = `${pad(depth)}]${comma}`;
    lines.push({ left: closeBracket, right: closeBracket, status: 'structural' });
    return lines;
  }

  // Both primitives (same type)
  if (left === right) {
    const text = `${pad(depth)}${JSON.stringify(left)}${comma}`;
    lines.push({ left: text, right: text, status: 'unchanged' });
  } else {
    const leftText = `${pad(depth)}${JSON.stringify(left)}${comma}`;
    const rightText = `${pad(depth)}${JSON.stringify(right)}${comma}`;
    lines.push({ left: leftText, right: rightText, status: 'changed' });
    stats.changed++;
  }

  return lines;
}

/**
 * Walk sorted union of object entries (used inside recursive container diff).
 */
function walkObjectEntries(
  leftObj: Record<string, unknown>,
  rightObj: Record<string, unknown>,
  depth: number,
  stats: DiffStats,
): DiffLine[] {
  const allKeys = Array.from(new Set([...Object.keys(leftObj), ...Object.keys(rightObj)])).sort();
  const lines: DiffLine[] = [];

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i];
    const lv = leftObj[key];
    const rv = rightObj[key];
    const keyIsLast = i === allKeys.length - 1;

    const hasLeft = key in leftObj;
    const hasRight = key in rightObj;

    if (hasLeft && hasRight) {
      const lvIsObj = lv !== null && typeof lv === 'object';
      const rvIsObj = rv !== null && typeof rv === 'object';

      if (lvIsObj && rvIsObj && Array.isArray(lv) === Array.isArray(rv)) {
        const isArr = Array.isArray(lv);
        const openText = `${pad(depth)}"${key}": ${isArr ? '[' : '{'}`;
        lines.push({ left: openText, right: openText, status: 'structural' });

        if (isArr) {
          const leftArr = lv as unknown[];
          const rightArr = rv as unknown[];
          const maxLen = Math.max(leftArr.length, rightArr.length);
          for (let j = 0; j < maxLen; j++) {
            const childLines = walkValue(
              j < leftArr.length ? leftArr[j] : undefined,
              j < rightArr.length ? rightArr[j] : undefined,
              depth + 1,
              j === maxLen - 1,
              stats,
            );
            lines.push(...childLines);
          }
        } else {
          const childLines = walkObjectEntries(
            lv as Record<string, unknown>,
            rv as Record<string, unknown>,
            depth + 1,
            stats,
          );
          lines.push(...childLines);
        }

        const keyComma = keyIsLast ? '' : ',';
        const closeText = `${pad(depth)}${isArr ? ']' : '}'}${keyComma}`;
        lines.push({ left: closeText, right: closeText, status: 'structural' });
      } else if (!lvIsObj && !rvIsObj) {
        const keyComma = keyIsLast ? '' : ',';
        if (lv === rv) {
          const text = `${pad(depth)}"${key}": ${JSON.stringify(lv)}${keyComma}`;
          lines.push({ left: text, right: text, status: 'unchanged' });
        } else {
          const leftText = `${pad(depth)}"${key}": ${JSON.stringify(lv)}${keyComma}`;
          const rightText = `${pad(depth)}"${key}": ${JSON.stringify(rv)}${keyComma}`;
          lines.push({ left: leftText, right: rightText, status: 'changed' });
          stats.changed++;
        }
      } else {
        // Type mismatch at this key
        stats.hasTypeChange = true;
        const keyComma = keyIsLast ? '' : ',';
        const leftFormatted = formatKeyValue(key, lv, depth, keyComma);
        const rightFormatted = formatKeyValue(key, rv, depth, keyComma);
        const maxLen = Math.max(leftFormatted.length, rightFormatted.length);
        for (let m = 0; m < maxLen; m++) {
          const l = leftFormatted[m] ?? '';
          const r = rightFormatted[m] ?? '';
          const status: DiffStatus = l && r ? 'changed' : l ? 'removed' : 'added';
          lines.push({ left: l, right: r, status });
          if (status === 'changed') stats.changed++;
          else if (status === 'removed') stats.removed++;
          else if (status === 'added') stats.added++;
        }
      }
    } else if (hasLeft && !hasRight) {
      const keyComma = keyIsLast ? '' : ',';
      const formatted = formatKeyValue(key, lv, depth, keyComma);
      for (const line of formatted) {
        lines.push({ left: line, right: '', status: 'removed' });
        stats.removed++;
      }
    } else {
      const keyComma = keyIsLast ? '' : ',';
      const formatted = formatKeyValue(key, rv, depth, keyComma);
      for (const line of formatted) {
        lines.push({ left: '', right: line, status: 'added' });
        stats.added++;
      }
    }
  }

  return lines;
}

/**
 * Format "key": value as lines (handles nested objects/arrays).
 */
function formatKeyValue(key: string, value: unknown, depth: number, trailingComma: string): string[] {
  if (value === null || typeof value !== 'object') {
    return [`${pad(depth)}"${key}": ${JSON.stringify(value)}${trailingComma}`];
  }

  if (Array.isArray(value)) {
    const lines: string[] = [];
    lines.push(`${pad(depth)}"${key}": [`);
    for (let i = 0; i < value.length; i++) {
      const childLines = formatValue(value[i], depth + 1, i === value.length - 1);
      lines.push(...childLines);
    }
    lines.push(`${pad(depth)}]${trailingComma}`);
    return lines;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const lines: string[] = [];
  lines.push(`${pad(depth)}"${key}": {`);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = obj[k];
    const last = i === keys.length - 1;
    const childComma = last ? '' : ',';
    const childLines = formatKeyValue(k, v, depth + 1, childComma);
    lines.push(...childLines);
  }
  lines.push(`${pad(depth)}}${trailingComma}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build paired left/right diff lines from two JSON strings.
 * Returns lines array and aggregate stats.
 */
export function buildLines(leftJson: string, rightJson: string): { lines: DiffLine[]; stats: DiffStats } {
  const left: unknown = JSON.parse(leftJson);
  const right: unknown = JSON.parse(rightJson);
  const stats: DiffStats = { added: 0, removed: 0, changed: 0, hasTypeChange: false };

  const lines = walkValue(left, right, 0, true, stats);

  return { lines, stats };
}
