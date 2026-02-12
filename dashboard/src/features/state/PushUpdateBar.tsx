import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { type BumpType, computeNextVersion } from './push-utils';
import { formatVersion, capitalize } from '@/lib/format';
import type { Version } from '@/api/types';

interface PushUpdateBarProps {
  onBumpTypeChange: (type: BumpType) => void;
  currentVersion: Version | null;
  nextVersion: Version | null;
  canPush: boolean;
  isPushing: boolean;
  pushError: string | null;
  onPush: (comment?: string) => void;
  onCancel: () => void;
}

export function PushUpdateBar({
  onBumpTypeChange,
  currentVersion,
  nextVersion,
  canPush,
  isPushing,
  pushError,
  onPush,
  onCancel,
}: PushUpdateBarProps) {
  const [comment, setComment] = useState('');

  const versionStr = nextVersion
    ? formatVersion(nextVersion, 'v')
    : '';

  function handlePush() {
    onPush(comment || undefined);
    setComment('');
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {/* Optional comment input */}
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment..."
          className="flex-1 px-3 py-1.5 text-xs bg-[var(--surface)] border border-border rounded text-foreground placeholder:text-text-dim outline-none focus:border-[var(--accent)]"
          disabled={!canPush}
        />

        {/* Cancel + Save grouped on the right */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onCancel}
            disabled={isPushing}
            className="px-3.5 py-1.5 text-sm font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          {/* Split button: push + bump type dropdown */}
          <div className="flex items-center">
            <Button
              onClick={handlePush}
              disabled={!canPush}
              size="sm"
              className="rounded-r-none"
            >
              {isPushing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>Save {versionStr}</>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-l-none border-l-0 px-1.5"
                  disabled={!canPush}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['patch', 'minor', 'major'] as const).map((type) => {
                  const ver = currentVersion ? computeNextVersion(currentVersion, type) : null;
                  const verStr = ver ? formatVersion(ver, 'v') : '';
                  return (
                    <DropdownMenuItem
                      key={type}
                      onSelect={() => onBumpTypeChange(type)}
                    >
                      {capitalize(type)} {verStr}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Error display */}
      {pushError && (
        <p className="text-xs text-destructive mt-2">{pushError}</p>
      )}
    </div>
  );
}
