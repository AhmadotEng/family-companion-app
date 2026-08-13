import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { z } from "zod";
import type { AppDatabase } from "./database.js";
import { getMembership, getMemberRow, requireFamilyAdmin, writeAudit } from "./domain.js";
import { HttpError } from "./http.js";

const uniqueMemberIds = z
  .array(z.string().uuid())
  .max(200)
  .transform((ids) => [...new Set(ids)]);

export const createGatheringSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    purpose: z.string().trim().min(2).max(500),
    startAt: z.string().datetime({ offset: true }),
    timezone: z.literal("Asia/Dubai").default("Asia/Dubai"),
    locationName: z.string().trim().min(2).max(300),
    notes: z.string().trim().max(2_000).optional(),
    type: z.string().trim().min(2).max(80),
  })
  .strict();

export const prepareInvitationsSchema = z
  .object({
    memberIds: uniqueMemberIds.pipe(z.array(z.string().uuid()).min(1).max(200)),
    channel: z.enum(["share_link", "whatsapp"]),
  })
  .strict();

export const completeGatheringSchema = z
  .object({
    confirmAttendeeMemberIds: uniqueMemberIds.pipe(z.array(z.string().uuid()).min(2).max(200)),
  })
  .strict();

export const createMemorySchema = z
  .object({
    familyId: z.string().uuid(),
    title: z.string().trim().min(2).max(150),
    note: z.string().trim().max(10_000).optional(),
    memoryType: z.enum(["note", "photo", "video", "audio"]),
    visibility: z.enum(["private", "family_admin", "family", "selected"]),
    selectedMemberIds: uniqueMemberIds.default([]),
    aiProcessingAllowed: z.boolean().default(false),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.memoryType === "note" && !value.note) {
      context.addIssue({ code: "custom", message: "A written memory requires a note." });
    }
    if (value.visibility === "selected" && value.selectedMemberIds.length === 0) {
      context.addIssue({ code: "custom", message: "Select at least one viewer." });
    }
  });

export const updatePlanStatusSchema = z
  .object({ status: z.enum(["accepted", "dismissed", "completed"]) })
  .strict();

export type CreateGatheringInput = z.infer<typeof createGatheringSchema>;
export type PrepareInvitationsInput = z.infer<typeof prepareInvitationsSchema>;
export type CompleteGatheringInput = z.infer<typeof completeGatheringSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdatePlanStatusInput = z.infer<typeof updatePlanStatusSchema>;

type GatheringStatus = "draft" | "inviting" | "completed" | "cancelled";

interface GatheringRow {
  id: string;
  family_id: string;
  title: string;
  start_at: string;
  timezone: string;
  status: GatheringStatus;
  created_by_user_id: string;
}

interface MemoryRow {
  id: string;
  family_id: string;
  gathering_id: string | null;
  created_by_user_id: string;
  title: string;
  memory_type: "note" | "photo" | "video" | "audio";
  storage_path: string | null;
}

interface CommandContext {
  actorUserId: string;
  now?: Date;
  proposalId?: string;
}

function commandTime(context: CommandContext): Date {
  return context.now ?? new Date();
}

function agentAuditDetails(context: CommandContext): Record<string, unknown> {
  return context.proposalId ? { source: "agent", proposalId: context.proposalId } : {};
}

function getGathering(database: AppDatabase, gatheringId: string): GatheringRow {
  const row = database.prepare("SELECT * FROM gatherings WHERE id = ?").get(gatheringId) as GatheringRow | undefined;
  if (!row) throw new HttpError(404, "GATHERING_NOT_FOUND", "Gathering not found.");
  return row;
}

