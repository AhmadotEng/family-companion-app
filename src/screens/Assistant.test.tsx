/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '../types';

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
const otherFamilyId = '10000000-0000-4000-8000-000000000099';
const sessionId = '20000000-0000-4000-8000-000000000002';
const messageId = '30000000-0000-4000-8000-000000000003';
const dadId = '60000000-0000-4000-8000-000000000001';
const momId = '60000000-0000-4000-8000-000000000002';
const anasId = '60000000-0000-4000-8000-000000000003';

const members: FamilyMember[] = [
  [dadId, 'Dad', 'Parent'],
  [momId, 'Mom', 'Parent'],
  [anasId, 'Anas', 'Sibling'],
].map(([id, name, relationship]) => ({
  id,
  name,
  relationship,
  age: 0,
  birthday: '',
  phone: '',
  email: '',
  interests: [],
  locationSharingStatus: 'Unknown',
})) as FamilyMember[];

const planner = {
  title: 'Golden Park family outing',
  purpose: 'Spend time together at Golden Park',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai' as const,
  locationName: 'Golden Park',
  type: 'Outdoor activity' as const,
  memberIds: [dadId, momId, anasId],
  invitationChannel: 'share_link' as const,
};

const gathering = {
  id: '40000000-0000-4000-8000-000000000004',
  familyId,
  title: planner.title,
  purpose: planner.purpose,
  startAt: planner.startAt,
  timezone: planner.timezone,
  locationName: planner.locationName,
  type: planner.type,
  status: 'draft' as const,
  createdByUserId: '50000000-0000-4000-8000-000000000005',
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:00.000Z',
  invitations: [],
};

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

