// Module-level reactive store for API availability status.
// Zero dependencies — no React, no Zustand — safe to import from api.ts without circular deps.
// Implements the useSyncExternalStore contract for React integration.

let available = true;
let dismissed = false;
let consecutiveFailures = 0;
const FAILURE_THRESHOLD = 2;
const listeners = new Set<() => void>();

// Cached snapshot object — useSyncExternalStore uses Object.is comparison,
// so we must return the same reference when nothing has changed.
let snapshot = { available: true, dismissed: false };

function emit() {
  snapshot = { available, dismissed };
  for (const listener of listeners) listener();
}

export function setApiAvailable(isAvailable: boolean): void {
  if (isAvailable) {
    consecutiveFailures = 0;
    if (!available) {
      available = true;
      dismissed = false;
      emit();
    }
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= FAILURE_THRESHOLD && available) {
      available = false;
      dismissed = false;
      emit();
    }
  }
}

export function dismiss(): void {
  dismissed = true;
  emit();
}

// useSyncExternalStore contract
export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getSnapshot(): { available: boolean; dismissed: boolean } {
  return snapshot;
}
