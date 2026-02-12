import { TIERS } from './tier-data';
import { PlanCard } from './PlanCard';

interface PlanCardsProps {
  currentTier: string;
  activatingTier: string | null;
  redirectingAction: string | null;
  onUpgrade: (tierId: string) => void;
  onManageSubscription: () => void;
}

export function PlanCards({
  currentTier,
  activatingTier,
  redirectingAction,
  onUpgrade,
  onManageSubscription,
}: PlanCardsProps) {
  return (
    <div
      id="plan-cards"
      className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[1008px] mx-auto"
    >
      {TIERS.map((tier) => (
        <PlanCard
          key={tier.id}
          tier={tier}
          isCurrent={tier.id === currentTier}
          isActivating={tier.id === activatingTier}
          isRedirecting={
            redirectingAction === tier.id ||
            (redirectingAction === 'manage' && tier.id === currentTier)
          }
          currentTier={currentTier}
          onUpgrade={onUpgrade}
          onManageSubscription={onManageSubscription}
        />
      ))}
    </div>
  );
}