function assistantElement(
  selectedFamilyId = familyId,
  selectedMembers = members,
  isActive = true,
  onActionCompleted?: () => void,
) {
  return (
    <Assistant
      presetInput=""
      clearPreset={vi.fn()}
      familyId={selectedFamilyId}
      members={selectedMembers}
      familyRole="owner"
      isActive={isActive}
      onActionCompleted={onActionCompleted}
      onUseReconnectionPlan={vi.fn()}
    />
  );
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

function renderAssistant() {
  return render(assistantElement());
}

describe('Assistant gathering planner integration', () => {
  it('keeps the conversation composer in the mobile viewport and progressively discloses guidance', async () => {
    const user = userEvent.setup();
    renderAssistant();

    const shell = screen.getByTestId('assistant-mobile-shell');
    expect(shell.className).toContain('assistant-mobile-shell');
    expect(shell.className).toContain('h-full');
    expect(shell.dataset.composerFocused).toBe('false');
    expect(screen.queryByRole('heading', { name: 'AI Helper' })).toBeNull();
    expect(screen.queryByText('Private, review-first family support')).toBeNull();
    expect(screen.getAllByText('How can I help your family today?')).toHaveLength(1);
    expect(screen.getByTestId('assistant-message-list').className).toContain('flex-1');
    expect(shell.querySelectorAll('svg.lucide-bot')).toHaveLength(0);
    const welcome = screen.getByRole('article', { name: 'SILAH message' });
    expect(welcome.dataset.agentSpeaker).toBe('assistant');
    expect(welcome.querySelector('svg.lucide-bot')).toBeNull();

    expect(screen.queryByText('Confirm before anything changes')).toBeNull();

    const carousel = screen.getByTestId('assistant-prompt-carousel');
    expect(carousel.parentElement?.className).toContain('assistant-quick-prompts');
    expect(carousel.className).toContain('overflow-x-auto');
    expect(carousel.className).toContain('snap-x');
    expect(shell.querySelector('.assistant-reconnection-panel')).toBeTruthy();
    expect(shell.querySelectorAll('.assistant-mobile-optional')).toHaveLength(2);
    await user.click(carousel.querySelector('button') as HTMLButtonElement);
    expect(shell.dataset.composerFocused).toBe('false');

    const consent = screen.getByTestId('gemini-consent-summary');
    expect(consent.textContent).toContain('One-time approval for this message');
    const disclosureToggle = screen.getByRole('button', { name: 'Read details' });
    expect(disclosureToggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(disclosureToggle);
    expect(disclosureToggle.getAttribute('aria-expanded')).toBe('true');
    expect(consent.textContent).toContain('Gemini receives this request');
    expect(shell.dataset.composerFocused).toBe('true');
    expect(consent.closest('.assistant-mobile-optional')).toBeNull();

    const dock = screen.getByTestId('assistant-composer-dock');
    expect(dock.className).toContain('sticky');
    expect(dock.className).toContain('assistant-composer-dock');
    expect(dock.querySelector('.assistant-required-composer')).toBeTruthy();
    expect(dock.className).not.toContain('safe-area-inset-bottom');
    const composer = screen.getByLabelText('Ask the family agent') as HTMLInputElement;
    expect(composer.className).toContain('text-base');
    expect(composer.closest('.assistant-mobile-optional')).toBeNull();
  });

  it('reserves short portrait and focused phone space for consent and the composer', () => {
    const styles = readFileSync('src/index.css', 'utf8');

    expect(styles).toMatch(/@media \(max-width: 639px\)\s*\{\s*\.assistant-mobile-shell\[data-composer-focused="true"\] \.assistant-mobile-optional\s*\{\s*display: none;/s);
    expect(styles).toMatch(/@media \(orientation: portrait\) and \(max-width: 639px\) and \(max-height: 650px\)\s*\{\s*\.assistant-mobile-shell \.assistant-mobile-optional\s*\{\s*display: none;/s);
  });

  it('opens the real editable planner for a gathering_planner response and cancel writes nothing', async () => {
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messageId,
      kind: 'gathering_planner',
      message: 'I prepared an editable gathering plan. Nothing has been saved or sent.',
      planner,
    });
    const user = userEvent.setup();
    render(<main>{assistantElement()}</main>);
    const scrollRoot = document.querySelector('main') as HTMLElement;

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Golden Park on September 12, 2099 at 5 PM with my parents and sibling');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    const dialog = await screen.findByRole('dialog', { name: 'AI gathering planner' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest('[data-testid="assistant-mobile-shell"]')).toBeNull();
    expect(dialog.className).toContain('mobile-sheet-overlay');
    expect(scrollRoot.style.overflow).toBe('hidden');
    expect(screen.getAllByText('How can I help your family today?')).toHaveLength(1);
    const sheet = screen.getByTestId('ai-gathering-planner-sheet').firstElementChild as HTMLElement;
    expect(sheet.className).toContain('h-[100dvh]');
    expect(sheet.className).toContain('sm:rounded-[2rem]');
    expect(sheet.className).toContain('mobile-sheet-surface');
    expect(sheet.querySelector('header')?.className).toContain('mobile-sheet-header');
    expect(screen.getByLabelText('Search invitees')).toBeTruthy();
    expect(document.querySelector('[data-gathering-planner-scroll-region]')?.className).toContain('mobile-sheet-scroll-region');
    const footer = document.querySelector('[data-gathering-planner-footer]');
    expect(footer?.className).toContain('sticky');
    expect(footer?.className).toContain('mobile-sheet-footer');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close gathering planner' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(planner.title);
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('Golden Park');
    expect((screen.getByRole('checkbox', { name: /Dad/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Mom/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Anas/ }) as HTMLInputElement).checked).toBe(true);
    expect(window.sessionStorage.getItem(`family-companion:agent-session:${familyId}`)).toBe(sessionId);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull());
    expect(scrollRoot.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: /Reopen editable planner/i }));
    expect(await screen.findByRole('dialog', { name: 'AI gathering planner' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull());
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('overrides sm dialog geometry for short landscape phones without changing normal desktop utilities', () => {
    const styles = readFileSync('src/index.css', 'utf8');
    const shortStart = styles.indexOf('@media (orientation: landscape) and (max-height: 500px) and (max-width: 1023px)');
    const narrowStart = styles.indexOf('@media (orientation: landscape) and (max-height: 500px) and (max-width: 820px)');
    const shortLandscape = styles.slice(shortStart, narrowStart);

    expect(shortStart).toBeGreaterThanOrEqual(0);
    expect(shortLandscape).toMatch(/\.mobile-sheet-overlay\s*\{[^}]*align-items:\s*stretch;[^}]*padding:\s*0;/s);
    expect(shortLandscape).toMatch(/\.mobile-sheet-surface\s*\{[^}]*max-width:\s*none;[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*border-radius:\s*0;/s);
    expect(shortLandscape).toMatch(/\.mobile-sheet-header\s*\{[^}]*safe-area-inset-top[^}]*safe-area-inset-right[^}]*safe-area-inset-left/s);
    expect(shortLandscape).toMatch(/\.mobile-sheet-footer\s*\{[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom[^}]*safe-area-inset-left/s);
  });

  it('restores a persisted planner payload after refresh without creating anything', async () => {
    window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, sessionId);
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messages: [{
        id: messageId,
        role: 'assistant',
        kind: 'gathering_planner',
        message: 'I prepared an editable gathering plan. Nothing has been saved or sent.',
        planner,
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    });

    renderAssistant();

    expect(await screen.findByRole('dialog', { name: 'AI gathering planner' })).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/agent/sessions/${sessionId}/messages?familyId=${familyId}`,
    );
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('17:00');
    expect(screen.getAllByText(/Prepared by AI/).some(
      element => element.textContent?.includes('Nothing will be sent automatically'),
    )).toBe(true);
  });

  it('forgets a malformed stored session id without issuing a restore request', async () => {
    window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, 'not-a-uuid');

    renderAssistant();

    await waitFor(() => expect(
      window.sessionStorage.getItem(`family-companion:agent-session:${familyId}`),
    ).toBeNull());
    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
  });

  it.each([
    ['field type', { ...planner, title: 42 }],
    ['gathering type', { ...planner, type: 'Road trip' }],
    ['invitation channel', { ...planner, invitationChannel: 'email' }],
    ['member id', { ...planner, memberIds: ['not-a-uuid'] }],
    ['schedule', { ...planner, startAt: '2099-09-12T17:00:00' }],
    ['non-Dubai schedule offset', { ...planner, startAt: '2099-09-12T13:00:00Z' }],
    ['rolled-over calendar date', { ...planner, startAt: '2099-02-29T17:00:00+04:00' }],
    ['nonzero schedule seconds', { ...planner, startAt: '2099-09-12T17:00:01+04:00' }],
  ])('restores a planner with a malformed %s only as inert transcript text', async (_label, malformedPlanner) => {
    window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, sessionId);
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messages: [{
        id: messageId,
        role: 'assistant',
        kind: 'gathering_planner',
        message: 'Malformed planner transcript text',
        planner: malformedPlanner,
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    });

    renderAssistant();

    expect(await screen.findByText('Malformed planner transcript text')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open editable planner/i })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('restores a planner with a malformed message id only as inert transcript text', async () => {
    window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, sessionId);
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messages: [{
        id: 'not-a-uuid',
        role: 'assistant',
        kind: 'gathering_planner',
        message: 'Malformed planner id transcript text',
        planner,
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    });

    renderAssistant();

    expect(await screen.findByText('Malformed planner id transcript text')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open editable planner/i })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('clears the prior family transcript and planner when the selected family changes', async () => {
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messageId,
      kind: 'gathering_planner',
      message: 'I prepared an editable gathering plan. Nothing has been saved or sent.',
      planner,
    });
    const user = userEvent.setup();
    const { rerender } = renderAssistant();

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Plan Golden Park on September 12, 2099 at 5 PM');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('dialog', { name: 'AI gathering planner' })).toBeTruthy();

    rerender(assistantElement(otherFamilyId, []));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull());
    expect(screen.queryByText(planner.title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('records a partially saved gathering and offers the safe Calendar recovery path', async () => {
    apiRequestMock
      .mockResolvedValueOnce({
        sessionId,
        messageId,
        kind: 'gathering_planner',
        message: 'I prepared an editable gathering plan. Nothing has been saved or sent.',
        planner: { ...planner, memberIds: [dadId] },
      })
      .mockResolvedValueOnce({ gathering })
      .mockRejectedValueOnce(new Error('Link service unavailable'));
    const user = userEvent.setup();
    const onNavigateToActionResult = vi.fn();
    render(
      <Assistant
        presetInput=""
        clearPreset={vi.fn()}
        familyId={familyId}
        members={members}
        familyRole="owner"
        onNavigateToActionResult={onNavigateToActionResult}
        onUseReconnectionPlan={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Plan Golden Park with Dad on September 12, 2099 at 5 PM');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('dialog', { name: 'AI gathering planner' });
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    expect(await screen.findByText(/gathering was saved, but invitation links were not prepared/i)).toBeTruthy();

    const partialState = JSON.parse(
      window.sessionStorage.getItem(`family-companion:agent-planners:${familyId}`) || '{}',
    ) as { dismissed?: string[]; saved?: string[]; results?: Record<string, { linksPending: boolean }> };
    expect(partialState.saved).toContain(messageId);
    expect(partialState.results?.[messageId]?.linksPending).toBe(true);

    const createCalls = apiRequestMock.mock.calls.filter(([path]) =>
      path === `/api/families/${familyId}/gatherings`,
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][1]?.headers).toEqual({ 'Idempotency-Key': messageId });
    await user.click(screen.getByRole('button', { name: 'Prepare later in Calendar' }));
    expect(onNavigateToActionResult).toHaveBeenCalledWith('CREATE_GATHERING_DRAFT', {
      gatheringId: gathering.id,
      startAt: gathering.startAt,
    });
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
  });

  it('restores a truthful links-pending result and targets its saved Calendar date', async () => {
    window.sessionStorage.setItem(`family-companion:agent-session:${familyId}`, sessionId);
    window.sessionStorage.setItem(`family-companion:agent-planners:${familyId}`, JSON.stringify({
      dismissed: [],
      saved: [messageId],
      results: {
        [messageId]: {
          gatheringId: gathering.id,
          startAt: gathering.startAt,
          linksPending: true,
        },
      },
    }));
    apiRequestMock.mockResolvedValueOnce({
      sessionId,
      messages: [{
        id: messageId,
        role: 'assistant',
        kind: 'gathering_planner',
        message: 'I prepared an editable gathering plan. Nothing has been saved or sent.',
        planner,
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    });
    const onNavigateToActionResult = vi.fn();
    const user = userEvent.setup();
    render(
      <Assistant
        presetInput=""
        clearPreset={vi.fn()}
        familyId={familyId}
        members={members}
        familyRole="owner"
        onNavigateToActionResult={onNavigateToActionResult}
        onUseReconnectionPlan={vi.fn()}
      />,
    );

    expect(await screen.findByText('Links pending')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Prepare links in Calendar' }));
    expect(onNavigateToActionResult).toHaveBeenCalledWith('CREATE_GATHERING_DRAFT', {
      gatheringId: gathering.id,
      startAt: gathering.startAt,
    });
  });

  it('does not let a late response from the prior family unlock a newer request', async () => {
    let resolveOldRequest!: (value: unknown) => void;
    let resolveNewRequest!: (value: unknown) => void;
    apiRequestMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldRequest = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNewRequest = resolve; }));
    const user = userEvent.setup();
    const { rerender } = renderAssistant();

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Old family request');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    rerender(assistantElement(otherFamilyId, []));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }) as HTMLInputElement).disabled).toBe(false));
    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'New family request');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect((screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }) as HTMLInputElement).disabled).toBe(true);

    resolveOldRequest({
      sessionId,
      kind: 'message',
      message: 'Stale response',
    });
    await Promise.resolve();
    expect((screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('Stale response')).toBeNull();

    resolveNewRequest({
      sessionId: '20000000-0000-4000-8000-000000000099',
      kind: 'message',
      message: 'Current response',
    });
    const currentResponse = await screen.findByText('Current response');
    expect(currentResponse.closest('[role="article"]')?.getAttribute('aria-label')).toBe('SILAH message');
    expect(screen.getByRole('article', { name: 'Your message' }).dataset.agentSpeaker).toBe('user');
    expect(screen.getAllByRole('article', { name: 'SILAH message' })).toHaveLength(2);
    const shell = screen.getByTestId('assistant-mobile-shell');
    expect(shell.querySelectorAll('svg.lucide-bot')).toHaveLength(0);
    for (const message of shell.querySelectorAll('[data-agent-speaker="assistant"]')) {
      expect(message.querySelector('svg.lucide-bot')).toBeNull();
    }
    expect((screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }) as HTMLInputElement).disabled).toBe(false);
  });

  it('ignores late old-family planner callbacks and private links after a family switch', async () => {
    const pendingInvitations = deferred<Record<string, unknown>>();
    const privateToken = 'old-family-planner-private-token';
    const onActionCompleted = vi.fn();
    apiRequestMock
      .mockResolvedValueOnce({
        sessionId,
        messageId,
        kind: 'gathering_planner',
        message: 'Prepared old-family planner',
        planner,
      })
      .mockResolvedValueOnce({ gathering })
      .mockReturnValueOnce(pendingInvitations.promise);
    const user = userEvent.setup();
    const { rerender } = render(assistantElement(familyId, members, true, onActionCompleted));

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Plan old family outing');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('dialog', { name: 'AI gathering planner' });
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(3));

    rerender(assistantElement(otherFamilyId, [], true, onActionCompleted));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull());

    await act(async () => {
      pendingInvitations.resolve({
        gathering,
        deliveryNotice: 'Nothing was sent.',
        invitations: [{
          memberId: dadId,
          memberName: 'Dad',
          sharePath: `/invite/${privateToken}`,
          whatsappUrl: 'https://wa.me/?text=private',
        }],
      });
      await pendingInvitations.promise;
    });

    expect(document.body.textContent).not.toContain(privateToken);
    expect(screen.queryByText('Links prepared, not sent')).toBeNull();
    expect(screen.queryByText(planner.title)).toBeNull();
    expect(onActionCompleted).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(`family-companion:agent-planners:${otherFamilyId}`)).toBeNull();
  });

  it('unmounts private planner links while hidden and does not reveal them when Assistant returns', async () => {
    const privateToken = 'hidden-planner-private-token';
    apiRequestMock
      .mockResolvedValueOnce({
        sessionId,
        messageId,
        kind: 'gathering_planner',
        message: 'Prepared private planner',
        planner,
      })
      .mockResolvedValueOnce({ gathering })
      .mockResolvedValueOnce({
        gathering,
        deliveryNotice: 'Nothing was sent.',
        invitations: [{
          memberId: dadId,
          memberName: 'Dad',
          sharePath: `/invite/${privateToken}`,
          whatsappUrl: 'https://wa.me/?text=private',
        }],
      });
    const user = userEvent.setup();
    const { rerender } = render(assistantElement());

    await user.click(screen.getByRole('checkbox', { name: /Send this request to Google Gemini/i }));
    await user.type(screen.getByLabelText('Ask the family agent'), 'Plan a private outing');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('dialog', { name: 'AI gathering planner' });
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    expect(await screen.findByText(new RegExp(privateToken))).toBeTruthy();

    rerender(assistantElement(familyId, members, false));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull());
    expect(document.body.textContent).not.toContain(privateToken);

    rerender(assistantElement(familyId, members, true));
    expect(screen.queryByRole('dialog', { name: 'AI gathering planner' })).toBeNull();
    expect(document.body.textContent).not.toContain(privateToken);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledTimes(3);
  });
});
