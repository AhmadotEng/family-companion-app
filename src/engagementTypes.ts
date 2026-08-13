import type { Activity } from './types';

export interface ActivityListing extends Activity {
  sourceLabel: string;
  sourceUrl?: string;
  verifiedAt?: string;
  isSample: boolean;
}

export type RsvpStatus = 'pending' | 'going' | 'maybe' | 'declined';

export interface GatheringInvitation {
  id: string;
  memberId: string;
  memberName: string;
  channel: 'share_link' | 'whatsapp';
  status: RsvpStatus;
  preparedAt: string;
  openedAt?: string;
  respondedAt?: string;
}

export interface PersistentGathering {
  id: string;
  familyId: string;
  title: string;
  purpose: string;
  startAt: string;
  timezone: string;
  locationName: string;
  notes?: string;
  type: string;
  status: 'draft' | 'inviting' | 'completed' | 'cancelled';
  createdByUserId: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  invitations: GatheringInvitation[];
}

export interface PreparedInvitation {
  memberId: string;
  memberName: string;
  sharePath: string;
  /** Absolute URL supplied by newer servers, honoring PUBLIC_APP_URL. */
  shareUrl?: string;
  whatsappUrl?: string;
}

export interface MemoryRecord {
  id: string;
  familyId: string;
  createdByUserId: string;
  gatheringId?: string;
  title: string;
  note?: string;
  memoryType: 'note' | 'photo' | 'video' | 'audio';
  visibility: 'private' | 'family_admin' | 'family' | 'selected';
  aiProcessingAllowed: boolean;
  hasMedia: boolean;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RewardEntry {
  id: string;
  points: number;
  reasonCode: string;
  description: string;
  createdAt: string;
}

export interface RewardOffer {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  partnerName?: string;
  isDemo: boolean;
  redeemable: boolean;
}

export interface RewardSummary {
  balance: number;
  entries: RewardEntry[];
  offers: RewardOffer[];
}

export interface ReconnectionPlan {
  id: string;
  title: string;
  rationale: string;
  suggestedMemberIds: string[];
  suggestedGathering: {
    format: 'home_visit' | 'phone_call' | 'video_call' | 'family_meal' | 'outing' | 'other';
    purpose: string;
    durationMinutes: number;
    timingGuidance?: string;
    locationGuidance?: string;
    accessibilityNotes?: string;
  };
  suggestedActivityId?: string;
  rewardChallenge?: string;
  evidence: Record<string, unknown>;
  status: 'active' | 'accepted' | 'dismissed' | 'completed';
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicInvitation {
  familyName: string;
  inviteeName: string;
  hostName: string;
  title: string;
  purpose: string;
  startAt: string;
  timezone: string;
  locationName: string;
  notes?: string;
  type: string;
  status: RsvpStatus;
}
