/**
 * HTTP client wrapper with auth, timeout, retry, error classification, and verbose logging.
 *
 * All authenticated CLI commands use this module to talk to the SkyState API.
 * Token resolution comes from config.ts (SKYSTATE_TOKEN env var or credentials.json).
 */

import { resolveToken } from './config.js';
import {
  AuthError,
  LimitError,
  RateLimitError,
  NetworkError,
  ApiError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
  auth?: boolean;
}

interface HttpClientConfig {
  apiUrl: string;
  verbose: boolean;
  version: string;
}

export interface HttpClient {
  get<T>(
    path: string,
    opts?: Omit<RequestOptions, 'method'>,
  ): Promise<HttpResponse<T>>;
  post<T>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
  put<T>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>>;
  del<T>(
    path: string,
    opts?: Omit<RequestOptions, 'method'>,
  ): Promise<HttpResponse<T>>;
}

// ---------------------------------------------------------------------------
// Verbose logging helpers (curl-like, all to stderr)
// ---------------------------------------------------------------------------

function redactToken(authHeader: string): string {
  const parts = authHeader.split(' ');
  if (parts.length < 2) return authHeader;
  const token = parts[1];
  if (token.length <= 6) return `Bearer ***`;
  return `Bearer ${token.slice(0, 3)}***...***${token.slice(-3)}`;
}

function logRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
): void {
  const parsed = new URL(url);
  process.stderr.write(`> ${method} ${parsed.pathname} HTTP/1.1\n`);
  process.stderr.write(`> Host: ${parsed.host}\n`);
  for (const [key, value] of Object.entries(headers)) {
    const display =
      key.toLowerCase() === 'authorization' ? redactToken(value) : value;
    process.stderr.write(`> ${key}: ${display}\n`);
  }
  process.stderr.write('>\n');
}

function logResponse(response: Response, elapsedMs: number): void {
  process.stderr.write(
    `< HTTP/1.1 ${response.status} ${response.statusText}\n`,
  );

  const interestingHeaders = ['content-type', 'content-length'];
  for (const [key, value] of response.headers) {
    if (
      interestingHeaders.includes(key.toLowerCase()) ||
      key.toLowerCase().startsWith('x-ratelimit-')
    ) {
      process.stderr.write(`< ${key}: ${value}\n`);
    }
  }
  process.stderr.write(`* Request completed in ${Math.round(elapsedMs)}ms\n`);
}

// ---------------------------------------------------------------------------
// Debug logging (enabled by --verbose)
// ---------------------------------------------------------------------------

