/**
 * PubSubEmitter provides a path-keyed subscription registry
 * that notifies only subscribers whose path is in the changed set.
 */
export class PubSubEmitter {
  private registry = new Map<string, Set<() => void>>();

  /**
   * Subscribe a callback to a specific dot-path.
   * Returns an unsubscribe function.
   */
  subscribe(path: string, callback: () => void): () => void {
    let callbacks = this.registry.get(path);
    if (!callbacks) {
      callbacks = new Set();
      this.registry.set(path, callbacks);
    }
    callbacks.add(callback);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      const set = this.registry.get(path);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.registry.delete(path);
        }
      }
    };
  }

  /**
   * Notify all subscribers whose path is in the changed set.
   */
  emit(changedPaths: Set<string>): void {
    for (const [path, callbacks] of this.registry) {
      if (changedPaths.has(path)) {
        for (const cb of callbacks) {
          cb();
        }
      }
    }
  }

  /**
   * Total number of active subscriptions across all paths.
   */
  get size(): number {
    let count = 0;
    for (const callbacks of this.registry.values()) {
      count += callbacks.size;
    }
    return count;
  }

  /**
   * Remove all subscriptions.
   */
  clear(): void {
    this.registry.clear();
  }
}
