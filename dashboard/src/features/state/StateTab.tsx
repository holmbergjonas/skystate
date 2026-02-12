import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Braces, Pencil } from 'lucide-react';
import { buildLines, type DiffStats, type DiffLine } from '@/lib/diff';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { CodeMirrorEditorHandle } from './CodeMirrorEditor';
import { VersionDropdown } from './VersionDropdown';
import { ActionModeGroup, type CompareTarget } from './ActionModeGroup';
import { ActionBar } from './ActionBar';
import { computeNextVersion, getPushErrorMessage, type BumpType } from './push-utils';
import { formatJson, formatVersion } from '@/lib/format';
import { UnifiedDiffView } from './UnifiedDiffView';
import { EditorView } from './EditorView';
import { PushUpdateBar } from './PushUpdateBar';
import { deriveView } from './mode-state';
import { VersionMetaBar } from './VersionMetaBar';
import { envColors } from './constants';


/**
 * Semantic version suggestion based on diff nature:
 * - Major: key removals or type changes (breaking)
 * - Minor: key additions (non-breaking structural)
 * - Patch: value-only changes
 */
function suggestBumpFromStats(stats: DiffStats): BumpType {
  // Type changes or removed keys/structure = breaking → major
  if (stats.hasTypeChange || stats.removed > 0) return 'major';
  // New keys/structure added = non-breaking structural → minor
  if (stats.added > 0) return 'minor';
  // Value-only changes → patch
  return 'patch';
}

interface StateTabProps {
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  guardNavigation?: (action: () => void) => void;
}

