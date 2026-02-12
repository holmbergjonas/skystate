import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { TabBar } from '@/layout/TabBar';

describe('TabBar', () => {
  const onTabChange = vi.fn();

  beforeEach(() => {
    onTabChange.mockClear();
  });

  function renderTabBar(activeTab: 'state' | 'settings' | 'usage' | 'plans' = 'state') {
    return render(
      <MemoryRouter>
        <TabBar activeTab={activeTab} onTabChange={onTabChange} />
      </MemoryRouter>,
    );
  }

  it('renders four tabs with correct labels', () => {
    renderTabBar();
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Plans')).toBeInTheDocument();
  });

  it('applies active styling to the active tab', () => {
    renderTabBar('settings');
    const configTab = screen.getByText('Config');
    expect(configTab.className).toContain('bg-primary');
  });

  it('calls onTabChange with correct id when tab is clicked', async () => {
    const user = userEvent.setup();
    renderTabBar();

    await user.click(screen.getByText('Config'));
    expect(onTabChange).toHaveBeenCalledWith('settings');

    await user.click(screen.getByText('Usage'));
    expect(onTabChange).toHaveBeenCalledWith('usage');

    await user.click(screen.getByText('Plans'));
    expect(onTabChange).toHaveBeenCalledWith('plans');

    await user.click(screen.getByText('State'));
    expect(onTabChange).toHaveBeenCalledWith('state');
  });
});
