/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { GatheringPlanPrefill } from '../api/reconnectionPlans';
import type { PersistentGathering } from '../engagementTypes';
import { dubaiTodayKey, toDubaiIso } from '../lib/gatheringDate';
import { readManualGatheringRetryState } from '../lib/manualGatheringRetry';
import type { FamilyMember, FamilyRole } from '../types';

const apiMocks = vi.hoisted(() => ({
  listGatherings: vi.fn(),
  createGathering: vi.fn(),
  prepareInvitations: vi.fn(),
  completeGathering: vi.fn(),
}));

vi.mock('../api/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/engagement')>();
  return {
    ...actual,
    engagementApi: {
      ...actual.engagementApi,
      ...apiMocks,
    },
  };
});

import { Calendar } from './Calendar';

const familyId = '10000000-0000-4000-8000-000000000001';
const otherFamilyId = '10000000-0000-4000-8000-000000000099';
const dad: FamilyMember = {
  id: 'dad',
  name: 'Dad',
  relationship: 'Parent',
  age: 58,
  birthday: '1968-01-01',
  phone: '',
  email: '',
  interests: [],
  locationSharingStatus: 'Unknown',
};
const otherDad: FamilyMember = { ...dad, id: 'other-dad', name: 'Other Dad' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setMobileViewport(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() { return currentMatches; },
    media: '(max-width: 767px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => query === '(max-width: 767px)' ? mediaQueryList : ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  return {
    change(nextMatches: boolean) {
      currentMatches = nextMatches;
      const event = { matches: nextMatches, media: mediaQueryList.media } as MediaQueryListEvent;
      listeners.forEach(listener => listener(event));
    },
  };
}

