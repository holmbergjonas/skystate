import type { DiffLine, DiffStats } from '@/lib/diff';
import { highlightJson } from './JsonDisplay';

interface UnifiedDiffViewProps {
  diffResult: { lines: DiffLine[]; stats: DiffStats };
}

const gutterColor: Record<string, string> = {
  added: 'var(--diff-added)',
  removed: 'var(--diff-removed)',
  changed: 'var(--diff-changed)',
};

const rowBg: Record<string, string> = {
  added: 'var(--diff-added-bg)',
  removed: 'var(--diff-removed-bg)',
  changed: 'var(--diff-changed-bg)',
};

export function UnifiedDiffView({ diffResult }: UnifiedDiffViewProps) {
  let leftLineNum = 0;
  let rightLineNum = 0;

  return (
    <div className="py-4 font-mono text-sm leading-[1.7] overflow-hidden">
      {diffResult.lines.map((line, i) => {
        const hasLeft = line.left !== '';
        const hasRight = line.right !== '';
        if (hasLeft) leftLineNum++;
        if (hasRight) rightLineNum++;

        const bg = rowBg[line.status];
        const leftGutter = hasLeft ? gutterColor[line.status] : undefined;
        const rightGutter = hasRight ? gutterColor[line.status] : undefined;

        return (
          <div
            key={i}
            className="flex"
            style={bg ? { backgroundColor: bg } : undefined}
          >
            {/* Left gutter */}
            <span
              className="shrink-0 self-stretch"
              style={{
                width: '3px',
                backgroundColor: leftGutter ?? 'transparent',
              }}
            />

            {/* Left content */}
            <span className="flex-1 whitespace-pre-wrap break-words pl-4 pr-2 min-w-0 overflow-hidden">
              {hasLeft ? highlightJson(line.left) : '\u00A0'}
            </span>

            {/* Left line number */}
            <span className="w-[32px] shrink-0 select-none text-right pr-2 text-xs text-text-dim">
              {hasLeft ? leftLineNum : ''}
            </span>

            {/* Center divider */}
            <span className="w-px shrink-0 self-stretch bg-border" />

            {/* Right line number */}
            <span className="w-[32px] shrink-0 select-none text-left pl-2 text-xs text-text-dim">
              {hasRight ? rightLineNum : ''}
            </span>

            {/* Right content */}
            <span className="flex-1 whitespace-pre-wrap break-words pl-2 pr-4 min-w-0 overflow-hidden">
              {hasRight ? highlightJson(line.right) : '\u00A0'}
            </span>

            {/* Right gutter */}
            <span
              className="shrink-0 self-stretch"
              style={{
                width: '3px',
                backgroundColor: rightGutter ?? 'transparent',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
