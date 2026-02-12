import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/lib/api', () => ({
  api: {
    environments: { list: vi.fn().mockResolvedValue([]) },
  },
}));

import { UsageTab } from '@/features/usage/UsageTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBilling(overrides?: Partial<Record<string, unknown>>) {
  return {
    tier: 'free',
    boostMultiplier: 1,
    projects: { count: 2, limit: 3 },
    environments: { count: 5, limit: 10 },
    storage: { bytes: 512, limit: 10240 },
    retentionDays: null,
    customRetentionDays: null,
    currentPeriodEnd: '2026-03-28T00:00:00Z',
    overLimit: [],
    apiRequests: { count: 100, limit: 1000, resetDate: '2026-03-01T00:00:00Z' },
    ...overrides,
  };
}

function seedStore(billing: unknown = makeBilling(), overrides?: Record<string, unknown>) {
  testStore = create<TestState>()(() => ({
    billing,
    billingLoading: false,
    billingError: null,
    projects: [
      { projectId: 'p1', name: 'Test Project', slug: 'test-project', apiKeyHash: '', userId: '', createdAt: '', updatedAt: '' },
    ],
    invoices: [],
    invoicesLoading: false,
    invoicesError: null,
    loadInvoices: vi.fn(),
    ...overrides,
  }));
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsageTab', () => {
  beforeEach(() => {
    seedStore();
  });

  it('renders loading state when billing is loading', () => {
    seedStore(null, { billingLoading: true });
    renderWithRouter(<UsageTab />);
    expect(screen.getByText('Loading usage data...')).toBeInTheDocument();
  });

  it('renders error state when billing fetch fails', () => {
    seedStore(null, { billingError: 'Network error' });
    renderWithRouter(<UsageTab />);
    expect(screen.getByText('Failed to load usage data')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders fallback error when billing is null without loading or error', () => {
    seedStore(null);
    renderWithRouter(<UsageTab />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders usage content when billing data exists', async () => {
    renderWithRouter(<UsageTab />);
    // Should NOT show error state
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    // Wait for async ResourceBreakdown state update to settle
    await waitFor(() => expect(screen.getByText('Your projects')).toBeInTheDocument());
  });

  it('renders OverLimitBanner when overLimit resources exist', async () => {
    seedStore(makeBilling({ overLimit: ['projects'] }));
    renderWithRouter(<UsageTab />);
    // OverLimitBanner shows upgrade messaging for over-limit resources
    await waitFor(() => expect(screen.getByText(/hit the Free plan limit/i)).toBeInTheDocument());
  });

  it('does not render OverLimitBanner when no overLimit resources', async () => {
    renderWithRouter(<UsageTab />);
    expect(screen.queryByText(/hit the Free plan limit/i)).not.toBeInTheDocument();
    // Wait for async ResourceBreakdown state update to settle
    await waitFor(() => expect(screen.getByText('Your projects')).toBeInTheDocument());
  });
});
