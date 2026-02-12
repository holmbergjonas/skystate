import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { useStore } from '@/store';
import { envColors } from './constants';
import { formatVersion } from '@/lib/format';
import { cn } from '@/lib/utils';

interface VersionDropdownProps {
  onSelectEnvironment: (environmentId: string) => void;
  disabled?: boolean;
}

export function VersionDropdown({ onSelectEnvironment, disabled }: VersionDropdownProps) {
  const environments = useStore(s => s.environments);
  const selectedEnvironmentId = useStore(s => s.selectedEnvironmentId);
  const stateVersions = useStore(s => s.stateVersions);
  const promoteTargetCache = useStore(s => s.promoteTargetCache);

  const selectedEnv = environments.find(e => e.environmentId === selectedEnvironmentId);
  const envColor = envColors[selectedEnv?.slug ?? ''] ?? 'var(--muted-foreground)';

  // Always show the latest version for the current environment
  const latestVersion = stateVersions[0];
  const latestVersionStr = latestVersion
    ? formatVersion(latestVersion, 'v')
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled || stateVersions.length === 0}
          className="flex items-center gap-2 rounded-md pl-3.5 pr-3.5 py-1.5 text-sm font-medium cursor-pointer border transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
          style={{
            borderColor: `color-mix(in srgb, ${envColor} 40%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${envColor} 10%, transparent)`,
          }}
        >
          <span
            className="h-[7px] w-[7px] rounded-full shrink-0"
            style={{ backgroundColor: envColor }}
          />
          <span>{selectedEnv?.name ?? 'Environment'}</span>
          <span className="text-text-muted">&middot;</span>
          <span className="text-xs text-foreground tabular-nums">{latestVersionStr ?? 'No versions'}</span>
          <span className="text-xs text-text-muted">{'\u25BE'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px]" align="start">
        <DropdownMenuLabel className="text-xs text-text-muted">
          Environment
        </DropdownMenuLabel>
        {environments.map((env) => {
          const isSelected = env.environmentId === selectedEnvironmentId;
          const dotColor = envColors[env.slug] ?? 'var(--muted-foreground)';

          return (
            <DropdownMenuItem
              key={env.environmentId}
              onSelect={(e) => {
                e.preventDefault();
                onSelectEnvironment(env.environmentId);
              }}
              className={cn("flex items-center gap-2", isSelected && "bg-accent/50")}
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: dotColor }}
              />
              <div className="flex-1 min-w-0">
                <span>{env.name}</span>
              </div>
              <span className="text-xs text-foreground tabular-nums min-w-[52px] text-right">
                {isSelected
                  ? (latestVersionStr ?? '')
                  : (() => {
                      const cached = promoteTargetCache.get(env.environmentId);
                      if (!cached) return '\u2013';
                      if (cached.isFresh) return '\u2013';
                      return cached.latest ? formatVersion(cached.latest, 'v') : '\u2013';
                    })()
                }
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
