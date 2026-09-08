/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRecord, PersistentGathering, RewardSummary } from '../engagementTypes';

const apiMocks = vi.hoisted(() => ({
  listGatherings: vi.fn(),
  listMemories: vi.fn(),
  getRewards: vi.fn(),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  redeemReward: vi.fn(),
  fetchMemoryMedia: vi.fn(),
  uploadMemoryMedia: vi.fn(),
}));

vi.mock('../api/memoriesRewards', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/memoriesRewards')>();
  return {
    ...actual,
    fetchMemoryMedia: apiMocks.fetchMemoryMedia,
    uploadMemoryMedia: apiMocks.uploadMemoryMedia,
    memoriesRewardsApi: {
      listGatherings: apiMocks.listGatherings,
      listMemories: apiMocks.listMemories,
      getRewards: apiMocks.getRewards,
      createMemory: apiMocks.createMemory,
      deleteMemory: apiMocks.deleteMemory,
      redeemReward: apiMocks.redeemReward,
    },
  };
});

import { MemoriesRewards } from './MemoriesRewards';

const gathering: PersistentGathering = {
  id: 'gathering-1',
  familyId: 'family-1',
  title: 'Friday picnic',
  purpose: 'Family time',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai',
  locationName: 'Golden Park',
  type: 'Outdoor activity',
  status: 'completed',
  createdByUserId: 'user-1',
  createdAt: '2099-09-01T00:00:00.000Z',
  updatedAt: '2099-09-12T18:00:00.000Z',
  invitations: [],
};

const memory: MemoryRecord = {
  id: 'memory-1',
  familyId: 'family-1',
  gatheringId: 'gathering-1',
  createdByUserId: 'user-1',
  title: 'Picnic story',
  note: 'We shared tea in the shade.',
  memoryType: 'note',
  visibility: 'private',
  aiProcessingAllowed: false,
  hasMedia: false,
  capturedAt: '2099-09-12T18:00:00.000Z',
  createdAt: '2099-09-12T18:00:00.000Z',
  updatedAt: '2099-09-12T18:00:00.000Z',
};

const rewards: RewardSummary = {
  balance: 120,
  entries: [{
    id: 'entry-1',
    points: 20,
    reasonCode: 'GATHERING_COMPLETE',
    description: 'Completed a family gathering',
    createdAt: '2099-09-12T18:00:00.000Z',
  }],
  offers: [{
    id: 'offer-1',
    title: 'Family tea example',
    description: 'A clearly labelled prototype reward.',
    pointsCost: 100,
    isDemo: true,
    redeemable: false,
  }],
};

beforeEach(() => {
  Object.values(apiMocks).forEach(mock => mock.mockReset());
  apiMocks.listGatherings.mockResolvedValue({ gatherings: [gathering] });
  apiMocks.listMemories.mockResolvedValue({ memories: [memory] });
  apiMocks.getRewards.mockResolvedValue(rewards);
  apiMocks.createMemory.mockResolvedValue({ memory });
});

afterEach(cleanup);

describe('MemoriesRewards mobile archive', () => {
  it('renders the memory album first and keeps rewards reachable through the requested view', async () => {
    render(
      <MemoriesRewards
        familyId="family-1"
        familyRole="owner"
        currentUserId="user-1"
        members={[{ id: 'member-1', name: 'Mariam' }]}
      />,
    );

    await screen.findByRole('heading', { name: 'Your family memories, gathered by occasion.' });
    expect(screen.getByRole('button', { name: 'Refresh archive' }).className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'Add memory' }).className).toContain('size-14');
    expect(screen.getByText('Picnic story')).toBeTruthy();

    cleanup();
    render(
      <MemoriesRewards
        familyId="family-1"
        familyRole="owner"
        currentUserId="user-1"
        members={[{ id: 'member-1', name: 'Mariam' }]}
        requestedView="rewards"
      />,
    );
    await screen.findByRole('heading', { name: 'Points history' });
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('Family tea example')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Demo only' }).className).toContain('min-h-11');
  });

  it('keeps the add-memory workflow editable with mobile-sized fields and explicit saving', async () => {
    const user = userEvent.setup();
    render(
      <MemoriesRewards
        familyId="family-1"
        familyRole="owner"
        currentUserId="user-1"
        members={[{ id: 'member-1', name: 'Mariam' }]}
      />,
    );
    await screen.findByRole('button', { name: 'Add memory' });

    await user.click(screen.getByRole('button', { name: 'Add memory' }));
    await user.selectOptions(screen.getByLabelText('Gathering'), 'gathering-1');
    const title = screen.getByLabelText('Title');
    const note = screen.getByLabelText('Written memory');
    expect(title.className).toContain('text-base');
    expect(note.className).toContain('text-base');
    expect(screen.getByLabelText('Gathering').className).toContain('min-h-12');
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Save memory' }).className).toContain('min-h-11');

    await user.type(title, 'A new family story');
    await user.type(note, 'We spent a calm afternoon together.');
    await user.click(screen.getByRole('button', { name: 'Save memory' }));

    await waitFor(() => expect(apiMocks.createMemory).toHaveBeenCalledTimes(1));
    expect(apiMocks.createMemory.mock.calls[0]?.[0]).toBe('gathering-1');
    expect(apiMocks.createMemory.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      familyId: 'family-1',
      title: 'A new family story',
      note: 'We spent a calm afternoon together.',
      memoryType: 'note',
      visibility: 'private',
    }));
    await screen.findByText('The written memory was saved with the selected privacy setting.');
  });
});
