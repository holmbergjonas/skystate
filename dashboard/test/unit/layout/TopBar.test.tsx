import { render, screen } from '@testing-library/react';
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

const mockSignOut = vi.fn();
vi.mock('@/lib/auth', () => ({
  signOut: () => mockSignOut(),
}));

vi.mock('@/lib/api-error', () => ({
  ApiError: class extends Error {
    status: number;
    constructor(status: number) { super(); this.status = status; }
  },
}));

import { TopBar } from '@/layout/TopBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedStore() {
  testStore = create<TestState>()(() => ({
    user: { userId: 'user-1', displayName: 'Alice', email: 'alice@example.com' },
    billing: { tier: 'free', boostMultiplier: 1 },
    projects: [
      { projectId: 'p1', name: 'Test', slug: 'test', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' },
    ],
    selectedProjectId: 'p1',
    selectProject: vi.fn(),
    createProject: vi.fn(),
    createEnvironment: vi.fn(),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopBar', () => {
  beforeEach(() => {
    seedStore();
    mockSignOut.mockClear();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  it('renders SkyState branding', () => {
    render(
      <MemoryRouter>
        <TopBar activeTab="state" onTabChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('SkyState')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    render(
      <MemoryRouter>
        <TopBar activeTab="state" onTabChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('renders TabBar with correct active tab', () => {
    render(
      <MemoryRouter>
        <TopBar activeTab="settings" onTabChange={vi.fn()} />
      </MemoryRouter>,
    );
    // Config tab should have active styling
    const configTab = screen.getByText('Config');
    expect(configTab.className).toContain('bg-primary');
  });

  it('calls signOut and redirects when Sign out is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TopBar activeTab="state" onTabChange={vi.fn()} />
      </MemoryRouter>,
    );

    // Click the Sign out button directly
    const signOutButton = screen.getByText('Sign out');
    await user.click(signOutButton);

    expect(mockSignOut).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
  });
});
