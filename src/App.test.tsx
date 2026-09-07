/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistentGathering } from './engagementTypes';
import {
  readManualGatheringRetryState,
  writeManualGatheringRetryState,
} from './lib/manualGatheringRetry';
import type { AuthSession, FamilyContext } from './types';

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn(),
  getContext: vi.fn(),
  listGatherings: vi.fn(),
  clearStoredAgentSessions: vi.fn(),
}));

const appHarness = vi.hoisted(() => ({
  nextSession: null as AuthSession | null,
}));

vi.mock('./components/Layout', () => ({
  Layout: ({ children, setActiveTab, onSignOut, onOpenLocationSettings, accountName }: any) => (
    <div>
      <nav>
        <button type="button" onClick={() => setActiveTab('home')}>Go Home</button>
        <button type="button" onClick={() => setActiveTab('assistant')}>Go Assistant</button>
        <button type="button" onClick={() => setActiveTab('tree')}>Go Tree</button>
      </nav>
      <button type="button" onClick={() => onOpenLocationSettings?.()}>Open privacy settings</button>
      <button type="button" onClick={() => void onSignOut?.()} aria-label={`Sign out ${accountName}`}>
        Sign out
      </button>
      {children}
    </div>
  ),
}));

vi.mock('./screens/Assistant', () => ({
  clearStoredAgentSessions: apiMocks.clearStoredAgentSessions,
  Assistant: (props: any) => (
    <section>
      <p data-testid="assistant-family">{props.familyId}:{props.members.map((member: any) => member.name).join(',')}</p>
      <button
        type="button"
        onClick={() => props.onNavigateToActionResult('CREATE_GATHERING_DRAFT', {
          gatheringId: '30000000-0000-4000-8000-000000000003',
          startAt: '2099-09-12T17:00:00+04:00',
        })}
      >
        Navigate saved gathering
      </button>
    </section>
  ),
}));

vi.mock('./screens/Calendar', () => ({
  Calendar: (props: any) => (
    <section data-testid="calendar-screen">
      <p>{props.familyId}</p>
      <pre data-testid="calendar-focus">{JSON.stringify(props.focusTarget ?? null)}</pre>
    </section>
  ),
}));

vi.mock('./screens/Home', () => ({
  Home: ({ members, gatherings }: any) => (
    <section>
      <p data-testid="home-members">{members.map((member: any) => member.name).join(',')}</p>
      <p data-testid="home-gatherings">{gatherings.map((item: any) => item.title).join(',')}</p>
    </section>
  ),
}));

vi.mock('./screens/FamilyTree', () => ({
  FamilyTree: ({ familyName, onRefresh, openLocationSettingsRequest, onLocationSettingsRequestHandled }: any) => (
    <section>
      <p data-testid="tree-family-name">{familyName}</p>
      <p data-testid="tree-location-request">{String(Boolean(openLocationSettingsRequest))}</p>
      <button type="button" onClick={() => void onRefresh()}>Refresh family context</button>
      <button type="button" onClick={() => onLocationSettingsRequestHandled?.()}>Consume location request</button>
    </section>
  ),
}));

vi.mock('./auth/AuthScreen', () => ({
  AuthScreen: ({ onAuthenticated }: any) => (
    <button
      type="button"
      disabled={!appHarness.nextSession}
      onClick={() => appHarness.nextSession && void onAuthenticated(appHarness.nextSession)}
    >
      Sign in next family
    </button>
  ),
}));

vi.mock('./screens/Activities', () => ({ Activities: () => <div>Activities</div> }));
vi.mock('./screens/MemoriesRewards', () => ({ MemoriesRewards: () => <div>Memories</div> }));
vi.mock('./screens/More', () => ({ More: () => <div>More</div> }));
vi.mock('./screens/PublicInvitation', () => ({ PublicInvitationScreen: () => <div>Invitation</div> }));

vi.mock('./api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('./api/client')>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      me: apiMocks.me,
      logout: apiMocks.logout,
    },
    familyApi: {
      ...actual.familyApi,
      getContext: apiMocks.getContext,
    },
  };
});

vi.mock('./api/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('./api/engagement')>();
  return {
    ...actual,
    engagementApi: {
      ...actual.engagementApi,
      listGatherings: apiMocks.listGatherings,
    },
  };
});

