/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyRole } from '../types';

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, apiRequest: apiRequestMock };
});

vi.mock('../components/ReconnectionPlansPanel', () => ({
  ReconnectionPlansPanel: () => null,
}));

import {
  Assistant,
  type AgentActionCompletion,
  type AgentResultNavigationTarget,
} from './Assistant';

const familyId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000002';
const validPlanner = {
  title: 'Golden Park outing',
  purpose: 'Spend time together at Golden Park',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai',
  locationName: 'Golden Park',
  type: 'Outdoor activity',
  memberIds: ['60000000-0000-4000-8000-000000000001'],
  invitationChannel: 'share_link',
};

const actionCases = [
  { actionType: 'ADD_MEMBER', resources: ['family'], resultLabel: 'View Bond Map', confirmLabel: 'Confirm change' },
  { actionType: 'UPDATE_MEMBER', resources: ['family'], resultLabel: 'View Bond Map', confirmLabel: 'Confirm change' },
  { actionType: 'DELETE_MEMBER', resources: ['family'], resultLabel: 'View Bond Map', confirmLabel: 'Review & delete' },
  { actionType: 'CREATE_RELATIONSHIP', resources: ['family'], resultLabel: 'View Bond Map', confirmLabel: 'Confirm change' },
  { actionType: 'DELETE_RELATIONSHIP', resources: ['family'], resultLabel: 'View Bond Map', confirmLabel: 'Review & delete' },
  { actionType: 'CREATE_RECONNECTION_PLAN', resources: ['plans'], resultLabel: 'View Reconnection Plans', confirmLabel: 'Confirm change' },
  { actionType: 'UPDATE_PLAN_STATUS', resources: ['plans'], resultLabel: 'View Reconnection Plans', confirmLabel: 'Confirm change' },
  { actionType: 'CREATE_GATHERING_DRAFT', resources: ['gatherings'], resultLabel: 'View Calendar', confirmLabel: 'Confirm change' },
  { actionType: 'PREPARE_INVITATION_LINKS', resources: ['gatherings'], resultLabel: 'Links prepared, not sent', confirmLabel: 'Review & prepare links' },
  { actionType: 'COMPLETE_GATHERING', resources: ['gatherings', 'rewards'], resultLabel: 'View Calendar', confirmLabel: 'Review & complete' },
  { actionType: 'CREATE_NOTE_MEMORY', resources: ['memories', 'rewards'], resultLabel: 'View Memories & Rewards', confirmLabel: 'Confirm change' },
  { actionType: 'DELETE_MEMORY', resources: ['memories'], resultLabel: 'View Memories & Rewards', confirmLabel: 'Review & delete' },
] as const;

const adminOnlyActions = [
  'ADD_MEMBER',
  'DELETE_MEMBER',
  'CREATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
  'COMPLETE_GATHERING',
] as const;

const destructiveActions = [
  ['DELETE_MEMBER', 'Review & delete'],
  ['DELETE_RELATIONSHIP', 'Review & delete'],
  ['PREPARE_INVITATION_LINKS', 'Review & prepare links'],
  ['COMPLETE_GATHERING', 'Review & complete'],
  ['DELETE_MEMORY', 'Review & delete'],
] as const;

function proposalIdFor(actionType: string): string {
  const index = actionCases.findIndex(candidate => candidate.actionType === actionType);
  return `30000000-0000-4000-8000-${String(index >= 0 ? index + 1 : 999).padStart(12, '0')}`;
}

