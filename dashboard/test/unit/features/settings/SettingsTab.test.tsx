import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

vi.mock('@/lib/format', () => ({
  deriveSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
}));

vi.mock('@/lib/api', () => ({
  api: {
    states: {
      getLatest: vi.fn().mockRejectedValue({ status: 404 }),
    },
  },
}));

vi.mock('@/lib/api-error', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    statusText: string;
    errorBody: Record<string, unknown> | null;
    constructor(status: number, statusText: string, errorBody: Record<string, unknown> | null) {
      super(statusText);
      this.status = status;
      this.statusText = statusText;
      this.errorBody = errorBody;
    }
  },
}));

import { SettingsTab } from '@/features/settings/SettingsTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUpdateProject = vi.fn().mockResolvedValue(undefined);
const mockDeleteProject = vi.fn().mockResolvedValue(undefined);
const mockCreateEnvironment = vi.fn().mockResolvedValue('env-new');
const mockUpdateEnvironment = vi.fn().mockResolvedValue(undefined);
const mockDeleteEnvironment = vi.fn().mockResolvedValue(undefined);
const mockUpdateUserRetention = vi.fn().mockResolvedValue(undefined);

function seedStore() {
  testStore = create<TestState>()(() => ({
    projects: [
      { projectId: 'proj-1', name: 'My Project', slug: 'my-project', apiKeyHash: 'hash', userId: 'u1', createdAt: '', updatedAt: '' },
    ],
    selectedProjectId: 'proj-1',
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
    environments: [
      { environmentId: 'env-1', projectId: 'proj-1', name: 'Development', slug: 'development', color: '#22c55e', createdAt: '', updatedAt: '' },
      { environmentId: 'env-2', projectId: 'proj-1', name: 'Production', slug: 'production', color: '#ef4444', createdAt: '', updatedAt: '' },
    ],
    createEnvironment: mockCreateEnvironment,
    updateEnvironment: mockUpdateEnvironment,
    deleteEnvironment: mockDeleteEnvironment,
    user: { userId: 'user-123', displayName: 'Test User', email: 'test@example.com', customRetentionDays: null },
    billing: {
      tier: 'free',
      retentionDays: 30,
      boostMultiplier: 1,
      projects: { count: 1, limit: 3 },
      environments: { count: 2, limit: 10 },
      storage: { bytes: 100, limit: 10240 },
      overLimit: [],
      apiRequests: { count: 50, limit: 1000, resetDate: '2026-03-01T00:00:00Z' },
      currentPeriodEnd: null,
      customRetentionDays: null,
    },
    updateUserRetention: mockUpdateUserRetention,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsTab', () => {
  beforeEach(() => {
    seedStore();
    mockUpdateProject.mockClear();
    mockDeleteProject.mockClear();
    mockCreateEnvironment.mockClear();
    mockUpdateEnvironment.mockClear();
    mockDeleteEnvironment.mockClear();
    mockUpdateUserRetention.mockClear();
  });

  it('shows "select a project" when no project is selected', () => {
    testStore = create<TestState>()(() => ({
      projects: [],
      selectedProjectId: null,
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      environments: [],
      createEnvironment: vi.fn(),
      updateEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      user: null,
      billing: null,
      updateUserRetention: vi.fn(),
    }));

    render(<SettingsTab />);
    expect(screen.getByText('Select a project to view settings')).toBeInTheDocument();
  });

  it('displays current project name in input', () => {
    render(<SettingsTab />);
    const nameInput = screen.getByDisplayValue('My Project');
    expect(nameInput).toBeInTheDocument();
  });

  it('displays project slug as read-only', () => {
    render(<SettingsTab />);
    const slugInput = screen.getByDisplayValue('my-project');
    expect(slugInput).toBeInTheDocument();
    expect(slugInput).toHaveAttribute('readOnly');
  });

  it('displays environment list with names and slugs', () => {
    render(<SettingsTab />);
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('shows Add Environment form when button clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    const addBtn = screen.getByText('Add environment');
    await user.click(addBtn);

    // Should show the create environment form
    expect(screen.getByPlaceholderText('e.g., Staging')).toBeInTheDocument();
  });

  it('calls updateProject when Save changes is clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    const nameInput = screen.getByDisplayValue('My Project');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    const saveBtn = screen.getByText('Save changes');
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateProject).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ name: 'Updated Name' }),
      );
    });
  });

  it('shows retention chips with preset options', () => {
    render(<SettingsTab />);
    // Retention chips should be present with preset labels
    expect(screen.getByText('Default (30 days)')).toBeInTheDocument();
    expect(screen.getByText('No retention')).toBeInTheDocument();
    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('1 month')).toBeInTheDocument();
    expect(screen.getByText('3 months')).toBeInTheDocument();
    expect(screen.getByText('1 year')).toBeInTheDocument();
  });

  it('opens delete project dialog when button clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(screen.getByText('This will permanently delete', { exact: false })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-project')).toBeInTheDocument();
  });

  it('enables delete button only when slug matches in dialog', async () => {
    const user = userEvent.setup();
    render(<SettingsTab />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(deleteBtn).toBeDisabled();

    const slugInput = screen.getByPlaceholderText('my-project');
    await user.type(slugInput, 'my-project');

    expect(deleteBtn).not.toBeDisabled();
  });

  it('displays user ID in Account section', () => {
    render(<SettingsTab />);
    expect(screen.getByText('user-123')).toBeInTheDocument();
  });

  it('displays display name in Account section', () => {
    render(<SettingsTab />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('shows Account section even when no project is selected', () => {
    testStore = create<TestState>()(() => ({
      projects: [],
      selectedProjectId: null,
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      environments: [],
      createEnvironment: vi.fn(),
      updateEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      user: { userId: 'user-456', displayName: 'No Project User', email: 'noproject@example.com', customRetentionDays: null },
      billing: null,
      updateUserRetention: vi.fn(),
    }));

    render(<SettingsTab />);
    // User ID should be visible in Account section
    expect(screen.getByText('user-456')).toBeInTheDocument();
    // "Select a project" message should also be visible
    expect(screen.getByText('Select a project to view settings')).toBeInTheDocument();
  });
});
