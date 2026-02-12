import type { ConfigEnvelope } from './types.js';
import { SkyStateError } from './error.js';

const CLIENT_VERSION = '0.1.0';
const DEFAULT_CLIENT_HEADER = `@skystate/core/${CLIENT_VERSION}`;

export type OnUpdateCallback = (envelope: ConfigEnvelope) => void;
export type OnErrorCallback = (error: Error) => void;

export interface HttpClientOptions {
  apiUrl: string;
  projectSlug: string;
  environmentSlug: string;
  clientHeader?: string;
  onUpdate: OnUpdateCallback;
  onError: OnErrorCallback;
}

/**
 * HttpClient handles HTTP fetch with Cache-Control max-age scheduling
 * and page visibility re-fetch for @skystate/core.
 */
export class HttpClient {
  private readonly apiUrl: string;
  private readonly projectSlug: string;
  private readonly environmentSlug: string;
  private readonly clientHeader: string;
  private readonly onUpdate: OnUpdateCallback;
  private readonly onError: OnErrorCallback;

  private fetchedAt = 0;
  private maxAgeMs = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private visibilityHandler: (() => void) | null = null;
  private disposed = false;

  constructor(options: HttpClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.projectSlug = options.projectSlug;
    this.environmentSlug = options.environmentSlug;
    this.clientHeader = options.clientHeader ?? DEFAULT_CLIENT_HEADER;
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
  }

  /**
   * Begin the initial fetch and set up the visibility listener.
   */
  start(): void {
    this.setupVisibilityListener();
    this.doFetch();
  }

  /**
   * Cancel timers, remove listeners, abort in-flight fetch, mark as disposed.
   */
  dispose(): void {
    this.disposed = true;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private buildUrl(): string {
    return `${this.apiUrl}/project/${this.projectSlug}/config/${this.environmentSlug}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-SkyState-Client': this.clientHeader,
    };
  }

  private async doFetch(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.buildUrl(), {
        headers: this.buildHeaders(),
        signal: this.abortController.signal,
      });

      if (this.disposed) return;

      if (!response.ok) {
        this.onError(
          new SkyStateError(
            'fetch_failed',
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
          ),
        );
        return;
      }

      const envelope = (await response.json()) as ConfigEnvelope;
      if (this.disposed) return;

      this.fetchedAt = Date.now();
      this.maxAgeMs = this.parseMaxAge(response) * 1000;

      this.onUpdate(envelope);
      this.scheduleRefetch();
    } catch (error: unknown) {
      if (this.disposed) return;

      // Abort errors are expected during dispose -- ignore them
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Parse max-age value from Cache-Control header.
   * Returns 0 if no max-age directive is present.
   */
  private parseMaxAge(response: Response): number {
    const cacheControl = response.headers.get('Cache-Control');
    if (!cacheControl) return 0;

    const match = /max-age=(\d+)/.exec(cacheControl);
    if (!match) return 0;

    return parseInt(match[1], 10);
  }

  /**
   * Schedule a re-fetch after maxAgeMs. No-op if maxAgeMs is 0.
   */
  private scheduleRefetch(): void {
    if (this.maxAgeMs <= 0 || this.disposed) return;

    this.timerId = setTimeout(() => {
      if (!this.disposed) {
        this.doFetch();
      }
    }, this.maxAgeMs);
  }

  /**
   * Guard browser APIs for SSR/Node safety, then attach visibilitychange listener.
   */
  private setupVisibilityListener(): void {
    if (typeof document === 'undefined') return;

    this.visibilityHandler = () => {
      this.onVisibilityChange();
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * On visibility change to "visible", re-fetch if cache is expired.
   * Does NOT fetch when the page is hidden.
   */
  private onVisibilityChange(): void {
    if (this.disposed) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    // Only re-fetch if we have a max-age and it has expired
    if (this.maxAgeMs <= 0) return;
    if (this.fetchedAt === 0) return;

    const elapsed = Date.now() - this.fetchedAt;
    if (elapsed >= this.maxAgeMs) {
      // Cancel any existing scheduled re-fetch to avoid duplicates
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.doFetch();
    }
  }
}
