import { useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { computeNextVersion, type BumpType } from './push-utils';
import type { DiffStats } from '@/lib/diff';
import type { ProjectState } from '@/api/types';
import { envColors } from './constants';
import { formatVersion, capitalize } from '@/lib/format';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const BUMP_TYPES: BumpType[] = ['patch', 'minor', 'major'];


interface ActionBarPromoteProps {
  mode: 'promote';
  targetEnvName: string;
  targetEnvSlug: string;
  targetLatest: ProjectState | null;
  targetIsFresh: boolean;
  bumpType: BumpType;
  onBumpTypeChange: (bt: BumpType) => void;
  isConfirming: boolean;
  error: string | null;
  diffStats: DiffStats | null;
  onConfirm: () => void;
  onCancel: () => void;
  sourceEnvName: string;
  sourceVersionStr: string;
}

interface ActionBarRollbackProps {
  mode: 'rollback';
  envName: string;
  envColor: string;
  versionStr: string;
  resultVersionStr: string;
  isConfirming: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

type ActionBarProps = ActionBarPromoteProps | ActionBarRollbackProps;

export function ActionBar(props: ActionBarProps) {
  if (props.mode === 'promote') {
    return <PromoteBar {...props} />;
  }
  return <RollbackBar {...props} />;
}

function PromoteBar({
  targetEnvName,
  targetEnvSlug,
  targetLatest,
  targetIsFresh,
  bumpType,
  onBumpTypeChange,
  isConfirming,
  error,
  diffStats,
  onConfirm,
  onCancel,
  sourceEnvName,
  sourceVersionStr,
}: ActionBarPromoteProps) {
  const [confirmText, setConfirmText] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const hasNoDifferences = diffStats && diffStats.added === 0 && diffStats.removed === 0 && diffStats.changed === 0;
  const envColor = envColors[targetEnvSlug] ?? 'var(--muted-foreground)';

  const confirmPhrase = `Promote to ${targetEnvName}`;
  const isConfirmMatch = confirmText.trim().toLowerCase() === confirmPhrase.toLowerCase();

  const nextVersion = targetIsFresh
    ? { major: 0, minor: 0, patch: 1 }
    : targetLatest
      ? computeNextVersion(targetLatest, bumpType)
      : null;

  const nextVersionStr = nextVersion
    ? formatVersion(nextVersion)
    : '';

  function handleCancel() {
    setConfirmText('');
    onCancel();
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setConfirmText('');
    }
  }

  function handleConfirm() {
    onConfirm();
    setDialogOpen(false);
    setConfirmText('');
  }

  return (
    <div className="flex items-center gap-3 mt-3">
      {hasNoDifferences && (
        <span className="text-sm text-text-muted">States are identical</span>
      )}

      {nextVersionStr && !hasNoDifferences && (
        <span className="text-sm text-text-muted">
          Promotes <span className="text-foreground tabular-nums">v{sourceVersionStr}</span> from {sourceEnvName} to {targetEnvName} as{' '}
          {targetIsFresh ? (
            <span className="text-foreground tabular-nums">v{nextVersionStr}</span>
          ) : (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="text-sm text-foreground tabular-nums bg-[var(--surface)] border border-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-[var(--hover)] inline-flex items-center gap-1">
                  v{nextVersionStr}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {BUMP_TYPES.map(bt => {
                  const previewVersion = computeNextVersion(targetLatest!, bt);
                  const previewStr = formatVersion(previewVersion);
                  return (
                    <DropdownMenuItem
                      key={bt}
                      onSelect={() => onBumpTypeChange(bt)}
                      className={bumpType === bt ? 'bg-accent/50' : ''}
                    >
                      {capitalize(bt)} (v{previewStr})
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      )}

      <div className="flex items-center gap-2 ml-auto">
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}

        <button
          onClick={handleCancel}
          disabled={isConfirming}
          className="px-3.5 py-1.5 text-sm font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>

        <AlertDialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
          <AlertDialogTrigger asChild>
            <button
              disabled={isConfirming || !!hasNoDifferences}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: envColor,
                color: 'white',
              }}
            >
              {isConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Promote to {targetEnvName}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Promote to {targetEnvName}</AlertDialogTitle>
            <AlertDialogDescription>
              Type the confirmation phrase below to proceed.
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full px-3 py-1.5 text-sm bg-transparent border border-[#333] rounded-md text-foreground placeholder:text-text-dim outline-none focus:border-primary"
            />
            <div className="flex items-center gap-2 justify-end mt-4">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={!isConfirmMatch}
                style={{
                  backgroundColor: isConfirmMatch ? envColor : `color-mix(in srgb, ${envColor} 30%, transparent)`,
                  color: isConfirmMatch ? 'white' : 'var(--text-dim)',
                }}
              >
                Confirm
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function RollbackBar({
  envColor,
  versionStr,
  resultVersionStr,
  isConfirming,
  error,
  onConfirm,
  onCancel,
}: ActionBarRollbackProps) {
  const [confirmText, setConfirmText] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const confirmPhrase = `Roll back to v${versionStr}`;
  const isConfirmMatch = confirmText.trim().toLowerCase() === confirmPhrase.toLowerCase();

  function handleCancel() {
    setConfirmText('');
    onCancel();
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setConfirmText('');
    }
  }

  function handleConfirm() {
    onConfirm();
    setDialogOpen(false);
    setConfirmText('');
  }

  return (
    <div className="flex items-center gap-3 mt-3">
      {resultVersionStr && (
        <span className="text-sm text-text-muted">
          Creates new version <span className="text-foreground tabular-nums">v{resultVersionStr}</span> with content from <span className="text-foreground tabular-nums">v{versionStr}</span>
        </span>
      )}

      <div className="flex items-center gap-2 ml-auto">
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}

        <button
          onClick={handleCancel}
          disabled={isConfirming}
          className="px-3.5 py-1.5 text-sm font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>

        <AlertDialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
          <AlertDialogTrigger asChild>
            <button
              disabled={isConfirming}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: envColor,
                color: 'white',
              }}
            >
              {isConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Roll back to v{versionStr}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Roll back to v{versionStr}</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new version with the content from v{versionStr}. Type the confirmation phrase below to proceed.
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full px-3 py-1.5 text-sm bg-transparent border border-[#333] rounded-md text-foreground placeholder:text-text-dim outline-none focus:border-amber-500/60"
            />
            <div className="flex items-center gap-2 justify-end mt-4">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={!isConfirmMatch}
                style={{
                  backgroundColor: isConfirmMatch ? envColor : `color-mix(in srgb, ${envColor} 30%, transparent)`,
                  color: isConfirmMatch ? 'white' : 'var(--text-dim)',
                }}
              >
                Confirm
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
