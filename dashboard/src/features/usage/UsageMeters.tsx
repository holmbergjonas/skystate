import { useNavigate } from 'react-router';
import type { BillingStatus } from '@/api/types';
import { UsageMeter } from './UsageMeter';
import { formatBytes } from '@/lib/format';

interface UsageMetersProps {
  billing: BillingStatus;
}

export function UsageMeters({ billing }: UsageMetersProps) {
  const navigate = useNavigate();
  const handleUpgradeClick = () => navigate('/plans');

  const resetDate = billing.apiRequests
    ? new Date(billing.apiRequests.resetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : undefined;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <UsageMeter
          label="Projects"
          count={billing.projects.count}
          limit={billing.projects.limit}
          onUpgradeClick={handleUpgradeClick}
        />
        <UsageMeter
          label="Environments"
          count={billing.environments.count}
          limit={billing.environments.limit}
          onUpgradeClick={handleUpgradeClick}
        />
        <UsageMeter
          label="Storage"
          count={billing.storage.bytes}
          limit={billing.storage.limit}
          formatValue={formatBytes}
          onUpgradeClick={handleUpgradeClick}
        />
        <UsageMeter
          label="API Requests"
          count={billing.apiRequests?.count ?? 0}
          limit={billing.apiRequests?.limit ?? null}
          graceZonePercent={110}
          subtitle={resetDate ? `Resets ${resetDate}` : undefined}
          onUpgradeClick={handleUpgradeClick}
        />
      </div>
    </div>
  );
}
