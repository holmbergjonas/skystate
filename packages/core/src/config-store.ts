import type { ConfigStoreOptions, ConfigEnvelope } from './types.js';
import { ConfigCache } from './config-cache.js';
import { PubSubEmitter } from './pubsub.js';
import { HttpClient } from './http-client.js';

/**
 * Reserved path that always fires on any state change (isLoading, error, lastFetched).
 * React hooks in Phase 3 subscribe to this path for status updates.
 */
const STATUS_PATH = '__status';

/**
 * Module-level singleton registry keyed by `${apiUrl}|${projectSlug}|${environmentSlug}`.
 */
const storeRegistry = new Map<string, ConfigStore>();

function buildRegistryKey(options: ConfigStoreOptions): string {
  return `${options.apiUrl}|${options.projectSlug}|${options.environmentSlug}`;
}

/**
 * ConfigStore composes ConfigCache + PubSubEmitter + HttpClient into the public API.
 * subscribe() and getSnapshot() are useSyncExternalStore-compatible.
 */
export class ConfigStore {
  private readonly cache: ConfigCache;
  private readonly pubsub: PubSubEmitter;
  private readonly http: HttpClient;
  private _isLoading = true;
  private _error: Error | null = null;
  private _lastFetched: Date | null = null;
  private _disposed = false;
  private _registryKey: string;
  private _initialLoadComplete = false;

  constructor(options: ConfigStoreOptions) {
    this._registryKey = buildRegistryKey(options);
    this.cache = new ConfigCache();
    this.pubsub = new PubSubEmitter();

    // Seed cache with initialConfig if provided
    if (options.initialConfig !== undefined) {
      const syntheticEnvelope: ConfigEnvelope = {
        version: { major: 0, minor: 0, patch: 0 },
        lastModified: new Date().toISOString(),
        config: options.initialConfig,
      };
      this.cache.update(syntheticEnvelope);
    }

    this.http = new HttpClient({
      apiUrl: options.apiUrl,
      projectSlug: options.projectSlug,
      environmentSlug: options.environmentSlug,
      clientHeader: options.clientHeader,
      onUpdate: (envelope) => this.handleUpdate(envelope),
      onError: (error) => this.handleError(error),
    });

    this.http.start();
  }

  /**
   * Subscribe a callback to a specific dot-path.
   * Returns an unsubscribe function (useSyncExternalStore-compatible).
   */
  subscribe(path: string, callback: () => void): () => void {
    return this.pubsub.subscribe(path, callback);
  }

  /**
   * Get value at a dot-separated path. Returns stable reference (useSyncExternalStore-compatible).
   */
  getSnapshot(path: string): unknown {
    return this.cache.get(path);
  }

  /**
   * Whether the store is currently loading data.
   */
  get isLoading(): boolean {
    return this._isLoading;
  }

  /**
   * Last error encountered, or null.
   */
  get error(): Error | null {
    return this._error;
  }

  /**
   * Timestamp of the last successful fetch, or null.
   */
  get lastFetched(): Date | null {
    return this._lastFetched;
  }

  /**
   * Clean up all resources: HttpClient, PubSubEmitter, and singleton registry entry.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this.http.dispose();
    this.pubsub.clear();

    // Remove from singleton registry
    storeRegistry.delete(this._registryKey);
  }

  private handleUpdate(envelope: ConfigEnvelope): void {
    if (this._disposed) return;

    const changedPaths = this.cache.update(envelope);
    this._isLoading = false;
    this._error = null;
    this._lastFetched = new Date();
    this._initialLoadComplete = true;

    // Emit changed paths + STATUS_PATH so status subscribers are notified
    const pathSet = new Set(changedPaths);
    pathSet.add(STATUS_PATH);
    this.pubsub.emit(pathSet);
  }

  private handleError(error: Error): void {
    if (this._disposed) return;

    this._error = error;

    // If initial load hasn't completed, mark loading as false
    if (!this._initialLoadComplete) {
      this._isLoading = false;
      this._initialLoadComplete = true;
    }

    // Notify status subscribers of error state change
    this.pubsub.emit(new Set([STATUS_PATH]));
  }
}

/**
 * Get or create a ConfigStore singleton for the given options tuple.
 * Stores are keyed by (apiUrl, projectSlug, environmentSlug).
 * dispose() removes the store from the registry so a fresh instance is created on next call.
 */
export function getOrCreateStore(options: ConfigStoreOptions): ConfigStore {
  const key = buildRegistryKey(options);
  const existing = storeRegistry.get(key);
  if (existing) return existing;

  const store = new ConfigStore(options);
  storeRegistry.set(key, store);
  return store;
}
