/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistentGathering } from '../engagementTypes';
import type { FamilyMember } from '../types';

const apiMocks = vi.hoisted(() => ({
  createGathering: vi.fn(),
  prepareInvitations: vi.fn(),
}));

vi.mock('../api/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/engagement')>();
  return {
    ...actual,
    engagementApi: {
      ...actual.engagementApi,
      createGathering: apiMocks.createGathering,
      prepareInvitations: apiMocks.prepareInvitations,
    },
  };
});

import { GatheringPlanner } from './GatheringPlanner';

const members: FamilyMember[] = [
  {
    id: 'dad',
    name: 'Dad',
    age: 58,
    birthday: '1968-01-01',
    relationship: 'Parent',
    phone: '',
    email: '',
    interests: [],
    locationSharingStatus: 'Unknown',
  },
  {
    id: 'anas',
    name: 'Anas',
    age: 25,
    birthday: '2001-01-01',
    relationship: 'Sibling',
    phone: '',
    email: '',
    interests: [],
    locationSharingStatus: 'Unknown',
  },
];

const savedGathering = (overrides: Partial<PersistentGathering> = {}): PersistentGathering => ({
  id: 'gathering-1',
  familyId: 'family-1',
  title: 'Golden Park family outing',
  purpose: 'Spend time together at Golden Park',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai',
  locationName: 'Golden Park',
  type: 'Outdoor activity',
  status: 'draft',
  createdByUserId: 'user-1',
  createdAt: '2099-01-01T00:00:00.000Z',
  updatedAt: '2099-01-01T00:00:00.000Z',
  invitations: [],
  ...overrides,
});

const aiPrefill = {
  title: 'Golden Park family outing',
  purpose: 'Spend time together at Golden Park',
  startAt: '2099-09-12T17:00:00+04:00',
  timezone: 'Asia/Dubai' as const,
  locationName: 'Golden Park',
  type: 'Outdoor activity' as const,
  memberIds: ['dad', 'not-visible', 'anas'],
  invitationChannel: 'share_link' as const,
};

