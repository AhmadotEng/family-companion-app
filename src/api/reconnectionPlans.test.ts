import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReconnectionPlan } from '../engagementTypes';
import {
  reconnectionPlanToGatheringPrefill,
  reconnectionPlansApi,
} from './reconnectionPlans';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const plan: ReconnectionPlan = {
  id: 'plan-id',
  title: 'Call Grandfather',
  rationale: 'A simple call is easier to coordinate.',
  suggestedMemberIds: ['member-1', 'member-1', 'member-2'],
  suggestedGathering: {
    format: 'phone_call',
    purpose: 'Share family news',
    durationMinutes: 30,
    timingGuidance: 'Ask him which evening works.',
    accessibilityNotes: 'Keep the call short if he is tired.',
  },
  rewardChallenge: 'Make the call together.',
  evidence: {},
  status: 'active',
  provider: 'gemini',
  model: 'model-name',
  createdAt: '2026-08-13T10:00:00.000Z',
  updatedAt: '2026-08-13T10:00:00.000Z',
};

describe('reconnection plan calendar hand-off', () => {
  it.each([
    ['home_visit', 'Visit', ''],
    ['phone_call', 'Phone call', 'Phone call'],
    ['video_call', 'Video call', 'Video call'],
    ['family_meal', 'Meal', ''],
    ['outing', 'Outdoor activity', ''],
    ['other', 'Family gathering', ''],
  ] as const)('maps %s to the Calendar type %s and safe default location', (format, type, locationName) => {
    const prefill = reconnectionPlanToGatheringPrefill({
      ...plan,
      suggestedGathering: { ...plan.suggestedGathering, format },
    });

    expect(prefill.type).toBe(type);
    expect(prefill.locationName).toBe(locationName);
    expect(prefill).not.toHaveProperty('startAt');
  });

  it('prefers explicit location guidance over a format default', () => {
    const prefill = reconnectionPlanToGatheringPrefill({
      ...plan,
      suggestedGathering: {
        ...plan.suggestedGathering,
        format: 'video_call',
        locationGuidance: 'Private family video room',
      },
    });

    expect(prefill.locationName).toBe('Private family video room');
  });

  it('maps only explicit plan guidance and leaves scheduling for user review', () => {
    expect(reconnectionPlanToGatheringPrefill(plan)).toEqual({
      sourcePlanId: 'plan-id',
      sourcePlanTitle: 'Call Grandfather',
      title: 'Call Grandfather',
      purpose: 'Share family news',
      type: 'Phone call',
      locationName: 'Phone call',
      notes: [
        'Prepared from the stored reconnection plan “Call Grandfather”. Review every detail before saving.',
        'Suggested duration: 30 minutes.',
        'Timing guidance: Ask him which evening works.',
        'Accessibility: Keep the call short if he is tired.',
      ].join('\n'),
      memberIds: ['member-1', 'member-2'],
    });
  });

  it('uses authenticated, encoded list and status endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ plans: [plan] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ id: 'plan/id', status: 'accepted' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    await reconnectionPlansApi.list('family/id');
    await reconnectionPlansApi.updateStatus('plan/id', 'accepted');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/families/family%2Fid/reconnection-plans');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/reconnection-plans/plan%2Fid');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      credentials: 'same-origin',
    }));
  });
});
