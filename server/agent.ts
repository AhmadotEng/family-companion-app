import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Application, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./database.js";
import {
  ensureRelationshipIsValid,
  findDuplicateMember,
  getMembership,
  getMemberRow,
  insertRelationship,
  requireFamilyAdmin,
  writeAudit,
  type FamilyRole,
  type Membership,
} from "./domain.js";
import { GEMINI_AGENT_SYSTEM_INSTRUCTION } from "./agentPrompt.js";
import { insertReconnectionPlan } from "./engagement.js";
import {
  cleanupDeletedMemoryFile,
  completeGathering,
  completeGatheringSchema,
  createGatheringDraft,
  createGatheringSchema,
  createMemory,
  deleteMemory,
  prepareInvitationLinks,
  prepareInvitationsSchema,
  updatePlanStatusSchema,
  updateReconnectionPlanStatus,
} from "./engagementCommands.js";
import { asyncRoute, HttpError, parseBody, parseParams } from "./http.js";
import { isoDateSchema, memberProfileSchema } from "./schemas.js";
import { requireAuth } from "./security.js";

const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(maximum).optional(),
  );

const relationshipTypeSchema = z.enum(["parent", "spouse", "sibling", "guardian", "relative"]);
const addMemberRelationshipSchema = z
  .object({
    existingMemberId: z.string().uuid(),
    type: relationshipTypeSchema,
    direction: z.enum(["new_to_existing", "existing_to_new"]),
  })
  .strict();

const approximateLocationSchema = z
  .object({
    city: optionalText(100),
    emirate: optionalText(100),
  })
  .strict()
  .refine((value) => Boolean(value.city || value.emirate), "A city or emirate is required.");

export const addMemberPayloadSchema = memberProfileSchema
  .omit({ photoUrl: true })
  .extend({
    relationships: z.array(addMemberRelationshipSchema).max(8).default([]),
    location: approximateLocationSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const relationshipKeys = value.relationships.map(
      (relationship) => `${relationship.existingMemberId}:${relationship.type}:${relationship.direction}`,
    );
    if (new Set(relationshipKeys).size !== relationshipKeys.length) {
      context.addIssue({ code: "custom", message: "Initial relationships must be unique." });
    }
  });

export type AddMemberPayload = z.infer<typeof addMemberPayloadSchema>;

const updateMemberChangesSchema = z
  .object({
    displayName: text(2, 100).optional(),
    birthDate: z.union([isoDateSchema, z.null()]).optional(),
    phone: z.union([z.string().trim().max(30), z.null()]).optional(),
    email: z.union([z.string().trim().toLowerCase().email().max(254), z.null()]).optional(),
    interests: z
      .array(text(1, 50))
      .max(20)
      .transform((values) => [...new Set(values)])
      .optional(),
    notes: z.union([z.string().trim().max(2_000), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one profile field is required.");

export const updateMemberPayloadSchema = z
  .object({
    memberId: z.string().uuid(),
    changes: updateMemberChangesSchema,
  })
  .strict();

export const deleteMemberPayloadSchema = z.object({ memberId: z.string().uuid() }).strict();

export const createRelationshipPayloadSchema = z
  .object({
    sourceMemberId: z.string().uuid(),
    targetMemberId: z.string().uuid(),
    type: relationshipTypeSchema,
  })
  .strict();

export const deleteRelationshipPayloadSchema = z.object({ relationshipId: z.string().uuid() }).strict();

export type UpdateMemberPayload = z.infer<typeof updateMemberPayloadSchema>;
export type DeleteMemberPayload = z.infer<typeof deleteMemberPayloadSchema>;
export type CreateRelationshipPayload = z.infer<typeof createRelationshipPayloadSchema>;
export type DeleteRelationshipPayload = z.infer<typeof deleteRelationshipPayloadSchema>;

const requiredRequesterRelationshipSchema = z
  .object({
    requesterMemberId: z.string().uuid(),
    type: relationshipTypeSchema,
    direction: z.enum(["new_to_existing", "existing_to_new"]),
    requestedAs: z.enum([
      "brother",
      "sister",
      "parent",
      "mother",
      "father",
      "child",
      "son",
      "daughter",
      "spouse",
      "wife",
      "husband",
    ]),
  })
  .strict();

const storedAddMemberProposalSchema = z
  .object({
    member: addMemberPayloadSchema,
    requiredRequesterRelationship: requiredRequesterRelationshipSchema.optional(),
  })
  .strict();

const storedUpdateMemberProposalSchema = z
  .object({ payload: updateMemberPayloadSchema, expectedUpdatedAt: z.string().datetime() })
  .strict();

const storedDeleteMemberProposalSchema = z
  .object({
    payload: deleteMemberPayloadSchema,
    snapshot: z
      .object({
        displayName: text(2, 100),
        updatedAt: z.string().datetime(),
        relationshipIds: z.array(z.string().uuid()).max(500),
        invitationVersions: z.array(text(1, 500)).max(500),
        locationConsentIds: z.array(z.string().uuid()).max(500),
        locationVersions: z.array(text(1, 200)).max(500),
        memoryViewerKeys: z.array(text(1, 200)).max(500),
      })
      .strict(),
  })
  .strict();

const suggestedGatheringSchema = z
  .object({
    format: z.enum(["home_visit", "phone_call", "video_call", "family_meal", "outing", "other"]),
    purpose: text(2, 300),
    durationMinutes: z.number().int().min(15).max(480),
    timingGuidance: optionalText(200),
    locationGuidance: optionalText(200),
    accessibilityNotes: optionalText(300),
  })
  .strict();

export const reconnectionPlanPayloadSchema = z
  .object({
    title: text(2, 120),
    rationale: text(2, 800),
    suggestedMemberIds: z
      .array(z.string().uuid())
      .min(1)
      .max(20)
      .transform((memberIds) => [...new Set(memberIds)]),
    evidenceSignalIds: z
      .array(text(1, 160))
      .min(1)
      .max(30)
      .transform((signalIds) => [...new Set(signalIds)]),
    suggestedGathering: suggestedGatheringSchema,
    suggestedActivityId: z.string().uuid().optional(),
    rewardChallenge: text(2, 300),
  })
  .strict();

export type ReconnectionPlanPayload = z.infer<typeof reconnectionPlanPayloadSchema>;

export const createGatheringDraftPayloadSchema = createGatheringSchema;
export const prepareInvitationLinksPayloadSchema = prepareInvitationsSchema
  .extend({ gatheringId: z.string().uuid() })
  .strict();
export const completeGatheringPayloadSchema = completeGatheringSchema
  .extend({ gatheringId: z.string().uuid() })
  .strict();
export const createNoteMemoryPayloadSchema = z
  .object({
    gatheringId: z.string().uuid(),
    title: text(2, 150),
    note: text(1, 10_000),
    visibility: z.enum(["private", "family_admin", "family", "selected"]),
    selectedMemberIds: z
      .array(z.string().uuid())
      .max(200)
      .transform((ids) => [...new Set(ids)]),
    capturedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.visibility === "selected" && value.selectedMemberIds.length === 0) {
      context.addIssue({ code: "custom", message: "Select at least one viewer." });
    }
  });
export const deleteMemoryPayloadSchema = z.object({ memoryId: z.string().uuid() }).strict();
export const updatePlanStatusPayloadSchema = updatePlanStatusSchema.extend({ planId: z.string().uuid() }).strict();

const invitationSnapshotItemSchema = z
  .object({
    memberId: z.string().uuid(),
    invitationId: z.string().uuid().nullable(),
    status: z.enum(["pending", "going", "maybe", "declined"]).nullable(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();
const storedPrepareInvitationLinksPayloadSchema = z
  .object({
    payload: prepareInvitationLinksPayloadSchema,
    invitationSnapshot: z.array(invitationSnapshotItemSchema).min(1).max(200),
  })
  .strict();
const gatheringInvitationVersionSchema = z
  .object({
    id: z.string().uuid(),
    memberId: z.string().uuid(),
    status: z.enum(["pending", "going", "maybe", "declined"]),
    updatedAt: z.string().datetime(),
  })
  .strict();
const storedCompleteGatheringPayloadSchema = z
  .object({
    payload: completeGatheringPayloadSchema,
    gatheringSnapshot: z
      .object({
        status: z.enum(["draft", "inviting", "completed", "cancelled"]),
        startAt: z.string().datetime({ offset: true }),
        updatedAt: z.string().datetime(),
        invitations: z.array(gatheringInvitationVersionSchema).max(500),
      })
      .strict(),
  })
  .strict();
const storedDeleteMemoryPayloadSchema = z
  .object({
    payload: deleteMemoryPayloadSchema,
    snapshot: z
      .object({
        title: text(2, 150),
        memoryType: z.enum(["note", "photo", "video", "audio"]),
        visibility: z.enum(["private", "family_admin", "family", "selected"]),
        updatedAt: z.string().datetime(),
        hasMedia: z.boolean(),
      })
      .strict(),
  })
  .strict();
const storedUpdatePlanStatusPayloadSchema = z
  .object({
    payload: updatePlanStatusPayloadSchema,
    expectedStatus: z.enum(["active", "accepted", "dismissed", "completed"]),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();

export type CreateGatheringDraftPayload = z.infer<typeof createGatheringDraftPayloadSchema>;
export type PrepareInvitationLinksPayload = z.infer<typeof prepareInvitationLinksPayloadSchema>;
export type CompleteGatheringPayload = z.infer<typeof completeGatheringPayloadSchema>;
export type CreateNoteMemoryPayload = z.infer<typeof createNoteMemoryPayloadSchema>;
export type DeleteMemoryPayload = z.infer<typeof deleteMemoryPayloadSchema>;
export type UpdatePlanStatusPayload = z.infer<typeof updatePlanStatusPayloadSchema>;

const storedCreateNoteMemoryPayloadSchema = createNoteMemoryPayloadSchema
  .safeExtend({ capturedAt: z.string().datetime({ offset: true }) })
  .strict();

export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_MEMBER"), payload: addMemberPayloadSchema }).strict(),
  z.object({ type: z.literal("UPDATE_MEMBER"), payload: updateMemberPayloadSchema }).strict(),
  z.object({ type: z.literal("DELETE_MEMBER"), payload: deleteMemberPayloadSchema }).strict(),
  z.object({ type: z.literal("CREATE_RELATIONSHIP"), payload: createRelationshipPayloadSchema }).strict(),
  z.object({ type: z.literal("DELETE_RELATIONSHIP"), payload: deleteRelationshipPayloadSchema }).strict(),
  z
    .object({ type: z.literal("CREATE_RECONNECTION_PLAN"), payload: reconnectionPlanPayloadSchema })
    .strict(),
  z.object({ type: z.literal("CREATE_GATHERING_DRAFT"), payload: createGatheringDraftPayloadSchema }).strict(),
  z.object({ type: z.literal("PREPARE_INVITATION_LINKS"), payload: prepareInvitationLinksPayloadSchema }).strict(),
  z.object({ type: z.literal("COMPLETE_GATHERING"), payload: completeGatheringPayloadSchema }).strict(),
  z.object({ type: z.literal("CREATE_NOTE_MEMORY"), payload: createNoteMemoryPayloadSchema }).strict(),
  z.object({ type: z.literal("DELETE_MEMORY"), payload: deleteMemoryPayloadSchema }).strict(),
  z.object({ type: z.literal("UPDATE_PLAN_STATUS"), payload: updatePlanStatusPayloadSchema }).strict(),
]);

export type AgentAction = z.infer<typeof agentActionSchema>;

const providerDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), message: text(1, 2_000) }).strict(),
  z.object({ kind: z.literal("clarification"), message: text(1, 2_000) }).strict(),
  z
    .object({
      kind: z.literal("proposal"),
      message: text(1, 2_000),
      action: agentActionSchema,
    })
    .strict(),
]);

export type AgentProviderDecision = z.infer<typeof providerDecisionSchema>;

export interface AgentFamilyMemberContext {
  id: string;
  displayName: string;
  canUpdate: boolean;
  canDelete: boolean;
  location?: {
    city?: string;
    emirate?: string;
    distanceBand?: string;
  };
}

export type AgentEvidenceSignalKind =
  | "family_member_count"
  | "relationship_count"
  | "safe_location"
  | "gathering_count"
  | "last_completed_gathering"
  | "invitation_count"
  | "confirmed_participation_count"
  | "ai_consented_shared_memory_count"
  | "reward_balance"
  | "reward_event_count";

const evidenceSignalSchema = z
  .object({
    id: text(1, 160),
    kind: z.enum([
      "family_member_count",
      "relationship_count",
      "safe_location",
      "gathering_count",
      "last_completed_gathering",
      "invitation_count",
      "confirmed_participation_count",
      "ai_consented_shared_memory_count",
      "reward_balance",
      "reward_event_count",
    ]),
    label: text(1, 300),
    value: z.union([z.string().max(500), z.number().finite()]),
    memberId: z.string().uuid().optional(),
    period: z.string().max(100).optional(),
  })
  .strict();

export interface AgentEvidenceSignal {
  id: string;
  kind: AgentEvidenceSignalKind;
  label: string;
  value: string | number;
  memberId?: string;
  period?: string;
}

export interface AgentSampleActivityContext {
  id: string;
  title: string;
  category: string;
  emirate: string;
  priceRange: "Free" | "Budget" | "Premium";
  ageSuitability: string;
  elderlyFriendly: boolean;
  indoorOutdoor: "Indoor" | "Outdoor";
  estimatedDuration: string;
  weatherSuitability: string;
}

export interface AgentGatheringContext {
  id: string;
  title: string;
  status: "draft" | "inviting" | "completed" | "cancelled";
  startAt: string;
  completedAt?: string;
  canPrepareInvitations: boolean;
  canComplete: boolean;
  invitationStatuses: Array<{
    memberId: string;
    memberName: string;
    status: "pending" | "going" | "maybe" | "declined";
  }>;
}

export interface AgentMemoryContext {
  id: string;
  title: string;
  memoryType: "note" | "photo" | "video" | "audio";
  visibility: "private" | "family_admin" | "family" | "selected";
  gatheringId?: string;
  canDelete: boolean;
}

export interface AgentPlanContext {
  id: string;
  title: string;
  status: "active" | "accepted" | "dismissed" | "completed";
  canUpdate: boolean;
}

const storedReconnectionProposalSchema = z
  .object({
    plan: reconnectionPlanPayloadSchema,
    evidenceSignals: z.array(evidenceSignalSchema).min(1).max(30),
    provider: text(1, 100),
    model: text(1, 200),
  })
  .strict();

export interface AgentFamilyContext {
  id: string;
  name: string;
  currentDateTime: string;
  timezone: "Asia/Dubai";
  requester: {
    role: FamilyRole;
    linkedMemberId: string | null;
  };
  members: AgentFamilyMemberContext[];
  relationships: Array<{
    id: string;
    sourceMemberId: string;
    targetMemberId: string;
    type: z.infer<typeof relationshipTypeSchema>;
  }>;
  engagement: {
    evidenceSignals: AgentEvidenceSignal[];
    sampleActivities: AgentSampleActivityContext[];
    gatherings: AgentGatheringContext[];
    memories: AgentMemoryContext[];
    plans: AgentPlanContext[];
    limitations: string[];
  };
}

export interface AgentProviderInput {
  request: string;
  history: Array<{ role: "user" | "assistant"; message: string }>;
  family: AgentFamilyContext;
  /** Providers which support cancellation should stop client-side work when aborted. */
  signal?: AbortSignal;
}

/**
 * Providers interpret requests but never receive a database handle. Their output
 * is treated as untrusted input and revalidated before any proposal is stored.
 */
export interface AgentProvider {
  readonly providerName?: string;
  readonly modelName?: string;
  readonly requiresExternalDataConsent?: boolean;
  generate(input: AgentProviderInput): Promise<AgentProviderDecision | unknown>;
}

export interface GeminiAgentProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
}


