import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from './http-client.js';
import type { ConfigEnvelope } from './types.js';
import { SkyStateError } from './error.js';

function makeEnvelope(): ConfigEnvelope {
  return {
    version: { major: 1, minor: 0, patch: 0 },
    lastModified: '2026-01-01T00:00:00Z',
    config: { features: { darkMode: true } },
  };
}

function makeResponse(
  body: unknown,
  options: { status?: number; cacheControl?: string } = {},
): Response {
  const { status = 200, cacheControl } = options;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cacheControl) {
    headers.set('Cache-Control', cacheControl);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function makeFakeDocument() {
  const listeners: Record<string, EventListener[]> = {};
  const fakeDoc = {
    addEventListener: (event: string, handler: EventListener) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener: (event: string, handler: EventListener) => {
      listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
    },
    visibilityState: 'visible' as DocumentVisibilityState,
  };
  return { fakeDoc, listeners };
}

function fireVisibilityChange(listeners: Record<string, EventListener[]>) {
  for (const handler of listeners['visibilitychange'] || []) {
    handler(new Event('visibilitychange'));
  }
}

describe('HttpClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('start() fetches from correct URL with correct headers', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(makeEnvelope()));

    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev/',
      projectSlug: 'my-project',
      environmentSlug: 'production',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.skystate.dev/project/my-project/config/production');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        'X-SkyState-Client': '@skystate/core/0.1.0',
      }),
    );

    client.dispose();
  });

  it('custom clientHeader overrides X-SkyState-Client value', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(makeEnvelope()));

    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      clientHeader: '@skystate/react/0.1.0',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-SkyState-Client']).toBe(
      '@skystate/react/0.1.0',
    );

    client.dispose();
  });

  it('successful fetch calls onUpdate with parsed response body', async () => {
    const envelope = makeEnvelope();
    fetchSpy.mockResolvedValueOnce(makeResponse(envelope));

    const onUpdate = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate,
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(envelope);

    client.dispose();
  });

  it('failed fetch (network error) calls onError', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const onError = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError,
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);

    client.dispose();
  });

  it('failed fetch (404 status) calls onError with SkyStateError', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
    );

    const onError = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError,
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SkyStateError;
    expect(error).toBeInstanceOf(SkyStateError);
    expect(error.status).toBe(404);

    client.dispose();
  });

  it('Cache-Control max-age=60 schedules re-fetch after 60 seconds', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );

    const onUpdate = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate,
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );

    // Advance 59 seconds -- should NOT re-fetch
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance 1 more second -- should re-fetch
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    client.dispose();
  });

  it('no Cache-Control header -> no scheduled re-fetch', async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(makeEnvelope()));

    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it('visibility change triggers re-fetch when cache expired', async () => {
    const { fakeDoc, listeners } = makeFakeDocument();
    vi.stubGlobal('document', fakeDoc);

    // Initial fetch with max-age=60
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );

    const onUpdate = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate,
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Let the scheduled re-fetch fire at 60s and complete
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Now the second scheduled timer will fire at 120s (60s from re-fetch).
    // Advance 59s (cache still fresh) and trigger visibility -- no re-fetch.
    vi.advanceTimersByTime(59_000);
    fakeDoc.visibilityState = 'visible';
    fireVisibilityChange(listeners);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Still 2 -- cache fresh

    // Now advance 1 more second (total 60s) -- the scheduled timer fires = re-fetch #3
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // Timer fired

    // Dispose the client and create fresh one for isolated visibility test
    client.dispose();

    // Fresh client: initial fetch, then manually expire cache and test visibility
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );
    const client2 = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj2',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });
    client2.start();
    await vi.advanceTimersByTimeAsync(0);
    const baseCalls = fetchSpy.mock.calls.length;

    // Let timer fire at 60s
    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy.mock.calls.length).toBe(baseCalls + 1);

    // Advance 59s (not 60, so timer doesn't fire). Now visibility triggers re-fetch?
    // No: 59s < 60s max-age, cache is still fresh.
    // We need to cross max-age WITHOUT the timer firing first.
    // This is impossible with fake timers since they execute at exact ms.

    // Alternative approach: verify the combined behavior.
    // After the timer fires at 60s, advance to 121s (timer fires again at 120s).
    // Between 120s and 121s, we can trigger visibility.
    // But timers fire during advanceTimersByTime so the order is:
    //   advanceTimersByTime(61_000) -> fires timer at 60s -> our visibility fires after.
    // Since the timer already refreshed, visibility sees fresh cache.

    // THE RIGHT APPROACH: The visibility re-fetch handles the case where the USER
    // was away (tab hidden) and comes back. The timer fires but the fetch may have failed
    // while the user was away. Let's simulate that:
    // 1. Timer fires (no mock response -> error)
    // 2. User comes back (visibility change)
    // 3. Cache is expired -> re-fetch
    await vi.advanceTimersByTimeAsync(60_000); // timer fires, no mock -> error
    // fetchedAt was NOT updated (error), so cache is still expired from perspective of
    // time elapsed since last successful fetch

    // Now trigger visibility change - cache should be expired
    fetchSpy.mockResolvedValueOnce(makeResponse(makeEnvelope()));
    fakeDoc.visibilityState = 'hidden';
    fireVisibilityChange(listeners);
    fakeDoc.visibilityState = 'visible';
    fireVisibilityChange(listeners);
    await vi.advanceTimersByTimeAsync(0);

    // Visibility should have triggered a re-fetch
    const finalCalls = fetchSpy.mock.calls.length;
    expect(finalCalls).toBeGreaterThan(baseCalls + 2);

    client2.dispose();
    vi.unstubAllGlobals();
  });

  it('visibility change does NOT re-fetch when cache still fresh', async () => {
    const { fakeDoc, listeners } = makeFakeDocument();
    vi.stubGlobal('document', fakeDoc);

    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );

    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 10 seconds elapsed -- cache still fresh
    vi.advanceTimersByTime(10_000);

    fakeDoc.visibilityState = 'visible';
    fireVisibilityChange(listeners);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    client.dispose();
    vi.unstubAllGlobals();
  });

  it('dispose() cancels scheduled re-fetch, removes visibility listener', async () => {
    const { fakeDoc, listeners } = makeFakeDocument();
    vi.stubGlobal('document', fakeDoc);

    fetchSpy.mockResolvedValueOnce(
      makeResponse(makeEnvelope(), { cacheControl: 'public, max-age=60' }),
    );

    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate: vi.fn(),
      onError: vi.fn(),
    });

    client.start();
    await vi.advanceTimersByTimeAsync(0);

    client.dispose();

    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(listeners['visibilitychange'] || []).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('callback after dispose is ignored (disposed flag)', async () => {
    let resolveFetch: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchSpy.mockReturnValueOnce(fetchPromise);

    const onUpdate = vi.fn();
    const client = new HttpClient({
      apiUrl: 'https://api.skystate.dev',
      projectSlug: 'proj',
      environmentSlug: 'dev',
      onUpdate,
      onError: vi.fn(),
    });

    client.start();
    client.dispose();

    resolveFetch!(makeResponse(makeEnvelope()));
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