import App from './App';

const familyA = '10000000-0000-4000-8000-000000000001';
const familyB = '10000000-0000-4000-8000-000000000002';

function session(familyId: string, marker: string): AuthSession {
  return {
    user: {
      id: `user-${marker}`,
      email: `${marker.toLowerCase()}@example.test`,
      displayName: `User ${marker}`,
    },
    families: [{ id: familyId, name: `${marker} Family`, role: 'owner', linkedMemberId: `member-${marker}` }],
    activeFamilyId: familyId,
  };
}

function context(familyId: string, marker: string): FamilyContext {
  const activeSession = session(familyId, marker);
  return {
    family: { id: familyId, name: `${marker} Family`, role: 'owner' },
    currentUser: { ...activeSession.user, linkedMemberId: `member-${marker}` },
    members: [{
      id: `member-${marker}`,
      familyId,
      userId: activeSession.user.id,
      displayName: `${marker} Member`,
      birthDate: '1990-01-01',
      interests: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    relationships: [],
    safeLocations: [],
  };
}

function gathering(familyId: string, marker: string): PersistentGathering {
  return {
    id: `gathering-${marker}`,
    familyId,
    title: `${marker} gathering`,
    purpose: 'Family time',
    startAt: '2099-09-12T17:00:00+04:00',
    timezone: 'Asia/Dubai',
    locationName: 'Family home',
    type: 'Visit',
    status: 'draft',
    createdByUserId: `user-${marker}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    invitations: [],
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

beforeEach(() => {
  window.sessionStorage.clear();
  Object.values(apiMocks).forEach(mock => mock.mockReset());
  window.history.replaceState({}, '', '/');
  const initialSession = session(familyA, 'A');
  appHarness.nextSession = session(familyB, 'B');
  apiMocks.me.mockResolvedValue(initialSession);
  apiMocks.logout.mockResolvedValue(undefined);
  apiMocks.getContext.mockImplementation((requestedFamilyId: string) => Promise.resolve(
    requestedFamilyId === familyA ? context(familyA, 'A') : context(familyB, 'B'),
  ));
  apiMocks.listGatherings.mockImplementation((requestedFamilyId: string) => Promise.resolve({
    gatherings: [requestedFamilyId === familyA ? gathering(familyA, 'A') : gathering(familyB, 'B')],
  }));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('App family-scoped orchestration', () => {
  it('routes the account privacy action to Heritage as a consumable sheet request', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('A Member')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Open privacy settings' }));
    expect(await screen.findByTestId('tree-family-name')).toBeTruthy();
    expect(screen.getByTestId('tree-location-request').textContent).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Consume location request' }));
    expect(screen.getByTestId('tree-location-request').textContent).toBe('false');
  });

  it('wires an Assistant gathering result to the exact Calendar focus target', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('A Member')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Go Assistant' }));
    await user.click(screen.getByRole('button', { name: 'Navigate saved gathering' }));

    expect(await screen.findByTestId('calendar-screen')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('calendar-focus').textContent || 'null')).toEqual({
      familyId: familyA,
      gatheringId: '30000000-0000-4000-8000-000000000003',
      startAt: '2099-09-12T17:00:00+04:00',
    });
  });

  it('keeps the newest overlapping family load when an older load settles last', async () => {
    const older = deferred<FamilyContext>();
    const newer = deferred<FamilyContext>();
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('A Member')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go Tree' }));

    apiMocks.getContext
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    await user.click(screen.getByRole('button', { name: 'Refresh family context' }));
    await user.click(screen.getByRole('button', { name: 'Refresh family context' }));
    await waitFor(() => expect(apiMocks.getContext).toHaveBeenCalledTimes(3));

    await act(async () => {
      newer.resolve(context(familyA, 'Newer'));
      await newer.promise;
    });
    expect(await screen.findByText('Newer Family')).toBeTruthy();

    await act(async () => {
      older.resolve(context(familyA, 'Older'));
      await older.promise;
    });
    expect(screen.getByTestId('tree-family-name').textContent).toBe('Newer Family');
    expect(screen.queryByText('Older Family')).toBeNull();
  });

  it.each(['success', 'error'] as const)(
    'ignores an old-family load %s after logout and a new-family sign-in',
    async outcome => {
      const oldContext = deferred<FamilyContext>();
      const oldGatherings = deferred<{ gatherings: PersistentGathering[] }>();
      const user = userEvent.setup();
      render(<App />);
      expect(await screen.findByText('A Member')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Go Tree' }));

      apiMocks.getContext.mockImplementationOnce(() => oldContext.promise);
      apiMocks.listGatherings.mockImplementationOnce(() => oldGatherings.promise);
      await user.click(screen.getByRole('button', { name: 'Refresh family context' }));
      await waitFor(() => expect(apiMocks.getContext).toHaveBeenCalledTimes(2));
      await user.click(screen.getByRole('button', { name: 'Sign out User A' }));
      await user.click(await screen.findByRole('button', { name: 'Sign in next family' }));

      expect(await screen.findByText('B Member')).toBeTruthy();
      expect(screen.getByTestId('home-gatherings').textContent).toContain('B gathering');

      await act(async () => {
        if (outcome === 'success') {
          oldContext.resolve(context(familyA, 'Old Late'));
          oldGatherings.resolve({ gatherings: [gathering(familyA, 'Old Late')] });
        } else {
          oldContext.reject(new Error('Old family context failed late'));
          oldGatherings.reject(new Error('Old family gatherings failed late'));
        }
        await Promise.allSettled([oldContext.promise, oldGatherings.promise]);
      });

      expect(screen.getByTestId('home-members').textContent).toBe('B Member');
      expect(screen.getByTestId('home-gatherings').textContent).toBe('B gathering');
      expect(screen.queryByText(/Old family .* failed late/)).toBeNull();
      expect(apiMocks.clearStoredAgentSessions).toHaveBeenCalledOnce();
    },
  );

  it('clears every retained manual gathering retry token as soon as logout starts', async () => {
    const pendingLogout = deferred<void>();
    apiMocks.logout.mockReturnValue(pendingLogout.promise);
    expect(writeManualGatheringRetryState('user-A', familyA, 'retry-key-for-family-a')).toBe(true);
    expect(writeManualGatheringRetryState('user-B', familyB, 'retry-key-for-family-b')).toBe(true);
    window.sessionStorage.setItem('unrelated-session-state', 'keep');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('A Member')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Sign out User A' }));

    expect(readManualGatheringRetryState('user-A', familyA)).toBeNull();
    expect(readManualGatheringRetryState('user-B', familyB)).toBeNull();
    expect(window.sessionStorage.getItem('unrelated-session-state')).toBe('keep');

    await act(async () => {
      pendingLogout.resolve();
      await pendingLogout.promise;
    });
    expect(await screen.findByRole('button', { name: 'Sign in next family' })).toBeTruthy();
  });

  it('keeps the boot status inside the standalone dynamic-viewport shell', () => {
    const pendingSession = deferred<AuthSession>();
    apiMocks.me.mockReturnValue(pendingSession.promise);
    const { container } = render(<App />);

    expect(screen.getByText('Opening your private family space…')).toBeTruthy();
    expect(container.querySelector('main')?.className).toContain('standalone-page');
  });

  it('keeps the no-family state safe-area aware with a full-size sign-out target', async () => {
    apiMocks.me.mockResolvedValue({
      ...session(familyA, 'A'),
      families: [],
      activeFamilyId: null,
    });
    render(<App />);

    const heading = await screen.findByRole('heading', { name: 'No family space assigned' });
    expect(heading.closest('main')?.className).toContain('standalone-page');
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.className).toContain('min-h-11');
    expect(signOut.className).toContain('text-sm');
    expect(signOut.className).not.toContain('uppercase');
  });

  it('keeps the full-page family error responsive with wrapping 44px actions', async () => {
    apiMocks.getContext.mockRejectedValue(new Error('Family context unavailable'));
    render(<App />);

    const heading = await screen.findByRole('heading', { name: 'Family data could not load' });
    expect(heading.closest('main')?.className).toContain('standalone-page');
    for (const label of ['Retry', 'Sign out']) {
      const button = screen.getByRole('button', { name: label });
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('text-sm');
      expect(button.className).not.toContain('uppercase');
    }
  });
});