beforeEach(() => {
  apiMocks.createGathering.mockReset();
  apiMocks.prepareInvitations.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GatheringPlanner', () => {
  it('renders every AI field in editable controls and selects only visible members', () => {
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={aiPrefill}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Golden Park family outing');
    expect((screen.getByLabelText('Purpose') as HTMLInputElement).value).toBe('Spend time together at Golden Park');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2099-09-12');
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('17:00');
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('Golden Park');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('Outdoor activity');
    expect((screen.getByLabelText('Notes (optional)') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: /Dad/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Anas/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('not-visible')).toBeNull();
    expect((screen.getByLabelText('Sharing option') as HTMLSelectElement).value).toBe('share_link');
    expect(screen.getByText(/Prepared by AI/).textContent).toContain('Nothing will be sent automatically');
    expect(screen.getByText(/planning label only/).textContent).toContain('not been verified');
  });

  it('lets the user edit fields while cancel and review remain non-mutating', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={aiPrefill}
        source="ai"
        onCancel={onCancel}
      />,
    );

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Edited family outing');
    const purpose = screen.getByLabelText('Purpose');
    await user.clear(purpose);
    await user.type(purpose, 'Edited purpose');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-09-13' } });
    fireEvent.change(screen.getByLabelText('Dubai time'), { target: { value: '19:15' } });
    const location = screen.getByLabelText('Location');
    await user.clear(location);
    await user.type(location, 'Edited location');
    await user.selectOptions(screen.getByLabelText('Type'), 'Visit');
    await user.type(screen.getByLabelText('Notes (optional)'), 'Edited note');
    await user.click(screen.getByRole('checkbox', { name: /Anas/ }));
    await user.selectOptions(screen.getByLabelText('Sharing option'), 'whatsapp');
    expect((title as HTMLInputElement).value).toBe('Edited family outing');
    expect((purpose as HTMLInputElement).value).toBe('Edited purpose');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2099-09-13');
    expect((screen.getByLabelText('Dubai time') as HTMLInputElement).value).toBe('19:15');
    expect((location as HTMLInputElement).value).toBe('Edited location');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('Visit');
    expect((screen.getByLabelText('Notes (optional)') as HTMLTextAreaElement).value).toBe('Edited note');
    expect((screen.getByRole('checkbox', { name: /Anas/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Sharing option') as HTMLSelectElement).value).toBe('whatsapp');

    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Final confirmation required')).toBeTruthy();
    expect(screen.getByText('Visit')).toBeTruthy();
    expect(screen.getByText('Edited note')).toBeTruthy();
    expect(screen.getByText('Dad')).toBeTruthy();
    expect(screen.getByText('WhatsApp share buttons')).toBeTruthy();
    expect(apiMocks.createGathering).not.toHaveBeenCalled();
    expect(apiMocks.prepareInvitations).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(apiMocks.createGathering).not.toHaveBeenCalled();
  });

  it('creates exactly once before preparing links and never opens a sharing app automatically', async () => {
    const created = savedGathering();
    const inviting = savedGathering({ status: 'inviting' });
    apiMocks.createGathering.mockResolvedValue({ gathering: created });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: inviting,
      deliveryNotice: 'Prepared, not sent.',
      invitations: [{ memberId: 'dad', memberName: 'Dad', sharePath: '/invite/token' }],
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onViewCalendar = vi.fn();
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'] }}
        source="ai"
        idempotencyKey="planner-message-id"
        onCancel={vi.fn()}
        onViewCalendar={onViewCalendar}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const confirm = screen.getByRole('button', { name: 'Create & prepare links' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await screen.findByText('Links prepared, not sent');
    expect(apiMocks.createGathering).toHaveBeenCalledTimes(1);
    expect(apiMocks.prepareInvitations).toHaveBeenCalledTimes(1);
    expect(apiMocks.createGathering.mock.invocationCallOrder[0]).toBeLessThan(apiMocks.prepareInvitations.mock.invocationCallOrder[0]);
    expect(apiMocks.createGathering.mock.calls[0][1]).toEqual(expect.objectContaining({
      startAt: '2099-09-12T17:00:00+04:00',
      timezone: 'Asia/Dubai',
    }));
    expect(apiMocks.createGathering.mock.calls[0][2]).toEqual({ idempotencyKey: 'planner-message-id' });
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View Calendar' }));
    expect(onViewCalendar).toHaveBeenCalledWith(inviting);
  });

  it('creates a draft without preparing links when no invitees are selected', async () => {
    apiMocks.createGathering.mockResolvedValue({ gathering: savedGathering() });
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: [] }}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await screen.findByText('Gathering saved');
    expect(apiMocks.createGathering).toHaveBeenCalledTimes(1);
    expect(apiMocks.prepareInvitations).not.toHaveBeenCalled();
    expect(screen.getByText('No invitation links were created.')).toBeTruthy();
  });

  it('reports partial invitation failure and retries links without another create', async () => {
    apiMocks.createGathering.mockResolvedValue({ gathering: savedGathering() });
    apiMocks.prepareInvitations
      .mockRejectedValueOnce(new Error('Link service unavailable'))
      .mockResolvedValueOnce({
        gathering: savedGathering({ status: 'inviting' }),
        deliveryNotice: 'Prepared, not sent.',
        invitations: [],
      });
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'] }}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    await screen.findByText(/gathering was saved, but invitation links were not prepared/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry link preparation' }));
    await waitFor(() => expect(apiMocks.prepareInvitations).toHaveBeenCalledTimes(2));
    expect(apiMocks.createGathering).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Links prepared, not sent')).toBeTruthy();
  });

  it('reports a create failure, remains non-mutating, and safely retries with the same idempotency key', async () => {
    apiMocks.createGathering
      .mockRejectedValueOnce(new Error('Create service unavailable'))
      .mockResolvedValueOnce({ gathering: savedGathering() });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: savedGathering({ status: 'inviting' }),
      deliveryNotice: 'Prepared, not sent.',
      invitations: [],
    });
    const onBusyChange = vi.fn();
    const onSubmissionResult = vi.fn();
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'] }}
        source="ai"
        idempotencyKey="stable-message-id"
        onCancel={vi.fn()}
        onBusyChange={onBusyChange}
        onSubmissionResult={onSubmissionResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    expect(await screen.findByText('Create service unavailable')).toBeTruthy();
    expect(apiMocks.createGathering).toHaveBeenCalledTimes(1);
    expect(apiMocks.prepareInvitations).not.toHaveBeenCalled();
    expect(onSubmissionResult).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    await screen.findByText('Links prepared, not sent');
    expect(apiMocks.createGathering).toHaveBeenCalledTimes(2);
    expect(apiMocks.createGathering.mock.calls[0][2]).toEqual({ idempotencyKey: 'stable-message-id' });
    expect(apiMocks.createGathering.mock.calls[1][2]).toEqual({ idempotencyKey: 'stable-message-id' });
    expect(apiMocks.prepareInvitations).toHaveBeenCalledTimes(1);
    expect(onSubmissionResult).toHaveBeenCalledOnce();
    expect(onBusyChange.mock.calls.map(call => call[0])).toEqual([true, false, true, false]);
  });

  it('exposes copy, preview, and WhatsApp only as explicit user actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    apiMocks.createGathering.mockResolvedValue({ gathering: savedGathering() });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: savedGathering({ status: 'inviting' }),
      deliveryNotice: 'Prepared, not sent.',
      invitations: [{
        memberId: 'dad',
        memberName: 'Dad',
        sharePath: '/invite/private-path-token',
        shareUrl: 'https://family.example/invite/private-absolute-token',
        whatsappUrl: 'https://wa.me/server-value-is-not-opened',
      }],
    });
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'], invitationChannel: 'whatsapp' }}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    expect(await screen.findByText('Links prepared, not sent')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();

    const preview = screen.getByRole('link', { name: 'Preview' }) as HTMLAnchorElement;
    expect(preview.href).toBe('https://family.example/invite/private-absolute-token');
    expect(preview.target).toBe('_blank');

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('https://family.example/invite/private-absolute-token');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open WhatsApp' }));
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain('Golden Park family outing');
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain('https://family.example/invite/private-absolute-token');
  });

  it('shows a recoverable error when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    apiMocks.createGathering.mockResolvedValue({ gathering: savedGathering() });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: savedGathering({ status: 'inviting' }),
      deliveryNotice: 'Prepared, not sent.',
      invitations: [{ memberId: 'dad', memberName: 'Dad', sharePath: '/invite/private-token' }],
    });
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'] }}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/browser blocked clipboard access/i);
    expect(writeText).toHaveBeenCalledOnce();
  });

  it.each([
    { sharePath: 'http://[' },
    { sharePath: '/invite/safe-looking-fallback', shareUrl: 'javascript:alert(1)' },
    { sharePath: 'data:text/html,unsafe' },
  ])('renders an unavailable notice instead of an unsafe invitation control for $sharePath', async invitation => {
    apiMocks.createGathering.mockResolvedValue({ gathering: savedGathering() });
    apiMocks.prepareInvitations.mockResolvedValue({
      gathering: savedGathering({ status: 'inviting' }),
      deliveryNotice: 'Prepared, not sent.',
      invitations: [{
        memberId: 'dad',
        memberName: 'Dad',
        whatsappUrl: 'https://wa.me/server-value-must-not-bypass-validation',
        ...invitation,
      }],
    });
    const user = userEvent.setup();
    render(
      <GatheringPlanner
        familyId="family-1"
        members={members}
        prefill={{ ...aiPrefill, memberIds: ['dad'] }}
        source="ai"
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Create & prepare links' }));

    expect(await screen.findByText(/invitation link is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open WhatsApp' })).toBeNull();
    expect(document.querySelector('a[href^="javascript:"], a[href^="data:"], a[href^="blob:"]')).toBeNull();
  });
});