function debug(config: HttpClientConfig, msg: string): void {
  if (config.verbose) {
    process.stderr.write(`[debug:http] ${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

async function handleHttpError(response: Response): Promise<never> {
  const body = await response.text();
  const { status } = response;

  if (status === 401) {
    throw new AuthError('Session expired.', 'Run: skystate auth login');
  }

  if (status === 402) {
    let message = 'Limit exceeded';
    try {
      const parsed = JSON.parse(body) as {
        message?: string;
        code?: string;
      };
      message =
        parsed.message ?? (parsed.code ? `Limit: ${parsed.code}` : message);
    } catch {
      // use default message
    }
    throw new LimitError(message, 'Run: skystate billing upgrade pro');
  }

  if (status === 429) {
    let message = 'Rate limit exceeded';
    let resetDate: string | undefined;
    try {
      const parsed = JSON.parse(body) as {
        message?: string;
        resetAt?: string;
      };
      message = parsed.message ?? message;
      resetDate = parsed.resetAt;
    } catch {
      // use default message
    }
    throw new RateLimitError(message, resetDate);
  }

  if (status >= 500 && status < 600) {
    throw new ApiError(status, 'Server error -- try again later', body, 1);
  }

  // Other 4xx
  let message = 'Request failed';
  try {
    const parsed = JSON.parse(body) as { message?: string };
    message = parsed.message ?? message;
  } catch {
    // use default message
  }
  throw new ApiError(status, message, body, 1);
}

// ---------------------------------------------------------------------------
// Internal request function
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  opts: RequestOptions,
  config: HttpClientConfig,
): Promise<HttpResponse<T>> {
  const method = opts.method ?? 'GET';
  const timeout = opts.timeout ?? 10_000;
  const auth = opts.auth !== false;

  const base = config.apiUrl.replace(/\/+$/, '');
  const url = `${base}${path}`;

  const headers: Record<string, string> = {
    'User-Agent': `skystate-cli/${config.version}`,
    Accept: 'application/json',
  };

  // Test auth mode: when SKYSTATE_TEST_AUTH_GITHUB_ID is set, send test auth
  // headers instead of bearer token. Used by E2E tests to authenticate against
  // the API's TestAuthHandler without needing real OAuth credentials.
  const testGithubId = process.env.SKYSTATE_TEST_AUTH_GITHUB_ID;
  if (auth && testGithubId) {
    debug(config, `using test auth headers (github_id=${testGithubId})`);
    headers['X-Test-GitHub-Id'] = testGithubId;
    const testEmail = process.env.SKYSTATE_TEST_AUTH_EMAIL;
    if (testEmail) headers['X-Test-Email'] = testEmail;
    const testName = process.env.SKYSTATE_TEST_AUTH_NAME;
    if (testName) headers['X-Test-Name'] = testName;
  } else if (auth) {
    debug(config, `resolving auth token (auth=${auth})`);
    const token = await resolveToken();
    if (!token) {
      debug(config, 'no token found, throwing AuthError');
      throw new AuthError(
        'Not authenticated.',
        'Run: skystate auth login',
      );
    }
    headers['Authorization'] = `Bearer ${token}`;
    debug(config, 'auth token attached');
  } else {
    debug(config, 'skipping auth (auth=false)');
  }

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (config.verbose) {
    logRequest(method, url, headers);
  }

  const startTime = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err: unknown) {
    if (
      err instanceof DOMException &&
      err.name === 'TimeoutError'
    ) {
      debug(config, `request timed out after ${timeout}ms`);
      throw new NetworkError('Request timed out after 10s');
    }
    debug(config, `network error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof TypeError) {
      throw new NetworkError();
    }
    throw new NetworkError();
  }

  const elapsedMs = performance.now() - startTime;

  if (config.verbose) {
    logResponse(response, elapsedMs);
  }

  if (!response.ok) {
    debug(config, `response not ok: ${response.status} ${response.statusText}`);
    await handleHttpError(response);
  }

  if (response.status === 204) {
    debug(config, '204 No Content, returning null body');
    return { data: null as T, status: response.status, headers: response.headers };
  }

  const data = (await response.json()) as T;
  debug(config, `${method} ${path} completed: ${response.status} in ${Math.round(elapsedMs)}ms`);
  return { data, status: response.status, headers: response.headers };
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError && err.status >= 500) return true;
  return false;
}

async function requestWithRetry<T>(
  path: string,
  opts: RequestOptions,
  config: HttpClientConfig,
): Promise<HttpResponse<T>> {
  try {
    return await request<T>(path, opts, config);
  } catch (err: unknown) {
    if (isRetryable(err)) {
      debug(config, `retryable error (${err instanceof Error ? err.message : String(err)}), retrying in 1s`);
      process.stderr.write('Authenticating...\n');
      await new Promise((r) => setTimeout(r, 1000));
      return await request<T>(path, opts, config);
    }
    debug(config, `non-retryable error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHttpClient(config: HttpClientConfig): HttpClient {
  return {
    get<T>(
      path: string,
      opts?: Omit<RequestOptions, 'method'>,
    ): Promise<HttpResponse<T>> {
      return requestWithRetry<T>(path, { ...opts, method: 'GET' }, config);
    },

    post<T>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'method' | 'body'>,
    ): Promise<HttpResponse<T>> {
      return requestWithRetry<T>(
        path,
        { ...opts, method: 'POST', body },
        config,
      );
    },

    put<T>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'method' | 'body'>,
    ): Promise<HttpResponse<T>> {
      return requestWithRetry<T>(
        path,
        { ...opts, method: 'PUT', body },
        config,
      );
    },

    del<T>(
      path: string,
      opts?: Omit<RequestOptions, 'method'>,
    ): Promise<HttpResponse<T>> {
      return requestWithRetry<T>(path, { ...opts, method: 'DELETE' }, config);
    },
  };
}
