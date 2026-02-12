import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PackagePlus } from 'lucide-react';
import { useStore } from '@/store';
import { deriveSlug } from '@/lib/format';
import { ApiError } from '@/lib/api-error';

export function NewProjectPage() {
  const { createProject, createEnvironment, selectProject, billing } = useStore(
    useShallow(s => ({
      createProject: s.createProject,
      createEnvironment: s.createEnvironment,
      selectProject: s.selectProject,
      billing: s.billing,
    }))
  );

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSlug, setNewProjectSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const hasStagingEnv = billing?.tier === 'hobby' || billing?.tier === 'pro';
  const DEFAULT_ENVIRONMENTS = hasStagingEnv
    ? [
        { name: 'Development', slug: 'development', color: '#22c55e' },
        { name: 'Staging', slug: 'staging', color: '#f59e0b' },
        { name: 'Production', slug: 'production', color: '#ef4444' },
      ]
    : [
        { name: 'Development', slug: 'development', color: '#22c55e' },
        { name: 'Production', slug: 'production', color: '#ef4444' },
      ];

  async function handleCreateProject() {
    if (!newProjectName.trim() || !newProjectSlug.trim()) return;
    setCreating(true);
    try {
      const apiKeyHash = crypto.randomUUID?.()
        ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      const projectId = await createProject({ name: newProjectName.trim(), slug: newProjectSlug.trim(), apiKeyHash });
      setNewProjectName('');
      setNewProjectSlug('');
      setSlugTouched(false);
      setCreateError(null);
      await Promise.allSettled(DEFAULT_ENVIRONMENTS.map(env => createEnvironment(projectId, env)));
      selectProject(projectId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        const body = err.errorBody as { code?: string } | null;
        setCreateError(
          body?.code === 'LIMIT_PROJECTS'
            ? 'You\'ve reached your project limit. Upgrade your plan to create more projects.'
            : 'Project creation is not available on your current plan.'
        );
      } else {
        setCreateError('Failed to create project. Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-16 px-4">
      {/* Header */}
      <div className="text-center mb-8">
        <PackagePlus className="h-10 w-10 text-[var(--accent)] mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-foreground">Create a new project</h1>
        <p className="text-sm text-text-muted mt-2 max-w-sm mx-auto">
          A project holds your state, organized by environments like development and production.
        </p>
      </div>

      {/* Form card */}
      <div className="bg-[var(--popover)] border border-border rounded-lg p-6 space-y-4">
        {/* Project name */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Project name</label>
          <input
            type="text"
            value={newProjectName}
            onChange={e => {
              setNewProjectName(e.target.value);
              if (!slugTouched) setNewProjectSlug(deriveSlug(e.target.value));
            }}
            onKeyDown={e => e.key === 'Enter' && void handleCreateProject()}
            placeholder="My Awesome App"
            autoFocus
            className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-text-muted outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Slug</label>
          <input
            type="text"
            value={newProjectSlug}
            onChange={e => {
              setSlugTouched(true);
              setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            onKeyDown={e => e.key === 'Enter' && void handleCreateProject()}
            placeholder="my-awesome-app"
            className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-text-muted outline-none focus:border-[var(--accent)]"
          />
          <p className="text-xs text-text-dim mt-1.5">Used in URLs. Cannot be changed later.</p>
        </div>

        {/* Default environments preview */}
        <div>
          <p className="text-sm text-text-muted mb-1.5">Default environments</p>
          <div className="flex items-center gap-3">
            {DEFAULT_ENVIRONMENTS.map(env => (
              <span key={env.slug} className="inline-flex items-center gap-1.5 text-sm text-foreground">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: env.color }}
                />
                {env.name}
              </span>
            ))}
          </div>
        </div>

        {/* Error */}
        {createError && (
          <p className="text-sm text-destructive mt-2">{createError}</p>
        )}

        {/* Create button */}
        <button
          onClick={() => void handleCreateProject()}
          disabled={!newProjectName.trim() || !newProjectSlug.trim() || creating}
          className="w-full bg-[var(--accent)] text-white rounded py-2.5 text-sm font-medium hover:bg-[var(--accent)]/90 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {creating ? 'Creating...' : 'Create project'}
        </button>
      </div>

      {/* CLI alternative section */}
      <div className="mt-8 text-center">
        <div className="flex items-center gap-3">
          <hr className="flex-1 border-border" />
          <span className="text-xs text-text-dim">or</span>
          <hr className="flex-1 border-border" />
        </div>
        <p className="text-sm text-text-muted mt-4 mb-3">Push from the CLI</p>
        <pre className="bg-background border border-border rounded-lg p-4 text-left text-xs text-text-muted whitespace-pre font-mono">
{`npm install -g @skystate/cli
skystate auth login
skystate projects create "my-project"`}
        </pre>
      </div>
    </div>
  );
}