/**
 * Keep the provider-enforced envelope intentionally compact and rely on the
 * strict discriminated Zod schemas above as the final trust boundary. The
 * system instruction documents every payload contract; malformed model output
 * is rejected with no proposal or domain write.
 */
export const GEMINI_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "message"],
  properties: {
    kind: { type: "string", enum: ["message", "clarification", "proposal"] },
    message: { type: "string" },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["type", "payload"],
      properties: {
        type: {
          type: "string",
          enum: [
            "ADD_MEMBER",
            "UPDATE_MEMBER",
            "DELETE_MEMBER",
            "CREATE_RELATIONSHIP",
            "DELETE_RELATIONSHIP",
            "CREATE_RECONNECTION_PLAN",
            "CREATE_GATHERING_DRAFT",
            "PREPARE_INVITATION_LINKS",
            "COMPLETE_GATHERING",
            "CREATE_NOTE_MEMORY",
            "DELETE_MEMORY",
            "UPDATE_PLAN_STATUS",
          ],
        },
        payload: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

export class GeminiAgentProvider implements AgentProvider {
  readonly providerName = "gemini";
  readonly requiresExternalDataConsent = true;
  readonly modelName: string;
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiAgentProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("A Gemini API key is required.");
    if (!options.model.trim()) throw new Error("A Gemini model is required.");
    this.modelName = options.model;
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generate(input: AgentProviderInput): Promise<AgentProviderDecision> {
    const response = await this.client.models.generateContent({
      model: this.options.model,
      contents: JSON.stringify({
        currentRequest: input.request,
        previousConversation: input.history,
        permittedFamilyContext: input.family,
      }),
      config: {
        abortSignal: input.signal,
        httpOptions: { timeout: this.options.timeoutMs },
        systemInstruction: GEMINI_AGENT_SYSTEM_INSTRUCTION,
        // Gemini 3.5 Flash defaults to medium reasoning. This task is strict
        // intent extraction, so minimal thinking preserves enough of the
        // shared output budget for a complete JSON action payload.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: 4_096,
        responseMimeType: "application/json",
        responseJsonSchema: GEMINI_RESPONSE_JSON_SCHEMA,
      },
    });

    if (!response.text) throw new Error("The Gemini response was empty.");
    return providerDecisionSchema.parse(JSON.parse(response.text));
  }
}

export interface RegisterAgentRoutesOptions {
  /** Inject a provider in tests or use a different implementation in production. */
  provider?: AgentProvider;
  /** Environment source is injectable so missing-credential behavior can be tested. */
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Overrides AGENT_PROVIDER_TIMEOUT_MS. Intended primarily for composition/tests. */
  providerTimeoutMs?: number;
  production?: boolean;
  publicAppUrl?: string;
}

interface AgentSessionRow {
  id: string;
  family_id: string;
  created_by_user_id: string;
  status: "active" | "closed";
  created_at: string;
  updated_at: string;
}

interface ActionProposalRow {
  id: string;
  session_id: string;
  family_id: string;
  created_by_user_id: string;
  action_type:
    | "ADD_MEMBER"
    | "UPDATE_MEMBER"
    | "DELETE_MEMBER"
    | "CREATE_RELATIONSHIP"
    | "DELETE_RELATIONSHIP"
    | "CREATE_RECONNECTION_PLAN"
    | "CREATE_GATHERING_DRAFT"
    | "PREPARE_INVITATION_LINKS"
    | "COMPLETE_GATHERING"
    | "CREATE_NOTE_MEMORY"
    | "DELETE_MEMORY"
    | "UPDATE_PLAN_STATUS";
  payload_json: string;
  title: string;
  summary: string;
  warnings_json: string;
  status: "pending" | "confirmed" | "rejected";
  result_entity_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  confirmed_at: string | null;
  rejected_at: string | null;
}

const messageRequestSchema = z
  .object({
    familyId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
    message: text(1, 2_000),
    aiProcessingConsent: z.boolean().optional(),
  })
  .strict();

const proposalParamsSchema = z.object({ proposalId: z.string().uuid() });
const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });

const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
const MIN_PROVIDER_TIMEOUT_MS = 100;
const MAX_PROVIDER_TIMEOUT_MS = 120_000;
export const AGENT_TRANSCRIPT_RETENTION_DAYS = 30;
const AGENT_TRANSCRIPT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export function purgeExpiredAgentSessions(database: AppDatabase, at = new Date()): number {
  const cutoff = new Date(at.getTime() - AGENT_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  return database.prepare("DELETE FROM agent_sessions WHERE updated_at < ?").run(cutoff).changes;
}

function providerTimeoutMs(options: RegisterAgentRoutesOptions): number {
  const environment = options.env ?? process.env;
  const candidate = options.providerTimeoutMs ?? Number(environment.AGENT_PROVIDER_TIMEOUT_MS);
  if (!Number.isFinite(candidate) || candidate < MIN_PROVIDER_TIMEOUT_MS || candidate > MAX_PROVIDER_TIMEOUT_MS) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }
  return Math.floor(candidate);
}

function createProvider(options: RegisterAgentRoutesOptions): AgentProvider | undefined {
  if (options.provider) return options.provider;
  const environment = options.env ?? process.env;
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new GeminiAgentProvider({
    apiKey,
    model: environment.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
    timeoutMs: providerTimeoutMs(options),
  });
}

function getOwnedSession(
  database: AppDatabase,
  sessionId: string,
  familyId: string,
  userId: string,
): AgentSessionRow {
  const session = database
    .prepare(
      `SELECT * FROM agent_sessions
       WHERE id = ? AND family_id = ? AND created_by_user_id = ? AND status = 'active'`,
    )
    .get(sessionId, familyId, userId) as AgentSessionRow | undefined;
  if (!session) throw new HttpError(404, "AGENT_SESSION_NOT_FOUND", "Agent session not found.");
  return session;
}

function getOwnedProposal(database: AppDatabase, proposalId: string, userId: string): ActionProposalRow {
  const proposal = database
    .prepare("SELECT * FROM agent_action_proposals WHERE id = ? AND created_by_user_id = ?")
    .get(proposalId, userId) as ActionProposalRow | undefined;
  if (!proposal) throw new HttpError(404, "AGENT_PROPOSAL_NOT_FOUND", "Action proposal not found.");
  return proposal;
}

