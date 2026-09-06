/* @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

import { ApiError } from '../api/client';
import {
  Assistant,
  type AgentActionCompletion,
  type AgentResultNavigationTarget,
} from './Assistant';

const familyId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000002';
const proposalId = '30000000-0000-4000-8000-000000000003';
const otherFamilyId = '10000000-0000-4000-8000-000000000099';

function renderAssistant(overrides: {
  onActionCompleted?: (completion: AgentActionCompletion) => Promise<void> | void;
  onNavigateToActionResult?: (actionType: string, target?: AgentResultNavigationTarget) => void;
} = {}) {
  const onActionCompleted = overrides.onActionCompleted
    ?? vi.fn<(completion: AgentActionCompletion) => void>();
  const onNavigateToActionResult = overrides.onNavigateToActionResult
    ?? vi.fn<(actionType: string, target?: AgentResultNavigationTarget) => void>();
  const assistant = (selectedFamilyId: string) => (
    <Assistant
      presetInput=""
      clearPreset={vi.fn()}
      familyId={selectedFamilyId}
      members={[]}
      familyRole="owner"
      onActionCompleted={onActionCompleted}
      onNavigateToActionResult={onNavigateToActionResult}
      onUseReconnectionPlan={vi.fn()}
    />
  );
  const view = render(assistant(familyId));
  return {
    onActionCompleted,
    onNavigateToActionResult,
    rerenderFamily: (selectedFamilyId: string) => view.rerender(assistant(selectedFamilyId)),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function submitRequest(user: ReturnType<typeof userEvent.setup>, message = 'Help with this family task') {
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
      id: proposalId,
      actionType,
      title: `${actionType} proposal`,
      summary: 'Review this exact server-validated change.',
      details: {},
      warnings: [],
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

describe('Assistant conversation and confirmation lifecycle', () => {
  it('deletes a confirmed conversation and clears all family-scoped local state', async () => {
    apiRequestMock
      .mockResolvedValueOnce({
        sessionId,
        kind: 'message',
        message: 'Private conversation response',
      })
      .mockResolvedValueOnce(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAssistant();

    await submitRequest(user);
    expect(await screen.findByText('Private conversation response')).toBeTruthy();
    window.sessionStorage.setItem(`family-companion:agent-planners:${familyId}`, '{"dismissed":["planner"]}');
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenLastCalledWith(
      `/api/agent/sessions/${sessionId}`,
      { method: 'DELETE' },
    ));
    expect(confirmSpy).toHaveBeenCalledWith('Permanently delete this AI conversation and its pending proposals?');
    expect(screen.queryByText('Private conversation response')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
    expect(window.sessionStorage.getItem(`family-companion:agent-session:${familyId}`)).toBeNull();
    expect(window.sessionStorage.getItem(`family-companion:agent-planners:${familyId}`)).toBeNull();
  });

  it('keeps the conversation available when deletion cannot be verified', async () => {
    apiRequestMock
      .mockResolvedValueOnce({
        sessionId,
        kind: 'message',
        message: 'Keep this response visible',
      })
      .mockRejectedValueOnce(new Error('Connection closed during deletion'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAssistant();

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Delete conversation' }));

    expect(await screen.findByText('Conversation deletion could not be verified')).toBeTruthy();
    expect(screen.getByText('Keep this response visible')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete conversation' })).toBeTruthy();
    expect(window.sessionStorage.getItem(`family-companion:agent-session:${familyId}`)).toBe(sessionId);
  });

  it('treats an explicit 4xx confirmation rejection as unchanged, not uncertain', async () => {
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse('CREATE_GATHERING_DRAFT'))
      .mockRejectedValueOnce(new ApiError('The draft no longer satisfies server rules.', 409, 'STALE_PROPOSAL'));
    const onActionCompleted = vi.fn();
    const onNavigateToActionResult = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderAssistant({ onActionCompleted, onNavigateToActionResult });

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Confirm change' }));

    expect(await screen.findByText('Confirmation was rejected')).toBeTruthy();
    expect(screen.getByText('The server rejected this confirmation, so no family data was changed by this attempt.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check confirmation status' })).toBeNull();
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(onNavigateToActionResult).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      flow: 'confirm',
      invalidResult: {
        proposalId,
        actionType: 'CREATE_GATHERING_DRAFT',
        status: 'confirmed',
        message: { unsafe: 'React object' },
      },
      expectedError: 'Confirmation outcome is unknown',
    },
    {
      flow: 'reject',
      invalidResult: {
        proposalId,
        actionType: 'CREATE_GATHERING_DRAFT',
        status: 'rejected',
        message: 'Cancelled',
        alreadyRejected: 'false',
      },
      expectedError: 'Cancellation could not be verified',
    },
    {
      flow: 'status-check',
      invalidResult: {
        proposalId: 42,
        actionType: 'CREATE_GATHERING_DRAFT',
        status: 'confirmed',
        message: 'Allegedly completed',
        alreadyCompleted: true,
      },
      expectedError: 'Confirmation outcome is unknown',
    },
  ] as const)(
    'rejects a malformed $flow resolution envelope without terminal UI side effects',
    async ({ flow, invalidResult, expectedError }) => {
      apiRequestMock.mockResolvedValueOnce(proposalResponse('CREATE_GATHERING_DRAFT'));
      if (flow === 'status-check') {
        apiRequestMock.mockRejectedValueOnce(new Error('Connection closed after confirmation'));
      }
      apiRequestMock.mockResolvedValueOnce(invalidResult);
      const onActionCompleted = vi.fn();
      const onNavigateToActionResult = vi.fn();
      const user = userEvent.setup();
      renderAssistant({ onActionCompleted, onNavigateToActionResult });

      await submitRequest(user);
      if (flow === 'reject') {
        await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      } else {
        await user.click(await screen.findByRole('button', { name: 'Confirm change' }));
        if (flow === 'status-check') {
          await user.click(await screen.findByRole('button', { name: 'Check confirmation status' }));
        }
      }

      expect(await screen.findByText(expectedError)).toBeTruthy();
      expect(screen.queryByText('Confirmed and completed')).toBeNull();
      expect(screen.queryByText(/Cancelled .* no changes made/)).toBeNull();
      expect(screen.queryByText('Links prepared, not sent')).toBeNull();
      expect(onActionCompleted).not.toHaveBeenCalled();
      expect(onNavigateToActionResult).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, 'had already completed', 'not returned again'],
    [false, 'completed', 'did not contain usable private links'],
  ] as const)(
    'shows a truthful non-recoverable-link result when alreadyCompleted is %s',
    async (alreadyCompleted, resultMessage, expectedNotice) => {
      apiRequestMock
        .mockResolvedValueOnce(proposalResponse('PREPARE_INVITATION_LINKS'))
      .mockResolvedValueOnce({
          proposalId,
          actionType: 'PREPARE_INVITATION_LINKS',
          status: 'confirmed',
          message: `The invitation-link action ${resultMessage}.`,
          alreadyCompleted,
          result: { gatheringId: 'gathering-id', invitations: [] },
        });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const onActionCompleted = vi.fn();
      const onNavigateToActionResult = vi.fn();
      const user = userEvent.setup();
      renderAssistant({ onActionCompleted, onNavigateToActionResult });

      await submitRequest(user);
      await user.click(await screen.findByRole('button', { name: 'Review & prepare links' }));

      expect(await screen.findByText('Private links are not available in this result')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain(expectedNotice);
      expect(screen.getByText('Confirmed and completed')).toBeTruthy();
      expect(screen.queryByText('Links prepared, not sent')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open WhatsApp' })).toBeNull();
      expect(onActionCompleted).toHaveBeenCalledWith({
        actionType: 'PREPARE_INVITATION_LINKS',
        resources: ['gatherings'],
      });
      expect(onNavigateToActionResult).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    },
  );

  it('shows live invitation links without automatically navigating or opening WhatsApp', async () => {
    const privateToken = 'private-live-token';
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse('PREPARE_INVITATION_LINKS'))
      .mockResolvedValueOnce({
        proposalId,
        actionType: 'PREPARE_INVITATION_LINKS',
        status: 'confirmed',
        message: 'Private invitation links were prepared.',
        alreadyCompleted: false,
        result: {
          gatheringId: 'gathering-id',
          deliveryNotice: 'Nothing was sent automatically.',
          invitations: [{
            memberId: 'member-dad',
            memberName: 'Dad',
            sharePath: `/invite/${privateToken}`,
          }],
        },
      });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onNavigateToActionResult = vi.fn();
    const user = userEvent.setup();
    renderAssistant({ onNavigateToActionResult });

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Review & prepare links' }));

    expect(await screen.findByText('Links prepared, not sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open WhatsApp' })).toBeTruthy();
    expect(onNavigateToActionResult).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      expect(window.sessionStorage.getItem(window.sessionStorage.key(index)!)).not.toContain(privateToken);
    }

    await user.click(screen.getByRole('button', { name: 'Open WhatsApp' }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/wa\.me\/\?text=/),
      '_blank',
      'noopener,noreferrer',
    );
    expect(onNavigateToActionResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /I copied the links/i }));
    expect(onNavigateToActionResult).toHaveBeenCalledWith('PREPARE_INVITATION_LINKS');
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a late invitation-link confirmation after the active family changes', async () => {
    const pending = deferred<Record<string, unknown>>();
    const privateToken = 'old-family-private-token';
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse('PREPARE_INVITATION_LINKS'))
      .mockReturnValueOnce(pending.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onActionCompleted = vi.fn();
    const onNavigateToActionResult = vi.fn();
    const user = userEvent.setup();
    const view = renderAssistant({ onActionCompleted, onNavigateToActionResult });

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Review & prepare links' }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    view.rerenderFamily(otherFamilyId);
    await waitFor(() => expect(screen.queryByText('PREPARE_INVITATION_LINKS proposal')).toBeNull());

    await act(async () => {
      pending.resolve({
        proposalId,
        actionType: 'PREPARE_INVITATION_LINKS',
        status: 'confirmed',
        message: 'Old-family private links were prepared.',
        result: {
          gatheringId: 'old-gathering',
          deliveryNotice: 'Nothing was sent.',
          invitations: [{ memberId: 'old-member', memberName: 'Old Dad', sharePath: `/invite/${privateToken}` }],
        },
      });
      await pending.promise;
    });

    expect(screen.queryByText('Old-family private links were prepared.')).toBeNull();
    expect(screen.queryByText('Links prepared, not sent')).toBeNull();
    expect(document.body.textContent).not.toContain(privateToken);
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(onNavigateToActionResult).not.toHaveBeenCalled();
  });

  it('ignores a late rejection after the active family changes', async () => {
    const pending = deferred<Record<string, unknown>>();
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse('CREATE_GATHERING_DRAFT'))
      .mockReturnValueOnce(pending.promise);
    const onActionCompleted = vi.fn();
    const user = userEvent.setup();
    const view = renderAssistant({ onActionCompleted });

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    view.rerenderFamily(otherFamilyId);

    await act(async () => {
      pending.resolve({
        proposalId,
        actionType: 'CREATE_GATHERING_DRAFT',
        status: 'rejected',
        message: 'Old proposal cancelled.',
      });
      await pending.promise;
    });

    expect(screen.queryByText('Old proposal cancelled.')).toBeNull();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it('ignores a late idempotent status-check result after the active family changes', async () => {
    const pendingStatus = deferred<Record<string, unknown>>();
    apiRequestMock
      .mockResolvedValueOnce(proposalResponse('CREATE_GATHERING_DRAFT'))
      .mockRejectedValueOnce(new Error('Connection closed after confirm'))
      .mockReturnValueOnce(pendingStatus.promise);
    const onActionCompleted = vi.fn();
    const user = userEvent.setup();
    const view = renderAssistant({ onActionCompleted });

    await submitRequest(user);
    await user.click(await screen.findByRole('button', { name: 'Confirm change' }));
    await user.click(await screen.findByRole('button', { name: 'Check confirmation status' }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(3));
    view.rerenderFamily(otherFamilyId);

    await act(async () => {
      pendingStatus.resolve({
        proposalId,
        actionType: 'CREATE_GATHERING_DRAFT',
        status: 'confirmed',
        message: 'Old gathering draft completed.',
      });
      await pendingStatus.promise;
    });

    expect(screen.queryByText('Old gathering draft completed.')).toBeNull();
    expect(screen.queryByText('Confirmed and completed')).toBeNull();
    expect(onActionCompleted).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'does not let a late conversation-delete %s clear or error the new family view',
    async outcome => {
      const pendingDelete = deferred<void>();
      apiRequestMock
        .mockResolvedValueOnce({
          sessionId,
          kind: 'message',
          message: 'Old family conversation',
        })
        .mockReturnValueOnce(pendingDelete.promise);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const user = userEvent.setup();
      const view = renderAssistant();

      await submitRequest(user);
      await user.click(await screen.findByRole('button', { name: 'Delete conversation' }));
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
      view.rerenderFamily(otherFamilyId);
      const input = screen.getByLabelText('Ask the family agent');
      await user.type(input, 'Keep this new-family draft');

      await act(async () => {
        if (outcome === 'resolve') pendingDelete.resolve();
        else pendingDelete.reject(new Error('Old deletion failed'));
        try {
          await pendingDelete.promise;
        } catch {
          // The component must ignore this old-family failure.
        }
      });

      expect((input as HTMLInputElement).value).toBe('Keep this new-family draft');
      expect(screen.queryByText('Conversation deletion could not be verified')).toBeNull();
      expect(screen.queryByText('Old family conversation')).toBeNull();
    },
  );
});
