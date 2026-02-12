import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { MemoryRouter } from 'react-router';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type TestState = Record<string, unknown>;
let testStore: UseBoundStore<StoreApi<TestState>>;

vi.mock('@/store', () => ({
  useStore: (selector: (s: TestState) => unknown) => testStore(selector),
}));

// Mock child tab components as simple divs
vi.mock('@/features/state/StateTab', () => ({
  StateTab: ({ active }: { active: boolean }) => (
    <div data-testid="state-tab" data-active={active}>
      StateTab
    </div>
  ),
}));

vi.mock('@/features/usage/UsageTab', () => ({
  UsageTab: () => <div data-testid="usage-tab">UsageTab</div>,
}));

vi.mock('@/features/usage/PlansTab', () => ({
  PlansTab: () => <div data-testid="plans-tab">PlansTab</div>,
}));

vi.mock('@/features/settings/SettingsTab', () => ({
  SettingsTab: () => <div data-testid="settings-tab">SettingsTab</div>,
}));

vi.mock('@/features/projects/NewProjectPage', () => ({
  NewProjectPage: () => <div data-testid="new-project-page">NewProjectPage</div>,
}));

// Mock useEditorGuards to return no-op functions
vi.mock('@/features/state/useEditorGuards', () => ({
  useEditorGuards: () => ({
    guardNavigation: (action: () => void) => action(),
    confirmDialogOpen: false,
    confirmProceed: vi.fn(),
    confirmCancel: vi.fn(),
  }),
}));

// Mock api for bootstrap data loading
const mockGetCurrent = vi.fn().mockResolvedValue({ displayName: 'Alice', email: 'alice@test.com' });
vi.mock('@/lib/api', () => ({
  api: {
    users: { getCurrent: (...args: unknown[]) => mockGetCurrent(...args) },
  },
}));

vi.mock('@/lib/format', () => ({
  capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  deriveSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
}));

vi.mock('@/lib/api-error', () => ({
  ApiError: class extends Error {
    status: number;
    constructor(status: number) {
      super();
      this.status = status;
    }
  },
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
      if (next !== prev) {
        prev = next;
        return next;
      }
      return prev;
    };
  },
}));

vi.mock('@/lib/auth', () => ({
  signOut: vi.fn(),
}));

import { AppShell } from '@/layout/AppShell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSetUser = vi.fn();
const mockLoadProjects = vi.fn();
const mockLoadBilling = vi.fn();
const mockSelectProject = vi.fn();
const mockCreateProject = vi.fn();
const mockCreateEnvironment = vi.fn();

function seedStore(overrides?: Partial<TestState>) {
  testStore = create<TestState>()(() => ({
    projects: [
      { projectId: 'p1', name: 'Test Project', slug: 'test-project', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' },
    ],
    selectedProjectId: 'p1',
    selectProject: mockSelectProject,
    createProject: mockCreateProject,
    createEnvironment: mockCreateEnvironment,
    environments: [
      { environmentId: 'e1', projectId: 'p1', name: 'Dev', slug: 'dev', color: '#22c55e', createdAt: '', updatedAt: '' },
    ],
    environmentsLoading: false,
    user: { displayName: 'Alice', email: 'alice@test.com' },
    billing: { tier: 'free', boostMultiplier: 1 },
    setUser: mockSetUser,
    loadProjects: mockLoadProjects,
    loadBilling: mockLoadBilling,
    ...overrides,
  }));
}

function renderWithRouter(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppShell />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppShell', () => {
  beforeEach(() => {
    seedStore();
    mockSetUser.mockClear();
    mockLoadProjects.mockClear();
    mockLoadBilling.mockClear();
    mockSelectProject.mockClear();
    mockGetCurrent.mockClear().mockResolvedValue({ displayName: 'Alice', email: 'alice@test.com' });
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/', search: '', pathname: '/' },
      writable: true,
    });
  });

  it('renders StateTab at default path "/"', () => {
    renderWithRouter('/');
    expect(screen.getByTestId('state-tab')).toBeInTheDocument();
  });

  it('renders UsageTab at path "/usage"', () => {
    renderWithRouter('/usage');
    expect(screen.getByTestId('usage-tab')).toBeInTheDocument();
  });

  it('renders PlansTab at path "/plans"', () => {
    renderWithRouter('/plans');
    expect(screen.getByTestId('plans-tab')).toBeInTheDocument();
  });

  it('renders SettingsTab at path "/settings"', () => {
    renderWithRouter('/settings');
    expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
  });

  it('loads projects and billing on mount', async () => {
    renderWithRouter('/');

    await waitFor(() => {
      expect(mockGetCurrent).toHaveBeenCalled();
      expect(mockLoadProjects).toHaveBeenCalled();
      expect(mockLoadBilling).toHaveBeenCalled();
    });
  });

  it('shows NewProjectPage when there are no projects', () => {
    seedStore({ selectedProjectId: null, projects: [] });
    renderWithRouter('/');
    expect(screen.getByTestId('new-project-page')).toBeInTheDocument();
  });

  it('shows "No project selected" when projects exist but selectedProjectId is null', () => {
    seedStore({ selectedProjectId: null });
    renderWithRouter('/');
    expect(screen.getByText('No project selected')).toBeInTheDocument();
  });

  it('shows "No environments" when project has no environments', () => {
    seedStore({ environments: [], environmentsLoading: false });
    renderWithRouter('/');
    expect(screen.getByText('No environments')).toBeInTheDocument();
  });

  it('TabBar tab change navigates to correct path', async () => {
    const user = userEvent.setup();
    renderWithRouter('/');

    // StateTab should be visible initially
    expect(screen.getByTestId('state-tab')).toBeInTheDocument();

    // Click Config tab to navigate to /settings
    const configTab = screen.getByText('Config');
    await user.click(configTab);

    // Should now show SettingsTab
    await waitFor(() => {
      expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
    });
  });
});
