import { describe, expect, it, vi } from 'vitest';
import type { PersistentGathering } from '../engagementTypes';
import {
  createGatheringPlannerDraft,
  createGatheringPlannerSubmissionController,
  gatheringInputFromDraft,
  type GatheringPlannerApi,
  type GatheringPlannerDraft,
} from './gatheringPlanner';

const draft = (overrides: Partial<GatheringPlannerDraft> = {}): GatheringPlannerDraft => ({
  title: 'Golden Park family outing',
  purpose: 'Spend time together at Golden Park',
  date: '2099-09-12',
  time: '17:00',
  type: 'Outdoor activity',
  locationName: 'Golden Park',
  notes: '',
  memberIds: [],
  channel: 'share_link',
  ...overrides,
});

const gathering = (overrides: Partial<PersistentGathering> = {}): PersistentGathering => ({
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

describe('gathering planner prefill', () => {
  it('maps every AI field to Dubai wall time and filters invitees to visible members', () => {
    expect(createGatheringPlannerDraft({
      prefill: {
        title: 'Golden Park family outing',
        purpose: 'Spend time together at Golden Park',
        startAt: '2099-09-12T13:00:00.000Z',
        timezone: 'Asia/Dubai',
        locationName: 'Golden Park',
        type: 'Outdoor activity',
        notes: 'Bring water',
        memberIds: ['dad', 'mom', 'dad', 'not-visible', 'anas'],
        invitationChannel: 'whatsapp',
      },
      availableMemberIds: ['dad', 'mom', 'anas'],
      defaultDate: '2000-01-01',
      defaultTime: '18:30',
    })).toEqual({
      title: 'Golden Park family outing',
      purpose: 'Spend time together at Golden Park',
      date: '2099-09-12',
      time: '17:00',
      type: 'Outdoor activity',
      locationName: 'Golden Park',
      notes: 'Bring water',
      memberIds: ['dad', 'mom', 'anas'],
      channel: 'share_link',
    });
  });

  it('does not silently apply Calendar schedule defaults to a prepared hand-off', () => {
    const result = createGatheringPlannerDraft({
      prefill: {
        title: 'Call Grandfather',
        purpose: 'Share family news',
        locationName: 'Phone call',
        type: 'Phone call',
        memberIds: ['grandfather'],
      },
      availableMemberIds: ['grandfather'],
      defaultDate: '2099-09-12',
      defaultTime: '18:30',
    });

    expect(result.date).toBe('');
    expect(result.time).toBe('');
  });

  it('does not accept an offset-less prepared schedule', () => {
    const result = createGatheringPlannerDraft({
      prefill: {
        title: 'Call Grandfather',
        purpose: 'Share family news',
        startAt: '2099-09-12T17:00:00',
        locationName: 'Phone call',
        type: 'Phone call',
        memberIds: [],
      },
      availableMemberIds: [],
      defaultDate: '2099-09-12',
      defaultTime: '18:30',
    });

    expect(result.date).toBe('');
    expect(result.time).toBe('');
  });

  it('accepts a parseable offset-aware timestamp with provider precision', () => {
    const result = createGatheringPlannerDraft({
      prefill: {
        title: 'Call Grandfather',
        purpose: 'Share family news',
        startAt: '2099-09-12T17:00:00.1234567890+04:00',
        locationName: 'Phone call',
        type: 'Phone call',
        memberIds: [],
      },
      availableMemberIds: [],
    });

    expect(result.date).toBe('2099-09-12');
    expect(result.time).toBe('17:00');
  });

  it('keeps selected-date defaults for a new manual Calendar draft', () => {
    const result = createGatheringPlannerDraft({
      availableMemberIds: [],
      defaultDate: '2099-09-12',
      defaultTime: '18:30',
    });

    expect(result.date).toBe('2099-09-12');
    expect(result.time).toBe('18:30');
  });

  it('trims editable fields and preserves an offset-aware Dubai time', () => {
    expect(gatheringInputFromDraft(draft({
      title: '  Edited title  ',
      purpose: '  Edited purpose  ',
      locationName: '  Edited location  ',
      notes: '  Optional note  ',
    }), new Date('2099-01-01T00:00:00.000Z'))).toEqual({
      title: 'Edited title',
      purpose: 'Edited purpose',
      startAt: '2099-09-12T17:00:00+04:00',
      timezone: 'Asia/Dubai',
      locationName: 'Edited location',
      notes: 'Optional note',
      type: 'Outdoor activity',
    });
  });

  it('rejects a schedule that is not in the future', () => {
    expect(() => gatheringInputFromDraft(
      draft({ date: '2026-09-12', time: '17:00' }),
      new Date('2026-09-12T13:00:00.000Z'),
    )).toThrow('future gathering date and time');
  });
});

describe('gathering planner final submission', () => {
  it('creates only a draft when no invitees are selected', async () => {
    const created = gathering();
    const createGathering = vi.fn().mockResolvedValue({ gathering: created });
    const prepareInvitations = vi.fn();
    const controller = createGatheringPlannerSubmissionController({ createGathering, prepareInvitations });

    const result = await controller.submit('family-1', draft());

    expect(result.gathering).toBe(created);
    expect(createGathering).toHaveBeenCalledTimes(1);
    expect(prepareInvitations).not.toHaveBeenCalled();
  });

  it('creates once, then prepares links in order without sending anything', async () => {
    const calls: string[] = [];
    const created = gathering();
    const inviting = gathering({ status: 'inviting' });
    const api: GatheringPlannerApi = {
      createGathering: vi.fn(async () => {
        calls.push('create');
        return { gathering: created };
      }),
      prepareInvitations: vi.fn(async () => {
        calls.push('prepare');
        return {
          gathering: inviting,
          deliveryNotice: 'Links are private and were not sent.',
          invitations: [{
            memberId: 'dad',
            memberName: 'Dad',
            sharePath: '/invite/token',
          }],
        };
      }),
    };
    const controller = createGatheringPlannerSubmissionController(api);

    const result = await controller.submit('family-1', draft({ memberIds: ['dad'] }));

    expect(calls).toEqual(['create', 'prepare']);
    expect(result.prepared?.gathering).toBe(inviting);
    expect(api.prepareInvitations).toHaveBeenCalledWith('gathering-1', {
      memberIds: ['dad'],
      channel: 'share_link',
    });
  });

  it('coalesces a double submission into one create request', async () => {
    const createGathering = vi.fn().mockResolvedValue({ gathering: gathering() });
    const controller = createGatheringPlannerSubmissionController({
      createGathering,
      prepareInvitations: vi.fn(),
    });

    const first = controller.submit('family-1', draft());
    const second = controller.submit('family-1', draft());
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(createGathering).toHaveBeenCalledTimes(1);
  });

  it('retries failed invitation preparation against the saved gathering', async () => {
    const createGathering = vi.fn().mockResolvedValue({ gathering: gathering() });
    const prepareInvitations = vi.fn()
      .mockRejectedValueOnce(new Error('Link service unavailable'))
      .mockResolvedValueOnce({
        gathering: gathering({ status: 'inviting' }),
        deliveryNotice: 'Prepared, not sent.',
        invitations: [],
      });
    const controller = createGatheringPlannerSubmissionController({ createGathering, prepareInvitations });
    const inviteDraft = draft({ memberIds: ['dad'] });

    const failed = await controller.submit('family-1', inviteDraft);
    const retried = await controller.submit('family-1', inviteDraft);

    expect(failed.invitationError).toBeInstanceOf(Error);
    expect(retried.prepared).toBeDefined();
    expect(createGathering).toHaveBeenCalledTimes(1);
    expect(prepareInvitations).toHaveBeenCalledTimes(2);
  });

  it('reuses one client request ID when an ambiguous create failure is retried', async () => {
    const createGathering = vi.fn()
      .mockRejectedValueOnce(new Error('Connection closed after request'))
      .mockResolvedValueOnce({ gathering: gathering() });
    const controller = createGatheringPlannerSubmissionController({
      createGathering,
      prepareInvitations: vi.fn(),
    }, 'planner-message-id');

    await expect(controller.submit('family-1', draft())).rejects.toThrow('Connection closed');
    await controller.submit('family-1', draft());

    const firstOptions = createGathering.mock.calls[0][2];
    const secondOptions = createGathering.mock.calls[1][2];
    expect(firstOptions.idempotencyKey).toBe('planner-message-id');
    expect(secondOptions.idempotencyKey).toBe('planner-message-id');
    expect(createGathering.mock.calls[0][1]).not.toHaveProperty('clientRequestId');
  });
});
