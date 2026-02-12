import { formatBytes, formatRelativeTime } from '@/lib/format';

interface VersionMeta {
  comment?: string | null;
  stateSizeBytes?: number;
  createdAt?: string;
  label?: string;
}

interface VersionMetaBarProps {
  source: VersionMeta;
  target?: VersionMeta;
  trailing?: React.ReactNode;
}

function MetaRow({ meta }: { meta: VersionMeta }) {
  const parts: React.ReactNode[] = [];

  if (meta.comment) {
    parts.push(
      <span key="comment" className="truncate max-w-[200px]" title={meta.comment}>
        {meta.comment}
      </span>,
    );
  }

  if (meta.stateSizeBytes !== undefined) {
    parts.push(
      <span key="size">{formatBytes(meta.stateSizeBytes)}</span>,
    );
  }

  if (meta.createdAt) {
    parts.push(
      <span key="date">{formatRelativeTime(meta.createdAt)}</span>,
    );
  }

  if (parts.length === 0) return null;

  const joined = parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (i > 0) acc.push(<span key={`sep-${i}`} className="opacity-40">&middot;</span>);
    acc.push(part);
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-1.5 min-w-0 text-xs text-text-dim">
      {meta.label && (
        <span className="text-xs text-text-muted shrink-0 font-medium">
          {meta.label}:
        </span>
      )}
      {joined}
    </div>
  );
}

export function VersionMetaBar({ source, target, trailing }: VersionMetaBarProps) {
  // If no metadata available at all, render nothing
  const sourceHasData = source.stateSizeBytes !== undefined || source.createdAt !== undefined;
  if (!sourceHasData) return null;

  // Horizontal layout when target is provided (compare/promote/rollback modes)
  if (target) {
    return (
      <div className="border-b border-border flex flex-row items-stretch">
        {/* Left half - source */}
        <div className="flex-1 min-w-0 px-4 py-2">
          <MetaRow meta={source} />
        </div>

        {/* Center divider - matches UnifiedDiffView */}
        <div className="w-px shrink-0 self-stretch bg-border" />

        {/* Right half - target */}
        <div className="flex-1 min-w-0 px-4 py-2">
          <MetaRow meta={target} />
        </div>
      </div>
    );
  }

  // Single-row layout for editor/viewing mode
  return (
    <div className="px-4 py-2 border-b border-border flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <MetaRow meta={source} />
      </div>
      {trailing}
    </div>
  );
}
