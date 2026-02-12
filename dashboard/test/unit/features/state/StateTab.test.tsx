import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { tabReducer, INITIAL_STATE } from '@/features/state/mode-state';
import type { TabAction, TabState } from '@/features/state/mode-state';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Real Zustand store so state changes trigger React re-renders
type TestState = Record<string, unknown>;
let testStore: UseBoundStore<StoreApi<TestState>>;

vi.mock('@/store', () => ({
  useStore: (selector: (s: TestState) => unknown) => testStore(selector),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T, U>(selector: (state: T) => U) => {
    let prev: U | undefined;
    return (state: T) => {
      const next = selector(state);
      if (prev === undefined) {
        prev = next;
        return next;
      }
      // Shallow comparison for objects
      if (typeof next === 'object' && next !== null && typeof prev === 'object' && prev !== null) {
        const nextKeys = Object.keys(next);
        const prevKeys = Object.keys(prev);
        if (nextKeys.length !== prevKeys.length) {
          prev = next;
          return next;
        }
        for (const key of nextKeys) {
          if ((next as Record<string, unknown>)[key] !== (prev as Record<string, unknown>)[key]) {
            prev = next;
            return next;
          }
        }
        return prev;
      }
      // For non-objects, use reference equality
      if (next !== prev) {
        prev = next;
        return next;
      }
      return prev;
    };
  },
}));

const mockStatesList = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    states: {
      list: (...args: unknown[]) => mockStatesList(...args),
    },
  },
}));

// CodeMirrorEditor needs CodeMirror internals — replace with a simple textarea
vi.mock('@/features/state/CodeMirrorEditor', () => ({
  CodeMirrorEditor: forwardRef(function FakeEditor(
    _props: { initialValue: string; readOnly: boolean },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ref: unknown,
  ) {
    return <textarea data-testid="codemirror" defaultValue={_props.initialValue} readOnly={_props.readOnly} />;
  }),
}));

import { StateTab } from '@/features/state/StateTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVersion(major: number, minor: number, patch: number, state = '{}') {
  return {
    projectStateId: `ps-${major}.${minor}.${patch}`,
    environmentId: 'env-1',
    major,
    minor,
    patch,
    state,
    comment: null,
    createdAt: '2024-01-01T00:00:00Z',
    stateSizeBytes: state.length,
    version: { major, minor, patch },
  };
}

function seedStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testStore = create<TestState>()((set: any) => ({
    selectedEnvironmentId: 'env-1',
    environments: [
      { environmentId: 'env-1', projectId: 'proj-1', name: 'Development', slug: 'development', color: '#22c55e', createdAt: '', updatedAt: '' },
      { environmentId: 'env-2', projectId: 'proj-1', name: 'Production', slug: 'production', color: '#ef4444', createdAt: '', updatedAt: '' },
    ],
    stateVersions: [
      makeVersion(0, 0, 2, '{"key":"latest"}'),
      makeVersion(0, 0, 1, '{"key":"middle"}'),
      makeVersion(0, 0, 0, '{}'),
    ],
    stateVersionsError: null,
    selectedProjectId: 'proj-1',
    loadStateVersions: vi.fn(),
    selectEnvironment: vi.fn(),
    loadBilling: vi.fn(),
    promoteTargetCache: new Map(),
    preloadPromoteTargets: vi.fn(),
    projects: [{ projectId: 'proj-1', name: 'Test', slug: 'test', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' }],
    tabState: INITIAL_STATE,
    tabDispatch: (action: TabAction) =>
      set((s: TestState) => ({ tabState: tabReducer(s.tabState as TabState, action) })),
  }));

  // Mock API: return versions when compare dropdown fetches target env versions
  mockStatesList.mockResolvedValue([
    makeVersion(0, 0, 2, '{"key":"latest"}'),
    makeVersion(0, 0, 1, '{"key":"middle"}'),
    makeVersion(0, 0, 0, '{}'),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StateTab – compare mode', () => {
  beforeEach(() => {
    seedStore();
  });

  it('enters compare mode when selecting an environment from the compare dropdown', async () => {
    const user = userEvent.setup();
    render(<StateTab />);

    // Precondition: we start in single-editor mode (not comparing)
    expect(screen.getByTestId('codemirror')).toBeInTheDocument();

    // Enter compare mode: open compare dropdown, select an environment
    const compareBtn = screen.getByRole('button', { name: /Compare/i });
    await user.click(compareBtn);
    const envOption = await screen.findByRole('menuitem', { name: /Production/ });
    await user.click(envOption);

    // Auto-compare fires with latest version → now in compare mode
    await waitFor(() => {
      expect(screen.getByText(/Comparing with/)).toBeInTheDocument();
    });

    // Should be in compare mode -- diff panes shown, no single editor
    expect(screen.queryByTestId('codemirror')).not.toBeInTheDocument();
  });

  it('shows environment dropdown with version under selected env', async () => {
    const user = userEvent.setup();
    render(<StateTab />);

    // The trigger button should show env name and version
    const versionDropdownTrigger = screen.getByRole('button', { name: /Development.*v0\.0\.2/ });
    expect(versionDropdownTrigger).toBeInTheDocument();

    // Open the dropdown
    await user.click(versionDropdownTrigger);

    // Should show environment options
    const devItem = await screen.findByRole('menuitem', { name: /Development/ });
    expect(devItem).toBeInTheDocument();
    const prodItem = await screen.findByRole('menuitem', { name: /Production/ });
    expect(prodItem).toBeInTheDocument();
  });
});
