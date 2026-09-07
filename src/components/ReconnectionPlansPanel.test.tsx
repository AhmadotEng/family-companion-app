/* @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReconnectionPlan } from '../engagementTypes';

const listPlansMock = vi.hoisted(() => vi.fn());
const updateStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../api/reconnectionPlans', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/reconnectionPlans')>();
  return {
    ...actual,
    reconnectionPlansApi: {
      list: listPlansMock,
      updateStatus: updateStatusMock,
    },
  };
});

import { ReconnectionPlansPanel } from './ReconnectionPlansPanel';

const familyId = '10000000-0000-4000-8000-000000000001';
const otherFamilyId = '10000000-0000-4000-8000-000000000099';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plan(status: ReconnectionPlan['status']): ReconnectionPlan {
  return {
    id: `plan-${status}`,
    title: `${status} family plan`,
    rationale: 'A short, optional visit could create time together.',
    suggestedMemberIds: [],
    suggestedGathering: {
      format: 'home_visit',
      purpose: 'Spend some time together.',
      durationMinutes: 45,
      locationGuidance: 'Family home',
    },
    evidence: {},
    status,
    provider: 'gemini',
    model: 'test-model',
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
  };
}

function renderPanel(status: ReconnectionPlan['status'], onUsePlan = vi.fn()) {
  listPlansMock.mockResolvedValueOnce({ plans: [plan(status)] });
  render(
    <ReconnectionPlansPanel
      familyId={familyId}
      members={[]}
      onUsePlan={onUsePlan}
    />,
  );
  return { onUsePlan };
}

function panelElement(selectedFamilyId: string) {
  return (
    <ReconnectionPlansPanel
      familyId={selectedFamilyId}
      members={[]}
      onUsePlan={vi.fn()}
    />
  );
}

async function expandPlans(user = userEvent.setup()) {
  const toggle = await screen.findByRole('button', { name: /Stored reconnection plans/i });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return user;
}

beforeEach(() => {
  listPlansMock.mockReset();
  updateStatusMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReconnectionPlansPanel lifecycle controls', () => {
  it('loads behind a collapsed count summary until the user opens it', async () => {
    renderPanel('active');

    const toggle = await screen.findByRole('button', { name: /Stored reconnection plans.*1 stored/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('active family plan')).toBeNull();

    const user = userEvent.setup();
    await user.click(toggle);
    expect(await screen.findByText('active family plan')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    {
      status: 'active',
      shown: ['Accept', 'Dismiss', 'Open editable draft'],
      hidden: ['Restore', 'Mark completed'],
    },
    {
      status: 'dismissed',
      shown: ['Restore'],
      hidden: ['Accept', 'Dismiss', 'Mark completed', 'Open editable draft'],
    },
    {
      status: 'accepted',
      shown: ['Dismiss', 'Mark completed', 'Open editable draft'],
      hidden: ['Accept', 'Restore'],
    },
    {
      status: 'completed',
      shown: [],
      hidden: ['Accept', 'Restore', 'Dismiss', 'Mark completed', 'Open editable draft'],
    },
  ] as const)('shows only valid $status controls', async ({ status, shown, hidden }) => {
    renderPanel(status);
    await expandPlans();

    expect(await screen.findByText(`${status} family plan`)).toBeTruthy();
    for (const label of shown) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    for (const label of hidden) expect(screen.queryByRole('button', { name: label })).toBeNull();
  });

  it.each([
    ['active', 'Accept', 'accepted', 'Accepted'],
    ['active', 'Dismiss', 'dismissed', 'Dismissed'],
    ['dismissed', 'Restore', 'accepted', 'Accepted'],
    ['accepted', 'Dismiss', 'dismissed', 'Dismissed'],
    ['accepted', 'Mark completed', 'completed', 'Completed'],
  ] as const)(
    'updates %s through %s to %s',
    async (currentStatus, buttonLabel, targetStatus, targetLabel) => {
      updateStatusMock.mockResolvedValueOnce({ id: `plan-${currentStatus}`, status: targetStatus });
      renderPanel(currentStatus);
      const user = userEvent.setup();
      await expandPlans(user);

      await user.click(await screen.findByRole('button', { name: buttonLabel }));

      await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith(`plan-${currentStatus}`, targetStatus));
      expect(await screen.findByText(targetLabel)).toBeTruthy();
    },
  );

  it.each([
    ['active', 'Accept', 'Ready to review'],
    ['dismissed', 'Restore', 'Dismissed'],
    ['accepted', 'Mark completed', 'Accepted'],
  ] as const)('keeps %s unchanged and reports a failed %s request', async (status, buttonLabel, statusLabel) => {
    updateStatusMock.mockRejectedValueOnce(new Error(`Could not update ${status}`));
    renderPanel(status);
    const user = userEvent.setup();
    await expandPlans(user);

    await user.click(await screen.findByRole('button', { name: buttonLabel }));

    expect((await screen.findByRole('alert')).textContent).toContain(`Could not update ${status}`);
    expect(screen.getByText(statusLabel)).toBeTruthy();
    expect((screen.getByRole('button', { name: buttonLabel }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('hands active and accepted plans to the editable draft without changing status', async () => {
    for (const status of ['active', 'accepted'] as const) {
      const onUsePlan = vi.fn();
      renderPanel(status, onUsePlan);
      const user = userEvent.setup();
      await expandPlans(user);

      await user.click(await screen.findByRole('button', { name: 'Open editable draft' }));

      expect(onUsePlan).toHaveBeenCalledOnce();
      expect(onUsePlan.mock.calls[0][0]).toMatchObject({ sourcePlanId: `plan-${status}` });
      expect(updateStatusMock).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('shows a list error and retries the authenticated family list', async () => {
    listPlansMock
      .mockRejectedValueOnce(new Error('Stored plans are unavailable'))
      .mockResolvedValueOnce({ plans: [plan('active')] });
    render(
      <ReconnectionPlansPanel familyId={familyId} members={[]} onUsePlan={vi.fn()} />,
    );
    const user = userEvent.setup();

    expect((await screen.findByRole('alert')).textContent).toContain('Stored plans are unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('active family plan')).toBeTruthy();
    expect(listPlansMock).toHaveBeenCalledTimes(2);
    expect(listPlansMock).toHaveBeenNthCalledWith(1, familyId);
    expect(listPlansMock).toHaveBeenNthCalledWith(2, familyId);
  });

  it.each(['success', 'error'] as const)(
    'ignores an old-family list %s that settles after the new family loads',
    async outcome => {
      const oldLoad = deferred<{ plans: ReconnectionPlan[] }>();
      const oldPlan = { ...plan('active'), id: 'old-family-plan', title: 'Old family private plan' };
      const newPlan = { ...plan('active'), id: 'new-family-plan', title: 'New family plan' };
      listPlansMock.mockImplementation((requestedFamilyId: string) => (
        requestedFamilyId === familyId
          ? oldLoad.promise
          : Promise.resolve({ plans: [newPlan] })
      ));
      const { rerender } = render(panelElement(familyId));
      await waitFor(() => expect(listPlansMock).toHaveBeenCalledWith(familyId));

      rerender(panelElement(otherFamilyId));
      await screen.findByRole('button', { name: /Stored reconnection plans.*1 stored/i });
      await expandPlans();
      expect(await screen.findByText('New family plan')).toBeTruthy();

      await act(async () => {
        if (outcome === 'success') oldLoad.resolve({ plans: [oldPlan] });
        else oldLoad.reject(new Error('Old family list failed late'));
        await Promise.resolve();
      });

      expect(screen.getByText('New family plan')).toBeTruthy();
      expect(screen.queryByText('Old family private plan')).toBeNull();
      expect(screen.queryByText(/Old family list failed late/)).toBeNull();
    },
  );

  it.each(['success', 'error'] as const)(
    'ignores an old-family status-update %s without unlocking or erroring the new family operation',
    async outcome => {
      const oldUpdate = deferred<{ id: string; status: 'accepted' }>();
      const newUpdate = deferred<{ id: string; status: 'accepted' }>();
      const oldPlan = { ...plan('active'), id: 'old-family-plan', title: 'Old family private plan' };
      const newPlan = { ...plan('active'), id: 'new-family-plan', title: 'New family plan' };
      listPlansMock.mockImplementation((requestedFamilyId: string) => Promise.resolve({
        plans: [requestedFamilyId === familyId ? oldPlan : newPlan],
      }));
      updateStatusMock
        .mockImplementationOnce(() => oldUpdate.promise)
        .mockImplementationOnce(() => newUpdate.promise);
      const { rerender } = render(panelElement(familyId));
      const user = userEvent.setup();

      await expandPlans(user);
      await user.click(await screen.findByRole('button', { name: 'Accept' }));
      rerender(panelElement(otherFamilyId));
      await screen.findByRole('button', { name: /Stored reconnection plans.*1 stored/i });
      await expandPlans(user);
      await screen.findByText('New family plan');
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        if (outcome === 'success') oldUpdate.resolve({ id: oldPlan.id, status: 'accepted' });
        else oldUpdate.reject(new Error('Old family status failed late'));
        await Promise.resolve();
      });

      expect(screen.getByText('New family plan')).toBeTruthy();
      expect(screen.queryByText('Old family private plan')).toBeNull();
      expect(screen.queryByText(/Old family status failed late/)).toBeNull();
      expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        newUpdate.resolve({ id: newPlan.id, status: 'accepted' });
        await Promise.resolve();
      });
      expect(await screen.findByText('Accepted')).toBeTruthy();
    },
  );
});