function getPermittedFamilyContext(
  database: AppDatabase,
  membership: Membership,
  userId: string,
  now: Date,
): AgentFamilyContext {
  const members = database
    .prepare(
      `SELECT m.id, m.display_name, m.user_id,
              EXISTS(SELECT 1 FROM family_users linked WHERE linked.linked_member_id = m.id) AS linked_account,
              ml.city, ml.emirate, ml.latitude, ml.longitude, ml.visibility, ml.expires_at,
              lc.id AS active_consent_id
       FROM family_members m
       LEFT JOIN member_locations ml ON ml.member_id = m.id AND ml.family_id = m.family_id
       LEFT JOIN location_consents lc ON lc.id = ml.consent_id AND lc.revoked_at IS NULL
       WHERE m.family_id = ?
       ORDER BY m.display_name COLLATE NOCASE, m.id`,
    )
    .all(membership.familyId) as Array<{
    id: string;
    display_name: string;
    user_id: string | null;
    linked_account: 0 | 1;
    city: string | null;
    emirate: string | null;
    latitude: number | null;
    longitude: number | null;
    visibility: "private" | "family_admin" | "family" | null;
    expires_at: string | null;
    active_consent_id: string | null;
  }>;

  const isAdmin = membership.role === "owner" || membership.role === "admin";
  const isPermittedLocation = (member: (typeof members)[number]) => {
    const locationIsCurrent = !member.expires_at || new Date(member.expires_at).getTime() > now.getTime();
    return (
      Boolean(member.active_consent_id) &&
      locationIsCurrent &&
      (member.visibility === "family" ||
        (member.visibility === "family_admin" && isAdmin) ||
        (member.visibility === "private" &&
          (member.user_id === userId || membership.linkedMemberId === member.id)))
    );
  };
  const requesterLocation = members.find(
    (member) => member.id === membership.linkedMemberId && isPermittedLocation(member),
  );
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const distanceBand = (member: (typeof members)[number]): string | undefined => {
    if (!requesterLocation || requesterLocation.id === member.id) return undefined;
    if (
      requesterLocation.latitude === null || requesterLocation.longitude === null ||
      member.latitude === null || member.longitude === null
    ) return undefined;
    const latitudeDelta = radians(member.latitude - requesterLocation.latitude);
    const longitudeDelta = radians(member.longitude - requesterLocation.longitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(requesterLocation.latitude)) * Math.cos(radians(member.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
    const kilometres = 6_371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    if (kilometres < 5) return "under-5-km";
    if (kilometres < 25) return "5-to-25-km";
    if (kilometres < 75) return "25-to-75-km";
    return "over-75-km";
  };

  const safeMembers = members.map((member): AgentFamilyMemberContext => {
    const maySeeLocation = isPermittedLocation(member);
    const derivedDistanceBand = maySeeLocation ? distanceBand(member) : undefined;

    return {
      id: member.id,
      displayName: member.display_name,
      canUpdate: isAdmin || membership.linkedMemberId === member.id,
      canDelete: isAdmin && !member.user_id && !member.linked_account,
      ...(maySeeLocation && (member.city || member.emirate || derivedDistanceBand)
        ? {
            location: {
              ...(member.city ? { city: member.city } : {}),
              ...(member.emirate ? { emirate: member.emirate } : {}),
              ...(derivedDistanceBand ? { distanceBand: derivedDistanceBand } : {}),
            },
          }
        : {}),
    };
  });

  const relationships = database
    .prepare(
      `SELECT id, source_member_id, target_member_id, type
       FROM relationships WHERE family_id = ? ORDER BY created_at, id`,
    )
    .all(membership.familyId) as Array<{
    id: string;
    source_member_id: string;
    target_member_id: string;
    type: z.infer<typeof relationshipTypeSchema>;
  }>;

  const visibleGatheringRows = (isAdmin
    ? database
        .prepare("SELECT id, title, status, start_at, completed_at, created_by_user_id FROM gatherings WHERE family_id = ? ORDER BY start_at, id")
        .all(membership.familyId)
    : database
        .prepare(
          `SELECT DISTINCT g.id, g.title, g.status, g.start_at, g.completed_at, g.created_by_user_id
           FROM gatherings g
           LEFT JOIN gathering_invitations gi ON gi.gathering_id = g.id
           WHERE g.family_id = ? AND (g.created_by_user_id = ? OR gi.member_id = ?)
           ORDER BY g.start_at, g.id`,
        )
        .all(membership.familyId, userId, membership.linkedMemberId)) as Array<{
    id: string;
    title: string;
    status: AgentGatheringContext["status"];
    start_at: string;
    completed_at: string | null;
    created_by_user_id: string;
  }>;

  const gatherings: AgentGatheringContext[] = visibleGatheringRows.map((gathering) => {
    const maySeeFullRoster = isAdmin || gathering.created_by_user_id === userId;
    const invitationRows = database
      .prepare(
        `SELECT gi.member_id, fm.display_name, gi.status
         FROM gathering_invitations gi JOIN family_members fm ON fm.id = gi.member_id
         WHERE gi.gathering_id = ? ORDER BY fm.display_name COLLATE NOCASE, gi.id`,
      )
      .all(gathering.id) as Array<{
      member_id: string;
      display_name: string;
      status: "pending" | "going" | "maybe" | "declined";
    }>;
    return {
      id: gathering.id,
      title: gathering.title,
      status: gathering.status,
      startAt: gathering.start_at,
      ...(gathering.completed_at ? { completedAt: gathering.completed_at } : {}),
      canPrepareInvitations:
        (isAdmin || gathering.created_by_user_id === userId) &&
        gathering.status !== "completed" &&
        gathering.status !== "cancelled",
      canComplete:
        isAdmin && gathering.status === "inviting" && new Date(gathering.start_at).getTime() <= now.getTime(),
      invitationStatuses: invitationRows
        .filter((invitation) => maySeeFullRoster || invitation.member_id === membership.linkedMemberId)
        .map((invitation) => ({
          memberId: invitation.member_id,
          memberName: invitation.display_name,
          status: invitation.status,
        })),
    };
  });

  const memoryRows = database
    .prepare(
      `SELECT m.id, m.title, m.memory_type, m.visibility, m.gathering_id, m.created_by_user_id,
              m.ai_processing_allowed,
              EXISTS(
                SELECT 1 FROM memory_viewers mv
                WHERE mv.memory_id = m.id AND mv.member_id = ?
              ) AS selected_for_requester
       FROM memories m WHERE m.family_id = ? ORDER BY m.captured_at DESC, m.id`,
    )
    .all(membership.linkedMemberId, membership.familyId) as Array<{
    id: string;
    title: string;
    memory_type: AgentMemoryContext["memoryType"];
    visibility: AgentMemoryContext["visibility"];
    gathering_id: string | null;
    created_by_user_id: string;
    ai_processing_allowed: 0 | 1;
    selected_for_requester: 0 | 1;
  }>;
  const visibleMemoryRows = memoryRows.filter(
    (memory) =>
      Boolean(memory.ai_processing_allowed) &&
      (memory.created_by_user_id === userId ||
        memory.visibility === "family" ||
        (memory.visibility === "family_admin" && isAdmin) ||
        (memory.visibility === "selected" && Boolean(memory.selected_for_requester))),
  );
  const memories: AgentMemoryContext[] = visibleMemoryRows.map((memory) => ({
    id: memory.id,
    title: memory.title,
    memoryType: memory.memory_type,
    visibility: memory.visibility,
    ...(memory.gathering_id ? { gatheringId: memory.gathering_id } : {}),
    canDelete: isAdmin || memory.created_by_user_id === userId,
  }));

  const planRows = (isAdmin
    ? database
        .prepare("SELECT id, title, status, created_by_user_id FROM reconnection_plans WHERE family_id = ? ORDER BY created_at DESC, id")
        .all(membership.familyId)
    : database
        .prepare(
          "SELECT id, title, status, created_by_user_id FROM reconnection_plans WHERE family_id = ? AND created_by_user_id = ? ORDER BY created_at DESC, id",
        )
        .all(membership.familyId, userId)) as Array<{
    id: string;
    title: string;
    status: AgentPlanContext["status"];
    created_by_user_id: string;
  }>;
  const plans: AgentPlanContext[] = planRows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    status: plan.status,
    canUpdate: isAdmin || plan.created_by_user_id === userId,
  }));

  const evidenceSignals: AgentEvidenceSignal[] = [
    {
      id: "family.member_count",
      kind: "family_member_count",
      label: "Family members recorded",
      value: safeMembers.length,
    },
    {
      id: "family.relationship_count",
      kind: "relationship_count",
      label: "Family relationships recorded",
      value: relationships.length,
    },
  ];

  for (const member of safeMembers) {
    if (member.location) {
      evidenceSignals.push({
        id: `location.${member.id}`,
        kind: "safe_location",
        label: `Consent-filtered approximate location recorded for ${member.displayName}`,
        value: [member.location.city, member.location.emirate, member.location.distanceBand].filter(Boolean).join(", "),
        memberId: member.id,
      });
    }
  }

  const completedGatherings = gatherings.filter((gathering) => gathering.status === "completed");
  const lastCompletedAt = completedGatherings
    .map((gathering) => gathering.completedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  evidenceSignals.push(
    {
      id: "gatherings.total",
      kind: "gathering_count",
      label: "Gatherings recorded",
      value: gatherings.length,
    },
    {
      id: "gatherings.completed",
      kind: "gathering_count",
      label: "Completed gatherings recorded",
      value: completedGatherings.length,
    },
  );
  if (lastCompletedAt) {
    evidenceSignals.push({
      id: "gatherings.last_completed_at",
      kind: "last_completed_gathering",
      label: "Most recent completed gathering date recorded",
      value: lastCompletedAt,
    });
  }

  const invitationCounts = new Map<string, { invitation_count: number; going_count: number }>();
  gatherings.flatMap((gathering) => gathering.invitationStatuses).forEach((invitation) => {
    const current = invitationCounts.get(invitation.memberId) ?? { invitation_count: 0, going_count: 0 };
    current.invitation_count += 1;
    if (invitation.status === "going") current.going_count += 1;
    invitationCounts.set(invitation.memberId, current);
  });
  const memberNames = new Map(safeMembers.map((member) => [member.id, member.displayName]));
  const totalInvitationCount = [...invitationCounts.values()].reduce((total, row) => total + row.invitation_count, 0);
  evidenceSignals.push({
    id: "invitations.total",
    kind: "invitation_count",
    label: "Invitations recorded",
    value: totalInvitationCount,
  });
  invitationCounts.forEach((row, memberId) => {
    const displayName = memberNames.get(memberId);
    if (!displayName) return;
    evidenceSignals.push(
      {
        id: `invitations.${memberId}.total`,
        kind: "invitation_count",
        label: `Invitations recorded for ${displayName}`,
        value: row.invitation_count,
        memberId,
      },
      {
        id: `invitations.${memberId}.going`,
        kind: "confirmed_participation_count",
        label: `Going RSVPs recorded for ${displayName}`,
        value: row.going_count,
        memberId,
      },
    );
  });

  const sharedAiMemoryCount = visibleMemoryRows.filter(
    (memory) => memory.visibility === "family" && Boolean(memory.ai_processing_allowed),
  ).length;
  evidenceSignals.push({
    id: "memories.ai_consented_shared.count",
    kind: "ai_consented_shared_memory_count",
    label: "Family-visible memories permitted for AI processing",
    value: Number(sharedAiMemoryCount),
  });

  const rewardSummary = database
    .prepare("SELECT COALESCE(SUM(points), 0) AS balance, COUNT(*) AS event_count FROM reward_ledger WHERE family_id = ?")
    .get(membership.familyId) as { balance: number; event_count: number };
  evidenceSignals.push(
    {
      id: "rewards.balance",
      kind: "reward_balance",
      label: "Current family reward-points balance",
      value: Number(rewardSummary.balance),
    },
    {
      id: "rewards.event_count",
      kind: "reward_event_count",
      label: "Reward-ledger events recorded",
      value: Number(rewardSummary.event_count),
    },
  );

  const sampleActivities = database
    .prepare(
      `SELECT id, title, category, emirate, price_range, age_suitability,
              elderly_friendly, indoor_outdoor, estimated_duration, weather_suitability
       FROM activities WHERE active = 1 AND is_sample = 1 ORDER BY emirate, title LIMIT 50`,
    )
    .all() as Array<{
    id: string;
    title: string;
    category: string;
    emirate: string;
    price_range: "Free" | "Budget" | "Premium";
    age_suitability: string;
    elderly_friendly: 0 | 1;
    indoor_outdoor: "Indoor" | "Outdoor";
    estimated_duration: string;
    weather_suitability: string;
  }>;

  return {
    id: membership.familyId,
    name: membership.familyName,
    currentDateTime: now.toISOString(),
    timezone: "Asia/Dubai",
    requester: { role: membership.role, linkedMemberId: membership.linkedMemberId },
    members: safeMembers,
    relationships: relationships.map((relationship) => ({
      id: relationship.id,
      sourceMemberId: relationship.source_member_id,
      targetMemberId: relationship.target_member_id,
      type: relationship.type,
    })),
    engagement: {
      evidenceSignals,
      sampleActivities: sampleActivities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        category: activity.category,
        emirate: activity.emirate,
        priceRange: activity.price_range,
        ageSuitability: activity.age_suitability,
        elderlyFriendly: Boolean(activity.elderly_friendly),
        indoorOutdoor: activity.indoor_outdoor,
        estimatedDuration: activity.estimated_duration,
        weatherSuitability: activity.weather_suitability,
      })),
      gatherings,
      memories,
      plans,
      limitations: [
        "These are incomplete administrative records and do not measure affection, wellbeing, closeness, or intent.",
        "Invitation and attendance records may not include gatherings organized outside this application.",
        "Memories without explicit AI-processing consent, memory contents, member notes, contact details, media, exact coordinates, and invitation tokens are excluded.",
        "Activities are prototype samples; availability and venue details are not verified live.",
      ],
    },
  };
}

function readHistory(database: AppDatabase, sessionId: string): AgentProviderInput["history"] {
  const rows = database
    .prepare(
      `SELECT role, content_text FROM (
         SELECT id, role, content_text, created_at
         FROM agent_messages
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 20
       ) ORDER BY created_at, id`,
    )
    .all(sessionId) as Array<{ role: "user" | "assistant"; content_text: string }>;
  return rows.map((row) => ({ role: row.role, message: row.content_text }));
}

