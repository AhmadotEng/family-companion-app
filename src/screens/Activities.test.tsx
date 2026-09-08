/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityListing } from '../engagementTypes';

const apiMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiRequest: apiMocks.apiRequest };
});

import { Activities } from './Activities';

const activities: ActivityListing[] = [
  {
    id: 'activity-1',
    title: 'Golden Park picnic',
    category: 'Outdoor',
    emirate: 'Dubai',
    location: 'Golden Park',
    priceRange: 'Free',
    ageSuitability: 'All ages',
    elderlyFriendly: true,
    indoorOutdoor: 'Outdoor',
    description: 'A relaxed family picnic with shaded seating.',
    estimatedDuration: '2 hours',
    weatherSuitability: 'Cool weather',
    sourceLabel: 'Prototype catalog',
    isSample: true,
  },
  {
    id: 'activity-2',
    title: 'Museum afternoon',
    category: 'Culture',
    emirate: 'Abu Dhabi',
    location: 'Family Museum',
    priceRange: 'Budget',
    ageSuitability: 'All ages',
    elderlyFriendly: false,
    indoorOutdoor: 'Indoor',
    description: 'Explore local history together.',
    estimatedDuration: '90 minutes',
    weatherSuitability: 'Any weather',
    sourceLabel: 'Prototype catalog',
    isSample: true,
  },
];

beforeEach(() => {
  apiMocks.apiRequest.mockReset();
  apiMocks.apiRequest.mockResolvedValue({ activities });
});

afterEach(cleanup);

describe('Activities mobile experience', () => {
  it('shows search and results while advanced filters start collapsed on phones', async () => {
    const onPlanActivity = vi.fn();
    render(<Activities members={[]} onPlanActivity={onPlanActivity} />);

    expect(screen.getByRole('textbox', { name: 'Search activities' })).toBeTruthy();
    await screen.findByText('Golden Park picnic');
    expect(screen.getByText('Museum afternoon')).toBeTruthy();
    expect(screen.getByText('2 results')).toBeTruthy();

    const filters = document.getElementById('activity-filters');
    expect(filters?.className.includes('hidden')).toBe(true);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: 'Plan with SILAH' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Plan manually' })).toHaveLength(2);
  });

  it('opens filters, exposes removable active chips, and filters the result list', async () => {
    const user = userEvent.setup();
    render(<Activities members={[]} onPlanActivity={vi.fn()} />);
    await screen.findByText('Golden Park picnic');

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('activity-filters')?.className.includes('hidden')).toBe(false);

    await user.selectOptions(screen.getByLabelText('Category'), 'Culture');
    await waitFor(() => expect(screen.queryByText('Golden Park picnic')).toBeNull());
    expect(screen.getByText('Museum afternoon')).toBeTruthy();
    const removeChip = screen.getByRole('button', { name: 'Remove category filter Culture' });
    expect(removeChip).toBeTruthy();

    await user.click(removeChip);
    await screen.findByText('Golden Park picnic');
  });

  it('searches immediately and sends the selected listing to the planner callback', async () => {
    const user = userEvent.setup();
    const onPlanActivity = vi.fn();
    render(<Activities members={[]} onPlanActivity={onPlanActivity} />);
    await screen.findByText('Golden Park picnic');

    await user.type(screen.getByRole('textbox', { name: 'Search activities' }), 'museum');
    await waitFor(() => expect(screen.queryByText('Golden Park picnic')).toBeNull());
    expect(screen.getByText('1 result')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Plan with SILAH' }));
    expect(onPlanActivity).toHaveBeenCalledTimes(1);
    expect(onPlanActivity).toHaveBeenCalledWith(activities[1]);
  });
});
