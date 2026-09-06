/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiRequest: apiRequestMock };
});

vi.mock('../components/ReconnectionPlansPanel', () => ({
  ReconnectionPlansPanel: () => null,
}));

import { Assistant } from './Assistant';

const familyId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000002';
const proposalId = '30000000-0000-4000-8000-000000000003';
const proposal = {
  id: proposalId,
  actionType: 'CREATE_GATHERING_DRAFT',
  title: 'Create draft: Golden Park outing',
  summary: 'Create an unsent Outdoor activity gathering draft.',
  details: {
    title: 'Golden Park outing',
    locationName: 'Golden Park',
    startAt: '2099-09-12T17:00:00+04:00',
  },
  warnings: ['No gathering is created until you confirm.'],
};

beforeEach(() => {
  apiRequestMock.mockReset();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, sessionId);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function restoredConversation(proposalStatus: 'pending' | 'confirmed' | 'rejected' | 'expired') {
  return {
    sessionId,
    messages: [{
      id: '40000000-0000-4000-8000-000000000004',
      role: 'assistant',
      kind: 'proposal',
      message: 'Review this proposal.',
      proposal,
      proposalStatus,
      createdAt: '2099-01-01T00:00:00.000Z',
    }],
  };
}

function renderAssistant(onActionCompleted = vi.fn()) {
  return render(
    <Assistant
      presetInput=""
      clearPreset={vi.fn()}
      familyId={familyId}
      members={[]}
      familyRole="owner"
      onActionCompleted={onActionCompleted}
      onUseReconnectionPlan={vi.fn()}
    />,
  );
}

describe('Assistant proposal restoration', () => {
  it('restores a pending proposal as an actionable card', async () => {
    apiRequestMock
      .mockResolvedValueOnce(restoredConversation('pending'))
      .mockResolvedValueOnce({
        proposalId,
        actionType: proposal.actionType,
        status: 'rejected',
        message: 'The proposed change was cancelled. No family data was changed.',
      });
    const user = userEvent.setup();
    renderAssistant();

    expect(await screen.findByText(proposal.title)).toBeTruthy();
    expect(screen.getByText('Golden Park')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm change' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/action-proposals/${proposalId}/reject`,
      { method: 'POST', body: JSON.stringify({ expectedActionType: proposal.actionType }) },
    ));
    expect(await screen.findByText('Cancelled — no changes made')).toBeTruthy();
  });

  it.each([
    ['confirmed', 'Confirmed and completed'],
    ['rejected', 'Cancelled — no changes made'],
    ['expired', 'Expired — ask for a new proposal'],
  ] as const)('restores %s as truthful and non-actionable', async (status, label) => {
    apiRequestMock.mockResolvedValueOnce(restoredConversation(status));
    renderAssistant();

    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('shows a server-degraded legacy proposal only as inert transcript text', async () => {
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messages: [{
        id: '40000000-0000-4000-8000-000000000004',
        role: 'assistant',
        kind: 'message',
        message: 'Review this proposal. The proposal controls could not be restored safely. Ask the AI Helper to prepare a new proposal.',
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    });
    renderAssistant();

    expect(await screen.findByText(/proposal controls could not be restored safely/i)).toBeTruthy();
    expect(screen.queryByText(proposal.title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
  });

  it('degrades an unknown restored proposal to inert text with no request or side effect', async () => {
    const onActionCompleted = vi.fn();
    apiRequestMock.mockResolvedValueOnce({
      ...restoredConversation('pending'),
      messages: [{
        ...restoredConversation('pending').messages[0],
        proposal: { ...proposal, actionType: 'UNKNOWN_ACTION' },
      }],
    });
    renderAssistant(onActionCompleted);

    expect(await screen.findByText('Review this proposal.')).toBeTruthy();
    expect(screen.queryByText(proposal.title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it.each([
    ['proposal status', { proposalStatus: 'executed' }],
    ['proposal message id', { id: 'not-a-uuid' }],
    ['proposal id', { proposal: { ...proposal, id: 'not-a-uuid' } }],
    ['proposal details', { proposal: { ...proposal, details: ['not', 'a', 'record'] } }],
    ['proposal warning', { proposal: { ...proposal, warnings: [42] } }],
  ])('degrades malformed restored %s data to inert text', async (_label, overrides) => {
    const restored = restoredConversation('pending');
    apiRequestMock.mockResolvedValueOnce({
      ...restored,
      messages: [{ ...restored.messages[0], ...overrides }],
    });
    renderAssistant();

    expect(await screen.findByText('Review this proposal.')).toBeTruthy();
    expect(screen.queryByText(proposal.title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a restored proposal pending when the result returns a different known action', async () => {
    const onActionCompleted = vi.fn();
    apiRequestMock
      .mockResolvedValueOnce(restoredConversation('pending'))
      .mockResolvedValueOnce({
        proposalId,
        actionType: 'CREATE_NOTE_MEMORY',
        status: 'confirmed',
        message: 'Mismatched result.',
      });
    const user = userEvent.setup();
    renderAssistant(onActionCompleted);

    await user.click(await screen.findByRole('button', { name: 'Confirm change' }));

    expect(await screen.findByText('Confirmation outcome is unknown')).toBeTruthy();
    expect(screen.queryByText('Confirmed and completed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check confirmation status' })).toBeTruthy();
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/action-proposals/${proposalId}/confirm`,
      { method: 'POST', body: JSON.stringify({ expectedActionType: proposal.actionType }) },
    );
  });
});
