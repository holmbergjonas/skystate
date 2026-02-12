import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config.js')>();
  return {
    ...actual,
    readConfigFile: vi.fn(async () => ({})),
    writeConfig: vi.fn(async () => {}),
    listConfigValues: vi.fn(async () => [
      { key: 'api_url', value: 'https://api.skystate.dev', source: 'default' as const },
      { key: 'default_project', value: '', source: 'default' as const },
      { key: 'default_env', value: '', source: 'default' as const },
      { key: 'format', value: 'table', source: 'default' as const },
    ]),
  };
});

import { writeConfig, listConfigValues } from '../../../src/lib/config.js';
import { settingsCommand } from '../../../src/commands/settings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stdoutData: string;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(settingsCommand);
  return program;
}

beforeEach(() => {
  stdoutData = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stdoutData +=
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settings set', () => {
  it('validates key and writes config', async () => {
    const program = createProgram();
    await program.parseAsync(['settings', 'set', 'format', 'json'], { from: 'user' });

    expect(writeConfig).toHaveBeenCalledWith('format', 'json');
    expect(stdoutData).toContain('Set format = json');
  });

  it('throws for invalid key', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['settings', 'set', 'badkey', 'value'], { from: 'user' }),
    ).rejects.toThrow(/Unknown key/);
  });

  it('throws for invalid format value', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['settings', 'set', 'format', 'xml'], { from: 'user' }),
    ).rejects.toThrow(/Invalid value/);
  });
});

describe('settings get', () => {
  it('outputs resolved settings value', async () => {
    const program = createProgram();
    await program.parseAsync(['settings', 'get', 'api_url'], { from: 'user' });

    expect(stdoutData).toContain('https://api.skystate.dev');
  });
});

describe('settings list', () => {
  it('calls listConfigValues and produces output', async () => {
    const program = createProgram();
    // Need to set format explicitly to avoid TTY detection issues
    program.option('--format <format>');
    await program.parseAsync(['--format', 'json', 'settings', 'list'], {
      from: 'user',
    });

    expect(listConfigValues).toHaveBeenCalled();
    expect(stdoutData.length).toBeGreaterThan(0);
  });
});

describe('settings path', () => {
  it('outputs settings file path', async () => {
    const program = createProgram();
    await program.parseAsync(['settings', 'path'], { from: 'user' });

    expect(stdoutData).toContain('config.json');
  });
});
