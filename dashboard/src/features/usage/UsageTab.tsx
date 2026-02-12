import { BarChart3, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { useStore } from '@/store';
import { InvoiceHistory } from './InvoiceHistory';
import { OverLimitBanner } from './OverLimitBanner';
import { ResourceBreakdown } from './ResourceBreakdown';
import { UsageMeters } from './UsageMeters';

export function UsageTab() {
  const billing = useStore(s => s.billing);
  const billingLoading = useStore(s => s.billingLoading);
  const billingError = useStore(s => s.billingError);
  const projects = useStore(s => s.projects);

  if (billingLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading usage data...</p>
      </div>
    );
  }

  if (billingError) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Failed to load usage data"
        description={billingError}
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

  return (
    <div className="space-y-8">
      <OverLimitBanner overLimitResources={billing.overLimit ?? []} tier={billing.tier} />
      <UsageMeters billing={billing} />
      <ResourceBreakdown projects={projects} />
      <InvoiceHistory />
    </div>
  );
}
