import { useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deriveSlug } from '@/lib/format';
import { ApiError } from '@/lib/api-error';

interface ProjectSelectorProps {
  onProjectSelect?: (projectId: string) => void;
}

export function ProjectSelector({ onProjectSelect }: ProjectSelectorProps) {
  const { projects, selectedProjectId, selectProject, createProject, createEnvironment, billing } = useStore(
    useShallow(s => ({
      projects: s.projects,
      selectedProjectId: s.selectedProjectId,
      selectProject: s.selectProject,
      createProject: s.createProject,
      createEnvironment: s.createEnvironment,
      billing: s.billing,
    }))
  );

  const selectedProject = projects.find(p => p.projectId === selectedProjectId) ?? null;

  const [showNewProject, setShowNewProject] = useState(false);
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
      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectSlug('');
      setSlugTouched(false);
      setCreateError(null);
      await Promise.allSettled(DEFAULT_ENVIRONMENTS.map(env => createEnvironment(projectId, env)));
      if (onProjectSelect) {
        onProjectSelect(projectId);
      } else {
        selectProject(projectId);
      }
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

  const triggerLabel = selectedProject?.name ?? 'Select project';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 outline-none">
          {triggerLabel}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {projects.map((project) => (
            <DropdownMenuItem key={project.projectId} onSelect={() => (onProjectSelect ?? selectProject)(project.projectId)}>
              <span className="flex items-center gap-2">
                {project.projectId === selectedProjectId && <Check className="h-3.5 w-3.5" />}
                {project.projectId !== selectedProjectId && <span className="w-3.5" />}
                {project.name}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setShowNewProject(true); setCreateError(null); }}>
            <Plus className="h-4 w-4" />
            New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showNewProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { if (!creating) { setShowNewProject(false); setNewProjectName(''); setNewProjectSlug(''); setSlugTouched(false); setCreateError(null); } }}>
          <div className="bg-[var(--popover)] border border-border rounded-lg p-8 w-[440px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-foreground mb-5">New project</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-muted mb-1.5">Project name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={e => {
                    setNewProjectName(e.target.value);
                    if (!slugTouched) setNewProjectSlug(deriveSlug(e.target.value));
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  placeholder="My Awesome App"
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-text-muted outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1.5">Slug</label>
                <input
                  type="text"
                  value={newProjectSlug}
                  onChange={e => {
                    setSlugTouched(true);
                    setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  placeholder="my-awesome-app"
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded text-foreground placeholder:text-text-muted outline-none focus:border-[var(--accent)]"
                />
                <p className="text-xs text-text-dim mt-1.5">Used in public state URLs. Cannot be changed later.</p>
              </div>

              <p className="text-sm text-text-muted">
                {hasStagingEnv
                  ? 'Three default environments will be created: Development, Staging, and Production.'
                  : 'Two default environments will be created: Development and Production.'}
                {' '}You can edit these later in the Config tab.
              </p>
            </div>

            {createError && (
              <p className="text-sm text-destructive mt-4">{createError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowNewProject(false); setNewProjectName(''); setNewProjectSlug(''); setSlugTouched(false); setCreateError(null); }}
                className="px-4 py-2 text-sm text-text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || !newProjectSlug.trim() || creating}
                className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)]/90 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
