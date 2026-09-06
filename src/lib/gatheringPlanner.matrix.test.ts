import { describe, expect, it, vi } from 'vitest';
import type { PersistentGathering } from '../engagementTypes';
import {
  createGatheringPlannerDraft,
  createGatheringPlannerSubmissionController,
  gatheringInputFromDraft,
  GATHERING_TYPES,
  normalizeGatheringType,
  type GatheringPlannerDraft,
  type InvitationChannel,
} from './gatheringPlanner';

const NOW = new Date('2098-01-01T00:00:00.000Z');

function validDraft(overrides: Partial<GatheringPlannerDraft> = {}): GatheringPlannerDraft {
  return {
    title: 'Family plan',
    purpose: 'Spend time together',
    date: '2099-09-12',
    time: '17:00',
    type: 'Family gathering',
    locationName: 'Family home',
    notes: '',
    memberIds: [],
    channel: 'share_link',
    ...overrides,
  };
}

function gathering(): PersistentGathering {
  return {
    id: 'gathering-1',
    familyId: 'family-1',
    title: 'Family plan',
    purpose: 'Spend time together',
    startAt: '2099-09-12T17:00:00+04:00',
    timezone: 'Asia/Dubai',
    locationName: 'Family home',
    type: 'Family gathering',
    status: 'draft',
    createdByUserId: 'user-1',
    createdAt: '2098-01-01T00:00:00.000Z',
    updatedAt: '2098-01-01T00:00:00.000Z',
    invitations: [],
  };
}

describe('complete gathering planner option matrix', () => {
  it.each(GATHERING_TYPES)('preserves the supported type option %s through prefill and submission', type => {
    const draft = createGatheringPlannerDraft({
      prefill: {
        title: 'Type test',
        purpose: 'Test every type',
        startAt: '2099-09-12T17:00:00+04:00',
        timezone: 'Asia/Dubai',
        locationName: 'Test place',
        type,
        memberIds: [],
      },
      availableMemberIds: [],
    });

    expect(draft.type).toBe(type);
    expect(normalizeGatheringType(type.toLocaleLowerCase('en'))).toBe(type);
    expect(gatheringInputFromDraft(draft, NOW).type).toBe(type);
  });

  it('fails closed to Family gathering for an unsupported prefill type', () => {
    expect(normalizeGatheringType('provider-invented-type')).toBe('Family gathering');
    expect(createGatheringPlannerDraft({
      prefill: {
        title: 'Fallback type',
        purpose: 'Use the safe type',
        startAt: '2099-09-12T17:00:00+04:00',
        locationName: 'Test place',
        type: 'provider-invented-type',
        memberIds: [],
      },
      availableMemberIds: [],
    }).type).toBe('Family gathering');
  });

  it.each([
    { field: 'title', value: 'a', error: 'Title must be between 2 and 120 characters.' },
    { field: 'title', value: 'a'.repeat(121), error: 'Title must be between 2 and 120 characters.' },
    { field: 'purpose', value: 'a', error: 'Purpose must be between 2 and 500 characters.' },
    { field: 'purpose', value: 'a'.repeat(501), error: 'Purpose must be between 2 and 500 characters.' },
    { field: 'locationName', value: 'a', error: 'Location must be between 2 and 300 characters.' },
    { field: 'locationName', value: 'a'.repeat(301), error: 'Location must be between 2 and 300 characters.' },
    { field: 'notes', value: 'a'.repeat(2_001), error: 'Notes must be 2,000 characters or fewer.' },
  ] as const)('rejects the $field boundary immediately', ({ field, value, error }) => {
    expect(() => gatheringInputFromDraft(validDraft({ [field]: value }), NOW)).toThrow(error);
  });

  it('accepts every exact maximum and trims all editable text fields', () => {
    const input = gatheringInputFromDraft(validDraft({
      title: ` ${'t'.repeat(120)} `,
      purpose: ` ${'p'.repeat(500)} `,
      locationName: ` ${'l'.repeat(300)} `,
      notes: ` ${'n'.repeat(2_000)} `,
    }), NOW);

    expect(input.title).toHaveLength(120);
    expect(input.purpose).toHaveLength(500);
    expect(input.locationName).toHaveLength(300);
    expect(input.notes).toHaveLength(2_000);
  });

  it.each([
    ['', '17:00'],
    ['2099-09-12', ''],
    ['2099-02-29', '17:00'],
    ['2099-09-12', '24:00'],
    ['2099-09-12', '5 PM'],
  ])('rejects malformed or impossible Dubai wall time %s %s', (date, time) => {
    expect(() => gatheringInputFromDraft(validDraft({ date, time }), NOW)).toThrow(/valid date|real calendar date/);
  });

  it.each(['share_link', 'whatsapp'] as const)('passes the explicit %s channel only after gathering creation', async channel => {
    const calls: string[] = [];
    const createGathering = vi.fn(async () => {
      calls.push('create');
      return { gathering: gathering() };
    });
    const prepareInvitations = vi.fn(async () => {
      calls.push('prepare');
      return {
        gathering: gathering(),
        invitations: [],
        deliveryNotice: 'Prepared but never sent.',
      };
    });
    const controller = createGatheringPlannerSubmissionController(
      { createGathering, prepareInvitations },
      'stable-planner-message-id',
    );

    await controller.submit('family-1', validDraft({
      memberIds: ['dad', 'dad', 'mom'],
      channel: channel as InvitationChannel,
    }));

    expect(calls).toEqual(['create', 'prepare']);
    expect(createGathering).toHaveBeenCalledWith(
      'family-1',
      expect.any(Object),
      { idempotencyKey: 'stable-planner-message-id' },
    );
    expect(prepareInvitations).toHaveBeenCalledWith('gathering-1', {
      memberIds: ['dad', 'mom'],
      channel,
    });
  });
});
