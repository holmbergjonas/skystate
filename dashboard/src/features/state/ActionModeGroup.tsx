import { useState, useEffect, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/store';
import { formatJson, formatVersion } from '@/lib/format';
import type { ProjectState } from '@/api/types';
import { envColors } from './constants';
import { cn } from '@/lib/utils';

export type ActionMode = 'editor' | 'compare' | 'promote' | 'rollback';

export interface CompareTarget {
  env: string;
  versionIndex: number;
  versionStr: string;
  state: string;
  comment?: string | null;
  stateSizeBytes?: number;
  createdAt?: string;
}

interface ActionModeGroupProps {
  mode: ActionMode;
  compareTarget: CompareTarget | null;
  onModeChange: (mode: ActionMode) => void;
  onCompare: (target: CompareTarget) => void;
  onSelectPromoteTarget: (envId: string) => void;
  onRollbackSelect: (versionIndex: number) => void;
  stateVersions: ProjectState[];
  disabled?: boolean;
  promoteDisabled?: boolean;
  rollbackDisabled?: boolean;
  promoteTargetEnvId?: string | null;
  rollbackSelectedIndex?: number;
}

const BASE_BUTTON_CLASSES =
  'px-3.5 py-1.5 text-sm font-medium rounded-md cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none inline-flex items-center gap-2';

const NEUTRAL_BUTTON_CLASSES =
  `${BASE_BUTTON_CLASSES} border border-border text-foreground/70 hover:bg-accent/50 hover:text-foreground`;

const ACTIVE_BUTTON_CLASSES =
  `${BASE_BUTTON_CLASSES} border`;

function modeButtonProps(isActive: boolean, envSlug: string | null): {
  className: string;
  style: React.CSSProperties | undefined;
} {
  const color = envSlug ? (envColors[envSlug] ?? 'var(--muted-foreground)') : null;
  if (isActive && color) {
    return {
      className: ACTIVE_BUTTON_CLASSES,
      style: {
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      },
    };
  }
  return {
    className: NEUTRAL_BUTTON_CLASSES,
    style: undefined,
  };
}

export function ActionModeGroup({
  mode,
  compareTarget,
  onModeChange,
  onCompare,
  onSelectPromoteTarget,
  onRollbackSelect,
  stateVersions,
  disabled,
  promoteDisabled,
  rollbackDisabled,
  promoteTargetEnvId,
  rollbackSelectedIndex,
}: ActionModeGroupProps) {
  const environments = useStore(s => s.environments);
  const selectedEnvironmentId = useStore(s => s.selectedEnvironmentId);
  const selectedProjectId = useStore(s => s.selectedProjectId);
  const promoteTargetCache = useStore(s => s.promoteTargetCache);

  // Compare dropdown state
  const [selectedTargetEnv, setSelectedTargetEnv] = useState('');
  const [targetVersions, setTargetVersions] = useState<ProjectState[]>([]);
  const [targetVersionsLoading, setTargetVersionsLoading] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const versionCacheRef = useRef<Map<string, ProjectState[]>>(new Map());
  const selectedTargetEnvRef = useRef(selectedTargetEnv);
  useEffect(() => { selectedTargetEnvRef.current = selectedTargetEnv; }, [selectedTargetEnv]);

  const activeEnvSlug = environments.find(e => e.environmentId === selectedEnvironmentId)?.slug ?? '';

  // Reset compare state when active env changes and abort in-flight fetches
  const resetEnvRef = useRef(activeEnvSlug);
  useEffect(() => {
    if (resetEnvRef.current !== activeEnvSlug) {
      resetEnvRef.current = activeEnvSlug;
      setSelectedTargetEnv(''); // eslint-disable-line react-hooks/set-state-in-effect -- reset on env change
      setTargetVersions([]);
      fetchAbortRef.current?.abort();
      versionCacheRef.current.clear();
    }
    return () => fetchAbortRef.current?.abort();
  }, [activeEnvSlug]);

  async function fetchAndCompare(envSlug: string, autoCompareLatest: boolean) {
    const envObj = environments.find(e => e.slug === envSlug);
    if (!envObj || !selectedProjectId) return;

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = new AbortController();

    // Serve cached versions instantly if available (no loading spinner)
    const cached = versionCacheRef.current.get(envSlug);
    if (cached) {
      setTargetVersions(cached);
      setTargetVersionsLoading(false);
      if (autoCompareLatest && cached.length > 0) {
        const v = cached[0];
        const vStr = formatVersion(v);
        let state: string;
        try { state = formatJson(v.state); } catch { state = v.state; }
        onCompare({ env: envSlug, versionIndex: 0, versionStr: vStr, state, comment: v.comment, stateSizeBytes: v.stateSizeBytes, createdAt: v.createdAt });
      }
    } else {
      setTargetVersionsLoading(true);
    }

    // Always fetch fresh data in the background
    const capturedEnvSlug = envSlug;
    try {
      const versions = await api.states.list(selectedProjectId, envObj.environmentId, fetchAbortRef.current.signal);
      versionCacheRef.current.set(capturedEnvSlug, versions);
      setTargetVersions(versions);
      setTargetVersionsLoading(false);

      // Re-fire onCompare with fresh data if env hasn't changed since fetch started
      if (autoCompareLatest && versions.length > 0 && capturedEnvSlug === selectedTargetEnvRef.current) {
        const v = versions[0];
        const vStr = formatVersion(v);
        let state: string;
        try { state = formatJson(v.state); } catch { state = v.state; }
        onCompare({ env: capturedEnvSlug, versionIndex: 0, versionStr: vStr, state, comment: v.comment, stateSizeBytes: v.stateSizeBytes, createdAt: v.createdAt });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setTargetVersionsLoading(false);
        if (!cached) setTargetVersions([]);
      }
    }
  }

  // Promote: target environments (exclude current)
  const promoteEnvs = environments.filter(e => e.environmentId !== selectedEnvironmentId);

  const isCompareActive = mode === 'compare';
  const isPromoteActive = mode === 'promote';
  const isRollbackActive = mode === 'rollback';

  // Derived slugs/names for active state coloring
  const compareSelectedSlug = isCompareActive && selectedTargetEnv ? selectedTargetEnv : null;
  const compareTargetEnvName = isCompareActive && selectedTargetEnv
    ? (environments.find(e => e.slug === selectedTargetEnv)?.name ?? '')
    : '';

  const promoteSelectedSlug = isPromoteActive && promoteTargetEnvId
    ? environments.find(e => e.environmentId === promoteTargetEnvId)?.slug ?? null
    : null;
  const promoteSelectedName = isPromoteActive && promoteTargetEnvId
    ? environments.find(e => e.environmentId === promoteTargetEnvId)?.name ?? ''
    : '';

  const rollbackSelectedSlug = isRollbackActive ? activeEnvSlug : null;
  const rollbackVersionStr = isRollbackActive && rollbackSelectedIndex !== undefined
    ? formatVersion(stateVersions[rollbackSelectedIndex], 'v')
    : '';

  // Compare dropdown content
  const compareDropdownContent = (
    <DropdownMenuContent className="w-[280px]" align="end">
      <DropdownMenuLabel className="text-xs text-text-muted">
        Environment
      </DropdownMenuLabel>
      {environments.map((env) => {
        const isSelected = env.slug === selectedTargetEnv;
        const dotColor = envColors[env.slug] ?? 'var(--muted-foreground)';
        return (
          <DropdownMenuItem
            key={env.environmentId}
            onSelect={(e) => {
              e.preventDefault();
              setSelectedTargetEnv(env.slug);
              fetchAndCompare(env.slug, true);
            }}
            className={cn("flex items-center gap-2", isSelected && "bg-accent/50")}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />
            <span className="flex-1">{env.name}</span>
          </DropdownMenuItem>
        );
      })}

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-text-muted">
        Version
      </DropdownMenuLabel>
      {targetVersionsLoading ? (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
        </div>
      ) : targetVersions.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-text-dim">
          {selectedTargetEnv ? 'No versions' : 'Select an environment'}
        </div>
      ) : (
        targetVersions.map((version, index) => {
          const versionStr = formatVersion(version, 'v');
          const isSelected = isCompareActive && compareTarget?.env === selectedTargetEnv && compareTarget?.versionIndex === index;
          return (
            <DropdownMenuItem
              key={version.projectStateId}
              onSelect={(e) => {
                e.preventDefault();
                const vStr = formatVersion(version);
                let state: string;
                try { state = formatJson(version.state); } catch { state = version.state; }
                onCompare({ env: selectedTargetEnv, versionIndex: index, versionStr: vStr, state, comment: version.comment, stateSizeBytes: version.stateSizeBytes, createdAt: version.createdAt });
              }}
              className={cn("flex items-center gap-2", isSelected && "bg-accent/50")}
            >
              <span className="text-xs text-foreground tabular-nums">{versionStr}</span>
              {version.comment && (
                <span className="text-text-muted text-xs truncate flex-1">
                  {version.comment}
                </span>
              )}
            </DropdownMenuItem>
          );
        })
      )}

      {isCompareActive && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onModeChange('editor')}
            variant="destructive"
          >
            Clear comparison
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  // Promote dropdown content
  const promoteDropdownContent = (
    <DropdownMenuContent className="w-[280px]" align="end">
      <DropdownMenuLabel className="text-xs text-text-muted">
        Target environment
      </DropdownMenuLabel>
      {promoteEnvs.map((env) => {
        const isSelected = env.environmentId === promoteTargetEnvId;
        const dotColor = envColors[env.slug] ?? 'var(--muted-foreground)';
        const cached = promoteTargetCache.get(env.environmentId);
        const versionStr = cached?.latest ? formatVersion(cached.latest, 'v') : '\u2013';
        return (
          <DropdownMenuItem
            key={env.environmentId}
            onSelect={(e) => { e.preventDefault(); onSelectPromoteTarget(env.environmentId); }}
            className={cn("flex items-center gap-2", isSelected && "bg-accent/50")}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />
            <span className="flex-1">{env.name}</span>
            <span className="text-xs text-foreground tabular-nums min-w-[52px] text-right">
              {versionStr}
            </span>
          </DropdownMenuItem>
        );
      })}
      {isPromoteActive && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onModeChange('editor')}
            variant="destructive"
          >
            Clear promotion
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  const rollbackProps = modeButtonProps(isRollbackActive, rollbackSelectedSlug);
  const compareProps = modeButtonProps(isCompareActive, compareSelectedSlug);
  const promoteProps = modeButtonProps(isPromoteActive, promoteSelectedSlug);

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Rollback button (with dropdown) */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled || rollbackDisabled}
            className={rollbackProps.className}
            style={rollbackProps.style}
          >
            {isRollbackActive && rollbackSelectedSlug ? (
              <>
                <span
                  className="h-[7px] w-[7px] rounded-full shrink-0"
                  style={{ backgroundColor: envColors[rollbackSelectedSlug] ?? 'var(--muted-foreground)' }}
                />
                <span>Rollback</span>
                <span className="text-text-muted">&middot;</span>
                <span>{rollbackVersionStr}</span>
              </>
            ) : (
              <span>Rollback</span>
            )}
            <span className="text-xs text-text-muted">{'\u25BE'}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[280px]" align="start">
          <DropdownMenuLabel className="text-xs text-text-muted">
            Select version to roll back to
          </DropdownMenuLabel>
          {stateVersions.slice(1).map((version, i) => {
            const vStr = formatVersion(version, 'v');
            const isSelected = isRollbackActive && rollbackSelectedIndex === i + 1;
            return (
              <DropdownMenuItem
                key={version.projectStateId}
                onSelect={(e) => { e.preventDefault(); onRollbackSelect(i + 1); }}
                className={cn("flex items-center gap-2", isSelected && "bg-accent/50")}
              >
                <span className="text-xs text-foreground tabular-nums">{vStr}</span>
                {version.comment && (
                  <span className="text-text-muted text-xs truncate flex-1">
                    {version.comment}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
          {isRollbackActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onModeChange('editor')}
                variant="destructive"
              >
                Clear rollback
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Compare button (with dropdown) */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled}
            className={compareProps.className}
            style={compareProps.style}
          >
            {isCompareActive && compareSelectedSlug ? (
              <>
                <span
                  className="h-[7px] w-[7px] rounded-full shrink-0"
                  style={{ backgroundColor: envColors[compareSelectedSlug] ?? 'var(--muted-foreground)' }}
                />
                <span>Compare</span>
                <span className="text-text-muted">&middot;</span>
                <span>{compareTargetEnvName}</span>
              </>
            ) : (
              <span>Compare</span>
            )}
            <span className="text-xs text-text-muted">{'\u25BE'}</span>
          </button>
        </DropdownMenuTrigger>
        {compareDropdownContent}
      </DropdownMenu>

      {/* Promote button (with dropdown) */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled || promoteDisabled}
            className={promoteProps.className}
            style={promoteProps.style}
          >
            {isPromoteActive && promoteSelectedSlug ? (
              <>
                <span
                  className="h-[7px] w-[7px] rounded-full shrink-0"
                  style={{ backgroundColor: envColors[promoteSelectedSlug] ?? 'var(--muted-foreground)' }}
                />
                <span>Promote</span>
                <span className="text-text-muted">&middot;</span>
                <span>{promoteSelectedName}</span>
              </>
            ) : (
              <span>Promote</span>
            )}
            <span className="text-xs text-text-muted">{'\u25BE'}</span>
          </button>
        </DropdownMenuTrigger>
        {promoteDropdownContent}
      </DropdownMenu>
    </div>
  );
}
