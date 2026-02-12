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
  useStore: Object.assign(
    (selector: (s: TestState) => unknown) => testStore(selector),
    { getState: () => testStore.getState() },
  ),
}));

const mockCheckout = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    billing: {
      checkout: (...args: unknown[]) => mockCheckout(...args),
      portal: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/portal' }),
      boostCheckout: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/boost' }),
    },
  },
}));

vi.mock('@/features/usage/useCheckoutReturn', () => ({
  useCheckoutReturn: () => ({
    activatingTier: null,
  }),
}));

import { PlansTab } from '@/features/usage/PlansTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBilling(overrides?: Partial<Record<string, unknown>>) {
  return {
    tier: 'free',
    boostMultiplier: 1,
    projects: { count: 1, limit: 3 },
    environments: { count: 2, limit: 10 },
    storage: { bytes: 100, limit: 10240 },
    retentionDays: null,
    customRetentionDays: null,
    currentPeriodEnd: null,
    overLimit: [],
    apiRequests: { count: 50, limit: 1000, resetDate: '2026-03-01T00:00:00Z' },
    ...overrides,
  };
}

function seedStore(billing: unknown = makeBilling(), overrides?: Record<string, unknown>) {
  testStore = create<TestState>()(() => ({
    billing,
    billingLoading: false,
    billingError: null,
    loadBilling: vi.fn(),
    ...overrides,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlansTab', () => {
  beforeEach(() => {
    seedStore();
    mockCheckout.mockReset();
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/plans',
        search: '',
        pathname: '/plans',
      },
      writable: true,
    });
  });

  it('renders loading state when billing is loading', () => {
    seedStore(null, { billingLoading: true });
    render(<PlansTab />);
    expect(screen.getByText('Loading billing data...')).toBeInTheDocument();
  });

  it('renders error state when billing fetch fails', () => {
    seedStore(null, { billingError: 'Network error' });
    render(<PlansTab />);
    expect(screen.getByText('Failed to load billing data')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders fallback error when billing is null without loading or error', () => {
    seedStore(null);
    render(<PlansTab />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders plan cards when billing data exists', () => {
    render(<PlansTab />);
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    // Should show the hero text
    expect(screen.getByText('Pick your perfect plan')).toBeInTheDocument();
  });

  it('shows locked boost section for non-Pro users', () => {
    seedStore(makeBilling({ tier: 'free' }));
    render(<PlansTab />);
    expect(screen.getByText('Resource Booster')).toBeInTheDocument();
    expect(screen.getByText('Pro plan required')).toBeInTheDocument();
    expect(screen.getByText('Pro add-on')).toBeInTheDocument();
    expect(screen.queryByText(/Add \d+ Booster/)).not.toBeInTheDocument();
  });

  it('shows interactive boost controls for Pro users', () => {
    seedStore(makeBilling({ tier: 'pro' }));
    render(<PlansTab />);
    expect(screen.getByText('Resource Booster')).toBeInTheDocument();
    expect(screen.getByText('Supercharge your Pro plan')).toBeInTheDocument();
    expect(screen.getByText(/Add 1 Booster/)).toBeInTheDocument();
    expect(screen.queryByText('Pro plan required')).not.toBeInTheDocument();
  });

  it('shows error message when checkout fails', async () => {
    mockCheckout.mockRejectedValue(new Error('Checkout failed'));
    const user = userEvent.setup();
    render(<PlansTab />);

    // Find an upgrade button — PlanCards renders buttons for tiers other than current
    const upgradeButtons = screen.getAllByRole('button');
    const upgradeBtn = upgradeButtons.find(b => b.textContent?.includes('Upgrade'));
    if (upgradeBtn) {
      await user.click(upgradeBtn);
      await waitFor(() => {
        expect(screen.getByText('Could not start checkout. Please try again.')).toBeInTheDocument();
      });
    }
  });
});