function insertMessage(
  database: AppDatabase,
  sessionId: string,
  role: "user" | "assistant",
  kind: "message" | "clarification" | "proposal" | "result",
  content: string,
  createdAt: string,
): void {
  database
    .prepare(
      `INSERT INTO agent_messages (id, session_id, role, kind, content_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), sessionId, role, kind, content, createdAt);
  database.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run(createdAt, sessionId);
}

function isFamilyAdmin(membership: Membership): boolean {
  return membership.role === "owner" || membership.role === "admin";
}

function requireActionPermission(membership: Membership, action: AgentAction): void {
  if (
    action.type === "CREATE_RECONNECTION_PLAN" ||
    action.type === "CREATE_GATHERING_DRAFT" ||
    action.type === "CREATE_NOTE_MEMORY"
  ) {
    return;
  }
  if (action.type === "UPDATE_MEMBER") {
    if (isFamilyAdmin(membership) || membership.linkedMemberId === action.payload.memberId) return;
    throw new HttpError(403, "INSUFFICIENT_ROLE", "You may update only your own linked family profile.");
  }
  if (
    action.type === "PREPARE_INVITATION_LINKS" ||
    action.type === "DELETE_MEMORY" ||
    action.type === "UPDATE_PLAN_STATUS"
  ) {
    // Entity-specific creator/admin permissions are validated against the
    // permitted context now and revalidated by the shared command on confirm.
    return;
  }
  requireFamilyAdmin(membership);
}

function storedProposalAction(proposal: ActionProposalRow): AgentAction {
  let raw: unknown;
  try {
    raw = JSON.parse(proposal.payload_json);
  } catch {
    throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
  }
  if (proposal.action_type === "UPDATE_MEMBER") {
    const stored = storedUpdateMemberProposalSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "UPDATE_MEMBER", payload: stored.data.payload };
  }
  if (proposal.action_type === "DELETE_MEMBER") {
    const stored = storedDeleteMemberProposalSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "DELETE_MEMBER", payload: stored.data.payload };
  }
  if (proposal.action_type === "ADD_MEMBER") {
    const stored = storedAddMemberProposalSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "ADD_MEMBER", payload: stored.data.member };
  }
  if (proposal.action_type === "CREATE_RECONNECTION_PLAN") {
    const stored = storedReconnectionProposalSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "CREATE_RECONNECTION_PLAN", payload: stored.data.plan };
  }
  if (proposal.action_type === "PREPARE_INVITATION_LINKS") {
    const stored = storedPrepareInvitationLinksPayloadSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "PREPARE_INVITATION_LINKS", payload: stored.data.payload };
  }
  if (proposal.action_type === "COMPLETE_GATHERING") {
    const stored = storedCompleteGatheringPayloadSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "COMPLETE_GATHERING", payload: stored.data.payload };
  }
  if (proposal.action_type === "DELETE_MEMORY") {
    const stored = storedDeleteMemoryPayloadSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "DELETE_MEMORY", payload: stored.data.payload };
  }
  if (proposal.action_type === "UPDATE_PLAN_STATUS") {
    const stored = storedUpdatePlanStatusPayloadSchema.safeParse(raw);
    if (!stored.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
    return { type: "UPDATE_PLAN_STATUS", payload: stored.data.payload };
  }
  const parsed = agentActionSchema.safeParse({ type: proposal.action_type, payload: raw });
  if (!parsed.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
  return parsed.data;
}

function requirePermittedMember(family: AgentFamilyContext, memberId: string): AgentFamilyMemberContext {
  const member = family.members.find((candidate) => candidate.id === memberId);
  if (!member) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an invalid family member.");
  }
  return member;
}

function getRelationshipForFamily(
  database: AppDatabase,
  familyId: string,
  relationshipId: string,
): { id: string; family_id: string; source_member_id: string; target_member_id: string; type: z.infer<typeof relationshipTypeSchema> } {
  const relationship = database
    .prepare("SELECT * FROM relationships WHERE family_id = ? AND id = ?")
    .get(familyId, relationshipId) as
    | { id: string; family_id: string; source_member_id: string; target_member_id: string; type: z.infer<typeof relationshipTypeSchema> }
    | undefined;
  if (!relationship) {
    throw new HttpError(409, "RELATIONSHIP_CHANGED", "That family relationship no longer exists.");
  }
  return relationship;
}

type RequiredRequesterRelationship = z.infer<typeof requiredRequesterRelationshipSchema>;

function explicitFirstPersonRelationship(request: string):
  | Omit<RequiredRequesterRelationship, "requesterMemberId">
  | "ambiguous"
  | undefined {
  const matches = [...request.matchAll(/\bmy\s+(brother|sister|parent|mother|father|child|son|daughter|spouse|wife|husband)\b/gi)];
  const terms = matches
    .filter((match) => {
      const start = match.index ?? 0;
      const before = request.slice(Math.max(0, start - 12), start);
      const after = request.slice(start + match[0].length);
      // "my father's brother" and "brother of my father" describe a
      // different person. They are not direct first-person relationships for
      // the member being added.
      const negated = /\b(?:not|isn['\u2019]?t|is not)\s*$/i.test(before) || /^\s*(?:-|in\s+law\b)/i.test(after);
      const contrasted = /\b(?:but|rather than|instead of)\b/i.test(request);
      const multipleLinks = /\b(?:and|also)\s+(?:my|his|her|their)\b/i.test(request);
      return (
        !negated &&
        !contrasted &&
        !multipleLinks &&
        !/\bof\s*$/i.test(before) &&
        !/^(?:['\u2019]s\b|\s+[\w-]+['\u2019]s\b)/i.test(after)
      );
    })
    .map((match) => match[1].toLowerCase() as RequiredRequesterRelationship["requestedAs"]);
  if (terms.length === 0) return undefined;
  const relationships = terms.map((requestedAs) => {
    if (requestedAs === "brother" || requestedAs === "sister") {
      return { requestedAs, type: "sibling" as const, direction: "new_to_existing" as const };
    }
    if (requestedAs === "parent" || requestedAs === "mother" || requestedAs === "father") {
      return { requestedAs, type: "parent" as const, direction: "new_to_existing" as const };
    }
    if (requestedAs === "child" || requestedAs === "son" || requestedAs === "daughter") {
      return { requestedAs, type: "parent" as const, direction: "existing_to_new" as const };
    }
    return { requestedAs, type: "spouse" as const, direction: "new_to_existing" as const };
  });
  const meanings = new Set(relationships.map((relationship) => `${relationship.type}:${relationship.direction}`));
  return meanings.size === 1 ? relationships[0] : "ambiguous";
}

function enforceFirstPersonAddRelationship(
  request: string,
  family: AgentFamilyContext,
  payload: AddMemberPayload,
): { payload: AddMemberPayload; required?: RequiredRequesterRelationship; clarification?: string } {
  const explicit = explicitFirstPersonRelationship(request);
  if (!explicit) return { payload };
  if (explicit === "ambiguous") {
    return { payload, clarification: `Please clarify how ${payload.displayName} is related to you.` };
  }
  if (!family.requester.linkedMemberId) {
    return {
      payload,
      clarification: "Your account is not linked to a family-map profile, so I cannot safely interpret a first-person relationship.",
    };
  }
  requirePermittedMember(family, family.requester.linkedMemberId);
  const required: RequiredRequesterRelationship = {
    requesterMemberId: family.requester.linkedMemberId,
    ...explicit,
  };
  // Ground the requester's link in deterministic server logic, never in a
  // model-selected target/type. Preserve other explicit initial links (for
  // example, a co-parent) so the same atomic graph write remains available as
  // the manual form. Any model-proposed link to the requester is replaced.
  const explicitlyNamedMemberIds = new Set(
    family.members
      .filter((member) => member.id !== required.requesterMemberId)
      .filter((member) => {
        const escapedName = member.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?<![\\p{L}\\p{N}])${escapedName}(?![\\p{L}\\p{N}])`, "iu").test(request);
      })
      .map((member) => member.id),
  );
  const otherRelationships = payload.relationships.filter(
    (relationship) =>
      relationship.existingMemberId !== required.requesterMemberId &&
      explicitlyNamedMemberIds.has(relationship.existingMemberId),
  );
  if (otherRelationships.length >= 8) {
    return {
      payload,
      clarification: "This request has more than eight initial family connections. Please choose up to eight connections for the new profile.",
    };
  }
  return {
    payload: {
      ...payload,
      relationships: [{
        existingMemberId: required.requesterMemberId,
        type: required.type,
        direction: required.direction,
      }, ...otherRelationships],
    },
    required,
  };
}

function assertStoredFirstPersonRelationship(
  membership: Membership,
  stored: z.infer<typeof storedAddMemberProposalSchema>,
): void {
  const required = stored.requiredRequesterRelationship;
  if (!required) return;
  if (membership.linkedMemberId !== required.requesterMemberId) {
    throw new HttpError(
      409,
      "REQUESTER_LINK_CHANGED",
      "Your linked family profile changed after this proposal was prepared. Ask the agent to prepare it again.",
    );
  }
  const requesterRelationships = stored.member.relationships.filter(
    (relationship) => relationship.existingMemberId === required.requesterMemberId,
  );
  const expected = requesterRelationships.filter(
    (relationship) =>
      relationship.type === required.type &&
      relationship.direction === required.direction,
  );
  if (requesterRelationships.length !== 1 || expected.length !== 1) {
    throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored first-person relationship is invalid.");
  }
}

function clarificationForAddMemberProposal(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: AddMemberPayload,
): string | undefined {
  const permittedMemberIds = new Set(family.members.map((member) => member.id));
  if (payload.relationships.some((relationship) => !permittedMemberIds.has(relationship.existingMemberId))) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an invalid family member.");
  }

  const duplicate = findDuplicateMember(database, family.id, payload);
  if (duplicate) {
    return "A matching family profile or email already exists. Do you want to update the existing profile, or verify the new person's details?";
  }
  if (family.members.length > 0 && payload.relationships.length === 0) {
    return `How is ${payload.displayName} related to an existing family member? Please include the relative's name and relationship.`;
  }
  return undefined;
}

const judgmentalPlanLanguage = [
  /\b(negligent|neglectful|uncaring|selfish|toxic|dysfunctional|estranged|isolated|lonely)\b/i,
  /\b(doesn'?t care|do not care|does not care|never makes an effort|avoids? (?:the )?family)\b/i,
  /\b(depressed|anxious|emotionally unhealthy|mental(?:ly)? ill)\b/i,
  /\b(absent|distant|disconnected)\b/i,
];

function validateReconnectionPlanProposal(
  family: AgentFamilyContext,
  payload: ReconnectionPlanPayload,
): { evidenceSignals: AgentEvidenceSignal[]; activity?: AgentSampleActivityContext } {
  const permittedMemberIds = new Set(family.members.map((member) => member.id));
  if (payload.suggestedMemberIds.some((memberId) => !permittedMemberIds.has(memberId))) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an invalid family member.");
  }

  const evidenceById = new Map(family.engagement.evidenceSignals.map((signal) => [signal.id, signal]));
  const evidenceSignals = payload.evidenceSignalIds.map((signalId) => evidenceById.get(signalId));
  if (evidenceSignals.some((signal) => !signal)) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced unsupported evidence.");
  }

  const activity = payload.suggestedActivityId
    ? family.engagement.sampleActivities.find((candidate) => candidate.id === payload.suggestedActivityId)
    : undefined;
  if (payload.suggestedActivityId && !activity) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an invalid sample activity.");
  }

  const generatedText = [
    payload.title,
    payload.rationale,
    payload.suggestedGathering.purpose,
    payload.suggestedGathering.timingGuidance,
    payload.suggestedGathering.locationGuidance,
    payload.suggestedGathering.accessibilityNotes,
    payload.rewardChallenge,
  ]
    .filter(Boolean)
    .join(" ");
  if (judgmentalPlanLanguage.some((pattern) => pattern.test(generatedText))) {
    throw new HttpError(
      502,
      "AGENT_UNSAFE_PLAN_LANGUAGE",
      "The AI provider returned judgmental or sensitive inferences. No proposal was saved.",
    );
  }

  return { evidenceSignals: evidenceSignals as AgentEvidenceSignal[], ...(activity ? { activity } : {}) };
}

function reconnectionPlanClarification(
  family: AgentFamilyContext,
  payload: ReconnectionPlanPayload,
): string | undefined {
  if (family.members.length < 2) {
    return "Please add at least one relative to the family map before I prepare a reconnection plan.";
  }
  if (
    family.requester.linkedMemberId &&
    payload.suggestedMemberIds.every((memberId) => memberId === family.requester.linkedMemberId)
  ) {
    return "Which other family member would you like the plan to include?";
  }
  return undefined;
}

function addMemberProposalPresentation(payload: AddMemberPayload, family: AgentFamilyContext) {
  const relationshipCount = payload.relationships.length;
  const locationLabel = [payload.location?.city, payload.location?.emirate].filter(Boolean).join(", ");
  const memberNames = new Map(family.members.map((member) => [member.id, member.displayName]));
  return {
    title: `Add ${payload.displayName} to the family`,
    summary: `Create one family member with ${relationshipCount} relationship${relationshipCount === 1 ? "" : "s"}${
      locationLabel ? ` and an approximate location of ${locationLabel}` : ""
    }.`,
    details: {
      name: payload.displayName,
      ...(payload.birthDate ? { birthDate: payload.birthDate } : {}),
      ...(payload.phone ? { phone: payload.phone } : {}),
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.interests.length ? { interests: payload.interests } : {}),
      ...(payload.notes ? { notes: payload.notes } : {}),
      relationships: payload.relationships.map((relationship) => ({
        existingMember: memberNames.get(relationship.existingMemberId) ?? "Unknown member",
        type: relationship.type,
        direction: relationship.direction,
      })),
      ...(locationLabel ? { approximateLocation: locationLabel, locationVisibility: "Family administrators" } : {}),
    },
    warnings: [
      "No family data changes until you confirm.",
      ...(payload.location
        ? ["This location is reported by an administrator, approximate, and visible only to family administrators."]
        : []),
    ],
  };
}

function assertUpdateDoesNotDuplicate(
  database: AppDatabase,
  familyId: string,
  memberId: string,
  changes: UpdateMemberPayload["changes"],
): void {
  const member = getMemberRow(database, familyId, memberId);
  if (changes.email === undefined && changes.displayName === undefined && changes.birthDate === undefined) return;
  const nextEmail = changes.email === undefined ? member.email : changes.email;
  const nextBirthDate = changes.birthDate === undefined ? member.birth_date : changes.birthDate;
  const duplicate = findDuplicateMember(
    database,
    familyId,
    {
      displayName: changes.displayName ?? member.display_name,
      birthDate: nextBirthDate,
      email: nextEmail,
    },
    memberId,
  );
  if (duplicate) throw new HttpError(409, "MEMBER_EXISTS", "A matching family member already exists.");
}

