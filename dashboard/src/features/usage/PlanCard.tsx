import { Check, Loader2 } from 'lucide-react';
import { TIERS, type TierDefinition } from './tier-data';

const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t.id, i]));

interface PlanCardProps {
  tier: TierDefinition;
  isCurrent: boolean;
  isActivating: boolean;
  isRedirecting: boolean;
  currentTier: string;
  onUpgrade: (tierId: string) => void;
  onManageSubscription: () => void;
}

export function PlanCard({
  tier,
  isCurrent,
  isActivating,
  isRedirecting,
  currentTier,
  onUpgrade,
  onManageSubscription,
}: PlanCardProps) {
  const isDowngrade = TIER_RANK[tier.id] < TIER_RANK[currentTier];
  const showGradientBorder = isCurrent;

  const content = (
    <>
      {/* Badges */}
      {isCurrent && (
        <span className="absolute top-4 right-4 bg-gradient-to-br from-cyan-400 to-indigo-500 px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase text-white">
          &#10003; Current plan
        </span>
      )}
      {/* Tier Name */}
      <div className="text-xl font-bold mb-2">{tier.name}</div>

      {/* Price */}
      <div className="text-5xl font-extrabold leading-none mb-1">
        {tier.price}
        {tier.priceSuffix && (
          <span className="text-base font-medium text-text-secondary ml-0.5">
            {tier.priceSuffix}
          </span>
        )}
      </div>
      {tier.priceNote && (
        <div className="text-sm text-text-muted mb-6">{tier.priceNote}</div>
      )}

      {/* Features */}
      <ul className="space-y-2 flex-1 mb-7">
        {tier.features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm text-foreground">
            <Check
              className={`w-[18px] h-[18px] flex-shrink-0 ${
                isCurrent ? 'text-cyan-400' : 'text-indigo-400'
              }`}
              strokeWidth={2.5}
            />
            {feature.text}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-auto">
        {isActivating || isRedirecting ? (
          <button
            disabled
            className="w-full py-3.5 rounded-xl text-base font-semibold bg-indigo-500/20 text-indigo-300 flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {isActivating ? 'Activating...' : 'Redirecting...'}
          </button>
        ) : isCurrent ? (
          <button
            onClick={onManageSubscription}
            className="w-full py-3.5 rounded-xl text-base font-semibold bg-[#1e293b] text-text-secondary border border-white/[0.08] hover:border-white/15 hover:text-foreground transition-all cursor-pointer"
          >
            Manage subscription
          </button>
        ) : tier.id === 'free' ? null : isDowngrade ? (
          <button
            onClick={() => onUpgrade(tier.id)}
            className="w-full py-3.5 rounded-xl text-base font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/20 transition-all cursor-pointer"
          >
            Downgrade to {tier.name}
          </button>
        ) : (
          <button
            onClick={() => onUpgrade(tier.id)}
            className="w-full py-3.5 rounded-xl text-base font-semibold bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:shadow-[0_6px_30px_rgba(99,102,241,0.5)] hover:brightness-110 transition-all cursor-pointer"
          >
            Upgrade to {tier.name} &nbsp;&rarr;
          </button>
        )}
      </div>
    </>
  );

  if (showGradientBorder) {
    return (
      <div
        className="rounded-[20px] p-[2px] bg-gradient-to-br from-cyan-400 via-indigo-500 to-purple-500 transition-all duration-300 hover:brightness-110 hover:shadow-[0_8px_30px_rgba(99,102,241,0.15)]"
      >
        <div className="relative bg-[rgba(15,20,40,0.95)] rounded-[18px] p-9 flex flex-col h-full">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] p-[2px] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-indigo-500/30 transition-all duration-300 hover:brightness-110 hover:shadow-[0_8px_30px_rgba(99,102,241,0.15)]">
      <div className="relative bg-[rgba(15,20,40,0.85)] rounded-[19px] p-9 flex flex-col h-full">
        {content}
      </div>
    </div>
  );
}
