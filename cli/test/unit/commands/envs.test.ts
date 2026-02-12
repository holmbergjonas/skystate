import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config.js')>();
  return {
    ...actual,
    readConfigFile: vi.fn(async () => ({
      api_url: 'http://test.dev',
      default_project: 'my-project',
      default_env: '',
    })),
    resolveToken: vi.fn(async () => 'test-token'),
    writeConfig: vi.fn(async () => {}),
  };
});

vi.mock('../../../src/lib/slug-resolver.js', async () => {
  const VALID = ['development', 'staging', 'production'];
  const { CliError } = await import('../../../src/lib/errors.js');
  return {
    resolveProject: vi.fn(async () => 'uuid-proj-1'),
    resolveEnvironment: vi.fn((slug: string) => {
      if (!VALID.includes(slug)) {
        throw new CliError(
          `Invalid environment "${slug}". Must be one of: ${VALID.join(', ')}`,
        );
      }
      return slug;
    }),
  };
});

import { writeConfig } from '../../../src/lib/config.js';
import { envsCommand } from '../../../src/commands/envs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stdoutData: string;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--format <format>');
  program.option('--quiet');
  program.option('--verbose');
  program.option('--api-url <url>');
  program.option('--project <slug>');
  program.option('--env <slug>');
  program.addCommand(envsCommand);
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
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('envs list', () => {
  it('lists fixed environments locally (no API call)', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', '--project', 'my-project', 'envs', 'list'],
      { from: 'user' },
    );

    const parsed = JSON.parse(stdoutData);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((e: { slug: string }) => e.slug)).toEqual([
      'development',
      'staging',
      'production',
    ]);
  });
});

describe('envs select', () => {
  it('saves environment slug to config', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['--project', 'my-project', 'envs', 'select', 'staging'],
      { from: 'user' },
    );

    expect(writeConfig).toHaveBeenCalledWith('default_env', 'staging');
  });

  it('rejects invalid environment slug', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(
        ['--project', 'my-project', 'envs', 'select', 'invalid-env'],
        { from: 'user' },
      ),
    ).rejects.toThrow(/Invalid environment/);
  });
});