function requireGatheringManager(database: AppDatabase, row: GatheringRow, actorUserId: string): void {
  const membership = getMembership(database, row.family_id, actorUserId);
  if (row.created_by_user_id !== actorUserId && membership.role === "member") {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "Only the gathering creator or a family administrator can do that.");
  }
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function addRewardEntry(
  database: AppDatabase,
  input: {
    familyId: string;
    points: number;
    reasonCode: string;
    description: string;
    entityType?: string;
    entityId?: string;
    dedupeKey: string;
    now?: Date;
  },
): boolean {
  const result = database
    .prepare(
      `INSERT OR IGNORE INTO reward_ledger
       (id, family_id, points, reason_code, description, entity_type, entity_id, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.familyId,
      input.points,
      input.reasonCode,
      input.description,
      input.entityType ?? null,
      input.entityId ?? null,
      input.dedupeKey,
      (input.now ?? new Date()).toISOString(),
    );
  return result.changes === 1;
}

export function createGatheringDraft(
  database: AppDatabase,
  familyId: string,
  rawInput: CreateGatheringInput,
  context: CommandContext,
): { gatheringId: string } {
  const input = createGatheringSchema.parse(rawInput);
  getMembership(database, familyId, context.actorUserId);
  const id = randomUUID();
  const timestamp = commandTime(context).toISOString();
  database
    .prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, notes,
        gathering_type, status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    )
    .run(
      id,
      familyId,
      input.title,
      input.purpose,
      input.startAt,
      input.timezone,
      input.locationName,
      input.notes ?? null,
      input.type,
      context.actorUserId,
      timestamp,
      timestamp,
    );
  writeAudit(database, {
    familyId,
    actorUserId: context.actorUserId,
    action: "gathering.created",
    entityType: "gathering",
    entityId: id,
    details: { status: "draft", ...agentAuditDetails(context) },
  });
  return { gatheringId: id };
}

export interface PreparedInvitationLink {
  memberId: string;
  memberName: string;
  sharePath: string;
  shareUrl: string;
  whatsappUrl?: string;
}

export function prepareInvitationLinks(
  database: AppDatabase,
  gatheringId: string,
  rawInput: PrepareInvitationsInput,
  context: CommandContext & {
    production?: boolean;
    publicAppUrl?: string;
    requestOrigin: string;
  },
): { gatheringId: string; invitations: PreparedInvitationLink[] } {
  const input = prepareInvitationsSchema.parse(rawInput);
  const gathering = getGathering(database, gatheringId);
  requireGatheringManager(database, gathering, context.actorUserId);
  const publicAppUrl = context.publicAppUrl?.trim().replace(/\/$/, "");
  if (context.production && !publicAppUrl) {
    throw new HttpError(503, "PUBLIC_APP_URL_REQUIRED", "Invitation links require PUBLIC_APP_URL in production.");
  }
  if (gathering.status === "completed" || gathering.status === "cancelled") {
    throw new HttpError(409, "GATHERING_CLOSED", "Invitations cannot be prepared for a closed gathering.");
  }
  input.memberIds.forEach((memberId) => getMemberRow(database, gathering.family_id, memberId));

  const timestamp = commandTime(context).toISOString();
  const prepared: PreparedInvitationLink[] = [];
  for (const memberId of input.memberIds) {
    const member = getMemberRow(database, gathering.family_id, memberId);
    const token = randomBytes(32).toString("base64url");
    const existing = database
      .prepare("SELECT id FROM gathering_invitations WHERE gathering_id = ? AND member_id = ?")
      .get(gatheringId, memberId) as { id: string } | undefined;
    const invitationId = existing?.id ?? randomUUID();
    if (existing) {
      database
        .prepare(
          `UPDATE gathering_invitations
           SET channel = ?, token_hash = ?, status = 'pending', prepared_at = ?, opened_at = NULL,
               responded_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(input.channel, hashInvitationToken(token), timestamp, timestamp, invitationId);
    } else {
      database
        .prepare(
          `INSERT INTO gathering_invitations
           (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(invitationId, gatheringId, memberId, input.channel, hashInvitationToken(token), timestamp, timestamp);
    }
    const sharePath = `/invite/${token}`;
    const shareUrl = `${publicAppUrl || context.requestOrigin.replace(/\/$/, "")}${sharePath}`;
    const invitationText = `Family gathering invitation: ${gathering.title} on ${new Date(gathering.start_at).toLocaleString("en-AE", { timeZone: gathering.timezone })}. Please RSVP: ${shareUrl}`;
    prepared.push({
      memberId,
      memberName: member.display_name,
      sharePath,
      shareUrl,
      ...(input.channel === "whatsapp"
        ? { whatsappUrl: `https://wa.me/?text=${encodeURIComponent(invitationText)}` }
        : {}),
    });
  }
  database.prepare("UPDATE gatherings SET status = 'inviting', updated_at = ? WHERE id = ?").run(timestamp, gatheringId);
  writeAudit(database, {
    familyId: gathering.family_id,
    actorUserId: context.actorUserId,
    action: "invitations.prepared",
    entityType: "gathering",
    entityId: gatheringId,
    // Tokens and URLs are intentionally excluded from persistent audit data.
    details: { count: prepared.length, channel: input.channel, ...agentAuditDetails(context) },
  });
  return { gatheringId, invitations: prepared };
}

