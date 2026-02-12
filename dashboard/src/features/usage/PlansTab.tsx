import { useState } from 'react';
import { BarChart3, Lock, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { PlanCards } from './PlanCards';
import { useCheckoutReturn } from './useCheckoutReturn';

export function PlansTab() {
  const billing = useStore(s => s.billing);
  const billingLoading = useStore(s => s.billingLoading);
  const billingFetchError = useStore(s => s.billingError);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [redirectingAction, setRedirectingAction] = useState<string | null>(null);
  const [boostCount, setBoostCount] = useState(1);

  const { activatingTier } = useCheckoutReturn();

  async function handleUpgrade(tierId: string) {
    setRedirectingAction(tierId);
    setBillingError(null);
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('checkout', tierId);
      const { url } = await api.billing.checkout({
        tier: tierId,
        successUrl: returnUrl.toString(),
        cancelUrl: window.location.href,
      });
      window.location.href = url;
    } catch {
      setBillingError('Could not start checkout. Please try again.');
      setRedirectingAction(null);
    }
  }

  async function handleManageSubscription() {
    setRedirectingAction('manage');
    setBillingError(null);
    try {
      const { url } = await api.billing.portal({
        returnUrl: window.location.href,
      });
      window.location.href = url;
    } catch {
      setBillingError('Could not open billing portal. Please try again.');
      setRedirectingAction(null);
    }
  }

  async function handleBoostPurchase() {
    if (!billing) return;
    setRedirectingAction('boost');
    setBillingError(null);
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('checkout', 'boost');
      const { url } = await api.billing.boostCheckout({
        quantity: (billing.boostMultiplier ?? 1) + boostCount,
        successUrl: returnUrl.toString(),
        cancelUrl: window.location.href,
      });
      window.location.href = url;
    } catch {
      setBillingError('Could not start boost checkout. Please try again.');
      setRedirectingAction(null);
    }
  }

  if (billingLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading billing data...</p>
      </div>
    );
  }

  if (billingFetchError) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Failed to load billing data"
        description={billingFetchError}
      />
    );
  }

  if (!billing) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Something went wrong"
        description="Please refresh the page."
      />
    );
  }

  const isProTier = billing.tier === 'pro';
  const boostMultiplier = billing.boostMultiplier ?? 1;

  return (
    <div className="space-y-10 pb-12">
      <p className={`text-xs text-destructive text-center ${billingError ? 'visible' : 'invisible'}`}>
        {billingError || '\u00A0'}
      </p>

      {billing.lastStripeError && (
        <div className="max-w-[1008px] mx-auto rounded-[var(--radius-card)] border border-destructive/30 bg-destructive/5 p-4 text-center">
          <p className="text-sm text-destructive font-medium mb-1">Billing error</p>
          <p className="text-xs text-destructive/80">{billing.lastStripeError}</p>
        </div>
      )}

      {/* Hero */}
      <div className="text-center pt-8 pb-2">
        <h1 className="text-4xl font-extrabold bg-gradient-to-br from-[#c7d2fe] via-[#a78bfa] to-[#818cf8] bg-clip-text text-transparent mb-3">
          Pick your perfect plan
        </h1>
        <p className="text-text-secondary text-lg max-w-md mx-auto">
          Scale effortlessly from prototype to production. Upgrade or downgrade
          anytime.
        </p>
      </div>

      {/* Plan Cards */}
      <PlanCards
        currentTier={billing.tier}
        activatingTier={activatingTier}
        redirectingAction={redirectingAction}
        onUpgrade={handleUpgrade}
        onManageSubscription={handleManageSubscription}
      />

      {/* Resource Booster Add-on */}
      <div className="max-w-[1008px] mx-auto">
        <div className="rounded-[20px] p-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[rgba(15,20,40,0.95)] rounded-[18px] px-8 py-7">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-1.5">
                {isProTier ? 'Supercharge your Pro plan' : 'Pro add-on'}
              </div>
              <div className="text-lg font-bold text-foreground mb-1">
                Resource Booster
              </div>
              <div className="text-sm text-text-secondary max-w-[420px]">
                Stack extra Pro resources — each booster adds another full set of
                project, storage, and API request limits.
              </div>
            </div>
            {isProTier ? (
              <div className="flex flex-col items-end gap-3 flex-shrink-0">
                {boostMultiplier > 1 && (
                  <span className="text-sm text-text-dim">
                    {boostMultiplier}x boost active
                  </span>
                )}
                <span className="text-sm text-purple-400 font-medium">$10/mo each</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-purple-400/30 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setBoostCount(c => Math.max(1, c - 1))}
                      disabled={boostCount <= 1}
                      className="px-3 py-1.5 text-sm font-semibold text-purple-400 hover:bg-purple-400/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    >
                      −
                    </button>
                    <span className="px-3 py-1.5 text-sm font-semibold text-foreground min-w-[2rem] text-center border-x border-purple-400/30">
                      {boostCount}
                    </span>
                    <button
                      onClick={() => setBoostCount(c => c + 1)}
                      className="px-3 py-1.5 text-sm font-semibold text-purple-400 hover:bg-purple-400/10 transition-colors cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={handleBoostPurchase}
                    disabled={redirectingAction === 'boost'}
                    className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-2 ${
                      redirectingAction === 'boost'
                        ? 'bg-indigo-500/20 text-indigo-300 cursor-not-allowed'
                        : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:shadow-[0_6px_30px_rgba(99,102,241,0.5)] hover:brightness-110 cursor-pointer'
                    }`}
                  >
                    {redirectingAction === 'boost' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {redirectingAction === 'boost'
                      ? 'Redirecting...'
                      : `Add ${boostCount} Booster${boostCount > 1 ? 's' : ''} — $${boostCount * 10}/mo`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-text-secondary">
                <Lock className="h-5 w-5 text-purple-400/50" />
                <div className="text-sm">
                  <span className="text-purple-400/70 font-medium">Pro plan required</span>
                  <span className="text-text-dim ml-1">· $10/mo per booster</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
