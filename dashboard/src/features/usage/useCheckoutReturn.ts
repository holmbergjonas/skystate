import { useState, useEffect } from 'react';
import { useStore } from '@/store';

interface CheckoutReturnState {
  /** True while the single post-checkout fetch is in flight */
  activatingTier: string | null;
}

function getCheckoutParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('checkout');
}

function removeCheckoutParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('checkout');
  window.history.replaceState({}, '', url.toString());
}

export function useCheckoutReturn(): CheckoutReturnState {
  const loadBilling = useStore(s => s.loadBilling);
  const [activatingTier, setActivatingTier] = useState<string | null>(getCheckoutParam);

  useEffect(() => {
    if (!activatingTier) return;

    let cancelled = false;

    (async () => {
      try {
        await loadBilling();
      } finally {
        if (!cancelled) {
          removeCheckoutParam();
          setActivatingTier(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activatingTier, loadBilling]);

  return { activatingTier };
}
