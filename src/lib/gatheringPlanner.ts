import type { CreateGatheringInput, CreateGatheringOptions, PreparedInvitationResult } from '../api/engagement';
import type { PersistentGathering } from '../engagementTypes';
import { formatDubaiDateKey, toDubaiIso } from './gatheringDate';

export const GATHERING_TYPES = [
  'Family gathering',
  'Majlis',
  'Meal',
  'Outdoor activity',
  'Celebration',
  'Visit',
  'Phone call',
  'Video call',
] as const;

const offsetAwareIsoPattern = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type GatheringType = (typeof GATHERING_TYPES)[number];
export type InvitationChannel = 'share_link' | 'whatsapp';
export type GatheringPlannerSource = 'manual' | 'ai' | 'reconnection';

export interface GatheringPlannerPrefill {
  title: string;
  purpose: string;
  /** Offset-aware instant. It is displayed as wall-clock time in Asia/Dubai. */
  startAt?: string;
  timezone?: 'Asia/Dubai';
  locationName: string;
  type: GatheringType | string;
  notes?: string;
  memberIds: string[];
  invitationChannel?: InvitationChannel;
}

export interface GatheringPlannerDraft {
  title: string;
  purpose: string;
  date: string;
  time: string;
  type: GatheringType;
  locationName: string;
  notes: string;
  memberIds: string[];
  channel: InvitationChannel;
}

export interface GatheringPlannerApi {
  createGathering: (
    familyId: string,
    input: CreateGatheringInput,
    options?: CreateGatheringOptions,
  ) => Promise<{ gathering: PersistentGathering }>;
  prepareInvitations: (
    gatheringId: string,
    input: { memberIds: string[]; channel: InvitationChannel },
  ) => Promise<PreparedInvitationResult>;
}

export interface GatheringPlannerSubmissionResult {
  gathering: PersistentGathering;
  prepared?: PreparedInvitationResult;
  invitationError?: unknown;
  created: boolean;
}

export function createGatheringPlannerIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `gathering-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dubaiTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const hour = part('hour');
  const minute = part('minute');
  return hour && minute ? `${hour}:${minute}` : '';
}

export function normalizeGatheringType(value: string): GatheringType {
  const normalized = value.trim().toLocaleLowerCase('en');
  return GATHERING_TYPES.find(type => type.toLocaleLowerCase('en') === normalized) ?? 'Family gathering';
}

export function createGatheringPlannerDraft({
  prefill,
  availableMemberIds,
  defaultDate = '',
  defaultTime = '',
}: {
  prefill?: GatheringPlannerPrefill;
  availableMemberIds: Iterable<string>;
  defaultDate?: string;
  defaultTime?: string;
}): GatheringPlannerDraft {
  const permittedIds = new Set(availableMemberIds);
  const startAt = prefill?.startAt?.trim() ?? '';
  const hasValidStart = offsetAwareIsoPattern.test(startAt) && !Number.isNaN(new Date(startAt).getTime());

  return {
    title: prefill?.title.slice(0, 120) ?? '',
    purpose: prefill?.purpose.slice(0, 500) ?? '',
    // A prepared hand-off never borrows Calendar defaults. If its exact
    // schedule is absent, the user must supply both fields before review.
    date: prefill ? (hasValidStart ? formatDubaiDateKey(startAt) : '') : defaultDate,
    time: prefill ? (hasValidStart ? dubaiTime(startAt) : '') : defaultTime,
    type: normalizeGatheringType(prefill?.type ?? 'Family gathering'),
    locationName: prefill?.locationName.slice(0, 300) ?? '',
    notes: prefill?.notes?.slice(0, 2_000) ?? '',
    memberIds: [...new Set(prefill?.memberIds ?? [])].filter(id => permittedIds.has(id)),
    channel: prefill?.invitationChannel ?? 'share_link',
  };
}

export function gatheringInputFromDraft(
  draft: GatheringPlannerDraft,
  now = new Date(),
): CreateGatheringInput {
  const title = draft.title.trim();
  const purpose = draft.purpose.trim();
  const locationName = draft.locationName.trim();
  const notes = draft.notes.trim();

  if (title.length < 2 || title.length > 120) throw new Error('Title must be between 2 and 120 characters.');
  if (purpose.length < 2 || purpose.length > 500) throw new Error('Purpose must be between 2 and 500 characters.');
  if (locationName.length < 2 || locationName.length > 300) throw new Error('Location must be between 2 and 300 characters.');
  if (notes.length > 2_000) throw new Error('Notes must be 2,000 characters or fewer.');

  const startAt = toDubaiIso(draft.date, draft.time);
  if (new Date(startAt).getTime() <= now.getTime()) {
    throw new Error('Choose a future gathering date and time.');
  }

  return {
    title,
    purpose,
    startAt,
    timezone: 'Asia/Dubai',
    locationName,
    notes: notes || undefined,
    type: normalizeGatheringType(draft.type),
  };
}

async function persistGatheringPlannerDraft({
  api,
  familyId,
  draft,
  existingGathering,
  idempotencyKey,
}: {
  api: GatheringPlannerApi;
  familyId: string;
  draft: GatheringPlannerDraft;
  existingGathering: PersistentGathering | null;
  idempotencyKey: string;
}): Promise<GatheringPlannerSubmissionResult> {
  const createdResult = existingGathering
    ? { gathering: existingGathering }
    : await api.createGathering(
      familyId,
      gatheringInputFromDraft(draft),
      { idempotencyKey },
    );
  const gathering = createdResult.gathering;
  const created = existingGathering === null;

  if (draft.memberIds.length === 0) return { gathering, created };

  try {
    const prepared = await api.prepareInvitations(gathering.id, {
      memberIds: [...new Set(draft.memberIds)],
      channel: draft.channel,
    });
    return { gathering: prepared.gathering, prepared, created };
  } catch (invitationError) {
    // Returning the saved gathering is essential: a retry must prepare links
    // for this row instead of creating a duplicate gathering.
    return { gathering, invitationError, created };
  }
}

/**
 * Keeps a planner's final submission single-flight and remembers a successful
 * create across invitation retries. The returned planner response itself is
 * non-mutating; this controller is called only from the final confirm button.
 */
export function createGatheringPlannerSubmissionController(
  api: GatheringPlannerApi,
  idempotencyKey: string = createGatheringPlannerIdempotencyKey(),
) {
  let savedGathering: PersistentGathering | null = null;
  let inFlight: Promise<GatheringPlannerSubmissionResult> | null = null;

  return {
    submit(familyId: string, draft: GatheringPlannerDraft) {
      if (inFlight) return inFlight;
      inFlight = persistGatheringPlannerDraft({
        api,
        familyId,
        draft,
        existingGathering: savedGathering,
        idempotencyKey,
      }).then(result => {
        savedGathering = result.gathering;
        return result;
      }).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    getSavedGathering() {
      return savedGathering;
    },
  };
}
