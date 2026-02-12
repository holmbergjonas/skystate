import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store';
import { deriveSlug } from '@/lib/format';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

const PRESET_COLORS = [
  '#ef4444', '#f59e0b', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280',
];

const RETENTION_PRESETS: { label: string; days: number | null }[] = [
  { label: 'Default', days: null },
  { label: 'No retention', days: 0 },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '1 year', days: 365 },
];

export function SettingsTab() {
  const { projects, selectedProjectId, updateProject, deleteProject, environments, createEnvironment, updateEnvironment, deleteEnvironment, user, billing, updateUserRetention } = useStore(
    useShallow(s => ({
      projects: s.projects,
      selectedProjectId: s.selectedProjectId,
      updateProject: s.updateProject,
      deleteProject: s.deleteProject,
      environments: s.environments,
      createEnvironment: s.createEnvironment,
      updateEnvironment: s.updateEnvironment,
      deleteEnvironment: s.deleteEnvironment,
      user: s.user,
      billing: s.billing,
      updateUserRetention: s.updateUserRetention,
    }))
  );
  const project = projects.find(p => p.projectId === selectedProjectId);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [envName, setEnvName] = useState('');
  const [envSlug, setEnvSlug] = useState('');
  const [envColor, setEnvColor] = useState('#6b7280');
  const [envSaving, setEnvSaving] = useState(false);
  const [envCreateError, setEnvCreateError] = useState<string | null>(null);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [editEnvName, setEditEnvName] = useState('');
  const [editEnvColor, setEditEnvColor] = useState('');
  const [editEnvSaving, setEditEnvSaving] = useState(false);
  const [deletingEnvId, setDeletingEnvId] = useState<string | null>(null);
  const [deleteEnvBusy, setDeleteEnvBusy] = useState(false);
  const [deleteEnvHasState, setDeleteEnvHasState] = useState<boolean | null>(null);
  const [deleteEnvInput, setDeleteEnvInput] = useState('');
  const [retentionInput, setRetentionInput] = useState('');
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [copiedStripeId, setCopiedStripeId] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setSlug(project.slug);
    }
    setDeleteInput('');
    setDeletingEnvId(null);
    setDeleteEnvHasState(null);
    setDeleteEnvInput('');
  }, [project?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally reset form only on project switch

  useEffect(() => {
    setRetentionInput(user?.customRetentionDays?.toString() ?? '');
  }, [user?.customRetentionDays]);

  useEffect(() => {
    if (editingEnvId !== null) {
      setDeletingEnvId(null);
    }
  }, [editingEnvId]);

  useEffect(() => {
    setDeleteEnvHasState(null);
    setDeleteEnvInput('');
    if (!deletingEnvId || !selectedProjectId) return;
    let cancelled = false;
    api.states.getLatest(selectedProjectId, deletingEnvId)
      .then((s) => {
        if (!cancelled) setDeleteEnvHasState(!(s.major === 0 && s.minor === 0 && s.patch === 0));
      })
      .catch((err) => {
        if (cancelled) return;
        setDeleteEnvHasState(err instanceof ApiError && err.status === 404 ? false : true);
      });
    return () => { cancelled = true; };
  }, [deletingEnvId, selectedProjectId]);

  const canDelete = project ? deleteInput === project.slug : false;
  const matchesPreset = RETENTION_PRESETS.some(p => (p.days?.toString() ?? '') === retentionInput);
  const customRetentionValue = matchesPreset ? '' : retentionInput;

  const editingEnv = editingEnvId ? environments.find(e => e.environmentId === editingEnvId) : null;
  const deletingEnv = deletingEnvId ? environments.find(e => e.environmentId === deletingEnvId) : null;

  const nameChanged = project ? name !== project.name : false;
  const retentionChanged = user && billing ? retentionInput !== (user.customRetentionDays?.toString() ?? '') : false;
  const isDirty = nameChanged || retentionChanged;

  async function handleSave() {
    if (!project || !name.trim()) return;
    setSaving(true);
    setRetentionError(null);
    try {
      const promises: Promise<void>[] = [
        updateProject(project.projectId, { name: name.trim(), apiKeyHash: project.apiKeyHash }),
      ];
      if (retentionChanged) {
        const days = retentionInput === '' ? null : parseInt(retentionInput, 10);
        promises.push(updateUserRetention(days));
      }
      await Promise.all(promises);
    } catch (err) {
      const message = err instanceof ApiError && typeof err.errorBody?.message === 'string'
        ? err.errorBody.message
        : 'Failed to save. Please try again.';
      setRetentionError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!project || !canDelete) return;
    setDeleteDialogOpen(false);
    setDeleteInput('');
    await deleteProject(project.projectId);
  }

  function handleDeleteDialogOpenChange(open: boolean) {
    setDeleteDialogOpen(open);
    if (!open) setDeleteInput('');
  }

  function handleReset() {
    if (project) {
      setName(project.name);
      setSlug(project.slug);
    }
    setRetentionInput(user?.customRetentionDays?.toString() ?? '');
    setRetentionError(null);
  }

  return (
    <div className="space-y-6">
      {/* ── Account ── */}
      {user && (
        <section className="rounded-2xl border border-border bg-[var(--surface)] overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">Account</h2>
            <p className="mt-1 text-sm text-text-muted">
              Your identity and account details.
            </p>
          </div>
          <div className="px-6 py-5">
            <div className="grid grid-cols-[1fr_2fr] gap-6 py-5">
              <div>
                <div className="text-sm text-foreground">User ID</div>
                <div className="text-xs text-text-muted mt-1 leading-snug">
                  Your unique account identifier.
                </div>
              </div>
              <div>
                <span className="text-sm text-foreground font-mono">{user.userId}</span>
              </div>
            </div>
            {user.displayName && (
              <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
                <div>
                  <div className="text-sm text-foreground">Display name</div>
                  <div className="text-xs text-text-muted mt-1 leading-snug">
                    Your name from your SSO provider.
                  </div>
                </div>
                <div className="text-sm text-foreground">{user.displayName}</div>
              </div>
            )}
            {user.email && (
              <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
                <div>
                  <div className="text-sm text-foreground">Email</div>
                  <div className="text-xs text-text-muted mt-1 leading-snug">
                    Your email from your SSO provider.
                  </div>
                </div>
                <div className="text-sm text-foreground">{user.email}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {!project ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Select a project to view settings
        </div>
      ) : (<>
      {/* ── Project ── */}
      <section className="rounded-2xl border border-border bg-[var(--surface)] overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Project</h2>
          <p className="mt-1 text-sm text-text-muted">
            Basic identifiers used across URLs and the dashboard.
          </p>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-[1fr_2fr] gap-6 py-5">
            <div>
              <div className="text-sm text-foreground">Project name</div>
              <div className="text-xs text-text-muted mt-1 leading-snug">
                Human-friendly name shown in the UI.
              </div>
            </div>
            <div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full max-w-[400px] px-4 py-3 border border-border bg-background rounded-xl text-sm text-foreground outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
            <div>
              <div className="text-sm text-foreground">Project slug</div>
              <div className="text-xs text-text-muted mt-1 leading-snug">
                Used in public state URLs. Read-only after creation.
              </div>
            </div>
            <div>
              <input
                type="text"
                value={slug}
                readOnly
                className="w-full max-w-[400px] px-4 py-3 border border-border bg-background rounded-xl text-sm text-text-muted outline-none cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Retention ── */}
      {user && billing && (
        <section className="rounded-2xl border border-border bg-[var(--surface)] overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">Retention</h2>
            <p className="mt-1 text-sm text-text-muted">
              Control how long old versions are kept before cleanup.
            </p>
          </div>
          <div className="px-6 py-5">
            <div className="grid grid-cols-[1fr_2fr] gap-6 py-5">
              <div>
                <div className="text-sm text-foreground">Version retention</div>
                <div className="text-xs text-text-muted mt-1 leading-snug">
                  Choose a preset or set a custom value (days).
                </div>
              </div>
              <div>
                <div className="flex flex-wrap gap-2">
                  {RETENTION_PRESETS.map((preset) => {
                    const val = preset.days?.toString() ?? '';
                    const isActive = retentionInput === val;
                    const isOverLimit = billing.retentionDays !== null && preset.days !== null && preset.days > billing.retentionDays;
                    const label = preset.days === null
                      ? `Default (${billing.retentionDays !== null ? `${billing.retentionDays} days` : 'unlimited'})`
                      : preset.label;
                    return (
                      <button
                        key={val}
                        disabled={isOverLimit}
                        onClick={() => {
                          setRetentionInput(val);
                          setRetentionError(null);
                        }}
                        className={`border border-border rounded-full px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-white/[0.08] text-foreground'
                            : 'bg-transparent text-text-secondary hover:bg-white/5'
                        } ${isOverLimit ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="border border-border bg-background rounded-xl p-4 mt-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="text-sm">Custom retention</div>
                      <div className="text-xs text-text-muted mt-1">Leave blank to use default.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g., 45"
                        value={customRetentionValue}
                        onChange={(e) => {
                          setRetentionInput(e.target.value);
                          setRetentionError(null);
                        }}
                        className="w-40 px-3 py-2 border border-border bg-background rounded-lg text-sm text-foreground outline-none focus:border-white/30 transition-colors"
                      />
                      <span className="text-xs text-text-muted">days</span>
                    </div>
                  </div>
                </div>
                {retentionError && (
                  <p className="text-sm text-destructive mt-3">{retentionError}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Billing ── */}
      {user?.stripeUserId && billing && (
        <section className="rounded-2xl border border-border bg-[var(--surface)] overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">Billing</h2>
              <p className="mt-1 text-sm text-text-muted">
                Subscription and payment details.
              </p>
            </div>
            <button
              disabled={portalLoading}
              onClick={async () => {
                setPortalLoading(true);
                try {
                  const { url } = await api.billing.portal({ returnUrl: window.location.href });
                  window.open(url, '_blank');
                } finally {
                  setPortalLoading(false);
                }
              }}
              className="px-4 py-2 rounded-xl text-sm bg-white/[0.08] text-foreground hover:bg-white/[0.12] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {portalLoading ? 'Opening...' : 'Manage in Stripe'}
            </button>
          </div>
          <div className="px-6 py-5">
            <div className="grid grid-cols-[1fr_2fr] gap-6 py-5">
              <div>
                <div className="text-sm text-foreground">Plan</div>
                <div className="text-xs text-text-muted mt-1 leading-snug">
                  Your current subscription tier.
                </div>
              </div>
              <div className="text-sm text-foreground capitalize">
                {billing.tier}{billing.boostMultiplier > 1 ? ` (${billing.boostMultiplier}x boost)` : ''}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
              <div>
                <div className="text-sm text-foreground">Stripe Customer ID</div>
                <div className="text-xs text-text-muted mt-1 leading-snug">
                  Your billing identifier.
                </div>
              </div>
              <div>
                <span
                  onClick={() => {
                    void navigator.clipboard.writeText(user.stripeUserId!);
                    setCopiedStripeId(true);
                    setTimeout(() => setCopiedStripeId(false), 2000);
                  }}
                  className="text-sm text-foreground cursor-pointer hover:text-white/80 transition-colors"
                  title="Click to copy"
                >
                  {copiedStripeId ? 'Copied!' : user.stripeUserId}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
              <div>
                <div className="text-sm text-foreground">Current period end</div>
                <div className="text-xs text-text-muted mt-1 leading-snug">
                  When the current billing period ends.
                </div>
              </div>
              <div className="text-sm text-foreground">
                {billing.currentPeriodEnd
                  ? new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                  : 'N/A'}
              </div>
            </div>
            {billing.lastStripeError && (
              <div className="grid grid-cols-[1fr_2fr] gap-6 py-5 border-t border-white/5">
                <div>
                  <div className="text-sm text-foreground">Last Stripe error</div>
                  <div className="text-xs text-text-muted mt-1 leading-snug">
                    Most recent billing error from Stripe.
                  </div>
                </div>
                <div className="text-sm text-red-400">
                  {billing.lastStripeError}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Environments ── */}
      <section className="rounded-2xl border border-border bg-[var(--surface)] overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Environments</h2>
            <p className="mt-1 text-sm text-text-muted">
              Use environments to separate state (e.g., prod, staging).
            </p>
          </div>
          <button
            onClick={() => { setShowAddEnv(true); setEditingEnvId(null); setDeletingEnvId(null); }}
            className="px-4 py-2 rounded-xl text-sm bg-white/[0.08] text-foreground hover:bg-white/[0.12] transition-colors cursor-pointer"
          >
            Add environment
          </button>
        </div>
        <div className="py-1">
          {environments.length === 0 && !showAddEnv ? (
            <p className="text-xs text-text-dim px-6 py-3">
              No environments yet. Add one to start managing state for this project.
            </p>
          ) : environments.length > 0 ? (
            <div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pl-6 pr-4 py-2.5 text-xs font-normal text-text-muted">Name</th>
                    <th className="px-4 py-2.5 text-xs font-normal text-text-muted">Slug</th>
                    <th className="px-4 py-2.5 text-xs font-normal text-text-muted">Color</th>
                    <th className="pl-4 pr-6 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {environments.map((env, i) => {
                    const color = env.color || '#6b7280';
                    return (
                      <tr key={env.environmentId} className={`${i > 0 ? 'border-t border-white/5' : ''} ${i % 2 === 1 ? 'bg-white/[0.02]' : ''} hover:bg-white/[0.04] transition-colors`}>
                        <td className="pl-6 pr-4 py-3">{env.name}</td>
                        <td className="px-4 py-3 text-text-secondary">{env.slug}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-block w-3 h-3 rounded-full align-middle mr-2"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm text-text-secondary">{color}</span>
                        </td>
                        <td className="pl-4 pr-6 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditingEnvId(env.environmentId);
                              setEditEnvName(env.name);
                              setEditEnvColor(env.color || '#6b7280');
                              setDeletingEnvId(null);
                            }}
                            className="px-3 py-1 rounded-lg text-xs text-foreground hover:bg-white/5 cursor-pointer transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeletingEnvId(env.environmentId);
                              setEditingEnvId(null);
                            }}
                            className="pl-3 pr-0 py-1 rounded-lg text-xs text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Edit environment panel */}
          {editingEnv && (
            <div className="border border-border bg-background rounded-2xl p-5 mx-6 mt-4 mb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Edit environment</div>
                  <div className="text-xs text-text-muted mt-1">
                    Update <strong>{editingEnv.name}</strong> settings.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingEnvId(null)}
                    className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={editEnvSaving || !editEnvName.trim()}
                    onClick={async () => {
                      if (!selectedProjectId || !editingEnvId) return;
                      setEditEnvSaving(true);
                      try {
                        await updateEnvironment(selectedProjectId, editingEnvId, {
                          name: editEnvName.trim(),
                          color: editEnvColor,
                        });
                        setEditingEnvId(null);
                      } finally {
                        setEditEnvSaving(false);
                      }
                    }}
                    className="px-4 py-2 rounded-xl text-sm bg-white/[0.08] text-foreground hover:bg-white/[0.12] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editEnvSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={editEnvName}
                    onChange={(e) => setEditEnvName(e.target.value)}
                    className="w-full px-4 py-3 border border-border bg-background rounded-xl text-sm text-foreground outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Slug</label>
                  <input
                    type="text"
                    value={editingEnv.slug}
                    readOnly
                    className="w-full px-4 py-3 border border-border bg-background rounded-xl text-sm text-text-muted outline-none cursor-not-allowed"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-text-muted mb-2">Color</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditEnvColor(c)}
                        className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          outline: editEnvColor === c ? '2px solid white' : 'none',
                          outlineOffset: '2px',
                        }}
                      />
                    ))}
                    <span className="text-xs text-text-dim ml-2">&hellip;or choose custom</span>
                    <input
                      type="color"
                      value={editEnvColor}
                      onChange={(e) => setEditEnvColor(e.target.value)}
                      className="w-10 h-7 border border-border rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delete environment panel */}
          {deletingEnv && (
            <div className="border border-red-500/20 bg-background rounded-2xl p-5 mx-6 mt-4 mb-4">
              {deleteEnvHasState === true && (
                <>
                  <p className="text-sm text-red-400 mb-2">
                    This environment contains state data. Removing it will permanently delete all state versions.
                  </p>
                  <p className="text-sm text-foreground mb-2">
                    To confirm, type <code className="bg-white/[0.08] px-1.5 py-0.5 rounded text-xs text-red-400">{deletingEnv.slug}</code> below:
                  </p>
                  <input
                    type="text"
                    value={deleteEnvInput}
                    onChange={(e) => setDeleteEnvInput(e.target.value)}
                    placeholder={deletingEnv.slug}
                    className="w-full max-w-xs px-4 py-3 border border-border bg-background rounded-xl text-sm text-foreground outline-none focus:border-red-500 transition-colors mb-3"
                  />
                </>
              )}
              {deleteEnvHasState === false && (
                <p className="text-sm text-foreground mb-3">
                  Remove <strong>{deletingEnv.name}</strong>? This will delete all state versions in this environment.
                </p>
              )}
              {deleteEnvHasState === null && (
                <p className="text-sm text-text-muted mb-3">Checking environment state...</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  disabled={deleteEnvBusy}
                  onClick={() => setDeletingEnvId(null)}
                  className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  disabled={deleteEnvBusy || !(deleteEnvHasState === false || (deleteEnvHasState === true && deleteEnvInput === deletingEnv.slug)) || deleteEnvHasState === null}
                  onClick={async () => {
                    if (!selectedProjectId || !deletingEnvId) return;
                    setDeleteEnvBusy(true);
                    try {
                      await deleteEnvironment(selectedProjectId, deletingEnvId);
                      setDeletingEnvId(null);
                    } finally {
                      setDeleteEnvBusy(false);
                    }
                  }}
                  className="px-4 py-3 rounded-xl text-sm bg-red-500/15 text-red-200 hover:bg-red-500/25 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleteEnvBusy ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          )}

          {/* Add environment panel */}
          {showAddEnv && (
            <div className="border border-border bg-background rounded-2xl p-5 mx-6 mt-4 mb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Add an environment</div>
                  <div className="text-xs text-text-muted mt-1">
                    Create a new isolated environment for this project.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowAddEnv(false);
                      setEnvName('');
                      setEnvSlug('');
                      setEnvColor('#6b7280');
                      setEnvCreateError(null);
                    }}
                    className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={envSaving || !envName.trim() || !envSlug.trim()}
                    onClick={async () => {
                      if (!selectedProjectId) return;
                      setEnvSaving(true);
                      try {
                        await createEnvironment(selectedProjectId, { name: envName.trim(), slug: envSlug.trim(), color: envColor });
                        setEnvName('');
                        setEnvSlug('');
                        setEnvColor('#6b7280');
                        setShowAddEnv(false);
                        setEnvCreateError(null);
                      } catch (err) {
                        if (err instanceof ApiError && err.status === 402) {
                          const body = err.errorBody as { code?: string } | null;
                          setEnvCreateError(
                            body?.code === 'LIMIT_ENVIRONMENTS'
                              ? 'You\'ve reached your environment limit. Upgrade your plan to add more environments.'
                              : 'Environment creation is not available on your current plan.'
                          );
                        } else {
                          setEnvCreateError('Failed to create environment. Please try again.');
                        }
                      } finally {
                        setEnvSaving(false);
                      }
                    }}
                    className="px-4 py-2 rounded-xl text-sm bg-white/[0.08] text-foreground hover:bg-white/[0.12] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {envSaving ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={envName}
                    onChange={(e) => {
                      setEnvName(e.target.value);
                      setEnvSlug(deriveSlug(e.target.value));
                    }}
                    placeholder="e.g., Staging"
                    className="w-full px-4 py-3 border border-border bg-background rounded-xl text-sm text-foreground outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Slug</label>
                  <input
                    type="text"
                    value={envSlug}
                    onChange={(e) => setEnvSlug(e.target.value)}
                    placeholder="e.g., staging"
                    className="w-full px-4 py-3 border border-border bg-background rounded-xl text-sm text-foreground outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-text-muted mb-2">Color</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEnvColor(c)}
                        className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          outline: envColor === c ? '2px solid white' : 'none',
                          outlineOffset: '2px',
                        }}
                      />
                    ))}
                    <span className="text-xs text-text-dim ml-2">&hellip;or choose custom</span>
                    <input
                      type="color"
                      value={envColor}
                      onChange={(e) => setEnvColor(e.target.value)}
                      className="w-10 h-7 border border-border rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              </div>
              {envCreateError && (
                <p className="text-sm text-destructive mt-4">{envCreateError}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Delete project ── */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] overflow-hidden">
        <div className="px-6 py-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-red-200">Delete project</h2>
            <p className="mt-1 text-sm text-red-200/70">
              Permanently delete this project, its environments, and all state versions.
            </p>
          </div>
          <AlertDialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
            <AlertDialogTrigger asChild>
              <button
                className="px-4 py-2 rounded-xl text-sm bg-red-500/15 text-red-200 hover:bg-red-500/25 transition-colors cursor-pointer"
              >
                Delete project
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete project</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{project.name}</strong>, its environments, and all state versions. Type the project slug below to confirm.
              </AlertDialogDescription>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={project.slug}
                className="w-full px-3 py-1.5 text-sm bg-transparent border border-[#333] rounded-md text-foreground placeholder:text-text-dim outline-none focus:border-red-500/60"
              />
              <div className="flex items-center gap-2 justify-end mt-4">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={!canDelete}
                  style={{
                    backgroundColor: canDelete ? 'rgb(239 68 68 / 0.4)' : 'rgb(239 68 68 / 0.1)',
                    color: canDelete ? '#fecaca' : 'var(--text-dim)',
                  }}
                >
                  Delete
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      {/* ── Sticky save bar ── */}
      <div className="sticky bottom-0 border border-border bg-[var(--surface-translucent)] backdrop-blur-xl rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="text-xs text-text-muted">Changes are saved at the project level.</div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={!isDirty}
              className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="px-4 py-2 rounded-xl text-sm bg-white/[0.08] text-foreground hover:bg-white/[0.12] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}