function validateUpdateMemberProposal(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: UpdateMemberPayload,
): AgentFamilyMemberContext {
  const member = requirePermittedMember(family, payload.memberId);
  if (!member.canUpdate) {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "You may update only your own linked family profile.");
  }
  assertUpdateDoesNotDuplicate(database, family.id, payload.memberId, payload.changes);
  return member;
}

function updateMemberProposalPresentation(payload: UpdateMemberPayload, member: AgentFamilyMemberContext) {
  return {
    title: `Update ${member.displayName}`,
    summary: `Change ${Object.keys(payload.changes).join(", ")} on ${member.displayName}'s family profile.`,
    details: {
      member: member.displayName,
      memberId: member.id,
      changes: payload.changes,
    },
    warnings: ["No profile data changes until you confirm.", "Only the fields shown here will be changed."],
  };
}

function validateDeleteMemberProposal(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: DeleteMemberPayload,
): AgentFamilyMemberContext {
  const member = requirePermittedMember(family, payload.memberId);
  const stored = getMemberRow(database, family.id, payload.memberId);
  if (stored.user_id || database.prepare("SELECT 1 FROM family_users WHERE linked_member_id = ? LIMIT 1").get(payload.memberId)) {
    throw new HttpError(409, "MEMBER_HAS_ACCOUNT", "A member linked to a user account cannot be deleted.");
  }
  if (!member.canDelete) {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "A family owner or administrator is required.");
  }
  return member;
}

function deleteMemberSnapshot(database: AppDatabase, familyId: string, memberId: string) {
  const member = getMemberRow(database, familyId, memberId);
  const relationshipIds = (
    database
      .prepare(
        `SELECT id FROM relationships
         WHERE family_id = ? AND (source_member_id = ? OR target_member_id = ?)
         ORDER BY id`,
      )
      .all(familyId, memberId, memberId) as Array<{ id: string }>
  ).map((row) => row.id);
  const invitationVersions = (
    database
      .prepare(
        `SELECT gi.id, gi.gathering_id, gi.status, gi.updated_at
         FROM gathering_invitations gi JOIN gatherings g ON g.id = gi.gathering_id
         WHERE g.family_id = ? AND gi.member_id = ? ORDER BY gi.id`,
      )
      .all(familyId, memberId) as Array<{
        id: string;
        gathering_id: string;
        status: "pending" | "going" | "maybe" | "declined";
        updated_at: string;
      }>
  ).map((row) => `${row.id}:${row.gathering_id}:${row.status}:${row.updated_at}`);
  const locationConsentIds = (
    database
      .prepare("SELECT id FROM location_consents WHERE family_id = ? AND member_id = ? ORDER BY id")
      .all(familyId, memberId) as Array<{ id: string }>
  ).map((row) => row.id);
  const locationVersions = (
    database
      .prepare("SELECT id, updated_at FROM member_locations WHERE family_id = ? AND member_id = ? ORDER BY id")
      .all(familyId, memberId) as Array<{ id: string; updated_at: string }>
  ).map((row) => `${row.id}:${row.updated_at}`);
  const memoryViewerKeys = (
    database
      .prepare("SELECT memory_id FROM memory_viewers WHERE member_id = ? ORDER BY memory_id")
      .all(memberId) as Array<{ memory_id: string }>
  ).map((row) => `${row.memory_id}:${memberId}`);
  return {
    displayName: member.display_name,
    updatedAt: member.updated_at,
    relationshipIds,
    invitationVersions,
    locationConsentIds,
    locationVersions,
    memoryViewerKeys,
  };
}

function invitationSnapshot(database: AppDatabase, gatheringId: string, memberIds: string[]) {
  return memberIds.map((memberId) => {
    const row = database
      .prepare(
        "SELECT id, status, updated_at FROM gathering_invitations WHERE gathering_id = ? AND member_id = ?",
      )
      .get(gatheringId, memberId) as
      | { id: string; status: "pending" | "going" | "maybe" | "declined"; updated_at: string }
      | undefined;
    return {
      memberId,
      invitationId: row?.id ?? null,
      status: row?.status ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

function gatheringCompletionSnapshot(database: AppDatabase, gatheringId: string) {
  const gathering = database
    .prepare("SELECT status, start_at, updated_at FROM gatherings WHERE id = ?")
    .get(gatheringId) as
    | {
        status: "draft" | "inviting" | "completed" | "cancelled";
        start_at: string;
        updated_at: string;
      }
    | undefined;
  if (!gathering) throw new HttpError(404, "GATHERING_NOT_FOUND", "Gathering not found.");
  const invitations = database
    .prepare(
      `SELECT id, member_id, status, updated_at FROM gathering_invitations
       WHERE gathering_id = ? ORDER BY id`,
    )
    .all(gatheringId) as Array<{
    id: string;
    member_id: string;
    status: "pending" | "going" | "maybe" | "declined";
    updated_at: string;
  }>;
  return {
    status: gathering.status,
    startAt: gathering.start_at,
    updatedAt: gathering.updated_at,
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      memberId: invitation.member_id,
      status: invitation.status,
      updatedAt: invitation.updated_at,
    })),
  };
}

function memorySnapshot(database: AppDatabase, memoryId: string) {
  const row = database
    .prepare("SELECT title, memory_type, visibility, updated_at, storage_path FROM memories WHERE id = ?")
    .get(memoryId) as
    | {
        title: string;
        memory_type: "note" | "photo" | "video" | "audio";
        visibility: "private" | "family_admin" | "family" | "selected";
        updated_at: string;
        storage_path: string | null;
      }
    | undefined;
  if (!row) throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found.");
  return {
    title: row.title,
    memoryType: row.memory_type,
    visibility: row.visibility,
    updatedAt: row.updated_at,
    hasMedia: Boolean(row.storage_path),
  };
}

function planStatusSnapshot(database: AppDatabase, planId: string) {
  const row = database
    .prepare("SELECT status, updated_at FROM reconnection_plans WHERE id = ?")
    .get(planId) as
    | { status: "active" | "accepted" | "dismissed" | "completed"; updated_at: string }
    | undefined;
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Reconnection plan not found.");
  return { expectedStatus: row.status, expectedUpdatedAt: row.updated_at };
}

function assertSnapshotMatches(current: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new HttpError(409, "PROPOSAL_TARGET_CHANGED", message);
  }
}

function assertDeleteMemberSnapshotCurrent(
  database: AppDatabase,
  familyId: string,
  memberId: string,
  expected: z.infer<typeof storedDeleteMemberProposalSchema>["snapshot"],
): void {
  const current = deleteMemberSnapshot(database, familyId, memberId);
  assertSnapshotMatches(
    current,
    expected,
    "This family profile or its connected records changed after the preview. Ask the agent for a new proposal.",
  );
}

function deleteMemberProposalPresentation(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: DeleteMemberPayload,
  member: AgentFamilyMemberContext,
) {
  const relationshipCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM relationships
         WHERE family_id = ? AND (source_member_id = ? OR target_member_id = ?)`,
      )
      .get(family.id, payload.memberId, payload.memberId) as { count: number }
  ).count;
  const invitationCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM gathering_invitations gi
         JOIN gatherings g ON g.id = gi.gathering_id
         WHERE g.family_id = ? AND gi.member_id = ?`,
      )
      .get(family.id, payload.memberId) as { count: number }
  ).count;
  return {
    title: `Remove ${member.displayName} from the family`,
    summary: `Permanently delete ${member.displayName}'s unlinked family profile.`,
    details: {
      member: member.displayName,
      memberId: member.id,
      connectedRelationshipsRemoved: Number(relationshipCount),
      gatheringInvitationsRemoved: Number(invitationCount),
    },
    warnings: [
      "Destructive action: confirmation permanently deletes this family profile.",
      "Connected relationships, locations, gathering invitations, and selected-memory access records are also removed.",
      "This cannot be undone from the app.",
    ],
  };
}

function validateCreateRelationshipProposal(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: CreateRelationshipPayload,
): { source: AgentFamilyMemberContext; target: AgentFamilyMemberContext } {
  const source = requirePermittedMember(family, payload.sourceMemberId);
  const target = requirePermittedMember(family, payload.targetMemberId);
  ensureRelationshipIsValid(database, family.id, payload.sourceMemberId, payload.targetMemberId, payload.type);
  return { source, target };
}

function createRelationshipProposalPresentation(
  payload: CreateRelationshipPayload,
  members: { source: AgentFamilyMemberContext; target: AgentFamilyMemberContext },
) {
  const directional = payload.type === "parent" || payload.type === "guardian";
  return {
    title: `Connect ${members.source.displayName} and ${members.target.displayName}`,
    summary: directional
      ? `Record ${members.source.displayName} as ${payload.type} of ${members.target.displayName}.`
      : `Record a ${payload.type} connection between ${members.source.displayName} and ${members.target.displayName}.`,
    details: {
      sourceMember: members.source.displayName,
      sourceMemberId: members.source.id,
      targetMember: members.target.displayName,
      targetMemberId: members.target.id,
      type: payload.type,
      ...(directional ? { direction: `${members.source.displayName} → ${members.target.displayName}` } : {}),
    },
    warnings: ["No family relationship changes until you confirm."],
  };
}

function validateDeleteRelationshipProposal(
  database: AppDatabase,
  family: AgentFamilyContext,
  payload: DeleteRelationshipPayload,
) {
  const permitted = family.relationships.find((relationship) => relationship.id === payload.relationshipId);
  if (!permitted) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an invalid family relationship.");
  }
  getRelationshipForFamily(database, family.id, payload.relationshipId);
  return {
    relationship: permitted,
    source: requirePermittedMember(family, permitted.sourceMemberId),
    target: requirePermittedMember(family, permitted.targetMemberId),
  };
}

function deleteRelationshipProposalPresentation(
  payload: DeleteRelationshipPayload,
  validated: ReturnType<typeof validateDeleteRelationshipProposal>,
) {
  return {
    title: `Remove the ${validated.relationship.type} connection`,
    summary: `Remove the recorded ${validated.relationship.type} connection between ${validated.source.displayName} and ${validated.target.displayName}.`,
    details: {
      relationshipId: payload.relationshipId,
      sourceMember: validated.source.displayName,
      targetMember: validated.target.displayName,
      type: validated.relationship.type,
    },
    warnings: [
      "Destructive action: confirmation removes this relationship from the family graph.",
      "Neither family member profile will be deleted.",
    ],
  };
}

function reconnectionPlanProposalPresentation(
  payload: ReconnectionPlanPayload,
  family: AgentFamilyContext,
  validated: { evidenceSignals: AgentEvidenceSignal[]; activity?: AgentSampleActivityContext },
) {
  const memberNames = new Map(family.members.map((member) => [member.id, member.displayName]));
  return {
    title: payload.title,
    summary: payload.rationale,
    details: {
      familyMembers: payload.suggestedMemberIds.map((memberId) => memberNames.get(memberId) ?? "Unknown member"),
      evidence: validated.evidenceSignals.map((signal) => ({ label: signal.label, value: signal.value })),
      gatheringStructure: payload.suggestedGathering,
      ...(validated.activity
        ? {
            sampleActivity: {
              title: validated.activity.title,
              emirate: validated.activity.emirate,
              sampleData: true,
            },
          }
        : {}),
      rewardChallenge: payload.rewardChallenge,
    },
    warnings: [
      "No plan or family data changes until you confirm.",
      "Confirming stores this plan only. It does not create a gathering, send invitations, or award points.",
      "The evidence is incomplete administrative data and does not measure feelings, closeness, or intent.",
      ...(validated.activity ? ["The suggested activity is sample data and must be verified before visiting."] : []),
    ],
  };
}

function requireGatheringContext(
  family: AgentFamilyContext,
  gatheringId: string,
): AgentGatheringContext {
  const gathering = family.engagement.gatherings.find((candidate) => candidate.id === gatheringId);
  if (!gathering) throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an unavailable gathering.");
  return gathering;
}

function createGatheringDraftPresentation(payload: CreateGatheringDraftPayload) {
  return {
    title: `Create draft: ${payload.title}`,
    summary: `Create an unsent ${payload.type} gathering draft for ${payload.startAt}.`,
    details: {
      title: payload.title,
      purpose: payload.purpose,
      startAt: payload.startAt,
      timezone: payload.timezone,
      locationName: payload.locationName,
      type: payload.type,
      ...(payload.notes ? { notes: payload.notes } : {}),
    },
    warnings: [
      "No gathering is created until you confirm.",
      "Confirming creates a draft only; it does not prepare links, contact anyone, or award points.",
    ],
  };
}