function renderAssistant({
  role = 'owner',
  onActionCompleted,
  onNavigateToActionResult,
}: {
  role?: FamilyRole;
  onActionCompleted?: (completion: AgentActionCompletion) => Promise<void> | void;
  onNavigateToActionResult?: (actionType: string, target?: AgentResultNavigationTarget) => void;
} = {}) {
  const actionCompleted = onActionCompleted ?? vi.fn<(completion: AgentActionCompletion) => void>();
  const navigateToActionResult = onNavigateToActionResult
    ?? vi.fn<(actionType: string, target?: AgentResultNavigationTarget) => void>();
  render(
    <Assistant
      presetInput=""
      clearPreset={vi.fn()}
      familyId={familyId}
      members={[]}
      familyRole={role}
      onActionCompleted={actionCompleted}
      onNavigateToActionResult={navigateToActionResult}
      onUseReconnectionPlan={vi.fn()}
    />,
  );
  return { onActionCompleted: actionCompleted, onNavigateToActionResult: navigateToActionResult };
}

async function submitRequest(user: ReturnType<typeof userEvent.setup>, message = 'Test every agent path') {
  await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
  await user.type(screen.getByLabelText('Ask the family agent'), message);
  await user.click(screen.getByRole('button', { name: 'Send request' }));
}

