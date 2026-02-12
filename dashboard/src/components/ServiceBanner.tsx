import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, dismiss } from '@/lib/api-status';
import { X, WifiOff, RefreshCw } from 'lucide-react';

export function ServiceBanner() {
  const { available, dismissed } = useSyncExternalStore(subscribe, getSnapshot);

  if (available || dismissed) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 bg-destructive px-4 py-2.5 text-sm text-white shadow-lg"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="size-4 shrink-0" />
        <span>
          Service unavailable — unable to reach the server. Please check your
          connection and try again.
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white hover:bg-white/20 transition-colors"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
        <button
          onClick={dismiss}
          className="rounded-md p-1 text-white hover:bg-white/20 transition-colors"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
