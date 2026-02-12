import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HttpClient } from '../../../src/lib/http-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    get: vi.fn() as unknown as HttpClient['get'] & ReturnType<typeof vi.fn>,
    post: vi.fn() as unknown as HttpClient['post'] & ReturnType<typeof vi.fn>,
    put: vi.fn() as unknown as HttpClient['put'] & ReturnType<typeof vi.fn>,
    del: vi.fn() as unknown as HttpClient['del'] & ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// resolveProject
// ---------------------------------------------------------------------------

describe('resolveProject', () => {
  it('returns projectId from API response', async () => {
    // Use vi.resetModules + dynamic import to get fresh module (clear cache)
    vi.resetModules();
    const { resolveProject } = await import('../../../src/lib/slug-resolver.js');

    const client = createMockClient();
    client.get.mockResolvedValue({
      data: { projectId: 'uuid-123', name: 'My Project', slug: 'my-project' },
      status: 200,
      headers: new Headers(),
    });

    const result = await resolveProject(client, 'my-project');
    expect(result).toBe('uuid-123');
    expect(client.get).toHaveBeenCalledWith('/projects/by-slug/my-project');
  });

  it('caches result for subsequent calls', async () => {
    vi.resetModules();
    const { resolveProject } = await import('../../../src/lib/slug-resolver.js');

    const client = createMockClient();
    client.get.mockResolvedValue({
      data: { projectId: 'uuid-456', name: 'Cached', slug: 'cached' },
      status: 200,
      headers: new Headers(),
    });

    await resolveProject(client, 'cached');
    await resolveProject(client, 'cached');

    // Only one API call -- second was served from cache
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('throws CliError on 404', async () => {
    vi.resetModules();
    const errors = await import('../../../src/lib/errors.js');
    const { resolveProject } = await import('../../../src/lib/slug-resolver.js');

    const client = createMockClient();
    client.get.mockRejectedValue(new errors.ApiError(404, 'Not found'));

    await expect(resolveProject(client, 'nonexistent')).rejects.toThrow(
      errors.CliError,
    );
  });

  it('re-throws non-404 errors unchanged', async () => {
    vi.resetModules();
    const errors = await import('../../../src/lib/errors.js');
    const { resolveProject } = await import('../../../src/lib/slug-resolver.js');

    const client = createMockClient();
    const serverError = new errors.ApiError(500, 'Server error');
    client.get.mockRejectedValue(serverError);

    await expect(resolveProject(client, 'test')).rejects.toThrow(serverError);
  });
});

// ---------------------------------------------------------------------------
// resolveEnvironment (now local validation, no API call)
// ---------------------------------------------------------------------------

describe('resolveEnvironment', () => {
  it('returns the slug for valid environments', async () => {
    vi.resetModules();
    const { resolveEnvironment } = await import('../../../src/lib/slug-resolver.js');

    expect(resolveEnvironment('development')).toBe('development');
    expect(resolveEnvironment('staging')).toBe('staging');
    expect(resolveEnvironment('production')).toBe('production');
  });

  it('throws CliError for invalid environment slug', async () => {
    vi.resetModules();
    const errors = await import('../../../src/lib/errors.js');
    const { resolveEnvironment } = await import('../../../src/lib/slug-resolver.js');

    expect(() => resolveEnvironment('invalid-env')).toThrow(errors.CliError);
  });

  it('includes valid environments in error message', async () => {
    vi.resetModules();
    const { resolveEnvironment } = await import('../../../src/lib/slug-resolver.js');

    try {
      resolveEnvironment('custom-env');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('development');
      expect((err as Error).message).toContain('staging');
      expect((err as Error).message).toContain('production');
    }
  });
});
