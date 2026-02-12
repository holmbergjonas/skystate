import { render, screen } from '@testing-library/react';
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

vi.mock('@/lib/api-error', () => ({
  ApiError: class extends Error {
    status: number;
    errorBody: Record<string, unknown> | null;
    constructor(status: number, _statusText: string, errorBody: Record<string, unknown> | null) {
      super(_statusText);
      this.status = status;
      this.errorBody = errorBody;
    }
  },
}));

import { ProjectSelector } from '@/layout/ProjectSelector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSelectProject = vi.fn();
const mockCreateProject = vi.fn().mockResolvedValue('proj-new');
const mockCreateEnvironment = vi.fn().mockResolvedValue('env-new');

function seedStore() {
  testStore = create<TestState>()(() => ({
    projects: [
      { projectId: 'proj-1', name: 'Project Alpha', slug: 'project-alpha', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' },
      { projectId: 'proj-2', name: 'Project Beta', slug: 'project-beta', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' },
    ],
    selectedProjectId: 'proj-1',
    selectProject: mockSelectProject,
    createProject: mockCreateProject,
    createEnvironment: mockCreateEnvironment,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectSelector', () => {
  beforeEach(() => {
    seedStore();
    mockSelectProject.mockClear();
    mockCreateProject.mockClear().mockResolvedValue('proj-new');
    mockCreateEnvironment.mockClear().mockResolvedValue('env-new');
  });

  it('displays selected project name in trigger', () => {
    render(<ProjectSelector />);
    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
  });

  it('shows dropdown with all projects when clicked', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByText('Project Alpha'));

    // Both projects should be visible in dropdown
    const menuItems = await screen.findAllByRole('menuitem');
    const names = menuItems.map(item => item.textContent);
    expect(names.some(n => n?.includes('Project Alpha'))).toBe(true);
    expect(names.some(n => n?.includes('Project Beta'))).toBe(true);
  });

  it('calls selectProject when a different project is selected', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByText('Project Alpha'));
    const betaItem = await screen.findByRole('menuitem', { name: /Project Beta/ });
    await user.click(betaItem);

    expect(mockSelectProject).toHaveBeenCalledWith('proj-2');
  });

  it('calls onProjectSelect callback if provided', async () => {
    const onProjectSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSelector onProjectSelect={onProjectSelect} />);

    await user.click(screen.getByText('Project Alpha'));
    const betaItem = await screen.findByRole('menuitem', { name: /Project Beta/ });
    await user.click(betaItem);

    expect(onProjectSelect).toHaveBeenCalledWith('proj-2');
  });

  it('shows "New project" option in dropdown', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByText('Project Alpha'));
    expect(await screen.findByText('New project')).toBeInTheDocument();
  });

  it('shows "Select project" when no project is selected', () => {
    testStore = create<TestState>()(() => ({
      projects: [],
      selectedProjectId: null,
      selectProject: vi.fn(),
      createProject: vi.fn(),
      createEnvironment: vi.fn(),
    }));

    render(<ProjectSelector />);
    expect(screen.getByText('Select project')).toBeInTheDocument();
  });
});
