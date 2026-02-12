import { useEffect, useState } from 'react';
import type { Project } from '@/api/types';
import { api } from '@/lib/api';

interface ResourceBreakdownProps {
  projects: Project[];
}

export function ResourceBreakdown({ projects }: ResourceBreakdownProps) {
  const [envCounts, setEnvCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const project of projects) {
      api.environments.list(project.projectId).then(
        (envs) => {
          if (!cancelled) {
            setEnvCounts((prev) => ({ ...prev, [project.projectId]: envs.length }));
          }
        },
        () => {
          if (!cancelled) {
            setEnvCounts((prev) => ({ ...prev, [project.projectId]: null }));
          }
        },
      );
    }
    return () => { cancelled = true; };
  }, [projects]);

  if (projects.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-widest text-text-secondary mb-3 px-1">
        Your projects
      </h3>
      <div className="space-y-2">
        {projects.map((project) => {
          const count = envCounts[project.projectId];
          return (
            <div
              key={project.projectId}
              className="flex items-center justify-between px-5 py-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-primary/20 hover:bg-white/[0.06] transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary group-hover:animate-pulse" />
                <span className="text-sm font-medium text-white">{project.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>
                  {count === undefined
                    ? '...'
                    : count === null
                      ? '\u2014'
                      : `${count} environment${count !== 1 ? 's' : ''}`}
                </span>
                <span>
                  Created{' '}
                  {new Date(project.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