function gathering(
  selectedFamilyId: string,
  id: string,
  title: string,
  overrides: Partial<PersistentGathering> = {},
): PersistentGathering {
  return {
    id,
    familyId: selectedFamilyId,
    title,
    purpose: 'Spend time together',
    startAt: toDubaiIso(dubaiTodayKey(), '00:00'),
    timezone: 'Asia/Dubai',
    locationName: 'Family home',
    type: 'Visit',
    status: 'draft',
    createdByUserId: `creator-${selectedFamilyId}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    invitations: [],
    ...overrides,
  };
}

function calendarElement({
  selectedFamilyId,
  selectedMembers,
  onGatheringsChanged,
  familyRole = 'owner',
  currentUserId = `creator-${selectedFamilyId}`,
}: {
  selectedFamilyId: string;
  selectedMembers: FamilyMember[];
  onGatheringsChanged?: (gatherings: PersistentGathering[]) => void;
  familyRole?: FamilyRole;
  currentUserId?: string;
}) {
  return (
    <Calendar
      familyId={selectedFamilyId}
      members={selectedMembers}
      familyRole={familyRole}
      currentUserId={currentUserId}
      onGatheringsChanged={onGatheringsChanged}
    />
  );
}

async function submitManualDraft(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: 'Plan a gathering' }));
  await screen.findByRole('dialog', { name: 'Plan a gathering' });
  await user.type(await screen.findByLabelText('Title'), title);
  await user.type(screen.getByLabelText('Purpose'), 'A family visit');
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-09-12' } });
  await user.type(screen.getByLabelText('Location'), 'Family home');
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  Object.values(apiMocks).forEach(mock => mock.mockReset());
  apiMocks.listGatherings.mockResolvedValue({ gatherings: [] });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Calendar responsive views', () => {
  it('defaults a phone viewport to Agenda and keeps Month available', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    const todayGathering = gathering(familyId, 'mobile-today', 'Mobile family lunch');
    apiMocks.listGatherings.mockResolvedValue({ gatherings: [todayGathering] });

    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    expect(await screen.findByText('Mobile family lunch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');
    const week = screen.getByRole('region', { name: 'Gathering week' });
    const agendaDays = within(week).getAllByRole('button');
    const today = agendaDays.find(button => button.getAttribute('aria-current') === 'date');
    const anotherDay = agendaDays.find(button => button !== today);
    expect(week.firstElementChild?.className).toContain('gap-px');
    expect(agendaDays.every(button => button.className.includes('min-w-11'))).toBe(true);
    expect(today).toBeTruthy();
    expect(today?.getAttribute('aria-pressed')).toBe('true');
    expect(anotherDay).toBeTruthy();
    await user.click(anotherDay!);
    expect(anotherDay?.getAttribute('aria-pressed')).toBe('true');
    expect(anotherDay?.getAttribute('aria-current')).toBeNull();
    expect(today?.getAttribute('aria-current')).toBe('date');
    expect(today?.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Gathering calendar' })).toBeNull();
    const planGatheringButton = screen.getByRole('button', { name: 'Plan a gathering' });
    expect(planGatheringButton.className).toContain('min-h-12');
    expect(planGatheringButton.className.split(' ')).toContain('bg-gold');
    expect(planGatheringButton.className.split(' ')).toContain('text-ink');

    await user.click(screen.getByRole('button', { name: 'Month' }));

    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
    const month = screen.getByRole('region', { name: 'Gathering calendar' });
    expect(month).toBeTruthy();
    expect(month.className.split(' ')).toContain('p-1');
    expect(month.firstElementChild?.className).toContain('gap-px');
    const monthDays = within(month).getAllByRole('button');
    expect(monthDays.every(button => button.className.includes('min-w-11'))).toBe(true);
    expect(monthDays.filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('follows breakpoint changes until the user explicitly chooses a view', async () => {
    const viewport = setMobileViewport(false);
    const user = userEvent.setup();
    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
    act(() => viewport.change(true));
    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Month' }));
    act(() => viewport.change(false));
    act(() => viewport.change(true));
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the desktop month default and opens a dvh mobile-capable planner shell', async () => {
    setMobileViewport(false);
    const user = userEvent.setup();
    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'Gathering calendar' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Plan gathering' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan a gathering' });
    const sheet = dialog.querySelector('section');
    expect(dialog.className).toContain('mobile-sheet-overlay');
    expect(sheet?.className).toContain('h-[100dvh]');
    expect(sheet?.className).toContain('sm:max-h-[92dvh]');
    expect(sheet?.className).toContain('mobile-sheet-surface');
    expect(sheet?.querySelector('header')?.className).toContain('mobile-sheet-header');
    expect(sheet?.querySelector('[data-gathering-planner-scroll-region]')?.className).toContain('mobile-sheet-scroll-region');
    expect(sheet?.querySelector('[data-gathering-planner-footer]')?.className).toContain('mobile-sheet-footer');
  });
});

describe('Calendar shared gathering planner', () => {
  it('opens a manual planner with the selected date convenience and no writes', async () => {
    const user = userEvent.setup();
    render(<main><Calendar familyId={familyId} members={[dad]} familyRole="owner" /></main>);
    const scrollRoot = document.querySelector('main') as HTMLElement;
    const trigger = screen.getByRole('button', { name: 'Plan gathering' });

    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Plan a gathering' });
    expect(dialog.parentElement).toBe(document.body);
    expect(scrollRoot.style.overflow).toBe('hidden');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('18:30');
    expect(apiMocks.createGathering).not.toHaveBeenCalled();
    expect(apiMocks.prepareInvitations).not.toHaveBeenCalled();

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }));
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Plan a gathering' })).toBeNull());
    expect(scrollRoot.style.overflow).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens a reconnection handoff in the shared form without silently defaulting its schedule', async () => {
    const user = userEvent.setup();
    const onPlanPrefillConsumed = vi.fn();
    const planPrefill: GatheringPlanPrefill = {
      sourcePlanId: '20000000-0000-4000-8000-000000000002',
      sourcePlanTitle: 'Tea with Dad',
      title: 'Tea with Dad',
      purpose: 'Share family news over tea',
      locationName: 'Family home',
      type: 'Visit',
      notes: 'Suggested duration: 45 minutes.',
      memberIds: ['dad'],
    };
    render(
      <Calendar
        familyId={familyId}
        members={[dad]}
        familyRole="owner"
        planPrefill={planPrefill}
        onPlanPrefillConsumed={onPlanPrefillConsumed}
      />,
    );

    expect(await screen.findByRole('dialog', { name: 'Plan a gathering' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Tea with Dad');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: /Dad/ }) as HTMLInputElement).checked).toBe(true);
    expect(onPlanPrefillConsumed).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Plan a gathering' })).toBeNull());
    expect(apiMocks.createGathering).not.toHaveBeenCalled();
    expect(apiMocks.prepareInvitations).not.toHaveBeenCalled();
  });

  it('focuses the saved gathering date when Assistant opens a Calendar result', async () => {
    const savedGathering = {
      id: '30000000-0000-4000-8000-000000000003',
      familyId,
      title: 'Future Golden Park outing',
      purpose: 'Spend time together',
      startAt: '2099-09-12T17:00:00+04:00',
      timezone: 'Asia/Dubai' as const,
      locationName: 'Golden Park',
      type: 'Outdoor activity',
      status: 'draft' as const,
      createdByUserId: '40000000-0000-4000-8000-000000000004',
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
      invitations: [],
    };
    apiMocks.listGatherings.mockResolvedValue({ gatherings: [savedGathering] });

    render(
      <Calendar
        familyId={familyId}
        members={[dad]}
        familyRole="owner"
        focusTarget={{
          familyId,
          gatheringId: savedGathering.id,
          startAt: savedGathering.startAt,
        }}
      />,
    );

    expect((await screen.findAllByText('Future Golden Park outing')).length).toBeGreaterThan(0);
    const focusedCard = document.querySelector(`[data-gathering-id="${savedGathering.id}"]`);
    expect(focusedCard?.className).toContain('border-gold');
    await waitFor(() => expect(document.activeElement).toBe(focusedCard));
  });

  it.each(['success', 'error'] as const)(
    'ignores an old-family gathering-list %s after the new family has loaded',
    async outcome => {
      const oldLoad = deferred<{ gatherings: PersistentGathering[] }>();
      const oldGathering = gathering(familyId, 'old-gathering', 'Old family private gathering');
      const newGathering = gathering(otherFamilyId, 'new-gathering', 'New family gathering');
      const onGatheringsChanged = vi.fn();
      apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => (
        requestedFamilyId === familyId
          ? oldLoad.promise
          : Promise.resolve({ gatherings: [newGathering] })
      ));
      const { rerender } = render(calendarElement({
        selectedFamilyId: familyId,
        selectedMembers: [dad],
        onGatheringsChanged,
      }));
      await waitFor(() => expect(apiMocks.listGatherings).toHaveBeenCalledWith(familyId));

      rerender(calendarElement({
        selectedFamilyId: otherFamilyId,
        selectedMembers: [otherDad],
        onGatheringsChanged,
      }));
      expect(await screen.findByText('New family gathering')).toBeTruthy();
      onGatheringsChanged.mockClear();

      await act(async () => {
        if (outcome === 'success') oldLoad.resolve({ gatherings: [oldGathering] });
        else oldLoad.reject(new Error('Old family calendar failed late'));
        await Promise.resolve();
      });

      expect(screen.getAllByText('New family gathering').length).toBeGreaterThan(0);
      expect(screen.queryByText('Old family private gathering')).toBeNull();
      expect(screen.queryByText(/Old family calendar failed late/)).toBeNull();
      expect(onGatheringsChanged).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'error'] as const)(
    'ignores an old-family invitation %s without replacing or unlocking the new family review',
    async outcome => {
      const oldInvitation = deferred<{
        gathering: PersistentGathering;
        invitations: Array<{ memberId: string; memberName: string; sharePath: string }>;
        deliveryNotice: string;
      }>();
      const newInvitation = deferred<{
        gathering: PersistentGathering;
        invitations: Array<{ memberId: string; memberName: string; sharePath: string }>;
        deliveryNotice: string;
      }>();
      const oldGathering = gathering(familyId, 'old-gathering', 'Old family private gathering');
      const newGathering = gathering(otherFamilyId, 'new-gathering', 'New family gathering');
      const onGatheringsChanged = vi.fn();
      apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => Promise.resolve({
        gatherings: [requestedFamilyId === familyId ? oldGathering : newGathering],
      }));
      apiMocks.prepareInvitations
        .mockImplementationOnce(() => oldInvitation.promise)
        .mockImplementationOnce(() => newInvitation.promise);
      const { rerender } = render(calendarElement({
        selectedFamilyId: familyId,
        selectedMembers: [dad],
        onGatheringsChanged,
      }));
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Prepare RSVP links' }));
      await user.click(screen.getByRole('checkbox', { name: /Dad/ }));
      await user.click(screen.getByRole('button', { name: 'Review' }));
      await user.click(screen.getByRole('button', { name: 'Confirm & prepare' }));

      rerender(calendarElement({
        selectedFamilyId: otherFamilyId,
        selectedMembers: [otherDad],
        onGatheringsChanged,
      }));
      await screen.findByText('New family gathering');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Prepare RSVP links' }));
      await user.click(screen.getByRole('checkbox', { name: /Other Dad/ }));
      await user.click(screen.getByRole('button', { name: 'Review' }));
      await user.click(screen.getByRole('button', { name: 'Confirm & prepare' }));
      expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
      onGatheringsChanged.mockClear();

      await act(async () => {
        if (outcome === 'success') {
          oldInvitation.resolve({
            gathering: { ...oldGathering, status: 'inviting' },
            invitations: [{ memberId: dad.id, memberName: dad.name, sharePath: '/invite/old-family-private-token' }],
            deliveryNotice: 'Old family links prepared.',
          });
        } else {
          oldInvitation.reject(new Error('Old family invitation failed late'));
        }
        await Promise.resolve();
      });

      expect(screen.getByRole('dialog', { name: 'Review link preparation' })).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByText(/old-family-private-token/)).toBeNull();
      expect(screen.queryByText(/Old family invitation failed late/)).toBeNull();
      expect(screen.getAllByText('New family gathering').length).toBeGreaterThan(0);
      expect(onGatheringsChanged).not.toHaveBeenCalled();

      await act(async () => {
        newInvitation.resolve({
          gathering: { ...newGathering, status: 'inviting' },
          invitations: [{ memberId: otherDad.id, memberName: otherDad.name, sharePath: '/invite/new-family-private-token' }],
          deliveryNotice: 'New family links prepared, not sent.',
        });
        await Promise.resolve();
      });
      expect(await screen.findByText('Links prepared, not sent')).toBeTruthy();
      expect(screen.getByText(/new-family-private-token/)).toBeTruthy();
    },
  );

  it.each(['success', 'error'] as const)(
    'ignores an old-family completion %s without replacing or unlocking the new family operation',
    async outcome => {
      const oldCompletion = deferred<{ gathering: PersistentGathering; pointsAwarded: number }>();
      const newCompletion = deferred<{ gathering: PersistentGathering; pointsAwarded: number }>();
      const goingInvitations = (prefix: string) => [
        {
          id: `${prefix}-invite-1`,
          memberId: `${prefix}-member-1`,
          memberName: `${prefix} Member One`,
          channel: 'share_link' as const,
          status: 'going' as const,
          preparedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: `${prefix}-invite-2`,
          memberId: `${prefix}-member-2`,
          memberName: `${prefix} Member Two`,
          channel: 'share_link' as const,
          status: 'going' as const,
          preparedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      const oldGathering = gathering(familyId, 'old-gathering', 'Old family private gathering', {
        status: 'inviting',
        invitations: goingInvitations('old'),
      });
      const newGathering = gathering(otherFamilyId, 'new-gathering', 'New family gathering', {
        status: 'inviting',
        invitations: goingInvitations('new'),
      });
      const onGatheringsChanged = vi.fn();
      apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => Promise.resolve({
        gatherings: [requestedFamilyId === familyId ? oldGathering : newGathering],
      }));
      apiMocks.completeGathering
        .mockImplementationOnce(() => oldCompletion.promise)
        .mockImplementationOnce(() => newCompletion.promise);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { rerender } = render(calendarElement({
        selectedFamilyId: familyId,
        selectedMembers: [dad],
        onGatheringsChanged,
      }));
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Complete' }));
      rerender(calendarElement({
        selectedFamilyId: otherFamilyId,
        selectedMembers: [otherDad],
        onGatheringsChanged,
      }));
      await screen.findByText('New family gathering');
      await user.click(screen.getByRole('button', { name: 'Complete' }));
      expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
      onGatheringsChanged.mockClear();

      await act(async () => {
        if (outcome === 'success') {
          oldCompletion.resolve({
            gathering: { ...oldGathering, status: 'completed' },
            pointsAwarded: 11,
          });
        } else {
          oldCompletion.reject(new Error('Old family completion failed late'));
        }
        await Promise.resolve();
      });

      expect(screen.getByText('New family gathering')).toBeTruthy();
      expect(screen.queryByText('Old family private gathering')).toBeNull();
      expect(screen.queryByText(/11 verified family points/)).toBeNull();
      expect(screen.queryByText(/Old family completion failed late/)).toBeNull();
      expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
      expect(onGatheringsChanged).not.toHaveBeenCalled();

      await act(async () => {
        newCompletion.resolve({
          gathering: { ...newGathering, status: 'completed' },
          pointsAwarded: 22,
        });
        await Promise.resolve();
      });
      expect(await screen.findByText(/22 verified family points/)).toBeTruthy();
    },
  );

  it.each(['success', 'error'] as const)(
    'ignores an old-family planner %s without refreshing or unlocking the new family planner',
    async outcome => {
      const oldCreate = deferred<{ gathering: PersistentGathering }>();
      const newCreate = deferred<{ gathering: PersistentGathering }>();
      const oldListed = gathering(familyId, 'old-listed', 'Old family private gathering');
      const newListed = gathering(otherFamilyId, 'new-listed', 'New family gathering');
      const oldSaved = gathering(familyId, 'old-saved', 'Old family draft result', {
        startAt: '2099-09-12T18:30:00+04:00',
      });
      const newSaved = gathering(otherFamilyId, 'new-saved', 'New family draft result', {
        startAt: '2099-09-12T18:30:00+04:00',
      });
      const onGatheringsChanged = vi.fn();
      apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => Promise.resolve({
        gatherings: [requestedFamilyId === familyId ? oldListed : newListed],
      }));
      apiMocks.createGathering
        .mockImplementationOnce(() => oldCreate.promise)
        .mockImplementationOnce(() => newCreate.promise);
      const { rerender } = render(calendarElement({
        selectedFamilyId: familyId,
        selectedMembers: [dad],
        onGatheringsChanged,
      }));
      const user = userEvent.setup();

      await screen.findByText('Old family private gathering');
      await submitManualDraft(user, 'Old family draft result');
      rerender(calendarElement({
        selectedFamilyId: otherFamilyId,
        selectedMembers: [otherDad],
        onGatheringsChanged,
      }));
      await screen.findByText('New family gathering');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await submitManualDraft(user, 'New family draft result');
      expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
      onGatheringsChanged.mockClear();

      await act(async () => {
        if (outcome === 'success') oldCreate.resolve({ gathering: oldSaved });
        else oldCreate.reject(new Error('Old family planner failed late'));
        await Promise.resolve();
      });

      expect(screen.getByRole('dialog', { name: 'Review before saving' })).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('New family gathering')).toBeTruthy();
      expect(screen.queryByText('Old family draft result')).toBeNull();
      expect(screen.queryByText(/Old family planner failed late/)).toBeNull();
      expect(onGatheringsChanged).not.toHaveBeenCalled();

      await act(async () => {
        newCreate.resolve({ gathering: newSaved });
        await Promise.resolve();
      });
      expect((await screen.findAllByText('Gathering saved')).length).toBeGreaterThan(0);
      expect(onGatheringsChanged).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ id: newSaved.id, familyId: otherFamilyId }),
      ]));
    },
  );

  it('does not refresh a remounted new-family calendar when an unmounted planner settles', async () => {
    const oldCreate = deferred<{ gathering: PersistentGathering }>();
    const oldListed = gathering(familyId, 'old-listed-unmount', 'Old family gathering');
    const oldSaved = gathering(familyId, 'old-saved-unmount', 'Old family saved late', {
      startAt: '2099-09-12T18:30:00+04:00',
    });
    const newListed = gathering(otherFamilyId, 'new-listed-unmount', 'Remounted new family gathering');
    const onGatheringsChanged = vi.fn();
    apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => Promise.resolve({
      gatherings: [requestedFamilyId === familyId ? oldListed : newListed],
    }));
    apiMocks.createGathering.mockReturnValueOnce(oldCreate.promise);
    const oldView = render(calendarElement({
      selectedFamilyId: familyId,
      selectedMembers: [dad],
      onGatheringsChanged,
    }));
    const user = userEvent.setup();

    await screen.findByText('Old family gathering');
    await submitManualDraft(user, 'Old family saved late');
    oldView.unmount();
    render(calendarElement({
      selectedFamilyId: otherFamilyId,
      selectedMembers: [otherDad],
      onGatheringsChanged,
    }));
    expect(await screen.findByText('Remounted new family gathering')).toBeTruthy();
    onGatheringsChanged.mockClear();

    await act(async () => {
      oldCreate.resolve({ gathering: oldSaved });
      await Promise.resolve();
    });

    expect(screen.getByText('Remounted new family gathering')).toBeTruthy();
    expect(screen.queryByText('Old family saved late')).toBeNull();
    expect(onGatheringsChanged).not.toHaveBeenCalled();
  });

  it('retains a manual planner request key across a lost response, close, and safe retry', async () => {
    const persistedByKey = new Map<string, PersistentGathering>();
    const requestKeys: string[] = [];
    let domainCreateCount = 0;
    const saved = gathering(familyId, 'lost-response-gathering', 'Lost response retry', {
      startAt: '2099-09-12T18:30:00+04:00',
    });
    apiMocks.createGathering.mockImplementation((
      _requestedFamilyId: string,
      _input: unknown,
      options?: { idempotencyKey?: string },
    ) => {
      const key = options?.idempotencyKey ?? '';
      requestKeys.push(key);
      const existing = persistedByKey.get(key);
      if (existing) return Promise.resolve({ gathering: existing });
      domainCreateCount += 1;
      persistedByKey.set(key, saved);
      if (domainCreateCount === 1) {
        return Promise.reject(new ApiError('Connection was lost after saving.', 0, 'NETWORK_ERROR'));
      }
      return Promise.resolve({ gathering: saved });
    });
    const user = userEvent.setup();
    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    await submitManualDraft(user, 'Lost response retry');
    expect(await screen.findByText(/server did not confirm whether the gathering was created/i)).toBeTruthy();
    expect(screen.getByText(/Calendar retains that key for the next manual retry/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await submitManualDraft(user, 'Lost response retry');

    expect((await screen.findAllByText('Gathering saved')).length).toBeGreaterThan(0);
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[0]).toBeTruthy();
    expect(requestKeys[1]).toBe(requestKeys[0]);
    expect(domainCreateCount).toBe(1);
  });

  it('recovers the same uncertain manual request key after Calendar unmount and remount', async () => {
    const persistedByKey = new Map<string, PersistentGathering>();
    const requestKeys: string[] = [];
    let domainCreateCount = 0;
    const currentUserId = 'calendar-retry-user';
    const saved = gathering(familyId, 'remounted-lost-response', 'Remounted lost response', {
      startAt: '2099-09-12T18:30:00+04:00',
    });
    apiMocks.createGathering.mockImplementation((
      _requestedFamilyId: string,
      _input: unknown,
      options?: { idempotencyKey?: string },
    ) => {
      const key = options?.idempotencyKey ?? '';
      requestKeys.push(key);
      const existing = persistedByKey.get(key);
      if (existing) return Promise.resolve({ gathering: existing });
      domainCreateCount += 1;
      persistedByKey.set(key, saved);
      return Promise.reject(new ApiError('Connection was lost after saving.', 0, 'NETWORK_ERROR'));
    });
    const user = userEvent.setup();
    const firstMount = render(calendarElement({
      selectedFamilyId: familyId,
      selectedMembers: [dad],
      currentUserId,
    }));

    await submitManualDraft(user, 'Remounted lost response');
    await screen.findByText(/server did not confirm whether the gathering was created/i);
    expect(readManualGatheringRetryState(currentUserId, familyId)?.idempotencyKey).toBe(requestKeys[0]);
    firstMount.unmount();

    render(calendarElement({
      selectedFamilyId: familyId,
      selectedMembers: [dad],
      currentUserId,
    }));
    await submitManualDraft(user, 'Remounted lost response');

    expect((await screen.findAllByText('Gathering saved')).length).toBeGreaterThan(0);
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[1]).toBe(requestKeys[0]);
    expect(domainCreateCount).toBe(1);
    expect(readManualGatheringRetryState(currentUserId, familyId)).toBeNull();
  });

  it.each([
    {
      label: 'family',
      nextFamilyId: otherFamilyId,
      nextUserId: 'calendar-scope-user-a',
      nextMembers: [otherDad],
    },
    {
      label: 'user',
      nextFamilyId: familyId,
      nextUserId: 'calendar-scope-user-b',
      nextMembers: [dad],
    },
  ])('clears and never reuses an uncertain key after a $label context change', async ({
    nextFamilyId,
    nextUserId,
    nextMembers,
  }) => {
    const originalUserId = 'calendar-scope-user-a';
    const requestKeys: string[] = [];
    let requestCount = 0;
    apiMocks.createGathering.mockImplementation((
      requestedFamilyId: string,
      input: { title: string; startAt: string },
      options?: { idempotencyKey?: string },
    ) => {
      requestCount += 1;
      requestKeys.push(options?.idempotencyKey ?? '');
      if (requestCount === 1) {
        return Promise.reject(new ApiError('Connection was lost after saving.', 0, 'NETWORK_ERROR'));
      }
      return Promise.resolve({
        gathering: gathering(requestedFamilyId, `new-scope-${requestCount}`, input.title, {
          startAt: input.startAt,
        }),
      });
    });
    const user = userEvent.setup();
    const view = render(calendarElement({
      selectedFamilyId: familyId,
      selectedMembers: [dad],
      currentUserId: originalUserId,
    }));

    await submitManualDraft(user, 'Old context uncertain draft');
    await screen.findByText(/server did not confirm whether the gathering was created/i);
    expect(readManualGatheringRetryState(originalUserId, familyId)?.idempotencyKey).toBe(requestKeys[0]);

    view.rerender(calendarElement({
      selectedFamilyId: nextFamilyId,
      selectedMembers: nextMembers,
      currentUserId: nextUserId,
    }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(readManualGatheringRetryState(originalUserId, familyId)).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(view.container.getAttribute('aria-hidden')).toBeNull();
      expect(view.container.inert).toBe(false);
    });
    await submitManualDraft(user, 'New context draft');

    expect((await screen.findAllByText('Gathering saved')).length).toBeGreaterThan(0);
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[1]).not.toBe(requestKeys[0]);
  });

  it('rotates an uncertain retry key only after explicit confirmation for a changed draft', async () => {
    const persistedByKey = new Map<string, { payload: string; gathering: PersistentGathering }>();
    const requestKeys: string[] = [];
    let domainCreateCount = 0;
    apiMocks.createGathering.mockImplementation((
      _requestedFamilyId: string,
      input: { title: string; startAt: string },
      options?: { idempotencyKey?: string },
    ) => {
      const key = options?.idempotencyKey ?? '';
      const payload = JSON.stringify(input);
      requestKeys.push(key);
      const existing = persistedByKey.get(key);
      if (existing) {
        if (existing.payload !== payload) {
          return Promise.reject(new ApiError(
            'This retry key was already used with different gathering details.',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          ));
        }
        return Promise.resolve({ gathering: existing.gathering });
      }

      domainCreateCount += 1;
      const saved = gathering(familyId, `changed-retry-${domainCreateCount}`, input.title, {
        startAt: input.startAt,
      });
      persistedByKey.set(key, { payload, gathering: saved });
      return domainCreateCount === 1
        ? Promise.reject(new ApiError('Connection was lost after saving.', 0, 'NETWORK_ERROR'))
        : Promise.resolve({ gathering: saved });
    });
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    await submitManualDraft(user, 'Original uncertain draft');
    await screen.findByText(/server did not confirm whether the gathering was created/i);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await submitManualDraft(user, 'Changed gathering details');
    expect(await screen.findByText(/retry key was already used with different gathering details/i)).toBeTruthy();
    expect(screen.getByText(/server did not confirm whether the gathering was created/i)).toBeTruthy();
    const startNewDraft = screen.getByRole('button', { name: 'Start a new draft instead' });
    expect(startNewDraft.className).toContain('min-h-11');
    await user.click(startNewDraft);

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'Review before saving' })).toBeTruthy();
    expect(requestKeys).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Start a new draft instead' }));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/previous request may already have created a gathering/i));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('Title'), 'Changed gathering details');
    await user.type(screen.getByLabelText('Purpose'), 'A family visit');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-09-12' } });
    await user.type(screen.getByLabelText('Location'), 'Family home');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect((await screen.findAllByText('Gathering saved')).length).toBeGreaterThan(0);
    expect(requestKeys).toHaveLength(3);
    expect(requestKeys[1]).toBe(requestKeys[0]);
    expect(requestKeys[2]).not.toBe(requestKeys[0]);
    expect(domainCreateCount).toBe(2);
  });

  it('does not render unsafe existing-gathering invitation URLs', async () => {
    const listed = gathering(familyId, 'unsafe-link-gathering', 'Gathering with unsafe link');
    apiMocks.listGatherings.mockResolvedValue({ gatherings: [listed] });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: { ...listed, status: 'inviting' },
      deliveryNotice: 'Prepared, not sent.',
      invitations: [{
        memberId: dad.id,
        memberName: dad.name,
        sharePath: '/invite/safe-looking-fallback',
        shareUrl: 'javascript:alert(1)',
        whatsappUrl: 'https://wa.me/server-value-must-not-bypass-validation',
      }],
    });
    const user = userEvent.setup();
    render(calendarElement({ selectedFamilyId: familyId, selectedMembers: [dad] }));

    await user.click(await screen.findByRole('button', { name: 'Prepare RSVP links' }));
    const inviteDialog = screen.getByRole('dialog', { name: 'Invite to Gathering with unsafe link' });
    const inviteSheet = inviteDialog.querySelector('section');
    expect(inviteDialog.className).toContain('mobile-sheet-overlay');
    expect(inviteSheet?.className).toContain('mobile-sheet-surface');
    expect(inviteSheet?.querySelector('header')?.className).toContain('mobile-sheet-header');
    expect(inviteSheet?.querySelector('.mobile-sheet-scroll-region')).toBeTruthy();
    expect(inviteSheet?.querySelector('.mobile-sheet-footer')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Dad/ }));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Confirm & prepare' }));

    expect(await screen.findByText(/invitation link is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open WhatsApp' })).toBeNull();
    expect(document.querySelector('a[href^="javascript:"], a[href^="data:"], a[href^="blob:"]')).toBeNull();
  });

  it.each([
    ...(['owner', 'admin'] as const).flatMap(familyRole => (
      ['draft', 'inviting', 'completed', 'cancelled'] as const
    ).map(status => ({
      label: familyRole,
      familyRole,
      status,
      creator: false,
      canPrepare: status === 'draft' || status === 'inviting',
      canComplete: status === 'inviting',
    }))),
    ...(['draft', 'inviting', 'completed', 'cancelled'] as const).flatMap(status => ([
      {
        label: 'member creator',
        familyRole: 'member' as const,
        status,
        creator: true,
        canPrepare: status === 'draft' || status === 'inviting',
        canComplete: false,
      },
      {
        label: 'member non-creator',
        familyRole: 'member' as const,
        status,
        creator: false,
        canPrepare: false,
        canComplete: false,
      },
    ])),
  ])('gates $status controls for $label', async ({ familyRole, status, creator, canPrepare, canComplete }) => {
    const currentUserId = 'permission-user';
    const listed = gathering(familyId, `permission-${familyRole}-${status}-${creator}`, 'Permission matrix gathering', {
      status,
      createdByUserId: creator ? currentUserId : 'another-user',
    });
    apiMocks.listGatherings.mockResolvedValue({ gatherings: [listed] });
    render(calendarElement({
      selectedFamilyId: familyId,
      selectedMembers: [dad],
      familyRole,
      currentUserId,
    }));

    expect(await screen.findByText('Permission matrix gathering')).toBeTruthy();
    expect(Boolean(screen.queryByRole('button', { name: 'Prepare RSVP links' }))).toBe(canPrepare);
    expect(Boolean(screen.queryByRole('button', { name: 'Complete' }))).toBe(canComplete);
  });

  it('does not offer completion before an inviting gathering starts', async () => {
    const listed = gathering(familyId, 'future-inviting', 'Future inviting gathering', {
      status: 'inviting',
      startAt: '2099-09-12T17:00:00+04:00',
    });
    apiMocks.listGatherings.mockResolvedValue({ gatherings: [listed] });
    render(
      <Calendar
        familyId={familyId}
        members={[dad]}
        familyRole="owner"
        currentUserId="permission-user"
        focusTarget={{ familyId, gatheringId: listed.id, startAt: listed.startAt }}
      />,
    );

    expect((await screen.findAllByText('Future inviting gathering')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Prepare RSVP links' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  });
});
