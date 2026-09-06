import type {
  PersistentGathering,
  PreparedInvitation,
  PublicInvitation,
  RsvpStatus,
} from '../engagementTypes';
import { apiRequest } from './client';

export interface CreateGatheringInput {
  title: string;
  purpose: string;
  startAt: string;
  timezone: 'Asia/Dubai';
  locationName: string;
  notes?: string;
  type: string;
}

export interface CreateGatheringOptions {
  /** Stable per planner instance so a retried request cannot make a duplicate. */
  idempotencyKey?: string;
}

export interface PreparedInvitationResult {
  invitations: PreparedInvitation[];
  deliveryNotice: string;
  gathering: PersistentGathering;
}

export const engagementApi = {
  listGatherings: (familyId: string) =>
    apiRequest<{ gatherings: PersistentGathering[] }>(
      `/api/families/${encodeURIComponent(familyId)}/gatherings`,
    ),

  createGathering: (
    familyId: string,
    input: CreateGatheringInput,
    options: CreateGatheringOptions = {},
  ) =>
    apiRequest<{ gathering: PersistentGathering }>(
      `/api/families/${encodeURIComponent(familyId)}/gatherings`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
      },
    ),

  prepareInvitations: (
    gatheringId: string,
    input: { memberIds: string[]; channel: 'share_link' | 'whatsapp' },
  ) =>
    apiRequest<PreparedInvitationResult>(
      `/api/gatherings/${encodeURIComponent(gatheringId)}/invitations`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  getPublicInvitation: (token: string) =>
    apiRequest<{ invitation: PublicInvitation }>(
      `/api/invitations/${encodeURIComponent(token)}`,
    ),

  respondToInvitation: (token: string, status: Exclude<RsvpStatus, 'pending'>) =>
    apiRequest<{ status: Exclude<RsvpStatus, 'pending'>; message: string }>(
      `/api/invitations/${encodeURIComponent(token)}/respond`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),

  completeGathering: (gatheringId: string, confirmAttendeeMemberIds: string[]) =>
    apiRequest<{ gathering: PersistentGathering; pointsAwarded: number }>(
      `/api/gatherings/${encodeURIComponent(gatheringId)}/complete`,
      { method: 'POST', body: JSON.stringify({ confirmAttendeeMemberIds }) },
    ),
};
