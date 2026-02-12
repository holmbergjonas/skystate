import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthError,
  LimitError,
  RateLimitError,
  NetworkError,
  ApiError,
} from '../../../src/lib/errors.js';

// Mock config.resolveToken
vi.mock('../../../src/lib/config.js', () => ({
  resolveToken: vi.fn(),
}));

import { resolveToken } from '../../../src/lib/config.js';
import { createHttpClient } from '../../../src/lib/http-client.js';

const mockedResolveToken = vi.mocked(resolveToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(opts?: { verbose?: boolean }) {
  return createHttpClient({
    apiUrl: 'https://api.test.dev',
    verbose: opts?.verbose ?? false,
    version: '0.1.0-test',
  });
}

function mockFetchResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  const responseHeaders = new Headers(headers);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : status === 204 ? 'No Content' : 'Error',
      headers: responseHeaders,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

beforeEach(() => {
  mockedResolveToken.mockResolvedValue('test-token-abc123');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createHttpClient', () => {
  it('returns an object with get, post, put, del methods', () => {
    const client = makeClient();
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.del).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// HTTP methods
// ---------------------------------------------------------------------------

describe('HTTP methods', () => {
  it('GET sends correct method', async () => {
    mockFetchResponse(200, { ok: true });
    const client = makeClient();
    await client.get('/test');

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.test.dev/test');
    expect(fetchCall[1]?.method).toBe('GET');
  });

  it('POST sends correct method and body', async () => {
    mockFetchResponse(200, { id: '123' });
    const client = makeClient();
    await client.post('/items', { name: 'test' });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe('POST');
    expect(fetchCall[1]?.body).toBe(JSON.stringify({ name: 'test' }));
  });

  it('PUT sends correct method', async () => {
    mockFetchResponse(200, { updated: true });
    const client = makeClient();
    await client.put('/items/1', { name: 'updated' });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe('PUT');
  });

  it('DELETE sends correct method', async () => {
    mockFetchResponse(204, null);
    const client = makeClient();
    await client.del('/items/1');

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]?.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// Auth header
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('attaches Authorization header when token available', async () => {
    mockFetchResponse(200, {});
    const client = makeClient();
    await client.get('/test');

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token-abc123');
  });

  it('throws AuthError when no token and auth not disabled', async () => {
    mockedResolveToken.mockResolvedValue(null);
    const client = makeClient();

    await expect(client.get('/test')).rejects.toThrow(AuthError);
  });

  it('skips auth when auth=false', async () => {
    mockedResolveToken.mockResolvedValue(null);
    mockFetchResponse(200, { public: true });
    const client = makeClient();
    await client.get('/public', { auth: false });

    // Should not throw since auth is disabled
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe('error classification', () => {
  it('throws AuthError on 401', async () => {
    mockFetchResponse(401, { message: 'Unauthorized' });
    const client = makeClient();
    await expect(client.get('/test')).rejects.toThrow(AuthError);
  });

  it('throws LimitError on 402', async () => {
    mockFetchResponse(402, { message: 'Project limit reached' });
    const client = makeClient();
    await expect(client.get('/test')).rejects.toThrow(LimitError);
  });

  it('throws RateLimitError on 429', async () => {
    mockFetchResponse(429, {
      message: 'Rate limit exceeded',
      resetAt: '2026-04-01',
    });
    const client = makeClient();
    await expect(client.get('/test')).rejects.toThrow(RateLimitError);
  });

  it('throws ApiError on 5xx', async () => {
    mockFetchResponse(500, { message: 'Internal Server Error' });
    const client = makeClient();

    try {
      await client.get('/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('throws ApiError on other 4xx with parsed message', async () => {
    mockFetchResponse(422, { message: 'Validation failed' });
    const client = makeClient();

    try {
      await client.get('/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Validation failed');
    }
  });
});

// ---------------------------------------------------------------------------
// 204 No Content
// ---------------------------------------------------------------------------

describe('204 response', () => {
  it('returns null data for 204', async () => {
    mockFetchResponse(204, null);
    const client = makeClient();
    const result = await client.del('/items/1');
    expect(result.data).toBeNull();
    expect(result.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe('network errors', () => {
  it('throws NetworkError on TypeError (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const client = makeClient();
    await expect(client.get('/test')).rejects.toThrow(NetworkError);
  });

  it('throws NetworkError on timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new DOMException('Signal timed out', 'TimeoutError');
        throw err;
      }),
    );
    const client = makeClient();
    await expect(client.get('/test', { timeout: 1 })).rejects.toThrow(
      NetworkError,
    );
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe('retry logic', () => {
  it('retries on NetworkError', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          json: async () => ({ ok: true }),
          text: async () => '{"ok":true}',
        };
      }),
    );
    // Mock stderr to suppress retry message
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const client = makeClient();
    const result = await client.get<{ ok: boolean }>('/test');
    expect(result.data.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('retries on 5xx', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers(),
            json: async () => ({}),
            text: async () => '{"message":"unavailable"}',
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          json: async () => ({ ok: true }),
          text: async () => '{"ok":true}',
        };
      }),
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const client = makeClient();
    const result = await client.get<{ ok: boolean }>('/test');
    expect(result.data.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('does not retry on 4xx (non-retryable)', async () => {
    mockFetchResponse(422, { message: 'Bad request' });
    const client = makeClient();
    await expect(client.get('/test')).rejects.toThrow(ApiError);

    // Only 1 call (no retry)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