export function completeGathering(
  database: AppDatabase,
  gatheringId: string,
  rawInput: CompleteGatheringInput,
  context: CommandContext,
): { gatheringId: string; pointsAwarded: number; alreadyCompleted: boolean } {
  const input = completeGatheringSchema.parse(rawInput);
  const gathering = getGathering(database, gatheringId);
  const membership = getMembership(database, gathering.family_id, context.actorUserId);
  requireFamilyAdmin(membership);
  if (gathering.status === "completed") {
    return { gatheringId, pointsAwarded: 0, alreadyCompleted: true };
  }
  if (gathering.status !== "inviting") {
    throw new HttpError(409, "GATHERING_NOT_INVITING", "Prepare invitations before completing this gathering.");
  }
  const at = commandTime(context);
  if (new Date(gathering.start_at).getTime() > at.getTime()) {
    throw new HttpError(409, "GATHERING_NOT_STARTED", "A future gathering cannot be marked completed.");
  }
  input.confirmAttendeeMemberIds.forEach((memberId) => getMemberRow(database, gathering.family_id, memberId));
  const goingInvitations = database
    .prepare("SELECT member_id FROM gathering_invitations WHERE gathering_id = ? AND status = 'going'")
    .all(gatheringId) as Array<{ member_id: string }>;
  const goingIds = new Set(goingInvitations.map((item) => item.member_id));
  if (input.confirmAttendeeMemberIds.some((memberId) => !goingIds.has(memberId))) {
    throw new HttpError(400, "ATTENDEE_NOT_CONFIRMED", "Every confirmed attendee must have already RSVP'd Going.");
  }

  let pointsAwarded = 0;
  const timestamp = at.toISOString();
  database.prepare("UPDATE gatherings SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, gatheringId);
  if (
    addRewardEntry(database, {
      familyId: gathering.family_id,
      points: 500,
      reasonCode: "GATHERING_COMPLETED",
      description: "A gathering with at least two confirmed attendees was completed.",
      entityType: "gathering",
      entityId: gatheringId,
      dedupeKey: `gathering:${gatheringId}:completed`,
      now: at,
    })
  ) {
    pointsAwarded += 500;
  }

  const elderCutoff = new Date(at);
  elderCutoff.setUTCFullYear(elderCutoff.getUTCFullYear() - 60);
  const placeholders = input.confirmAttendeeMemberIds.map(() => "?").join(",");
  const elder = database
    .prepare(`SELECT 1 FROM family_members WHERE id IN (${placeholders}) AND birth_date IS NOT NULL AND birth_date <= ? LIMIT 1`)
    .get(...input.confirmAttendeeMemberIds, elderCutoff.toISOString().slice(0, 10));
  if (
    elder &&
    addRewardEntry(database, {
      familyId: gathering.family_id,
      points: 300,
      reasonCode: "ELDER_INCLUDED",
      description: "A completed gathering included an elder family member.",
      entityType: "gathering",
      entityId: gatheringId,
      dedupeKey: `gathering:${gatheringId}:elder`,
      now: at,
    })
  ) {
    pointsAwarded += 300;
  }
  writeAudit(database, {
    familyId: gathering.family_id,
    actorUserId: context.actorUserId,
    action: "gathering.completed",
    entityType: "gathering",
    entityId: gatheringId,
    details: {
      confirmedAttendees: input.confirmAttendeeMemberIds.length,
      pointsAwarded,
      ...agentAuditDetails(context),
    },
  });
  return { gatheringId, pointsAwarded, alreadyCompleted: false };
}

export function createMemory(
  database: AppDatabase,
  gatheringId: string,
  rawInput: CreateMemoryInput,
  context: CommandContext,
): { memoryId: string; memoryType: CreateMemoryInput["memoryType"] } {
  const input = createMemorySchema.parse(rawInput);
  const gathering = getGathering(database, gatheringId);
  getMembership(database, gathering.family_id, context.actorUserId);
  if (gathering.status !== "completed") {
    throw new HttpError(409, "GATHERING_NOT_COMPLETED", "Complete the gathering before adding a memory.");
  }
  if (input.familyId !== gathering.family_id) {
    throw new HttpError(400, "FAMILY_MISMATCH", "The memory and gathering must belong to the same family.");
  }
  input.selectedMemberIds.forEach((memberId) => getMemberRow(database, gathering.family_id, memberId));
  const id = randomUUID();
  const at = commandTime(context);
  const timestamp = at.toISOString();
  database
    .prepare(
      `INSERT INTO memories
       (id, family_id, gathering_id, created_by_user_id, title, note, memory_type,
        visibility, ai_processing_allowed, captured_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      gathering.family_id,
      gatheringId,
      context.actorUserId,
      input.title,
      input.note ?? null,
      input.memoryType,
      input.visibility,
      input.aiProcessingAllowed ? 1 : 0,
      input.capturedAt,
      timestamp,
      timestamp,
    );
  const insertViewer = database.prepare("INSERT INTO memory_viewers (memory_id, member_id) VALUES (?, ?)");
  input.selectedMemberIds.forEach((memberId) => insertViewer.run(id, memberId));
  if (input.memoryType === "note") {
    addRewardEntry(database, {
      familyId: gathering.family_id,
      points: 150,
      reasonCode: "MEMORY_CAPTURED",
      description: "A memory was preserved after a gathering.",
      entityType: "gathering",
      entityId: gatheringId,
      dedupeKey: `gathering:${gatheringId}:memory`,
      now: at,
    });
  }
  writeAudit(database, {
    familyId: gathering.family_id,
    actorUserId: context.actorUserId,
    action: "memory.created",
    entityType: "memory",
    entityId: id,
    details: {
      memoryType: input.memoryType,
      visibility: input.visibility,
      aiProcessingAllowed: input.aiProcessingAllowed,
      ...agentAuditDetails(context),
    },
  });
  return { memoryId: id, memoryType: input.memoryType };
}

export function deleteMemory(
  database: AppDatabase,
  memoryId: string,
  context: CommandContext,
): { memoryId: string; title: string; memoryType: MemoryRow["memory_type"]; storagePath: string | null } {
  const row = database.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow | undefined;
  if (!row) throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found.");
  const membership = getMembership(database, row.family_id, context.actorUserId);
  if (row.created_by_user_id !== context.actorUserId && membership.role === "member") {
    throw new HttpError(403, "MEMORY_OWNER_REQUIRED", "Only the memory creator or a family administrator can delete it.");
  }
  database.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
  writeAudit(database, {
    familyId: row.family_id,
    actorUserId: context.actorUserId,
    action: "memory.deleted",
    entityType: "memory",
    entityId: memoryId,
    details: agentAuditDetails(context),
  });
  return { memoryId, title: row.title, memoryType: row.memory_type, storagePath: row.storage_path };
}

/** Run only after the database transaction which removed the memory commits. */
export function cleanupDeletedMemoryFile(storagePath: string | null): void {
  if (!storagePath) return;
  try {
    unlinkSync(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // The database record is already gone; retain availability and surface
      // the orphan for operational cleanup without leaking its path to users.
      console.error("Deleted memory media cleanup failed", error);
    }
  }
}

export function updateReconnectionPlanStatus(
  database: AppDatabase,
  planId: string,
  rawInput: UpdatePlanStatusInput,
  context: CommandContext,
): { planId: string; status: UpdatePlanStatusInput["status"]; alreadyCurrent: boolean } {
  const input = updatePlanStatusSchema.parse(rawInput);
  const row = database
    .prepare("SELECT family_id, created_by_user_id, status FROM reconnection_plans WHERE id = ?")
    .get(planId) as { family_id: string; created_by_user_id: string; status: string } | undefined;
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Reconnection plan not found.");
  const membership = getMembership(database, row.family_id, context.actorUserId);
  if (row.created_by_user_id !== context.actorUserId && membership.role === "member") {
    throw new HttpError(403, "PLAN_OWNER_REQUIRED", "Only the plan creator or a family administrator can update it.");
  }
  if (row.status === input.status) return { planId, status: input.status, alreadyCurrent: true };
  const timestamp = commandTime(context).toISOString();
  database.prepare("UPDATE reconnection_plans SET status = ?, updated_at = ? WHERE id = ?").run(input.status, timestamp, planId);
  writeAudit(database, {
    familyId: row.family_id,
    actorUserId: context.actorUserId,
    action: "reconnection_plan.status_changed",
    entityType: "reconnection_plan",
    entityId: planId,
    details: { status: input.status, previousStatus: row.status, ...agentAuditDetails(context) },
  });
  return { planId, status: input.status, alreadyCurrent: false };
}
