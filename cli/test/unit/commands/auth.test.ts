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
    })),
    resolveToken: vi.fn(async () => 'test-token'),
    resolveTokenWithSource: vi.fn(),
    writeCredentials: vi.fn(async () => {}),
  };
});

vi.mock('../../../src/lib/spinner.js', () => ({
  withSpinner: vi.fn(async (_msg: string, fn: () => Promise<unknown>) => fn()),
}));

import { resolveTokenWithSource } from '../../../src/lib/config.js';
import { statusCommand, logoutCommand } from '../../../src/commands/auth.js';

const mockedResolveTokenWithSource = vi.mocked(resolveTokenWithSource);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stdoutData: string;
let stderrData: string;

function createProgramForStatus(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--format <format>');
  program.option('--quiet');
  program.option('--verbose');
  program.option('--api-url <url>');
  program.addCommand(statusCommand);
  return program;
}

function createProgramForLogout(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--verbose');
  program.addCommand(logoutCommand);
  return program;
}

beforeEach(() => {
  stdoutData = '';
  stderrData = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stdoutData +=
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      stderrData +=
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  );
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth status (unauthenticated)', () => {
  it('reports not authenticated when no token', async () => {
    mockedResolveTokenWithSource.mockResolvedValue(null);

    const program = createProgramForStatus();
    await program.parseAsync(['status'], { from: 'user' });

    expect(stderrData).toContain('Not authenticated');
    expect(process.exitCode).toBe(2);

    // Reset exitCode for other tests
    process.exitCode = undefined;
  });
});

describe('auth status (authenticated)', () => {
  it('displays user info and billing status', async () => {
    mockedResolveTokenWithSource.mockResolvedValue({
      token: 'test-token',
      source: 'credentials',
    });

    mockClient.get.mockImplementation(async (path: string) => {
      if (path === '/users/me') {
        return {
          data: {
            userId: 'user-1',
            email: 'user@test.com',
            displayName: 'Test User',
            ssoProvider: 'github',
            subscriptionTier: 'pro',
            boostMultiplier: 1,
          },
          status: 200,
          headers: new Headers(),
        };
      }
      if (path === '/billing/status') {
        return {
          data: {
            tier: 'pro',
            boostMultiplier: 1,
            projects: { count: 3, limit: 25 },
            environments: { count: 5, limit: 100 },
            storage: { bytes: 1048576, limit: 104857600 },
            apiRequests: {
              count: 500,
              limit: 25000,
              resetDate: '2026-04-01',
            },
          },
          status: 200,
          headers: new Headers(),
        };
      }
      return { data: null, status: 404, headers: new Headers() };
    });

    const program = createProgramForStatus();
    await program.parseAsync(['--format', 'json', 'status'], { from: 'user' });

    const parsed = JSON.parse(stdoutData);
    expect(parsed.email).toBe('user@test.com');
    expect(parsed.tier).toBe('pro');
    expect(parsed.projects).toBe('3/25');
  });
});

describe('auth logout', () => {
  it('attempts to remove credentials file', async () => {
    // Mock fs.promises.unlink
    vi.mock('node:fs/promises', () => ({
      unlink: vi.fn(async () => {}),
    }));

    const program = createProgramForLogout();
    await program.parseAsync(['logout'], { from: 'user' });

    expect(stderrData).toContain('Logged out');
    expect(stderrData).toContain('credentials');
  });
});
