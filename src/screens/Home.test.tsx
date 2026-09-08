/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FamilyMember, Gathering } from '../types';
import { Home } from './Home';

afterEach(cleanup);

const member: FamilyMember = {
  id: 'member-1',
  name: 'Mariam',
  age: 58,
  birthday: '1968-04-12',
  relationship: 'Parent',
  phone: '',
  email: '',
  interests: ['Gardening'],
  locationSharingStatus: 'Active',
  safeLocation: {
    memberId: 'member-1',
    source: 'manual',
    precision: 'city',
    visibility: 'family',
    city: 'Dubai',
    emirate: 'Dubai',
    capturedAt: '2026-01-01T00:00:00.000Z',
  },
};

const gathering: Gathering = {
  id: 'gathering-1',
  title: 'Friday picnic',
  purpose: 'Spend time together',
  date: '2099-09-12',
  time: '17:00',
  location: 'Golden Park',
  invitedMembers: ['member-1'],
  rsvpStatus: { 'member-1': 'Going' },
  createdBy: 'user-1',
  type: 'Outdoor activity',
};

describe('Home mobile dashboard', () => {
  it('keeps the core dashboard actions and useful previews compact and reachable', async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    const navigateToAssistant = vi.fn();
    render(
      <Home
        members={[member]}
        gatherings={[gathering]}
        setActiveTab={setActiveTab}
        navigateToAssistant={navigateToAssistant}
      />,
    );

    expect(screen.getByText('Marhaba')).toBeTruthy();
    expect(screen.queryByText('Account protected')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open SILAH' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Family summary' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Family members' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Upcoming gatherings' })).toBeTruthy();
    expect(screen.getByText('Friday picnic')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Open SILAH' }));
    expect(navigateToAssistant).toHaveBeenCalledWith('');
    await user.click(screen.getByRole('button', { name: 'Open Family Tree' }));
    expect(setActiveTab).toHaveBeenCalledWith('tree');
  });

  it('opens an accessible member sheet that closes with Escape and restores focus', async () => {
    const user = userEvent.setup();
    render(
      <Home
        members={[member]}
        gatherings={[]}
        setActiveTab={vi.fn()}
        navigateToAssistant={vi.fn()}
      />,
    );
    const memberButton = screen.getByRole('button', { name: /Mariam/ });

    await user.click(memberButton);
    expect(screen.getByRole('dialog', { name: 'Mariam profile' })).toBeTruthy();
    expect(screen.getByText('Dubai · Dubai')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(memberButton));
  });

  it('does not count gatherings in the past as upcoming', () => {
    render(
      <Home
        members={[]}
        gatherings={[{ ...gathering, id: 'past', title: 'Past picnic', date: '2001-01-01' }]}
        setActiveTab={vi.fn()}
        navigateToAssistant={vi.fn()}
      />,
    );

    expect(screen.queryByText('Past picnic')).toBeNull();
    expect(screen.getByText('No upcoming gathering has been saved.')).toBeTruthy();
  });
});
