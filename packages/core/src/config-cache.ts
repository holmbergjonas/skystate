import type { ConfigEnvelope } from './types.js';

/**
 * Resolve a dot-separated path against an object.
 * Empty string returns the object itself.
 */
function getByPath(obj: unknown, path: string): unknown {
  if (path === '') return obj;

  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Recursively compare prev and next, returning prev's reference
 * when values are deeply equal (structural sharing).
 */
function structuralShare(prev: unknown, next: unknown): unknown {
  // Identical reference or primitive equality — keep prev
  if (Object.is(prev, next)) return prev;

  // If either is null/undefined or not an object, they differ — use next
  if (
    prev === null ||
    prev === undefined ||
    next === null ||
    next === undefined ||
    typeof prev !== 'object' ||
    typeof next !== 'object'
  ) {
    return next;
  }

  // Both are arrays
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return next;

    let allSame = true;
    const shared = new Array<unknown>(next.length);
    for (let i = 0; i < next.length; i++) {
      shared[i] = structuralShare(prev[i], next[i]);
      if (!Object.is(shared[i], prev[i])) {
        allSame = false;
      }
    }
    return allSame ? prev : shared;
  }

  // One is array, other is not
  if (Array.isArray(prev) !== Array.isArray(next)) {
    return next;
  }

  // Both are plain objects
  const prevObj = prev as Record<string, unknown>;
  const nextObj = next as Record<string, unknown>;
  const prevKeys = Object.keys(prevObj);
  const nextKeys = Object.keys(nextObj);

  if (prevKeys.length !== nextKeys.length) {
    // Different key count — rebuild with sharing where possible
    const result: Record<string, unknown> = {};
    for (const key of nextKeys) {
      result[key] =
        key in prevObj ? structuralShare(prevObj[key], nextObj[key]) : nextObj[key];
    }
    return result;
  }

  let allSame = true;
  const result: Record<string, unknown> = {};
  for (const key of nextKeys) {
    if (!(key in prevObj)) {
      result[key] = nextObj[key];
      allSame = false;
    } else {
      result[key] = structuralShare(prevObj[key], nextObj[key]);
      if (!Object.is(result[key], prevObj[key])) {
        allSame = false;
      }
    }
  }

  return allSame ? prev : result;
}

/**
 * Collect all dot-paths of an object (leaves + intermediate nodes + root "").
 */
function collectAllPaths(obj: unknown, prefix: string = ''): string[] {
  const paths: string[] = [prefix]; // Include the node itself

  if (obj !== null && obj !== undefined && typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const childPath = prefix === '' ? key : `${prefix}.${key}`;
      paths.push(...collectAllPaths(record[key], childPath));
    }
  }

  return paths;
}

/**
 * Walk two object trees and collect paths where Object.is returns false.
 * Includes ancestor paths when any descendant changed.
 */
function collectChangedPaths(
  prev: unknown,
  next: unknown,
  prefix: string = '',
): string[] {
  if (Object.is(prev, next)) return [];

  // If either is not an object or is null, the path itself changed
  if (
    prev === null ||
    prev === undefined ||
    next === null ||
    next === undefined ||
    typeof prev !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(prev) ||
    Array.isArray(next)
  ) {
    return [prefix];
  }

  // Both are plain objects — recurse
  const prevObj = prev as Record<string, unknown>;
  const nextObj = next as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);

  const childChanges: string[] = [];
  for (const key of allKeys) {
    const childPath = prefix === '' ? key : `${prefix}.${key}`;
    childChanges.push(...collectChangedPaths(prevObj[key], nextObj[key], childPath));
  }

  // If any child changed, include this node
  if (childChanges.length > 0) {
    return [prefix, ...childChanges];
  }

  return [];
}

/**
 * ConfigCache stores config in memory with stable object identity
 * for unchanged paths via structural sharing.
 */
export class ConfigCache {
  private envelope: ConfigEnvelope | null = null;
  private config: unknown = undefined;

  /**
   * Update cache with new envelope data.
   * Returns list of changed dot-paths (including root "" if anything changed).
   */
  update(envelope: ConfigEnvelope): string[] {
    const newConfig = envelope.config;

    if (this.envelope === null) {
      // First update — everything is new
      this.config = newConfig;
      this.envelope = { ...envelope, config: this.config };
      return collectAllPaths(newConfig, '');
    }

    // Structural share against previous config
    const shared = structuralShare(this.config, newConfig);

    // Collect changed paths by walking both trees
    const changedPaths = collectChangedPaths(this.config, shared, '');

    // Update stored config
    this.config = shared;
    this.envelope = { ...envelope, config: this.config };

    return changedPaths;
  }

  /**
   * Get value at a dot-separated path. Returns stable reference.
   * Empty string returns the entire config.
   */
  get(path: string): unknown {
    return getByPath(this.config, path);
  }

  /**
   * Get entire config (same as get("")).
   */
  getConfig(): unknown {
    return this.config;
  }

  /**
   * Get full envelope, or null if no data has been loaded.
   */
  getEnvelope(): ConfigEnvelope | null {
    return this.envelope;
  }
}
