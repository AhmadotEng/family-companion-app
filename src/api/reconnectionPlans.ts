import type { ReconnectionPlan } from '../engagementTypes';
import type { GatheringPlannerPrefill } from '../lib/gatheringPlanner';
import { apiRequest } from './client';

export type ReconnectionPlanUpdateStatus = 'accepted' | 'dismissed' | 'completed';

/**
 * A local, editable hand-off from an AI-assisted plan to the calendar. Passing
 * this object does not create a gathering, send invitations, or update a plan.
 */
export interface GatheringPlanPrefill extends GatheringPlannerPrefill {
  sourcePlanId: string;
  sourcePlanTitle: string;
}

const gatheringTypeByFormat: Record<ReconnectionPlan['suggestedGathering']['format'], string> = {
  home_visit: 'Visit',
  phone_call: 'Phone call',
  video_call: 'Video call',
  family_meal: 'Meal',
  outing: 'Outdoor activity',
  other: 'Family gathering',
};

function defaultLocation(format: ReconnectionPlan['suggestedGathering']['format']): string {
  if (format === 'phone_call') return 'Phone call';
  if (format === 'video_call') return 'Video call';
  return '';
}

export function reconnectionPlanToGatheringPrefill(plan: ReconnectionPlan): GatheringPlanPrefill {
  const suggestion = plan.suggestedGathering;
  const guidance = [
    `Prepared from the stored reconnection plan “${plan.title}”. Review every detail before saving.`,
    `Suggested duration: ${suggestion.durationMinutes} minutes.`,
    suggestion.timingGuidance ? `Timing guidance: ${suggestion.timingGuidance}` : '',
    suggestion.accessibilityNotes ? `Accessibility: ${suggestion.accessibilityNotes}` : '',
  ].filter(Boolean).join('\n');

  return {
    sourcePlanId: plan.id,
    sourcePlanTitle: plan.title,
    title: plan.title,
    purpose: suggestion.purpose,
    type: gatheringTypeByFormat[suggestion.format],
    locationName: suggestion.locationGuidance?.trim() || defaultLocation(suggestion.format),
    notes: guidance.slice(0, 2_000),
    memberIds: [...new Set(plan.suggestedMemberIds)],
  };
}

export const reconnectionPlansApi = {
  list: (familyId: string) => apiRequest<{ plans: ReconnectionPlan[] }>(
    `/api/families/${encodeURIComponent(familyId)}/reconnection-plans`,
  ),

  updateStatus: (planId: string, status: ReconnectionPlanUpdateStatus) => (
    apiRequest<{ id: string; status: ReconnectionPlanUpdateStatus }>(
      `/api/reconnection-plans/${encodeURIComponent(planId)}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    )
  ),
};