function prepareInvitationLinksPresentation(
  payload: PrepareInvitationLinksPayload,
  family: AgentFamilyContext,
) {
  const gathering = requireGatheringContext(family, payload.gatheringId);
  if (!gathering.canPrepareInvitations) {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "Only the gathering creator or a family administrator may prepare links.");
  }
  if (gathering.status === "completed" || gathering.status === "cancelled") {
    throw new HttpError(409, "GATHERING_CLOSED", "Invitations cannot be prepared for a closed gathering.");
  }
  const invitees = payload.memberIds.map((memberId) => requirePermittedMember(family, memberId));
  return {
    title: `Prepare invitation links for ${gathering.title}`,
    summary: `Prepare ${payload.channel === "whatsapp" ? "WhatsApp-ready" : "share"} links for ${invitees.length} invitee${invitees.length === 1 ? "" : "s"}.`,
    details: { gathering: gathering.title, invitees: invitees.map((member) => member.displayName), channel: payload.channel },
    warnings: [
      "No links are created until you confirm; the app will not contact anyone automatically.",
      "Security warning: confirmation creates new private RSVP capability links and invalidates any existing links for these invitees.",
      "Each selected invitee's RSVP is reset to Pending. New links appear only in the immediate confirmation result and are not stored in the AI transcript, proposal, or audit log.",
    ],
  };
}

function completeGatheringPresentation(payload: CompleteGatheringPayload, family: AgentFamilyContext) {
  const gathering = requireGatheringContext(family, payload.gatheringId);
  if (!gathering.canComplete) {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "Only a family administrator may complete an eligible gathering.");
  }
  const goingIds = new Set(
    gathering.invitationStatuses.filter((invitation) => invitation.status === "going").map((invitation) => invitation.memberId),
  );
  if (payload.confirmAttendeeMemberIds.some((memberId) => !goingIds.has(memberId))) {
    throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider included an attendee without a Going RSVP.");
  }
  const attendees = payload.confirmAttendeeMemberIds.map((memberId) => requirePermittedMember(family, memberId));
  return {
    title: `Complete ${gathering.title}`,
    summary: `Permanently record ${attendees.length} confirmed attendees and mark the gathering completed.`,
    details: { gathering: gathering.title, confirmedAttendees: attendees.map((member) => member.displayName) },
    warnings: [
      "Attendance warning: confirmation permanently marks this gathering completed using exactly the people shown.",
      "Reward warning: confirmation may award 500 completion points and 300 elder-inclusion points; ledger entries are deduplicated and are not reversed by later record deletion.",
      "Invitations close after completion.",
    ],
  };
}

function createNoteMemoryPresentation(payload: CreateNoteMemoryPayload, family: AgentFamilyContext) {
  const gathering = requireGatheringContext(family, payload.gatheringId);
  if (gathering.status !== "completed") {
    throw new HttpError(409, "GATHERING_NOT_COMPLETED", "Complete the gathering before adding a memory.");
  }
  const viewers = payload.selectedMemberIds.map((memberId) => requirePermittedMember(family, memberId));
  return {
    title: `Save written memory: ${payload.title}`,
    summary: `Save a written memory for ${gathering.title} with ${payload.visibility} visibility.`,
    details: {
      gathering: gathering.title,
      title: payload.title,
      note: payload.note,
      visibility: payload.visibility,
      ...(viewers.length ? { selectedViewers: viewers.map((member) => member.displayName) } : {}),
      capturedAt: payload.capturedAt,
      aiProcessingAllowed: false,
    },
    warnings: [
      "No memory is saved until you confirm.",
      "This creates a written note only—no media is uploaded—and AI processing remains disabled.",
      "A deduplicated 150-point memory reward may be awarded for this gathering.",
    ],
  };
}

function deleteMemoryPresentation(payload: DeleteMemoryPayload, family: AgentFamilyContext) {
  const memory = family.engagement.memories.find((candidate) => candidate.id === payload.memoryId);
  if (!memory) throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an unavailable memory.");
  if (!memory.canDelete) {
    throw new HttpError(403, "MEMORY_OWNER_REQUIRED", "Only the memory creator or a family administrator can delete it.");
  }
  return {
    title: `Permanently delete ${memory.title}`,
    summary: `Permanently delete this ${memory.memoryType} memory record.`,
    details: { title: memory.title, memoryType: memory.memoryType, visibility: memory.visibility },
    warnings: [
      "Destructive action: confirmation permanently deletes this memory record and any attached media.",
      "This cannot be undone from the app, and previously awarded reward points are not reversed.",
    ],
  };
}

function updatePlanStatusPresentation(payload: UpdatePlanStatusPayload, family: AgentFamilyContext) {
  const plan = family.engagement.plans.find((candidate) => candidate.id === payload.planId);
  if (!plan) throw new HttpError(502, "AGENT_INVALID_ACTION", "The AI provider referenced an unavailable plan.");
  if (!plan.canUpdate) {
    throw new HttpError(403, "PLAN_OWNER_REQUIRED", "Only the plan creator or a family administrator can update it.");
  }
  return {
    title: `Mark ${plan.title} ${payload.status}`,
    summary: `Change the plan status from ${plan.status} to ${payload.status}.`,
    details: { plan: plan.title, currentStatus: plan.status, newStatus: payload.status },
    warnings: ["No plan changes until you confirm.", "This changes the plan status only; it creates no gathering or reward."],
  };
}

function applyAddMember(
  database: AppDatabase,
  proposal: ActionProposalRow,
  stored: z.infer<typeof storedAddMemberProposalSchema>,
  actorUserId: string,
  now: Date,
  membership: Membership,
): { memberId: string; message: string } {
  assertStoredFirstPersonRelationship(membership, stored);
  const payload = stored.member;
  const timestamp = now.toISOString();
  const memberId = randomUUID();

  const duplicate = findDuplicateMember(database, proposal.family_id, payload);
  if (duplicate) {
    throw new HttpError(409, "MEMBER_EXISTS", "A matching family member already exists.");
  }

  for (const relationship of payload.relationships) {
    getMemberRow(database, proposal.family_id, relationship.existingMemberId);
  }

  database
    .prepare(
      `INSERT INTO family_members
       (id, family_id, user_id, display_name, birth_date, phone, email, interests_json, notes, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      memberId,
      proposal.family_id,
      payload.displayName,
      payload.birthDate ?? null,
      payload.phone ?? null,
      payload.email ?? null,
      JSON.stringify(payload.interests),
      payload.notes ?? null,
      timestamp,
      timestamp,
    );

  for (const relationship of payload.relationships) {
    const newMemberIsSource = relationship.direction === "new_to_existing";
    insertRelationship(
      database,
      proposal.family_id,
      newMemberIsSource ? memberId : relationship.existingMemberId,
      newMemberIsSource ? relationship.existingMemberId : memberId,
      relationship.type,
    );
  }

  if (payload.location) {
    const consentId = randomUUID();
    const locationId = randomUUID();
    const precision = payload.location.city ? "city" : "emirate";
    database
      .prepare(
        `INSERT INTO location_consents
         (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
         VALUES (?, ?, ?, ?, 'admin_reported', ?, 'family_admin', ?)`,
      )
      .run(consentId, proposal.family_id, memberId, actorUserId, precision, timestamp);
    database
      .prepare(
        `INSERT INTO member_locations
         (id, family_id, member_id, consent_id, source, precision, visibility,
          latitude, longitude, accuracy_m, emirate, city, captured_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', ?, 'family_admin', NULL, NULL, NULL, ?, ?, ?, NULL, ?)`,
      )
      .run(
        locationId,
        proposal.family_id,
        memberId,
        consentId,
        precision,
        payload.location.emirate ?? null,
        payload.location.city ?? null,
        timestamp,
        timestamp,
      );
  }

  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.add_member.confirmed",
    entityType: "family_member",
    entityId: memberId,
    details: {
      proposalId: proposal.id,
      relationshipCount: payload.relationships.length,
      locationPrecision: payload.location ? (payload.location.city ? "city" : "emirate") : null,
    },
  });

  return { memberId, message: `${payload.displayName} was added to the family map.` };
}

function applyUpdateMember(
  database: AppDatabase,
  proposal: ActionProposalRow,
  payload: UpdateMemberPayload,
  actorUserId: string,
  now: Date,
): { memberId: string; message: string } {
  const member = getMemberRow(database, proposal.family_id, payload.memberId);
  assertUpdateDoesNotDuplicate(database, proposal.family_id, payload.memberId, payload.changes);
  const columns: Record<string, unknown> = {};
  if (payload.changes.displayName !== undefined) columns.display_name = payload.changes.displayName;
  if (payload.changes.birthDate !== undefined) columns.birth_date = payload.changes.birthDate;
  if (payload.changes.phone !== undefined) columns.phone = payload.changes.phone;
  if (payload.changes.email !== undefined) columns.email = payload.changes.email;
  if (payload.changes.interests !== undefined) columns.interests_json = JSON.stringify(payload.changes.interests);
  if (payload.changes.notes !== undefined) columns.notes = payload.changes.notes;
  columns.updated_at = now.toISOString();
  database
    .prepare(`UPDATE family_members SET ${Object.keys(columns).map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
    .run(...Object.values(columns), payload.memberId);
  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.update_member.confirmed",
    entityType: "family_member",
    entityId: payload.memberId,
    details: { proposalId: proposal.id, changedFields: Object.keys(payload.changes) },
  });
  return {
    memberId: payload.memberId,
    message: `${payload.changes.displayName ?? member.display_name}'s family profile was updated.`,
  };
}

function applyDeleteMember(
  database: AppDatabase,
  proposal: ActionProposalRow,
  payload: DeleteMemberPayload,
  actorUserId: string,
): { memberId: string; message: string } {
  const member = getMemberRow(database, proposal.family_id, payload.memberId);
  if (member.user_id || database.prepare("SELECT 1 FROM family_users WHERE linked_member_id = ? LIMIT 1").get(payload.memberId)) {
    throw new HttpError(409, "MEMBER_HAS_ACCOUNT", "A member linked to a user account cannot be deleted.");
  }
  database.prepare("DELETE FROM family_members WHERE family_id = ? AND id = ?").run(proposal.family_id, payload.memberId);
  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.delete_member.confirmed",
    entityType: "family_member",
    entityId: payload.memberId,
    details: { proposalId: proposal.id, displayName: member.display_name },
  });
  return { memberId: payload.memberId, message: `${member.display_name} was removed from the family map.` };
}

function applyCreateRelationship(
  database: AppDatabase,
  proposal: ActionProposalRow,
  payload: CreateRelationshipPayload,
  actorUserId: string,
): { relationshipId: string; message: string } {
  const source = getMemberRow(database, proposal.family_id, payload.sourceMemberId);
  const target = getMemberRow(database, proposal.family_id, payload.targetMemberId);
  const relationship = insertRelationship(
    database,
    proposal.family_id,
    payload.sourceMemberId,
    payload.targetMemberId,
    payload.type,
  );
  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.create_relationship.confirmed",
    entityType: "relationship",
    entityId: relationship.id,
    details: { proposalId: proposal.id, type: payload.type },
  });
  return {
    relationshipId: relationship.id,
    message: `The ${payload.type} connection between ${source.display_name} and ${target.display_name} was added.`,
  };
}

function applyDeleteRelationship(
  database: AppDatabase,
  proposal: ActionProposalRow,
  payload: DeleteRelationshipPayload,
  actorUserId: string,
): { relationshipId: string; message: string } {
  const relationship = getRelationshipForFamily(database, proposal.family_id, payload.relationshipId);
  database.prepare("DELETE FROM relationships WHERE family_id = ? AND id = ?").run(proposal.family_id, payload.relationshipId);
  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.delete_relationship.confirmed",
    entityType: "relationship",
    entityId: payload.relationshipId,
    details: { proposalId: proposal.id, type: relationship.type },
  });
  return {
    relationshipId: payload.relationshipId,
    message: `The ${relationship.type} connection was removed from the family graph.`,
  };
}

function applyReconnectionPlan(
  database: AppDatabase,
  proposal: ActionProposalRow,
  stored: z.infer<typeof storedReconnectionProposalSchema>,
  actorUserId: string,
): { planId: string; message: string } {
  const payload = stored.plan;
  payload.suggestedMemberIds.forEach((memberId) => getMemberRow(database, proposal.family_id, memberId));

  if (payload.suggestedActivityId) {
    const activity = database
      .prepare("SELECT id FROM activities WHERE id = ? AND active = 1 AND is_sample = 1")
      .get(payload.suggestedActivityId);
    if (!activity) {
      throw new HttpError(
        409,
        "SUGGESTED_ACTIVITY_UNAVAILABLE",
        "The sample activity in this proposal is no longer available. Ask the agent for a new plan.",
      );
    }
  }

  const planId = insertReconnectionPlan(database, {
    familyId: proposal.family_id,
    createdByUserId: actorUserId,
    title: payload.title,
    rationale: payload.rationale,
    suggestedMemberIds: payload.suggestedMemberIds,
    suggestedGathering: payload.suggestedGathering,
    ...(payload.suggestedActivityId ? { suggestedActivityId: payload.suggestedActivityId } : {}),
    rewardChallenge: payload.rewardChallenge,
    evidence: {
      signals: stored.evidenceSignals,
      limitations: [
        "These signals are incomplete administrative records and do not measure feelings, closeness, or intent.",
        "No private memory content, member notes, media, contact details, exact coordinates, or invitation tokens were used.",
      ],
    },
    provider: stored.provider,
    model: stored.model,
  });

  writeAudit(database, {
    familyId: proposal.family_id,
    actorUserId,
    action: "agent.reconnection_plan.confirmed",
    entityType: "reconnection_plan",
    entityId: planId,
    details: {
      proposalId: proposal.id,
      suggestedMemberCount: payload.suggestedMemberIds.length,
      evidenceSignalIds: stored.evidenceSignals.map((signal) => signal.id),
      suggestedActivityId: payload.suggestedActivityId ?? null,
      createdGathering: false,
    },
  });

  return {
    planId,
    message: "The reconnection plan was saved. No gathering or invitation was created.",
  };
}

