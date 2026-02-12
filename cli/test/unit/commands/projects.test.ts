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
      default_project: '',
      default_env: '',
    })),
    resolveToken: vi.fn(async () => 'test-token'),
    writeConfig: vi.fn(async () => {}),
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
  confirmSlug: vi.fn(async () => true),
  confirmYesNo: vi.fn(async () => true),
}));

vi.mock('../../../src/lib/slug-resolver.js', () => ({
  resolveProject: vi.fn(async () => 'uuid-proj-1'),
}));

import { writeConfig } from '../../../src/lib/config.js';
import { projectsCommand } from '../../../src/commands/projects.js';

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
  program.addCommand(projectsCommand);
  return program;
}

const sampleProjects = [
  {
    projectId: 'uuid-1',
    name: 'Project Alpha',
    slug: 'project-alpha',
    apiKeyHash: 'hash1',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
  },
  {
    projectId: 'uuid-2',
    name: 'Project Beta',
    slug: 'project-beta',
    apiKeyHash: 'hash2',
    createdAt: '2026-02-20T10:00:00Z',
    updatedAt: '2026-02-20T10:00:00Z',
  },
];

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

describe('projects list', () => {
  it('fetches projects and outputs JSON', async () => {
    mockClient.get.mockResolvedValue({
      data: sampleProjects,
      status: 200,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(['--format', 'json', 'projects', 'list'], {
      from: 'user',
    });

    expect(mockClient.get).toHaveBeenCalledWith('/projects');

    const parsed = JSON.parse(stdoutData);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Project Alpha');
    // apiKeyHash should be excluded from JSON output
    expect(parsed[0].apiKeyHash).toBeUndefined();
  });
});

describe('projects create', () => {
  it('creates project and default environments', async () => {
    mockClient.post.mockResolvedValue({
      data: { projectId: 'new-uuid' },
      status: 201,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', 'projects', 'create', 'My New Project'],
      { from: 'user' },
    );

    // First call is project creation
    const firstPostCall = mockClient.post.mock.calls[0];
    expect(firstPostCall[0]).toBe('/projects');
    expect(firstPostCall[1]).toMatchObject({
      name: 'My New Project',
      slug: 'my-new-project',
    });

    // Subsequent calls are environment creation (2 default envs)
    expect(mockClient.post).toHaveBeenCalledTimes(3); // project + 2 envs
  });
});

describe('projects get', () => {
  it('fetches project details and outputs them', async () => {
    mockClient.get.mockResolvedValue({
      data: sampleProjects[0],
      status: 200,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', 'projects', 'get', 'project-alpha'],
      { from: 'user' },
    );

    expect(mockClient.get).toHaveBeenCalledWith(
      '/projects/by-slug/project-alpha',
    );

    const parsed = JSON.parse(stdoutData);
    expect(parsed.name).toBe('Project Alpha');
    expect(parsed.slug).toBe('project-alpha');
  });
});

describe('projects delete', () => {
  it('deletes project with --force flag', async () => {
    mockClient.del.mockResolvedValue({
      data: null,
      status: 204,
      headers: new Headers(),
    });

    const program = createProgram();
    await program.parseAsync(
      ['--format', 'json', 'projects', 'delete', 'project-alpha', '--force'],
      { from: 'user' },
    );

    expect(mockClient.del).toHaveBeenCalledWith('/projects/uuid-proj-1');

    const parsed = JSON.parse(stdoutData);
    expect(parsed.deleted).toBe('project-alpha');
  });
});

describe('projects select', () => {
  it('saves slug to config as default project', async () => {
    const program = createProgram();
    await program.parseAsync(['projects', 'select', 'my-project'], {
      from: 'user',
    });

    expect(writeConfig).toHaveBeenCalledWith('default_project', 'my-project');
  });
});
