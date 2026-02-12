import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@/lib/api-error';

// Mock dependencies
vi.mock('@/lib/env', () => ({
  env: {
    VITE_API_BASE_URL: 'http://localhost:5148',
    VITE_TEST_MODE: false,
  },
}));

const mockGetAuthHeaders = vi.fn((): Record<string, string> => ({ 'Authorization': 'Bearer test-token' }));
const mockClearToken = vi.fn();

vi.mock('@/lib/auth', () => ({
  getAuthHeaders: () => mockGetAuthHeaders(),
  clearToken: () => mockClearToken(),
}));

import { api } from '@/lib/api';

describe('api', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    mockGetAuthHeaders.mockReturnValue({ 'Authorization': 'Bearer test-token' });
    mockClearToken.mockReset();

    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON for successful GET request', async () => {
    const responseData = [{ projectId: 'p1', name: 'Test' }];
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await api.projects.list();
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5148/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        }),
      }),
    );
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await api.projects.delete('p1');
    expect(result).toBeUndefined();
  });

  it('throws ApiError and redirects on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(api.projects.list()).rejects.toThrow(ApiError);
    expect(mockClearToken).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
  });

  it('throws ApiError with parsed body on 4xx/5xx with JSON', async () => {
    const errorBody = { message: 'Not found', code: 'NOT_FOUND' };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve(errorBody),
    });

    try {
      await api.projects.list();
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.statusText).toBe('Not Found');
      expect(err.errorBody).toEqual(errorBody);
    }
  });

  it('throws ApiError with null errorBody on non-JSON error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not JSON')),
    });

    try {
      await api.projects.list();
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(500);
      expect(err.errorBody).toBeNull();
    }
  });

  it('sends POST with JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ projectId: 'new-1', slug: 'test' }),
    });

    await api.projects.create({ name: 'Test Project', slug: 'test-project', apiKeyHash: 'hash123' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5148/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test Project', slug: 'test-project', apiKeyHash: 'hash123' }),
      }),
    );
  });

  it('merges auth headers into fetch call', async () => {
    mockGetAuthHeaders.mockReturnValue({ 'X-Test-GitHub-Id': 'gh-1' });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await api.users.getCurrent();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Test-GitHub-Id': 'gh-1',
      }),
    );
  });

  it('passes AbortSignal through to fetch', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    await api.environments.list('proj-1', controller.signal);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].signal).toBe(controller.signal);
  });
});