function sendAgentError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number((error as { status?: unknown }).status) === 429
  ) {
    console.warn("Agent provider quota exhausted.");
    throw new HttpError(
      429,
      "AGENT_QUOTA_EXHAUSTED",
      "The Gemini API quota is currently exhausted. No conversation or family data was saved. Try again after the provider quota resets.",
    );
  }
  console.error("Agent provider error", error);
  throw new HttpError(502, "AGENT_PROVIDER_ERROR", "The AI provider could not complete the request.");
}

function proposalResult(actionType: ActionProposalRow["action_type"], entityId: string | null) {
  if (actionType === "CREATE_RECONNECTION_PLAN") return { planId: entityId };
  if (
    actionType === "CREATE_GATHERING_DRAFT" ||
    actionType === "PREPARE_INVITATION_LINKS" ||
    actionType === "COMPLETE_GATHERING"
  ) {
    return { gatheringId: entityId };
  }
  if (actionType === "CREATE_NOTE_MEMORY" || actionType === "DELETE_MEMORY") return { memoryId: entityId };
  if (actionType === "UPDATE_PLAN_STATUS") return { planId: entityId };
  if (actionType === "CREATE_RELATIONSHIP" || actionType === "DELETE_RELATIONSHIP") {
    return { relationshipId: entityId };
  }
  return { memberId: entityId };
}

