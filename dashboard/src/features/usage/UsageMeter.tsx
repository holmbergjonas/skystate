import { cn } from '@/lib/utils';

interface UsageMeterProps {
  label: string;
  count: number;
  limit: number | null;
  formatValue?: (n: number) => string;
  subtitle?: string;
  graceZonePercent?: number;
  onUpgradeClick?: () => void;
}

export function UsageMeter({
  label,
  count,
  limit,
  formatValue,
  subtitle,
  graceZonePercent,
  onUpgradeClick,
}: UsageMeterProps) {
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());

  if (limit === null) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/15 bg-white/[0.03] p-5 transition-all duration-300">
        <p className="text-xs uppercase tracking-widest text-text-secondary mb-1.5">
          {label}
        </p>
        <div className="flex items-baseline gap-1.5 mb-3">
          <span className="text-4xl font-bold tabular-nums text-white">{fmt(count)}</span>
          <span className="text-sm text-text-muted">/ unlimited</span>
          {subtitle && (
            <span className="ml-auto text-sm text-text-muted">{subtitle}</span>
          )}
        </div>
      </div>
    );
  }

  const percent = limit > 0 ? Math.min((count / limit) * 100, 100) : 100;
  const actualPercent = limit > 0 ? (count / limit) * 100 : 100;
  const isAtLimit = percent >= 100;
  const isWarning = percent >= 80 && !isAtLimit;
  const isOverLimit = actualPercent > 100;
  const graceMax = graceZonePercent ?? 100;
  const isGraceZone =
    graceZonePercent !== undefined && actualPercent >= 100 && actualPercent <= graceMax;

  const barClass = isOverLimit
    ? 'bg-red-500'
    : isAtLimit
      ? 'bg-amber-500'
      : isWarning
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  const cardClass = isOverLimit
    ? 'border-red-500/20 bg-red-600/[0.06]'
    : isAtLimit
      ? 'border-amber-500/20 bg-amber-600/[0.06]'
      : isWarning
        ? 'border-amber-500/15 bg-amber-600/[0.04]'
        : 'border-emerald-500/15 bg-white/[0.03]';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border p-5 transition-all duration-300',
        cardClass,
      )}
    >
      <p className="text-xs uppercase tracking-widest text-text-secondary mb-1.5">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-4xl font-bold tabular-nums text-white">{fmt(count)}</span>
        <span className="text-sm text-text-muted">/ {fmt(limit)}</span>
        {subtitle && (
          <span className="ml-auto text-sm text-text-muted">{subtitle}</span>
        )}
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-1000 ease-out', barClass)}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
      {isGraceZone ? (
        <p className="mt-1.5 text-xs text-text-muted flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block shrink-0" />
          Grace zone
        </p>
      ) : isAtLimit ? (
        <p className="mt-1.5">
          <button
            onClick={onUpgradeClick}
            className="text-primary text-xs hover:underline cursor-pointer"
          >
            Upgrade for more
          </button>
        </p>
      ) : null}
    </div>
  );
}