function proposalResponse(actionType: string) {
  return {
    sessionId,
    kind: 'proposal',
    message: `Review ${actionType}`,
    proposal: {
      id: proposalIdFor(actionType),
      actionType,
      title: `${actionType} title`,
      summary: `${actionType} summary`,
      details: { target: 'Example target', count: 2 },
      warnings: [`${actionType} warning`],
    },
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
  window.sessionStorage.clear();
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

describe('complete Assistant response and action matrix', () => {
  it.each(actionCases)('confirms $actionType through its exact UI path', async row => {
    const result = row.actionType === 'PREPARE_INVITATION_LINKS'
      ? {
          gatheringId: '30000000-0000-4000-8000-000000000003',
          invitations: [{
            memberId: 'dad',
            memberName: 'Dad',
            sharePath: '/invite/private-test-token',
          }],
          deliveryNotice: 'Private links were prepared. Nothing was sent.',
        }
      : { entityId: `result-${row.actionType}` };
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse(row.actionType))
      .mockResolvedValueOnce({
        proposalId: proposalIdFor(row.actionType),
        actionType: row.actionType,
        status: 'confirmed',
        message: `${row.actionType} completed`,
        result,
      });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onActionCompleted = vi.fn();
    const { onNavigateToActionResult } = renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);
    expect(await screen.findByText(`${row.actionType} title`)).toBeTruthy();
    expect(screen.getByText(`${row.actionType} summary`)).toBeTruthy();
    expect(screen.getByText('Example target')).toBeTruthy();
    expect(screen.getByText(`${row.actionType} warning`)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: row.confirmLabel }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/action-proposals/${proposalIdFor(row.actionType)}/confirm`,
      { method: 'POST', body: JSON.stringify({ expectedActionType: row.actionType }) },
    ));
    expect(await screen.findByText(`${row.actionType} completed`)).toBeTruthy();
    expect(screen.getByText('Confirmed and completed')).toBeTruthy();
    expect(onActionCompleted).toHaveBeenCalledWith({
      actionType: row.actionType,
      resources: [...row.resources],
    });
    expect(await screen.findByText(row.resultLabel)).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();

    const shouldHaveSecondConfirmation = [
      'DELETE_MEMBER',
      'DELETE_RELATIONSHIP',
      'PREPARE_INVITATION_LINKS',
      'COMPLETE_GATHERING',
      'DELETE_MEMORY',
    ].includes(row.actionType);
    expect(confirmSpy).toHaveBeenCalledTimes(shouldHaveSecondConfirmation ? 1 : 0);

    if (row.actionType !== 'PREPARE_INVITATION_LINKS') {
      await user.click(screen.getByRole('button', { name: row.resultLabel }));
      expect(onNavigateToActionResult).toHaveBeenCalledWith(row.actionType);
    }
  });

  it.each(actionCases)('cancels $actionType without invoking completion side effects', async row => {
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse(row.actionType))
      .mockResolvedValueOnce({
        proposalId: proposalIdFor(row.actionType),
        actionType: row.actionType,
        status: 'rejected',
        message: 'The proposed change was cancelled. No family data was changed.',
      });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onActionCompleted = vi.fn();
    renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);
    await screen.findByText(`${row.actionType} title`);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/action-proposals/${proposalIdFor(row.actionType)}/reject`,
      { method: 'POST', body: JSON.stringify({ expectedActionType: row.actionType }) },
    ));
    expect(await screen.findByText(/Cancelled/)).toBeTruthy();
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it.each(destructiveActions)('does not submit $0 when the second confirmation is declined', async (actionType, confirmLabel) => {
    apiRequestMock.mockResolvedValueOnce(proposalResponse(actionType));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onActionCompleted = vi.fn();
    renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);
    await screen.findByText(`${actionType} title`);
    await user.click(screen.getByRole('button', { name: confirmLabel }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: confirmLabel })).toBeTruthy();
  });

  it('recovers an unknown confirmation outcome through the dedicated idempotent status check', async () => {
    const actionType = 'CREATE_GATHERING_DRAFT';
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse(actionType))
      .mockRejectedValueOnce(new Error('Connection closed after the server received the request'))
      .mockResolvedValueOnce({
        proposalId: proposalIdFor(actionType),
        actionType,
        status: 'confirmed',
        message: 'The gathering draft was created.',
        alreadyCompleted: true,
        result: { gatheringId: '30000000-0000-4000-8000-000000000003' },
      });
    const onActionCompleted = vi.fn();
    renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText('Confirmation outcome is unknown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check confirmation status' }));

    expect(await screen.findByText('The gathering draft was created.')).toBeTruthy();
    expect(screen.getByText('Confirmed and completed')).toBeTruthy();
    expect(onActionCompleted).toHaveBeenCalledOnce();
    expect(apiRequestMock).toHaveBeenCalledTimes(3);
    expect(apiRequestMock.mock.calls[1]).toEqual(apiRequestMock.mock.calls[2]);
  });

  it.each(adminOnlyActions)('shows a fail-closed member-role card for $actionType', async actionType => {
    apiRequestMock.mockResolvedValueOnce(proposalResponse(actionType));
    renderAssistant({ role: 'member' });
    const user = userEvent.setup();

    await submitRequest(user);

    expect(await screen.findByText('Your role cannot approve this action. A family owner or administrator must make this change.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm change|Review & delete|Review & complete/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it.each(['message', 'clarification'] as const)('renders a non-action %s response without mutation controls', async kind => {
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      kind,
      message: `${kind} response text`,
    });
    renderAssistant();
    const user = userEvent.setup();

    await submitRequest(user);

    expect(await screen.findByText(`${kind} response text`)).toBeTruthy();
    expect(screen.queryByText('Proposed action')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a canonical real leap-day planner schedule', async () => {
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messageId: '40000000-0000-4000-8000-000000000009',
      kind: 'gathering_planner',
      message: 'Leap-day planner',
      planner: { ...validPlanner, startAt: '2104-02-29T23:59:00+04:00' },
    });
    renderAssistant();
    const user = userEvent.setup();

    await submitRequest(user);

    expect(await screen.findByRole('dialog', { name: 'AI gathering planner' })).toBeTruthy();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2104-02-29');
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('23:59');
  });

  it.each([
    { name: 'missing envelope fields', body: {} },
    {
      name: 'planner payload missing',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000001', kind: 'gathering_planner', message: 'Incomplete planner' },
    },
    {
      name: 'unknown proposal action type',
      body: proposalResponse('UNKNOWN_ACTION'),
    },
    {
      name: 'malformed proposal id',
      body: {
        ...proposalResponse('CREATE_NOTE_MEMORY'),
        proposal: { ...proposalResponse('CREATE_NOTE_MEMORY').proposal, id: 'not-a-uuid' },
      },
    },
    {
      name: 'proposal payload attached to a non-proposal response',
      body: { ...proposalResponse('CREATE_NOTE_MEMORY'), kind: 'message' },
    },
    {
      name: 'unknown response kind',
      body: { sessionId, kind: 'tool', message: 'Unsafe tool result' },
    },
    {
      name: 'malformed session id',
      body: { sessionId: 'not-a-uuid', kind: 'message', message: 'Unsafe session result' },
    },
    {
      name: 'malformed optional message id',
      body: { sessionId, messageId: 'not-a-uuid', kind: 'message', message: 'Unsafe message id' },
    },
    {
      name: 'planner with an invalid type',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000002', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, type: 'Road trip' } },
    },
    {
      name: 'planner with an invalid invitation channel',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000003', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, invitationChannel: 'email' } },
    },
    {
      name: 'planner with an invalid member id',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000004', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, memberIds: ['not-a-uuid'] } },
    },
    {
      name: 'planner with an offsetless schedule',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000005', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, startAt: '2099-09-12T17:00:00' } },
    },
    {
      name: 'planner with a non-Dubai offset',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000007', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, startAt: '2099-09-12T13:00:00Z' } },
    },
    {
      name: 'planner with a rolled-over non-leap date',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000008', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, startAt: '2099-02-29T17:00:00+04:00' } },
    },
    {
      name: 'planner with nonzero seconds',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000010', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, startAt: '2099-09-12T17:00:01+04:00' } },
    },
    {
      name: 'planner with an extra nested property',
      body: { sessionId, messageId: '40000000-0000-4000-8000-000000000006', kind: 'gathering_planner', message: 'Planner', planner: { ...validPlanner, autoSend: true } },
    },
  ])('rejects a malformed frontend response: $name', async ({ body }) => {
    apiRequestMock.mockResolvedValueOnce(body);
    const onActionCompleted = vi.fn();
    renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);

    expect(await screen.findByText('Agent request failed')).toBeTruthy();
    expect(screen.getByText('No family data was changed by this request.')).toBeTruthy();
    expect(screen.queryByText('Proposed action')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it.each([
    ['DELETE_MEMBER', 'UPDATE_MEMBER'],
    ['UPDATE_MEMBER', 'DELETE_MEMBER'],
    ['ADD_MEMBER', 'CREATE_GATHERING_DRAFT'],
    ['CREATE_NOTE_MEMORY', 'CREATE_RELATIONSHIP'],
    ['UPDATE_MEMBER', 'CREATE_RECONNECTION_PLAN'],
    ['UPDATE_PLAN_STATUS', 'CREATE_GATHERING_DRAFT'],
    ['CREATE_GATHERING_DRAFT', 'CREATE_NOTE_MEMORY'],
    ['PREPARE_INVITATION_LINKS', 'CREATE_GATHERING_DRAFT'],
  ] as const)('treats a mismatched known result %s -> %s as unknown with no UI side effects', async (shownAction, returnedAction) => {
    const row = actionCases.find(candidate => candidate.actionType === shownAction)!;
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse(shownAction))
      .mockResolvedValueOnce({
        proposalId: proposalIdFor(shownAction),
        actionType: returnedAction,
        status: 'confirmed',
        message: 'A mismatched action allegedly completed.',
        result: {
          gatheringId: '30000000-0000-4000-8000-000000000003',
          invitations: [{ memberId: 'dad', memberName: 'Dad', sharePath: '/invite/private-token' }],
          deliveryNotice: 'Nothing was sent.',
        },
      });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onActionCompleted = vi.fn();
    const { onNavigateToActionResult } = renderAssistant({ onActionCompleted });
    const user = userEvent.setup();

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: row.confirmLabel }));

    expect(await screen.findByText('Confirmation outcome is unknown')).toBeTruthy();
    expect(screen.queryByText('Confirmed and completed')).toBeNull();
    expect(screen.queryByText('Links prepared, not sent')).toBeNull();
    expect(screen.queryByText('private-token')).toBeNull();
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(onNavigateToActionResult).not.toHaveBeenCalled();
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/action-proposals/${proposalIdFor(shownAction)}/confirm`,
      { method: 'POST', body: JSON.stringify({ expectedActionType: shownAction }) },
    );
  });
});