async function generateWithTimeout(
  provider: AgentProvider,
  input: Omit<AgentProviderInput, "signal">,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new HttpError(
          504,
          "AGENT_PROVIDER_TIMEOUT",
          "The AI provider took too long to respond. No conversation or family data was saved.",
        ),
      );
      controller.abort();
    }, timeoutMs);
  });

  try {
    // Attach rejection handling to the provider promise immediately. Some
    // injected providers cannot cancel, but a late rejection must never become
    // an unhandled rejection after the HTTP request has timed out.
    const generation = Promise.resolve(provider.generate({ ...input, signal: controller.signal }));
    return await Promise.race([generation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Register the complete `/api/agent` contract. Call this before the global error handler. */
export function registerAgentRoutes(
  app: Application,
  database: AppDatabase,
  options: RegisterAgentRoutesOptions = {},
): void {
  const provider = createProvider(options);
  const timeoutMs = providerTimeoutMs(options);
  const now = options.now ?? (() => new Date());
  purgeExpiredAgentSessions(database, now());
  const cleanupTimer = setInterval(() => {
    try {
      purgeExpiredAgentSessions(database, now());
    } catch (error) {
      console.error("Agent transcript retention cleanup failed", error);
    }
  }, AGENT_TRANSCRIPT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  const backgroundTimers = (app.locals.backgroundTimers ??= []) as Array<ReturnType<typeof setInterval>>;
  backgroundTimers.push(cleanupTimer);

  app.delete("/api/agent/sessions/:sessionId", (request: Request, response: Response) => {
    const auth = requireAuth(response);
    const { sessionId } = parseParams(sessionParamsSchema, request.params);
    const session = database
      .prepare("SELECT id, family_id, created_by_user_id FROM agent_sessions WHERE id = ?")
      .get(sessionId) as { id: string; family_id: string; created_by_user_id: string } | undefined;
    if (!session || session.created_by_user_id !== auth.userId) {
      throw new HttpError(404, "AGENT_SESSION_NOT_FOUND", "Agent session not found.");
    }
    database.transaction(() => {
      database.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId);
      writeAudit(database, {
        familyId: session.family_id,
        actorUserId: auth.userId,
        action: "agent.session.deleted",
        entityType: "agent_session",
        entityId: sessionId,
      });
    })();
    response.status(204).end();
  });

  app.post(
    "/api/agent/messages",
    asyncRoute(async (request: Request, response: Response) => {
      const auth = requireAuth(response);
      purgeExpiredAgentSessions(database, now());
      const input = parseBody(messageRequestSchema, request.body);
      const membership = getMembership(database, input.familyId, auth.userId);
      if (!provider) {
        throw new HttpError(
          503,
          "AGENT_NOT_CONFIGURED",
          "The family agent is unavailable because GEMINI_API_KEY is not configured.",
        );
      }
      if (provider.requiresExternalDataConsent && input.aiProcessingConsent !== true) {
        throw new HttpError(
          400,
          "AGENT_DATA_CONSENT_REQUIRED",
          "Confirm the external AI data disclosure before sending this request.",
        );
      }

      const timestamp = now().toISOString();
      const newSession = !input.sessionId;
      const session: AgentSessionRow = input.sessionId
        ? getOwnedSession(database, input.sessionId, input.familyId, auth.userId)
        : {
            id: randomUUID(),
            family_id: input.familyId,
            created_by_user_id: auth.userId,
            status: "active",
            created_at: timestamp,
            updated_at: timestamp,
          };
      const persistTurnStart = () => {
        if (newSession) {
          database
            .prepare(
              `INSERT INTO agent_sessions
               (id, family_id, created_by_user_id, status, created_at, updated_at)
               VALUES (?, ?, ?, 'active', ?, ?)`,
            )
            .run(session.id, input.familyId, auth.userId, timestamp, timestamp);
        }
        insertMessage(database, session.id, "user", "message", input.message, timestamp);
      };

      const history = newSession ? [] : readHistory(database, session.id);
      const family = getPermittedFamilyContext(database, membership, auth.userId, now());

      let rawDecision: unknown;
      try {
        if (provider.requiresExternalDataConsent) {
          writeAudit(database, {
            familyId: input.familyId,
            actorUserId: auth.userId,
            action: "agent.external_context_disclosed",
            entityType: "agent_session",
            entityId: session.id,
            details: {
              provider: provider.providerName ?? "external",
              model: provider.modelName ?? "unspecified",
              categories: [
                "request_and_recent_agent_conversation",
                "family_display_names_and_relationships",
                "authorized_coarse_location_context",
                "engagement_and_reward_aggregates",
                "sample_activity_metadata",
                "authorized_gathering_invitation_status_memory_label_and_plan_status_metadata",
              ],
            },
          });
        }
        rawDecision = await generateWithTimeout(provider, { request: input.message, history, family }, timeoutMs);
      } catch (error) {
        sendAgentError(error);
      }

      const parsedDecision = providerDecisionSchema.safeParse(rawDecision);
      if (!parsedDecision.success) {
        throw new HttpError(
          502,
          "AGENT_INVALID_RESPONSE",
          "The AI provider returned an invalid response. No family data was changed.",
        );
      }
      const decision: AgentProviderDecision = parsedDecision.data;

      let preparedAddMember:
        | { payload: AddMemberPayload; required?: RequiredRequesterRelationship; clarification?: string }
        | undefined;
      if (decision.kind === "proposal") requireActionPermission(membership, decision.action);
      if (decision.kind === "proposal" && decision.action.type === "ADD_MEMBER") {
        preparedAddMember = enforceFirstPersonAddRelationship(input.message, family, decision.action.payload);
        const clarification =
          preparedAddMember.clarification ??
          clarificationForAddMemberProposal(database, family, preparedAddMember.payload);
        if (clarification) {
          database.transaction(() => {
            persistTurnStart();
            insertMessage(database, session.id, "assistant", "clarification", clarification, now().toISOString());
          })();
          response.json({ sessionId: session.id, kind: "clarification", message: clarification });
          return;
        }
      }

      if (decision.kind !== "proposal") {
        database.transaction(() => {
          persistTurnStart();
          insertMessage(database, session.id, "assistant", decision.kind, decision.message, now().toISOString());
        })();
        response.json({ sessionId: session.id, kind: decision.kind, message: decision.message });
        return;
      }

      const action = decision.action;
      const proposalId = randomUUID();
      let storedPayload: unknown;
      let presentation: { title: string; summary: string; details: Record<string, unknown>; warnings: string[] };
      if (action.type === "ADD_MEMBER") {
        const prepared = preparedAddMember ?? enforceFirstPersonAddRelationship(input.message, family, action.payload);
        storedPayload = {
          member: prepared.payload,
          ...(prepared.required ? { requiredRequesterRelationship: prepared.required } : {}),
        } satisfies z.infer<typeof storedAddMemberProposalSchema>;
        presentation = addMemberProposalPresentation(prepared.payload, family);
      } else if (action.type === "UPDATE_MEMBER") {
        const member = validateUpdateMemberProposal(database, family, action.payload);
        storedPayload = {
          payload: action.payload,
          expectedUpdatedAt: getMemberRow(database, family.id, action.payload.memberId).updated_at,
        } satisfies z.infer<typeof storedUpdateMemberProposalSchema>;
        presentation = updateMemberProposalPresentation(action.payload, member);
      } else if (action.type === "DELETE_MEMBER") {
        const member = validateDeleteMemberProposal(database, family, action.payload);
        storedPayload = {
          payload: action.payload,
          snapshot: deleteMemberSnapshot(database, family.id, action.payload.memberId),
        } satisfies z.infer<typeof storedDeleteMemberProposalSchema>;
        presentation = deleteMemberProposalPresentation(database, family, action.payload, member);
      } else if (action.type === "CREATE_RELATIONSHIP") {
        const members = validateCreateRelationshipProposal(database, family, action.payload);
        storedPayload = action.payload;
        presentation = createRelationshipProposalPresentation(action.payload, members);
      } else if (action.type === "DELETE_RELATIONSHIP") {
        const validated = validateDeleteRelationshipProposal(database, family, action.payload);
        storedPayload = action.payload;
        presentation = deleteRelationshipProposalPresentation(action.payload, validated);
      } else if (action.type === "CREATE_RECONNECTION_PLAN") {
        const validated = validateReconnectionPlanProposal(family, action.payload);
        const clarification = reconnectionPlanClarification(family, action.payload);
        if (clarification) {
          database.transaction(() => {
            persistTurnStart();
            insertMessage(database, session.id, "assistant", "clarification", clarification, now().toISOString());
          })();
          response.json({ sessionId: session.id, kind: "clarification", message: clarification });
          return;
        }
        storedPayload = {
          plan: action.payload,
          evidenceSignals: validated.evidenceSignals,
          provider: provider.providerName ?? "injected",
          model: provider.modelName ?? "injected-provider",
        } satisfies z.infer<typeof storedReconnectionProposalSchema>;
        presentation = reconnectionPlanProposalPresentation(action.payload, family, validated);
      } else if (action.type === "CREATE_GATHERING_DRAFT") {
        storedPayload = action.payload;
        presentation = createGatheringDraftPresentation(action.payload);
      } else if (action.type === "PREPARE_INVITATION_LINKS") {
        storedPayload = {
          payload: action.payload,
          invitationSnapshot: invitationSnapshot(database, action.payload.gatheringId, action.payload.memberIds),
        } satisfies z.infer<typeof storedPrepareInvitationLinksPayloadSchema>;
        presentation = prepareInvitationLinksPresentation(action.payload, family);
      } else if (action.type === "COMPLETE_GATHERING") {
        presentation = completeGatheringPresentation(action.payload, family);
        storedPayload = {
          payload: action.payload,
          gatheringSnapshot: gatheringCompletionSnapshot(database, action.payload.gatheringId),
        } satisfies z.infer<typeof storedCompleteGatheringPayloadSchema>;
      } else if (action.type === "CREATE_NOTE_MEMORY") {
        const resolvedPayload = storedCreateNoteMemoryPayloadSchema.parse({
          ...action.payload,
          capturedAt: action.payload.capturedAt ?? now().toISOString(),
        });
        storedPayload = resolvedPayload;
        presentation = createNoteMemoryPresentation(resolvedPayload, family);
      } else if (action.type === "DELETE_MEMORY") {
        storedPayload = {
          payload: action.payload,
          snapshot: memorySnapshot(database, action.payload.memoryId),
        } satisfies z.infer<typeof storedDeleteMemoryPayloadSchema>;
        presentation = deleteMemoryPresentation(action.payload, family);
      } else {
        storedPayload = {
          payload: action.payload,
          ...planStatusSnapshot(database, action.payload.planId),
        } satisfies z.infer<typeof storedUpdatePlanStatusPayloadSchema>;
        presentation = updatePlanStatusPresentation(action.payload, family);
      }
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000);
      database.transaction(() => {
        persistTurnStart();
        database
          .prepare(
            `INSERT INTO agent_action_proposals
             (id, session_id, family_id, created_by_user_id, action_type, payload_json,
              title, summary, warnings_json, status, created_at, updated_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(
            proposalId,
            session.id,
            input.familyId,
            auth.userId,
            action.type,
            JSON.stringify(storedPayload),
            presentation.title,
            presentation.summary,
            JSON.stringify(presentation.warnings),
            createdAt.toISOString(),
            createdAt.toISOString(),
            expiresAt.toISOString(),
          );
        insertMessage(database, session.id, "assistant", "proposal", decision.message, createdAt.toISOString());
      })();

      response.status(201).json({
        sessionId: session.id,
        kind: "proposal",
        message: decision.message,
        proposal: {
          id: proposalId,
          actionType: action.type,
          title: presentation.title,
          summary: presentation.summary,
          details: presentation.details,
          warnings: presentation.warnings,
        },
      });
    }),
  );

  app.post(
    "/api/agent/action-proposals/:proposalId/confirm",
    asyncRoute(async (request: Request, response: Response) => {
      const auth = requireAuth(response);
      const { proposalId } = parseParams(proposalParamsSchema, request.params);
      const initialProposal = getOwnedProposal(database, proposalId, auth.userId);
      const membership = getMembership(database, initialProposal.family_id, auth.userId);
      requireActionPermission(membership, storedProposalAction(initialProposal));

      if (initialProposal.status === "confirmed") {
        response.json({
          proposalId,
          status: "confirmed",
          message:
            initialProposal.action_type === "PREPARE_INVITATION_LINKS"
              ? "These links were already prepared and cannot be recovered from the transcript. Ask for and confirm a new rotation only if you need replacement links."
              : "This approved change was already completed.",
          alreadyCompleted: true,
          result: proposalResult(initialProposal.action_type, initialProposal.result_entity_id),
        });
        return;
      }
      if (initialProposal.status === "rejected") {
        throw new HttpError(409, "PROPOSAL_REJECTED", "A cancelled proposal cannot be confirmed.");
      }
      if (new Date(initialProposal.expires_at).getTime() <= now().getTime()) {
        throw new HttpError(409, "PROPOSAL_EXPIRED", "This proposal expired. Ask the agent to prepare a new one.");
      }

      const result = database.transaction(() => {
        const proposal = getOwnedProposal(database, proposalId, auth.userId);
        const currentMembership = getMembership(database, proposal.family_id, auth.userId);
        requireActionPermission(currentMembership, storedProposalAction(proposal));
        if (proposal.status === "confirmed") {
          return {
            entityId: proposal.result_entity_id,
            message:
              proposal.action_type === "PREPARE_INVITATION_LINKS"
                ? "These links were already prepared and cannot be recovered from the transcript. Ask for and confirm a new rotation only if you need replacement links."
                : "This approved change was already completed.",
            alreadyCompleted: true,
          };
        }
        if (proposal.status !== "pending") {
          throw new HttpError(409, "PROPOSAL_NOT_PENDING", "This proposal can no longer be confirmed.");
        }

        const claimed = database
          .prepare(
            `UPDATE agent_action_proposals SET status = 'confirmed', updated_at = ?, confirmed_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(now().toISOString(), now().toISOString(), proposal.id);
        if (claimed.changes !== 1) {
          throw new HttpError(409, "PROPOSAL_NOT_PENDING", "This proposal can no longer be confirmed.");
        }

        let applied: {
          entityId: string;
          message: string;
          ephemeralResult?: Record<string, unknown>;
          cleanupStoragePath?: string | null;
        };
        if (proposal.action_type === "ADD_MEMBER") {
          const parsedPayload = storedAddMemberProposalSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          const result = applyAddMember(database, proposal, parsedPayload.data, auth.userId, now(), currentMembership);
          applied = { entityId: result.memberId, message: result.message };
        } else if (proposal.action_type === "UPDATE_MEMBER") {
          const parsedPayload = storedUpdateMemberProposalSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          if (getMemberRow(database, proposal.family_id, parsedPayload.data.payload.memberId).updated_at !== parsedPayload.data.expectedUpdatedAt) {
            throw new HttpError(409, "PROPOSAL_TARGET_CHANGED", "This profile changed after the preview. Ask the agent for a new proposal.");
          }
          const result = applyUpdateMember(database, proposal, parsedPayload.data.payload, auth.userId, now());
          applied = { entityId: result.memberId, message: result.message };
        } else if (proposal.action_type === "DELETE_MEMBER") {
          const parsedPayload = storedDeleteMemberProposalSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          assertDeleteMemberSnapshotCurrent(
            database,
            proposal.family_id,
            parsedPayload.data.payload.memberId,
            parsedPayload.data.snapshot,
          );
          const result = applyDeleteMember(database, proposal, parsedPayload.data.payload, auth.userId);
          applied = { entityId: result.memberId, message: result.message };
        } else if (proposal.action_type === "CREATE_RELATIONSHIP") {
          const parsedPayload = createRelationshipPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          const result = applyCreateRelationship(database, proposal, parsedPayload.data, auth.userId);
          applied = { entityId: result.relationshipId, message: result.message };
        } else if (proposal.action_type === "DELETE_RELATIONSHIP") {
          const parsedPayload = deleteRelationshipPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          const result = applyDeleteRelationship(database, proposal, parsedPayload.data, auth.userId);
          applied = { entityId: result.relationshipId, message: result.message };
        } else if (proposal.action_type === "CREATE_RECONNECTION_PLAN") {
          const parsedPayload = storedReconnectionProposalSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) {
            throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          }
          const result = applyReconnectionPlan(database, proposal, parsedPayload.data, auth.userId);
          applied = { entityId: result.planId, message: result.message };
        } else if (proposal.action_type === "CREATE_GATHERING_DRAFT") {
          const parsedPayload = createGatheringDraftPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          const result = createGatheringDraft(database, proposal.family_id, parsedPayload.data, {
            actorUserId: auth.userId,
            now: now(),
            proposalId: proposal.id,
          });
          applied = { entityId: result.gatheringId, message: "The gathering draft was created. No invitations were prepared." };
        } else if (proposal.action_type === "PREPARE_INVITATION_LINKS") {
          const parsedPayload = storedPrepareInvitationLinksPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          const { gatheringId, ...input } = parsedPayload.data.payload;
          assertSnapshotMatches(
            invitationSnapshot(database, gatheringId, input.memberIds),
            parsedPayload.data.invitationSnapshot,
            "An invitation or RSVP changed after the preview. Ask the agent for fresh invitation links.",
          );
          const prepared = prepareInvitationLinks(database, gatheringId, input, {
            actorUserId: auth.userId,
            now: now(),
            proposalId: proposal.id,
            production: options.production,
            publicAppUrl: options.publicAppUrl,
            requestOrigin: `${request.protocol}://${request.get("host")}`,
          });
          applied = {
            entityId: prepared.gatheringId,
            message: "Invitation links are ready to share. The app has not contacted anyone automatically.",
            ephemeralResult: {
              gatheringId: prepared.gatheringId,
              invitations: prepared.invitations,
              deliveryNotice: "Links are ready to share. The app has not contacted anyone automatically.",
            },
          };
        } else if (proposal.action_type === "COMPLETE_GATHERING") {
          const parsedPayload = storedCompleteGatheringPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          const { gatheringId, ...input } = parsedPayload.data.payload;
          assertSnapshotMatches(
            gatheringCompletionSnapshot(database, gatheringId),
            parsedPayload.data.gatheringSnapshot,
            "This gathering or its RSVP roster changed after the preview. Ask the agent for a new completion proposal.",
          );
          const completed = completeGathering(database, gatheringId, input, {
            actorUserId: auth.userId,
            now: now(),
            proposalId: proposal.id,
          });
          applied = {
            entityId: completed.gatheringId,
            message: `The gathering was completed${completed.pointsAwarded ? ` and ${completed.pointsAwarded} points were awarded` : ""}.`,
            ephemeralResult: { gatheringId: completed.gatheringId, pointsAwarded: completed.pointsAwarded },
          };
        } else if (proposal.action_type === "CREATE_NOTE_MEMORY") {
          const parsedPayload = storedCreateNoteMemoryPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          const result = createMemory(
            database,
            parsedPayload.data.gatheringId,
            {
              familyId: proposal.family_id,
              title: parsedPayload.data.title,
              note: parsedPayload.data.note,
              memoryType: "note",
              visibility: parsedPayload.data.visibility,
              selectedMemberIds: parsedPayload.data.selectedMemberIds,
              aiProcessingAllowed: false,
              capturedAt: parsedPayload.data.capturedAt,
            },
            { actorUserId: auth.userId, now: now(), proposalId: proposal.id },
          );
          applied = { entityId: result.memoryId, message: "The written memory was saved with AI processing disabled." };
        } else if (proposal.action_type === "DELETE_MEMORY") {
          const parsedPayload = storedDeleteMemoryPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          assertSnapshotMatches(
            memorySnapshot(database, parsedPayload.data.payload.memoryId),
            parsedPayload.data.snapshot,
            "This memory changed after the preview. Ask the agent for a new deletion proposal.",
          );
          const result = deleteMemory(database, parsedPayload.data.payload.memoryId, {
            actorUserId: auth.userId,
            proposalId: proposal.id,
          });
          applied = {
            entityId: result.memoryId,
            message: `${result.title} was permanently deleted.`,
            cleanupStoragePath: result.storagePath,
          };
        } else if (proposal.action_type === "UPDATE_PLAN_STATUS") {
          const parsedPayload = storedUpdatePlanStatusPayloadSchema.safeParse(JSON.parse(proposal.payload_json));
          if (!parsedPayload.success) throw new HttpError(409, "INVALID_STORED_PROPOSAL", "The stored proposal is invalid.");
          assertSnapshotMatches(
            planStatusSnapshot(database, parsedPayload.data.payload.planId),
            {
              expectedStatus: parsedPayload.data.expectedStatus,
              expectedUpdatedAt: parsedPayload.data.expectedUpdatedAt,
            },
            "This plan changed after the preview. Ask the agent for a new status proposal.",
          );
          const result = updateReconnectionPlanStatus(
            database,
            parsedPayload.data.payload.planId,
            { status: parsedPayload.data.payload.status },
            { actorUserId: auth.userId, now: now(), proposalId: proposal.id },
          );
          applied = { entityId: result.planId, message: `The plan was marked ${result.status}.` };
        } else {
          throw new HttpError(409, "UNSUPPORTED_AGENT_ACTION", "This action type is not supported.");
        }
        database
          .prepare("UPDATE agent_action_proposals SET result_entity_id = ?, updated_at = ? WHERE id = ?")
          .run(applied.entityId, now().toISOString(), proposal.id);
        insertMessage(database, proposal.session_id, "assistant", "result", applied.message, now().toISOString());
        return { ...applied, alreadyCompleted: false };
      })();

      if (result.cleanupStoragePath) cleanupDeletedMemoryFile(result.cleanupStoragePath);

      response.json({
        proposalId,
        status: "confirmed",
        message: result.message,
        result:
          result.ephemeralResult
            ? result.ephemeralResult
            : proposalResult(initialProposal.action_type, result.entityId),
        alreadyCompleted: result.alreadyCompleted,
      });
    }),
  );

  app.post(
    "/api/agent/action-proposals/:proposalId/reject",
    asyncRoute(async (request: Request, response: Response) => {
      const auth = requireAuth(response);
      const { proposalId } = parseParams(proposalParamsSchema, request.params);
      const initialProposal = getOwnedProposal(database, proposalId, auth.userId);
      getMembership(database, initialProposal.family_id, auth.userId);

      if (initialProposal.status === "confirmed") {
        throw new HttpError(409, "PROPOSAL_CONFIRMED", "A completed proposal cannot be cancelled.");
      }
      if (initialProposal.status === "rejected") {
        response.json({
          proposalId,
          status: "rejected",
          message: "This proposal was already cancelled. No family data was changed.",
          alreadyRejected: true,
        });
        return;
      }

      database.transaction(() => {
        const rejectedAt = now().toISOString();
        const updated = database
          .prepare(
            `UPDATE agent_action_proposals
             SET status = 'rejected', updated_at = ?, rejected_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(rejectedAt, rejectedAt, proposalId);
        if (updated.changes !== 1) {
          throw new HttpError(409, "PROPOSAL_NOT_PENDING", "This proposal can no longer be cancelled.");
        }
        writeAudit(database, {
          familyId: initialProposal.family_id,
          actorUserId: auth.userId,
          action: "agent.action.rejected",
          entityType: "agent_action_proposal",
          entityId: proposalId,
          details: { actionType: initialProposal.action_type },
        });
        insertMessage(
          database,
          initialProposal.session_id,
          "assistant",
          "result",
          "The proposed change was cancelled. No family data was changed.",
          rejectedAt,
        );
      })();

      response.json({
        proposalId,
        status: "rejected",
        message: "The proposed change was cancelled. No family data was changed.",
        alreadyRejected: false,
      });
    }),
  );
}
