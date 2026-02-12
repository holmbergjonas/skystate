import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getConfigDir,
  getConfigPath,
  getCredentialsPath,
  validateKey,
  validateValue,
  resolveConfigValue,
  CONFIG_KEYS,
  VALID_KEY_NAMES,
} from '../../../src/lib/config.js';
import { CliError } from '../../../src/lib/errors.js';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('getConfigDir', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');
    expect(getConfigDir()).toBe('/custom/config/skystate');
  });

  it('falls back to ~/.config/skystate when XDG not set', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '');
    const dir = getConfigDir();
    expect(dir).toMatch(/\.config\/skystate$/);
  });
});

describe('getConfigPath', () => {
  it('returns config.json inside config dir', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');
    expect(getConfigPath()).toBe('/custom/config/skystate/config.json');
  });
});

describe('getCredentialsPath', () => {
  it('returns credentials.json inside config dir', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');
    expect(getCredentialsPath()).toBe(
      '/custom/config/skystate/credentials.json',
    );
  });
});

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

describe('validateKey', () => {
  it('accepts all valid keys', () => {
    for (const key of VALID_KEY_NAMES) {
      expect(() => validateKey(key)).not.toThrow();
    }
  });

  it('throws CliError for unknown key', () => {
    expect(() => validateKey('nonexistent')).toThrow(CliError);
  });

  it('includes "Did you mean" suggestion for close matches', () => {
    try {
      validateKey('formt'); // close to 'format'
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain('Did you mean');
    }
  });

  it('lists valid keys in error message', () => {
    try {
      validateKey('zzzzz');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain('api_url');
    }
  });
});

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

describe('validateValue', () => {
  it('accepts valid format values', () => {
    expect(() => validateValue('format', 'json')).not.toThrow();
    expect(() => validateValue('format', 'table')).not.toThrow();
    expect(() => validateValue('format', 'plain')).not.toThrow();
  });

  it('throws CliError for invalid format value', () => {
    expect(() => validateValue('format', 'xml')).toThrow(CliError);
  });

  it('accepts any value for keys without validation', () => {
    expect(() => validateValue('api_url', 'anything')).not.toThrow();
    expect(() => validateValue('default_project', '')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Config value resolution
// ---------------------------------------------------------------------------

describe('resolveConfigValue', () => {
  it('returns env var value with source "env" when set', () => {
    vi.stubEnv('SKYSTATE_API_URL', 'https://custom.api');
    const result = resolveConfigValue('api_url');
    expect(result.value).toBe('https://custom.api');
    expect(result.source).toBe('env');
  });

  it('returns config file value with source "config" when present', () => {
    vi.stubEnv('SKYSTATE_API_URL', '');
    // Clear the env var entirely by deleting it
    delete process.env.SKYSTATE_API_URL;
    const result = resolveConfigValue('api_url', {
      api_url: 'https://file.api',
    });
    expect(result.value).toBe('https://file.api');
    expect(result.source).toBe('config');
  });

  it('returns default value with source "default" when no override', () => {
    delete process.env.SKYSTATE_API_URL;
    const result = resolveConfigValue('api_url');
    expect(result.value).toBe(CONFIG_KEYS.api_url.default);
    expect(result.source).toBe('default');
  });

  it('env var takes priority over config file', () => {
    vi.stubEnv('SKYSTATE_API_URL', 'https://env.api');
    const result = resolveConfigValue('api_url', {
      api_url: 'https://file.api',
    });
    expect(result.value).toBe('https://env.api');
    expect(result.source).toBe('env');
  });

  it('throws CliError for unknown key', () => {
    expect(() => resolveConfigValue('unknown_key')).toThrow(CliError);
  });

  it('returns correct key in result', () => {
    const result = resolveConfigValue('default_project');
    expect(result.key).toBe('default_project');
  });
});
