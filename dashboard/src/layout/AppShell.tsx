import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { TopBar } from './TopBar';
import type { TabId } from './TabBar';
import { StateTab } from '@/features/state/StateTab';
import { UsageTab } from '@/features/usage/UsageTab';
import { PlansTab } from '@/features/usage/PlansTab';
import { SettingsTab } from '@/features/settings/SettingsTab';
import { NewProjectPage } from '@/features/projects/NewProjectPage';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { useEditorGuards } from '@/features/state/useEditorGuards';
import { cn } from '@/lib/utils';

function tabFromPath(pathname: string): TabId {
  if (pathname === '/settings') return 'settings';
  if (pathname === '/usage') return 'usage';
  if (pathname === '/plans') return 'plans';
  return 'state';
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);
  const setActiveTab = useCallback(
    (tab: TabId) =>
      navigate(tab === 'settings' ? '/settings' : tab === 'usage' ? '/usage' : tab === 'plans' ? '/plans' : '/'),
    [navigate],
  );
  const [editorDirty, setEditorDirty] = useState(false);

  const { guardNavigation, confirmDialogOpen, confirmProceed, confirmCancel } = useEditorGuards({
    isDirty: editorDirty,
    onDiscard: () => setEditorDirty(false),
  });

  const setUser = useStore(s => s.setUser);
  const loadProjects = useStore(s => s.loadProjects);
  const loadBilling = useStore(s => s.loadBilling);

  const projects = useStore(s => s.projects);
  const selectedProjectId = useStore(s => s.selectedProjectId);
  const selectProject = useStore(s => s.selectProject);
  const environments = useStore(s => s.environments);
  const environmentsLoading = useStore(s => s.environmentsLoading);

  const guardedSetActiveTab = useCallback(
    (tab: TabId) => guardNavigation(() => setActiveTab(tab)),
    [guardNavigation, setActiveTab],
  );

  // Bootstrap data loading on mount
  useEffect(() => {
    api.users.getCurrent().then(user => setUser(user));
    loadProjects();
    loadBilling();
  }, [setUser, loadProjects, loadBilling]);

  // Auto-select first project only on initial load (not after deletion)
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (projects.length === 0) return;
    if (hasAutoSelected.current) return;
    const selectionValid = selectedProjectId !== null && projects.some(p => p.projectId === selectedProjectId);
    if (!selectionValid) {
      selectProject(projects[0].projectId);
    }
    hasAutoSelected.current = true;
  }, [projects, selectedProjectId, selectProject]);

  // Auto-navigate to usage tab when returning from Stripe checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('checkout') && activeTab !== 'plans') {
      navigate('/plans', { replace: true });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine what to show in the main content area
  const showNewProjectPage = projects.length === 0;
  const showNoProject = !selectedProjectId && activeTab !== 'usage' && activeTab !== 'plans';
  const showNoEnvironments =
    selectedProjectId &&
    !environmentsLoading &&
    environments.length === 0 &&
    activeTab === 'state';

  const isContainedLayout = activeTab === 'state';

  return (
    <div className={cn('bg-app flex flex-col', isContainedLayout ? 'h-screen overflow-hidden' : 'min-h-screen')}>
      <TopBar
        onProjectSelect={(projectId) => guardNavigation(() => { selectProject(projectId); setActiveTab('state'); })}
        activeTab={activeTab}
        onTabChange={guardedSetActiveTab}
      />
      <main className={cn('px-6 py-6 flex-1 flex flex-col max-w-screen-2xl w-full mx-auto', isContainedLayout && 'min-h-0')}>
        <div className={cn('flex-1 flex flex-col', isContainedLayout && 'min-h-0')}>
          {activeTab === 'usage' ? (
            <div className="flex-1"><UsageTab /></div>
          ) : activeTab === 'plans' ? (
            <div className="flex-1"><PlansTab /></div>
          ) : showNewProjectPage ? (
            <NewProjectPage />
          ) : showNoProject ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="text-text-muted text-sm mb-2">No project selected</div>
              <p className="text-xs text-text-dim max-w-xs">
                Select an existing project from the dropdown above, or create a new one to get started.
              </p>
            </div>
          ) : showNoEnvironments ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="text-text-muted text-sm mb-2">No environments</div>
              <p className="text-xs text-text-dim max-w-xs mb-4">
                This project has no environments yet. Create one to get started.
              </p>
              <button
                onClick={() => setActiveTab('settings')}
                className="text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
              >
                Go to Config &rarr;
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: activeTab === 'state' ? undefined : 'none' }} className="flex-1 min-h-0 flex flex-col">
                <StateTab active={activeTab === 'state'} onDirtyChange={setEditorDirty} guardNavigation={guardNavigation} />
              </div>
              {activeTab === 'settings' && <div className="flex-1"><SettingsTab /></div>}
            </>
          )}
        </div>
      </main>
      {confirmDialogOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={confirmCancel}>
          <div className="bg-[var(--popover)] border border-[#333] rounded-lg p-8 w-[420px] shadow-[0_0_40px_rgba(0,0,0,0.5)] ring-1 ring-white/5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-foreground mb-3">Unsaved changes</h3>
            <p className="text-sm text-text-muted mb-6">
              You have unsaved changes. Do you want to discard them?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={confirmCancel}
                className="px-4 py-2 text-sm text-text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmProceed}
                className="px-4 py-2 text-sm bg-[var(--destructive)] text-white rounded hover:bg-[var(--destructive)]/90 transition-colors cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
