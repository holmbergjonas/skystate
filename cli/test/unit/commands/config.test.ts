import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import type { HttpClient } from '../../../src/lib/http-client.js';

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

const mockClient = {
  get: vi.fn() as unknown as HttpClient['get'] & ReturnType<typeof vi.fn>,
  post: vi.fn() as unknown as HttpClient['post'] & ReturnType<typeof vi.fn>,
  put: vi.fn() as unknown as HttpClient['put'] & ReturnType<typeof vi.fn>,
  del: vi.fn() as unknown as HttpClient['del'] & ReturnType<typeof vi.fn>,
};

vi.mock('../../../src/lib/http-client.js', () => ({
  createHttpClient: vi.fn(() => mockClient),
}));

vi.mock('../../../src/lib/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config.js')>();
  return {
    ...actual,
    readConfigFile: vi.fn(async () => ({
      api_url: 'http://test.dev',
      default_project: 'my-project',
      default_env: 'staging',
    })),
    resolveToken: vi.fn(async () => 'test-token'),
  };
});

vi.mock('../../../src/lib/spinner.js', () => ({
  withSpinner: vi.fn(async (_msg: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../../src/lib/version.js', () => ({
  getVersion: vi.fn(async () => '0.1.0-test'),
}));

vi.mock('../../../src/lib/prompt.js', () => ({
  requireInteractive: vi.fn(),
  confirmYesNo: vi.fn(async () => true),
}));

vi.mock('../../../src/lib/slug-resolver.js', () => ({
  resolveProject: vi.fn(async () => 'uuid-proj-1'),
  resolveEnvironment: vi.fn((slug: string) => slug),
}));

import { configCommand } from '../../../src/commands/config.js';

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
  program.addCommand(configCommand);
  return program;
}

function makeSampleConfig(overrides?: Partial<{
  major: number;
  minor: number;
  patch: number;
  state: string;
  comment: string | null;
}>) {
  return {
    projectStateId: 'config-uuid-1',
    projectId: 'uuid-proj-1',
    environment: 'staging',
    major: overrides?.major ?? 1,
    minor: overrides?.minor ?? 2,
    patch: overrides?.patch ?? 3,
    state: overrides?.state ?? '{"count":42}',
    comment: overrides?.comment ?? null,
    createdAt: '2026-02-28T10:00:00Z',
    stateSizeBytes: 64,
  };
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

describe('config get', () => {
  it('fetches latest config and outputs JSON envelope', async () => {
    mockClient.get.mockResolvedValue({
      data: makeSampleConfig(),
      status: 200,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', '--project', 'my-project', '--env', 'staging', 'config', 'get'],
      { from: 'user' },
    );

    expect(mockClient.get).toHaveBeenCalledWith(
      '/project/uuid-proj-1/config/staging/latest',
    );

    const parsed = JSON.parse(stdoutData);
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.data).toEqual({ count: 42 });
  });
});

describe('config history', () => {
  it('fetches version history and outputs list', async () => {
    const configs = [
      makeSampleConfig({ major: 1, minor: 2, patch: 3 }),
      makeSampleConfig({ major: 1, minor: 2, patch: 2, comment: 'fix' }),
      makeSampleConfig({ major: 1, minor: 2, patch: 1 }),
    ];

    mockClient.get.mockResolvedValue({
      data: configs,
      status: 200,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', '--project', 'my-project', '--env', 'staging', 'config', 'history'],
      { from: 'user' },
    );

    const parsed = JSON.parse(stdoutData);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].version).toBe('1.2.3');
    expect(parsed[1].comment).toBe('fix');
  });
});

describe('config push', () => {
  it('pushes new config with auto-detected bump', async () => {
    // Mock: current latest config
    mockClient.get.mockResolvedValue({
      data: makeSampleConfig({ state: '{"count":42}' }),
      status: 200,
      headers: new Headers(),
    });

    // Mock: POST push result
    mockClient.post.mockResolvedValue({
      data: { projectConfigId: 'new-config-uuid' },
      status: 201,
      headers: new Headers(),
    });

    // Write a temp file to push
    const { writeFileSync, mkdtempSync, rmdirSync, unlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tempDir = mkdtempSync(join(tmpdir(), 'skystate-test-'));
    const tempFile = join(tempDir, 'config.json');
    writeFileSync(tempFile, '{"count":99}', 'utf8');

    try {
      const program = createProgram();
      await program.parseAsync(
        [
          '--format', 'json',
          '--project', 'my-project',
          '--env', 'staging',
          'config', 'push', tempFile,
        ],
        { from: 'user' },
      );

      // Verify the POST was called with correct data
      expect(mockClient.post).toHaveBeenCalledWith(
        '/project/uuid-proj-1/config/staging',
        expect.objectContaining({
          Major: 1,
          Minor: 2,
          Patch: 4, // patch bump since only value changed
          State: '{"count":99}',
        }),
      );

      const parsed = JSON.parse(stdoutData);
      expect(parsed.version).toBe('1.2.4');
      expect(parsed.bump).toBe('patch');
    } finally {
      unlinkSync(tempFile);
      rmdirSync(tempDir);
    }
  });

  it('uses explicit bump type when --bump is provided', async () => {
    mockClient.get.mockResolvedValue({
      data: makeSampleConfig({ state: '{"count":42}' }),
      status: 200,
      headers: new Headers(),
    });

    mockClient.post.mockResolvedValue({
      data: { projectConfigId: 'new-config-uuid' },
      status: 201,
      headers: new Headers(),
    });

    const { writeFileSync, mkdtempSync, rmdirSync, unlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tempDir = mkdtempSync(join(tmpdir(), 'skystate-test-'));
    const tempFile = join(tempDir, 'config.json');
    writeFileSync(tempFile, '{"count":99}', 'utf8');

    try {
      const program = createProgram();
      await program.parseAsync(
        [
          '--format', 'json',
          '--project', 'my-project',
          '--env', 'staging',
          'config', 'push', tempFile,
          '--bump', 'major',
        ],
        { from: 'user' },
      );

      expect(mockClient.post).toHaveBeenCalledWith(
        '/project/uuid-proj-1/config/staging',
        expect.objectContaining({
          Major: 2,
          Minor: 0,
          Patch: 0,
        }),
      );

      const parsed = JSON.parse(stdoutData);
      expect(parsed.version).toBe('2.0.0');
      expect(parsed.bump).toBe('major');
    } finally {
      unlinkSync(tempFile);
      rmdirSync(tempDir);
    }
  });
});

describe('config diff', () => {
  it('generates diff between two versions', async () => {
    const configV1 = makeSampleConfig({
      major: 1,
      minor: 0,
      patch: 0,
      state: '{"name":"Alice","count":1}',
    });
    const configV2 = makeSampleConfig({
      major: 1,
      minor: 0,
      patch: 1,
      state: '{"name":"Alice","count":2}',
    });

    // Mock the get calls for history and specific versions
    mockClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/latest')) {
        return { data: configV2, status: 200, headers: new Headers() };
      }
      // History endpoint returns all versions
      return {
        data: [configV2, configV1],
        status: 200,
        headers: new Headers(),
      };
    });

    const program = createProgram();
    await program.parseAsync(
      [
        '--project', 'my-project',
        '--env', 'staging',
        'config', 'diff',
      ],
      { from: 'user' },
    );

    expect(mockClient.get).toHaveBeenCalled();
  });
});
