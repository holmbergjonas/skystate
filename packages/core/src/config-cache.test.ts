import { describe, it, expect } from 'vitest';
import { ConfigCache } from './config-cache.js';
import type { ConfigEnvelope } from './types.js';

function makeEnvelope(config: unknown): ConfigEnvelope {
  return {
    version: { major: 1, minor: 0, patch: 0 },
    lastModified: '2026-01-01T00:00:00Z',
    config,
  };
}

describe('ConfigCache', () => {
  it('first update returns all paths as changed', () => {
    const cache = new ConfigCache();
    const envelope = makeEnvelope({
      features: { darkMode: true, beta: false },
      limits: { maxUsers: 100 },
    });

    const changed = cache.update(envelope);

    expect(changed).toContain('');
    expect(changed).toContain('features');
    expect(changed).toContain('features.darkMode');
    expect(changed).toContain('features.beta');
    expect(changed).toContain('limits');
    expect(changed).toContain('limits.maxUsers');
  });

  it('identical update returns empty changedPaths and preserves identity', () => {
    const cache = new ConfigCache();
    const config = {
      features: { darkMode: true, beta: false },
      limits: { maxUsers: 100 },
    };

    cache.update(makeEnvelope(config));
    const prevFeatures = cache.get('features');
    const prevLimits = cache.get('limits');
    const prevRoot = cache.getConfig();

    const changed = cache.update(makeEnvelope(config));

    expect(changed).toEqual([]);
    expect(Object.is(cache.get('features'), prevFeatures)).toBe(true);
    expect(Object.is(cache.get('limits'), prevLimits)).toBe(true);
    expect(Object.is(cache.getConfig(), prevRoot)).toBe(true);
  });

  it('change one nested key returns only affected paths, sibling keeps reference', () => {
    const cache = new ConfigCache();
    const initial = {
      features: { darkMode: true, beta: false },
      limits: { maxUsers: 100 },
    };

    cache.update(makeEnvelope(initial));
    const prevLimits = cache.get('limits');

    const updated = {
      features: { darkMode: false, beta: false },
      limits: { maxUsers: 100 },
    };
    const changed = cache.update(makeEnvelope(updated));

    // Changed paths: root, features, features.darkMode
    expect(changed).toContain('');
    expect(changed).toContain('features');
    expect(changed).toContain('features.darkMode');

    // Sibling subtree should NOT be in changed paths
    expect(changed).not.toContain('limits');
    expect(changed).not.toContain('limits.maxUsers');
    expect(changed).not.toContain('features.beta');

    // Sibling reference should be preserved
    expect(Object.is(cache.get('limits'), prevLimits)).toBe(true);
  });

  it('get("deep.nested.path") traverses correctly', () => {
    const cache = new ConfigCache();
    cache.update(
      makeEnvelope({
        deep: { nested: { path: 'found it' } },
      }),
    );

    expect(cache.get('deep.nested.path')).toBe('found it');
    expect(cache.get('deep.nested')).toEqual({ path: 'found it' });
    expect(cache.get('deep')).toEqual({ nested: { path: 'found it' } });
  });

  it('get("nonexistent.path") returns undefined', () => {
    const cache = new ConfigCache();
    cache.update(makeEnvelope({ a: 1 }));

    expect(cache.get('nonexistent.path')).toBeUndefined();
    expect(cache.get('a.b.c')).toBeUndefined();
  });

  it('array positional comparison preserves identity for same elements', () => {
    const cache = new ConfigCache();
    const initial = { items: [1, 2, 3] };
    cache.update(makeEnvelope(initial));
    const prevItems = cache.get('items');

    // Same array contents
    const same = { items: [1, 2, 3] };
    const changed = cache.update(makeEnvelope(same));

    expect(changed).toEqual([]);
    expect(Object.is(cache.get('items'), prevItems)).toBe(true);

    // Different array contents
    const different = { items: [1, 2, 4] };
    const changed2 = cache.update(makeEnvelope(different));

    expect(changed2).toContain('items');
  });

  it('getEnvelope() returns null before any update', () => {
    const cache = new ConfigCache();
    expect(cache.getEnvelope()).toBeNull();
  });

  it('update() with changed config returns root "" in changedPaths', () => {
    const cache = new ConfigCache();
    cache.update(makeEnvelope({ a: 1 }));

    const changed = cache.update(makeEnvelope({ a: 2 }));
    expect(changed).toContain('');
  });

  it('getConfig() returns same as get("")', () => {
    const cache = new ConfigCache();
    const config = { x: 1, y: 2 };
    cache.update(makeEnvelope(config));

    expect(cache.getConfig()).toEqual(cache.get(''));
    expect(Object.is(cache.getConfig(), cache.get(''))).toBe(true);
  });

  it('getEnvelope() returns full envelope after update', () => {
    const cache = new ConfigCache();
    const envelope = makeEnvelope({ a: 1 });
    cache.update(envelope);

    const result = cache.getEnvelope();
    expect(result).not.toBeNull();
    expect(result!.version).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(result!.lastModified).toBe('2026-01-01T00:00:00Z');
    expect(result!.config).toEqual({ a: 1 });
  });

  it('handles null values in config', () => {
    const cache = new ConfigCache();
    cache.update(makeEnvelope({ a: null, b: { c: null } }));

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b.c')).toBeNull();
  });

  it('handles primitive config values', () => {
    const cache = new ConfigCache();
    cache.update(makeEnvelope('just a string'));

    expect(cache.getConfig()).toBe('just a string');
    expect(cache.get('')).toBe('just a string');
  });
});
