/**
 * Config file management, path resolution, key validation, and token resolution.
 *
 * Config file: ~/.config/skystate/config.json (or $XDG_CONFIG_HOME/skystate/config.json)
 * Credentials file: ~/.config/skystate/credentials.json
 *
 * Resolution priority: env var > config file > default
 */

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { closest, distance } from 'fastest-levenshtein';
import { CliError } from './errors.js';

// ---------------------------------------------------------------------------
// Config key definitions
// ---------------------------------------------------------------------------

interface ConfigKeyDef {
  default: string;
  envVar?: string;
  validate?: (value: string) => string | null; // returns error message or null
}

export const CONFIG_KEYS: Record<string, ConfigKeyDef> = {
  api_url: {
    default: 'https://api.skystate.dev',
    envVar: 'SKYSTATE_API_URL',
  },
  default_project: {
    default: '',
  },
  default_env: {
    default: '',
  },
  format: {
    default: 'table',
    validate: (v: string) => {
      const valid = ['json', 'table', 'plain'];
      if (!valid.includes(v)) {
        return `Invalid value "${v}" for format. Valid: json, table, plain`;
      }
      return null;
    },
  },
};

export const VALID_KEY_NAMES = Object.keys(CONFIG_KEYS);

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), '.config');
  return join(base, 'skystate');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

// ---------------------------------------------------------------------------
// Key validation with did-you-mean
// ---------------------------------------------------------------------------

export function validateKey(key: string): void {
  if (VALID_KEY_NAMES.includes(key)) return;

  let msg = `Unknown key "${key}". Valid keys: ${VALID_KEY_NAMES.join(', ')}`;

  const suggestion = closest(key, VALID_KEY_NAMES);
  if (suggestion && distance(key, suggestion) <= 3) {
    msg += `. Did you mean "${suggestion}"?`;
  }

  throw new CliError(msg);
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

export function validateValue(key: string, value: string): void {
  const def = CONFIG_KEYS[key];
  if (!def?.validate) return;

  const error = def.validate(value);
  if (error) {
    throw new CliError(error);
  }
}

// ---------------------------------------------------------------------------
// Config file read/write
// ---------------------------------------------------------------------------

export async function readConfigFile(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(getConfigPath(), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new CliError(
        `Config file is corrupt. Delete it with: rm ${getConfigPath()}`,
      );
    }
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export async function writeConfig(key: string, value: string): Promise<void> {
  const config = await readConfigFile();
  config[key] = value;

  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf8',
  });
}

export async function writeCredentials(token: string): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const credPath = getCredentialsPath();
  const data = JSON.stringify({ token }, null, 2) + '\n';
  await writeFile(credPath, data, { encoding: 'utf8', mode: 0o600 });
  // Safety net against umask stripping permissions
  await chmod(credPath, 0o600);
}

// ---------------------------------------------------------------------------
// Config value resolution
// ---------------------------------------------------------------------------

export interface ConfigValue {
  key: string;
  value: string;
  source: 'default' | 'config' | 'env';
}

export function resolveConfigValue(
  key: string,
  configFile?: Record<string, string>,
): ConfigValue {
  const def = CONFIG_KEYS[key];
  if (!def) {
    throw new CliError(`Unknown config key: ${key}`);
  }

  // Priority: env var > config file > default
  if (def.envVar) {
    const envVal = process.env[def.envVar];
    if (envVal !== undefined) {
      return { key, value: envVal, source: 'env' };
    }
  }

  if (configFile && key in configFile) {
    return { key, value: configFile[key], source: 'config' };
  }

  return { key, value: def.default, source: 'default' };
}

export async function listConfigValues(): Promise<ConfigValue[]> {
  const configFile = await readConfigFile();
  return VALID_KEY_NAMES.map((key) => resolveConfigValue(key, configFile));
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export async function resolveToken(): Promise<string | null> {
  // Check env var first
  const envToken = process.env.SKYSTATE_TOKEN;
  if (envToken) return envToken;

  // Then check credentials file
  try {
    const raw = await readFile(getCredentialsPath(), 'utf8');
    const creds = JSON.parse(raw) as { token?: string };
    return creds.token ?? null;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    if (err instanceof SyntaxError) {
      throw new CliError(
        `Credentials file is corrupt. Delete it with: rm ${getCredentialsPath()}`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Token resolution with source
// ---------------------------------------------------------------------------

export interface TokenInfo {
  token: string;
  source: 'env' | 'credentials';
}

/**
 * Resolve token with source information for auth status display.
 * Same resolution logic as resolveToken() but returns source context.
 */
export async function resolveTokenWithSource(): Promise<TokenInfo | null> {
  // Check env var first
  const envToken = process.env.SKYSTATE_TOKEN;
  if (envToken) return { token: envToken, source: 'env' };

  // Then check credentials file
  try {
    const raw = await readFile(getCredentialsPath(), 'utf8');
    const creds = JSON.parse(raw) as { token?: string };
    if (creds.token) return { token: creds.token, source: 'credentials' };
    return null;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    if (err instanceof SyntaxError) {
      throw new CliError(
        `Credentials file is corrupt. Delete it with: rm ${getCredentialsPath()}`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