export function StateTab({ active, onDirtyChange, guardNavigation }: StateTabProps) {
  const {
    selectedEnvironmentId,
    environments,
    stateVersions,
    stateVersionsError,
    loadStateVersions,
    selectedProjectId,
    selectEnvironment,
    loadBilling,
    promoteTargetCache,
    preloadPromoteTargets,
    tabState: { selectedIndex, activeMode },
    tabDispatch: dispatch,
  } = useStore(
    useShallow(s => ({
      selectedEnvironmentId: s.selectedEnvironmentId,
      environments: s.environments,
      stateVersions: s.stateVersions,
      stateVersionsError: s.stateVersionsError,
      loadStateVersions: s.loadStateVersions,
      selectedProjectId: s.selectedProjectId,
      selectEnvironment: s.selectEnvironment,
      loadBilling: s.loadBilling,
      promoteTargetCache: s.promoteTargetCache,
      preloadPromoteTargets: s.preloadPromoteTargets,
      tabState: s.tabState,
      tabDispatch: s.tabDispatch,
    }))
  );
  const selectedEnv = environments.find(e => e.environmentId === selectedEnvironmentId);

  const editorValueRef = useRef<string>('');
  const editorRef = useRef<CodeMirrorEditorHandle>(null);

  const view = deriveView(activeMode);

  // -- Handlers -------------------------------------------------------------

  const handleDirtyChange = useCallback((dirty: boolean) => {
    let jsonValid = true;
    if (dirty) {
      try {
        JSON.parse(editorValueRef.current);
      } catch {
        jsonValid = false;
      }
    }
    dispatch({ type: 'SET_DIRTY', isDirty: dirty, isJsonValid: jsonValid });
    onDirtyChange?.(dirty);
  }, [onDirtyChange]); // eslint-disable-line react-hooks/exhaustive-deps -- dispatch is stable (zustand), intentionally excluded

  // Load state versions when project and environment are selected
  useEffect(() => {
    if (selectedProjectId && selectedEnvironmentId) {
      loadStateVersions(selectedProjectId, selectedEnvironmentId);
    }
  }, [selectedProjectId, selectedEnvironmentId, loadStateVersions]);

  function exitEditMode() {
    dispatch({ type: 'EXIT_EDITING' });
  }

  function handleCancelEdit() {
    const dirty = view.mode === 'editor' && view.editing && view.isDirty;
    if (dirty && guardNavigation) {
      guardNavigation(() => exitEditMode());
    } else {
      exitEditMode();
    }
  }

  // Reset transient state when environment changes, preserving valid modes
  useEffect(() => {
    dispatch({ type: 'RESET_FOR_ENV_CHANGE', newEnvId: selectedEnvironmentId ?? '' });
    onDirtyChange?.(false);
  }, [selectedEnvironmentId]); // eslint-disable-line react-hooks/exhaustive-deps -- onDirtyChange is stable, intentionally excluded to avoid re-triggering on prop change

  // Re-fetch promote target after environment switch preserved promote mode with loading target
  useEffect(() => {
    if (activeMode?.mode !== 'promote') return;
    if (activeMode.target.status !== 'loading') return;
    const targetEnvId = activeMode.targetEnvId;
    const cached = promoteTargetCache.get(targetEnvId);
    if (cached) {
      dispatch({ type: 'PROMOTE_TARGET_LOADED', latest: cached.latest, isFresh: cached.isFresh });
      return;
    }
    if (stateVersions.length === 0) return;
    api.states.getLatest(stateVersions[0].projectStateId, targetEnvId)
      .then(latest => dispatch({ type: 'PROMOTE_TARGET_LOADED', latest, isFresh: false }))
      .catch(err => {
        if (err instanceof ApiError && err.status === 404) {
          dispatch({ type: 'PROMOTE_TARGET_LOADED', latest: null, isFresh: true });
        } else {
          dispatch({ type: 'PROMOTE_TARGET_ERROR', error: 'Failed to reload promote target.' });
        }
      });
  }, [activeMode]); // eslint-disable-line react-hooks/exhaustive-deps -- dispatch, promoteTargetCache, stateVersions, api are stable references

  // Reset to editor mode when tab becomes active again (was hidden, now shown)
  const prevActiveRef = useRef(active);
  useEffect(() => {
    if (active && !prevActiveRef.current) {
      dispatch({ type: 'RETURN_TO_EDITOR' });
    }
    prevActiveRef.current = active;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- dispatch is stable (zustand), intentionally excluded

  // Compute displayed state from version
  const selectedVersion = stateVersions[selectedIndex];
  const versionStr = selectedVersion
    ? formatVersion(selectedVersion)
    : '';
  const displayedState = useMemo(() => {
    const raw = selectedVersion?.state ?? '{}';
    try {
      return formatJson(raw);
    } catch {
      return raw;
    }
  }, [selectedVersion?.state]);

  const latestVersion = stateVersions[0];
  const editBumpType = view.mode === 'editor' && view.editing ? view.bumpType : 'patch';
  const nextVersionPreview = latestVersion
    ? computeNextVersion(latestVersion, editBumpType)
    : null;

  // Promote: available target environments (exclude current)
  const promoteEnvs = useMemo(
    () => environments.filter(e => e.environmentId !== selectedEnvironmentId),
    [environments, selectedEnvironmentId],
  );

  // Preload latest state for each promote-eligible environment
  useEffect(() => {
    if (stateVersions.length === 0 || promoteEnvs.length === 0) return;
    const psId = stateVersions[0].projectStateId;
    preloadPromoteTargets(psId, promoteEnvs.map(e => e.environmentId));
  }, [stateVersions, promoteEnvs, preloadPromoteTargets]);

  const promoteTargetEnvId = view.mode === 'promote' ? view.targetEnvId : null;
  const promoteTargetEnv = promoteEnvs.find(e => e.environmentId === promoteTargetEnvId);
  const promoteTargetEnvName = promoteTargetEnv?.name ?? '';
  const promoteTargetEnvSlug = promoteTargetEnv?.slug ?? '';

  // Extract stable primitive values from view to avoid infinite re-render loops.
  // deriveView() creates a new object every render, so using `view` directly
  // in useMemo/useEffect deps causes them to fire every render.
  const isPromoteMode = view.mode === 'promote';
  const promoteLoading = isPromoteMode ? view.loadingTarget : false;
  const promoteIsFresh = isPromoteMode ? view.targetIsFresh : false;
  const promoteTargetState = isPromoteMode && !promoteLoading ? view.targetLatest?.state ?? null : null;

  // Promote diff: source (current env) on left, target on right.
  // Swap line statuses (added↔removed) so colors show promote perspective:
  // source-only lines (will be added to target) render green,
  // target-only lines (will be removed from target) render red.
  // Stats are also swapped so badge shows target perspective.
  const promoteDiffResult = useMemo(() => {
    if (!isPromoteMode) return null;
    if (promoteLoading) return null;

    let result;
    if (promoteIsFresh) {
      try {
        const sourceFormatted = formatJson(selectedVersion?.state ?? '{}');
        result = buildLines(sourceFormatted, '{}');
      } catch {
        return null;
      }
    } else {
      if (!promoteTargetState) return null;
      try {
        const sourceFormatted = formatJson(selectedVersion?.state ?? '{}');
        const targetFormatted = formatJson(promoteTargetState);
        result = buildLines(sourceFormatted, targetFormatted);
      } catch {
        return null;
      }
    }

    return {
      lines: result.lines.map((line): DiffLine => ({
        ...line,
        status: line.status === 'added' ? 'removed'
              : line.status === 'removed' ? 'added'
              : line.status,
      })),
      stats: { added: result.stats.removed, removed: result.stats.added, changed: result.stats.changed, hasTypeChange: result.stats.hasTypeChange },
    };
  }, [isPromoteMode, promoteLoading, promoteIsFresh, promoteTargetState, selectedVersion?.state]);

  useEffect(() => {
    if (!promoteDiffResult || promoteIsFresh) return;
    const bumpType = suggestBumpFromStats(promoteDiffResult.stats);
    dispatch({ type: 'SET_PROMOTE_BUMP_TYPE', bumpType });
  }, [promoteDiffResult, promoteIsFresh, dispatch]);

  // Rollback version: when in rollback mode, use the selected version
  const rollbackVersion = stateVersions[selectedIndex];
  const rollbackVersionStr = rollbackVersion
    ? formatVersion(rollbackVersion)
    : '';

  // Compute diff for all 3 modes
  const compareTargetState = view.mode === 'compare' ? view.target.state : null;
  const diffResult = useMemo(() => {
    if (view.mode === 'compare' && compareTargetState !== null) {
      const result = buildLines(displayedState, compareTargetState);
      return {
        lines: result.lines,
        stats: { added: result.stats.removed, removed: result.stats.added, changed: result.stats.changed, hasTypeChange: result.stats.hasTypeChange },
      };
    }
    if (isPromoteMode) {
      return promoteDiffResult;
    }
    if (view.mode === 'rollback' && selectedVersion && latestVersion) {
      try {
        const latestFormatted = formatJson(latestVersion.state);
        const rollbackFormatted = formatJson(selectedVersion.state);
        return buildLines(latestFormatted, rollbackFormatted);
      } catch {
        return null;
      }
    }
    return null;
  }, [view.mode, compareTargetState, isPromoteMode, displayedState, promoteDiffResult, selectedVersion, latestVersion]);

  // Rollback result version: derived from diff between latest and rollback target
  const rollbackBumpType: BumpType = view.mode === 'rollback' && diffResult?.stats
    ? suggestBumpFromStats(diffResult.stats)
    : 'patch';
  const rollbackResultVersion = latestVersion
    ? computeNextVersion(latestVersion, rollbackBumpType)
    : null;
  const rollbackResultVersionStr = rollbackResultVersion
    ? formatVersion(rollbackResultVersion)
    : '';

  // Rollback version selection handler (from dropdown)
  function handleRollbackSelect(versionIndex: number) {
    dispatch({ type: 'ENTER_ROLLBACK', selectedIndex: versionIndex });
  }

  // Mode change handler (return to editor)
  function handleModeChange(newMode: 'editor' | 'compare' | 'promote' | 'rollback') {
    if (newMode === 'editor') {
      dispatch({ type: 'RETURN_TO_EDITOR' });
      return;
    }

    if (newMode === 'rollback') {
      // Auto-select previous version if latest is selected
      const idx = selectedIndex === 0 && stateVersions.length > 1 ? 1 : selectedIndex;
      dispatch({ type: 'ENTER_ROLLBACK', selectedIndex: idx });
      return;
    }

    // compare and promote are entered via their specific handlers
    // (handleCompare / handleSelectPromoteTarget), not via mode buttons
  }

  function handleCompare(target: CompareTarget) {
    dispatch({ type: 'SET_COMPARE', target });
  }

  async function handleSelectPromoteTarget(envId: string) {
    dispatch({ type: 'ENTER_PROMOTE', targetEnvId: envId });

    // Use preloaded data if available
    const cached = promoteTargetCache.get(envId);
    if (cached) {
      dispatch({ type: 'PROMOTE_TARGET_LOADED', latest: cached.latest, isFresh: cached.isFresh });
      return;
    }

    // Fallback: fetch on demand
    try {
      const latest = await api.states.getLatest(
        stateVersions[0].projectStateId,
        envId,
      );
      dispatch({ type: 'PROMOTE_TARGET_LOADED', latest, isFresh: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        dispatch({ type: 'PROMOTE_TARGET_LOADED', latest: null, isFresh: true });
      } else if (err instanceof ApiError) {
        dispatch({ type: 'PROMOTE_TARGET_ERROR', error: `Failed to fetch target state (${err.status})` });
      } else if (err instanceof TypeError) {
        dispatch({ type: 'PROMOTE_TARGET_ERROR', error: 'Network error \u2014 check your connection and try again.' });
      } else {
        dispatch({ type: 'PROMOTE_TARGET_ERROR', error: 'An unexpected error occurred.' });
      }
    }
  }

  async function handleConfirmPromote() {
    if (activeMode?.mode !== 'promote') return;

    const targetEnv = activeMode.targetEnvId;
    const isFresh = activeMode.target.status === 'loaded' && activeMode.target.isFresh;
    const sourceVersionStr = formatVersion(selectedVersion);
    const sourceEnvName = selectedEnv?.name ?? '';

    dispatch({ type: 'PROMOTE_START' });

    try {
      const freshTarget = isFresh
        ? null
        : await api.states.getLatest(stateVersions[0].projectStateId, targetEnv);

      const bumpType = view.mode === 'promote' ? view.bumpType : 'patch';
      const version = isFresh
        ? { major: 0, minor: 0, patch: 1 }
        : computeNextVersion(freshTarget!, bumpType);

      await api.states.create(stateVersions[0].projectStateId, targetEnv, {
        major: version.major,
        minor: version.minor,
        patch: version.patch,
        state: selectedVersion.state,
        comment: `Promoted from ${sourceEnvName} v${sourceVersionStr}`,
      });

      loadBilling();
      selectEnvironment(targetEnv);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 402) {
          const body = err.errorBody as { code?: string } | null;
          dispatch({ type: 'PROMOTE_ERROR', error: body?.code === 'LIMIT_STORAGE'
            ? 'Storage limit reached. Upgrade your plan to promote state.'
            : 'Limit reached. Please upgrade your plan.' });
        } else if (err.status === 404) {
          dispatch({ type: 'PROMOTE_ERROR', error: 'Version conflict \u2014 another update was pushed. Please try again.' });
        } else {
          dispatch({ type: 'PROMOTE_ERROR', error: `Failed to promote (${err.status})` });
        }
      } else if (err instanceof TypeError) {
        dispatch({ type: 'PROMOTE_ERROR', error: 'Network error \u2014 check your connection and try again.' });
      } else {
        dispatch({ type: 'PROMOTE_ERROR', error: 'An unexpected error occurred. Please try again.' });
      }
    }
  }

  async function handleRollbackConfirm() {
    if (!selectedProjectId || !selectedEnvironmentId) return;

    const targetVersion = stateVersions[selectedIndex];
    if (!targetVersion) return;

    dispatch({ type: 'ROLLBACK_START' });

    try {
      await api.states.rollback(
        stateVersions[0].projectStateId,
        selectedEnvironmentId,
        targetVersion.projectStateId,
      );

      await loadStateVersions(
        stateVersions[0].projectStateId,
        selectedEnvironmentId,
      );
      dispatch({ type: 'ROLLBACK_SUCCESS' });
      loadBilling();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 402) {
          const body = err.errorBody as { code?: string } | null;
          dispatch({ type: 'ROLLBACK_ERROR', error: body?.code === 'LIMIT_STORAGE'
            ? 'Storage limit reached. Upgrade your plan to roll back.'
            : 'Limit reached. Please upgrade your plan.' });
        } else if (err.status === 404) {
          dispatch({ type: 'ROLLBACK_ERROR', error: 'Version not found. It may have been deleted.' });
        } else {
          dispatch({ type: 'ROLLBACK_ERROR', error: `Failed to roll back (${err.status})` });
        }
      } else if (err instanceof TypeError) {
        dispatch({ type: 'ROLLBACK_ERROR', error: 'Network error \u2014 check your connection and try again.' });
      } else {
        dispatch({ type: 'ROLLBACK_ERROR', error: 'An unexpected error occurred. Please try again.' });
      }
    }
  }

  async function handlePush(comment?: string) {
    if (!(view.mode === 'editor' && view.editing && view.canPush) || !selectedProjectId || !selectedEnvironmentId) return;

    dispatch({ type: 'PUSH_START' });

    const content = editorValueRef.current;

    try {
      const freshLatest = await api.states.getLatest(
        stateVersions[0].projectStateId,
        selectedEnvironmentId,
      );

      const next = computeNextVersion(freshLatest, editBumpType);

      await api.states.create(
        stateVersions[0].projectStateId,
        selectedEnvironmentId,
        {
          major: next.major,
          minor: next.minor,
          patch: next.patch,
          state: content,
          comment: comment || undefined,
        },
      );

      await loadStateVersions(
        stateVersions[0].projectStateId,
        selectedEnvironmentId,
      );
      dispatch({ type: 'PUSH_SUCCESS' });
      loadBilling();
    } catch (err) {
      dispatch({ type: 'PUSH_ERROR', error: getPushErrorMessage(err) });
    }
  }

  const showContent = stateVersions.length > 0;
  const editing = view.mode === 'editor' && view.editing;
  const actionMode = view.mode === 'compare' || view.mode === 'promote' || view.mode === 'rollback';

  // Compare target label for dropdown button
  const compareTargetEnvName = view.mode === 'compare'
    ? (() => {
        const env = environments.find(e => e.slug === view.target.env);
        return env?.name;
      })()
    : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {stateVersionsError ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-[var(--surface-translucent)] p-6 text-center">
          <p className="text-sm text-text-muted">Could not load state versions</p>
          <p className="text-xs text-text-dim mt-1">{stateVersionsError}</p>
        </div>
      ) : (
        <>
          {showContent && (
            <div className="grid grid-cols-[auto_1fr_auto] items-center mb-3">
              <VersionDropdown
                onSelectEnvironment={(envId) => {
                  if (envId === selectedEnvironmentId) return;
                  const action = () => selectEnvironment(envId);
                  if (guardNavigation) { guardNavigation(action); } else { action(); }
                }}
                disabled={editing}
              />
              <div className="min-w-0" />
              <ActionModeGroup
                mode={view.mode === 'editor' ? 'editor' : view.mode}
                compareTarget={view.mode === 'compare' ? view.target : null}
                onModeChange={handleModeChange}
                onCompare={handleCompare}
                onSelectPromoteTarget={handleSelectPromoteTarget}
                onRollbackSelect={handleRollbackSelect}
                stateVersions={stateVersions}
                disabled={editing}
                promoteDisabled={environments.length <= 1 || stateVersions.length === 0}
                rollbackDisabled={stateVersions.length <= 1}
                promoteTargetEnvId={promoteTargetEnvId}
                rollbackSelectedIndex={view.mode === 'rollback' ? selectedIndex : undefined}
              />
            </div>
          )}

          {/* Diff stats badge -- rendered outside grid for true screen centering */}
          {actionMode && diffResult?.stats && (diffResult.stats.added > 0 || diffResult.stats.removed > 0 || diffResult.stats.changed > 0) && (
            <div className="fixed left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="flex items-center gap-1.5 text-xs tabular-nums bg-[var(--surface-translucent)] border border-border rounded-full px-2.5 py-1 pointer-events-auto">
                {diffResult.stats.added > 0 && <span style={{ color: 'var(--diff-added)' }}>+{diffResult.stats.added}</span>}
                {diffResult.stats.removed > 0 && <span style={{ color: 'var(--diff-removed)' }}>-{diffResult.stats.removed}</span>}
                {diffResult.stats.changed > 0 && <span style={{ color: 'var(--diff-changed)' }}>~{diffResult.stats.changed}</span>}
              </div>
            </div>
          )}

          {/* Editor / Compare / Promote / Rollback area */}
          <div className="flex flex-col">
            <div className="flex flex-col min-h-[315px] h-[50vh] max-h-[600px] overflow-hidden rounded-[var(--radius-card)] border border-border bg-[var(--surface-translucent)]">
              <EditorView
                header={showContent && selectedVersion ? (() => {
                  if (view.mode === 'compare') {
                    return (
                      <VersionMetaBar
                        source={{
                          label: selectedEnv?.name ?? 'Source',
                          comment: selectedVersion.comment,
                          stateSizeBytes: selectedVersion.stateSizeBytes,
                          createdAt: selectedVersion.createdAt,
                        }}
                        target={{
                          label: compareTargetEnvName ?? view.target.env,
                          comment: view.target.comment,
                          stateSizeBytes: view.target.stateSizeBytes,
                          createdAt: view.target.createdAt,
                        }}
                      />
                    );
                  }
                  if (view.mode === 'promote' && !view.loadingTarget) {
                    return (
                      <VersionMetaBar
                        source={{
                          label: selectedEnv?.name ?? 'Source',
                          comment: selectedVersion.comment,
                          stateSizeBytes: selectedVersion.stateSizeBytes,
                          createdAt: selectedVersion.createdAt,
                        }}
                        target={{
                          label: promoteTargetEnvName || 'Target',
                          comment: view.targetLatest?.comment,
                          stateSizeBytes: view.targetLatest?.stateSizeBytes,
                          createdAt: view.targetLatest?.createdAt,
                        }}
                      />
                    );
                  }
                  if (view.mode === 'rollback') {
                    return (
                      <VersionMetaBar
                        source={{
                          label: `Rolling back to v${rollbackVersionStr}`,
                          comment: selectedVersion.comment,
                          stateSizeBytes: selectedVersion.stateSizeBytes,
                          createdAt: selectedVersion.createdAt,
                        }}
                        target={{
                          label: `Current (v${formatVersion(latestVersion!)})`,
                          comment: latestVersion?.comment,
                          stateSizeBytes: latestVersion?.stateSizeBytes,
                          createdAt: latestVersion?.createdAt,
                        }}
                      />
                    );
                  }
                  // editor/viewing mode
                  return (
                    <VersionMetaBar
                      source={{
                        comment: selectedVersion.comment,
                        stateSizeBytes: selectedVersion.stateSizeBytes,
                        createdAt: selectedVersion.createdAt,
                      }}
                      trailing={editing ? (
                        <button
                          onClick={() => editorRef.current?.format()}
                          title="Format JSON (Shift+Alt+F)"
                          className="text-text-dim hover:text-foreground transition-colors cursor-pointer p-1 rounded hover:bg-[var(--hover)]"
                        >
                          <Braces className="h-3.5 w-3.5" />
                        </button>
                      ) : undefined}
                    />
                  );
                })() : undefined}
                displayedState={displayedState}
                isEditing={editing}
                editorRef={editorRef}
                editorValueRef={editorValueRef}
                selectedVersionId={selectedVersion?.projectStateId ?? ''}
                onDirtyChange={handleDirtyChange}
              >
                {actionMode && diffResult ? (
                  <UnifiedDiffView diffResult={diffResult} />
                ) : undefined}
              </EditorView>
            </div>

            {/* Edit button - only in editor mode when not editing */}
            {view.mode === 'editor' && !editing && (
              <div className="flex items-center gap-2 mt-3 flex-shrink-0 justify-end">
                <button
                  onClick={() => dispatch({ type: 'START_EDITING' })}
                  className="flex items-center gap-1.5 text-sm font-medium cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3.5 py-1.5"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              </div>
            )}

            {/* Compare mode label */}
            {view.mode === 'compare' && (
              <div className="mt-3 flex-shrink-0">
                <span className="text-sm text-text-muted">
                  Comparing with <span className="text-foreground">{compareTargetEnvName ?? view.target.env}</span> <span className="text-foreground tabular-nums">v{view.target.versionStr}</span>
                </span>
              </div>
            )}

            {/* ActionBar for promote/rollback modes */}
            {view.mode === 'promote' && !view.loadingTarget && (
              <div className="flex-shrink-0">
                <ActionBar
                mode="promote"
                targetEnvName={promoteTargetEnvName}
                targetEnvSlug={promoteTargetEnvSlug}
                targetLatest={view.targetLatest}
                targetIsFresh={view.targetIsFresh}
                bumpType={view.bumpType}
                onBumpTypeChange={(bt) => dispatch({ type: 'SET_PROMOTE_BUMP_TYPE', bumpType: bt })}
                isConfirming={view.isPromoting}
                error={view.promoteError}
                diffStats={diffResult?.stats ?? null}
                onConfirm={handleConfirmPromote}
                onCancel={() => handleModeChange('editor')}
                sourceEnvName={selectedEnv?.name ?? ''}
                sourceVersionStr={versionStr}
              />
              </div>
            )}

            {view.mode === 'rollback' && (
              <div className="flex-shrink-0">
                <ActionBar
                mode="rollback"
                envName={selectedEnv?.name ?? ''}
                envColor={envColors[selectedEnv?.slug ?? ''] ?? 'var(--muted-foreground)'}
                versionStr={rollbackVersionStr}
                resultVersionStr={rollbackResultVersionStr}
                isConfirming={view.isRollingBack}
                error={view.rollbackError}
                onConfirm={handleRollbackConfirm}
                onCancel={() => handleModeChange('editor')}
              />
              </div>
            )}

            {/* PushUpdateBar (when editing) */}
            {view.mode === 'editor' && view.editing && (
              <div className="mt-3 flex-shrink-0">
                <PushUpdateBar
                  onBumpTypeChange={(bt) => dispatch({ type: 'SET_BUMP_TYPE', bumpType: bt })}
                  currentVersion={latestVersion ?? null}
                  nextVersion={nextVersionPreview}
                  canPush={view.canPush}
                  isPushing={view.isPushing}
                  pushError={view.pushError}
                  onPush={handlePush}
                  onCancel={handleCancelEdit}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
