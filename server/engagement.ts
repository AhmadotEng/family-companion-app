import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import { z } from "zod";
import type { AppDatabase } from "./database.js";
import { getMembership, getMemberRow, requireFamilyAdmin, writeAudit } from "./domain.js";
import { asyncRoute, HttpError, parseBody, parseParams } from "./http.js";
import { requireAuth, type AuthContext } from "./security.js";
import {
  addRewardEntry,
  cleanupDeletedMemoryFile,
  completeGathering,
  completeGatheringSchema,
  createGatheringDraft,
  createGatheringSchema,
  createMemory,
  createMemorySchema,
  deleteMemory,
  hashInvitationToken,
  prepareInvitationLinks,
  prepareInvitationsSchema,
  updatePlanStatusSchema,
  updateReconnectionPlanStatus,
} from "./engagementCommands.js";
import {
  hashGatheringCreationPayload,
  parseGatheringIdempotencyKey,
} from "./gatheringIdempotency.js";

/**
 * Schema owned by the engagement vertical slice. It is exported so the main
 * migration runner can apply it as a numbered migration, while isolated tests
 * can apply the exact same SQL to an in-memory database.
 */
export const ENGAGEMENT_SCHEMA_SQL = `
  CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    emirate TEXT NOT NULL,
    location_name TEXT NOT NULL,
    price_range TEXT NOT NULL CHECK(price_range IN ('Free', 'Budget', 'Premium')),
    age_suitability TEXT NOT NULL,
    elderly_friendly INTEGER NOT NULL DEFAULT 0 CHECK(elderly_friendly IN (0, 1)),
    indoor_outdoor TEXT NOT NULL CHECK(indoor_outdoor IN ('Indoor', 'Outdoor')),
    description TEXT NOT NULL,
    estimated_duration TEXT NOT NULL,
    weather_suitability TEXT NOT NULL,
    image_url TEXT,
    source_label TEXT NOT NULL,
    source_url TEXT,
    verified_at TEXT,
    is_sample INTEGER NOT NULL DEFAULT 1 CHECK(is_sample IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX activities_emirate_idx ON activities(emirate, active);

  CREATE TABLE gatherings (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL,
    start_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
    location_name TEXT NOT NULL,
    notes TEXT,
    gathering_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'inviting', 'completed', 'cancelled')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX gatherings_family_start_idx ON gatherings(family_id, start_at);

  CREATE TABLE gathering_invitations (
    id TEXT PRIMARY KEY,
    gathering_id TEXT NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('share_link', 'whatsapp')),
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'going', 'maybe', 'declined')),
    prepared_at TEXT NOT NULL,
    opened_at TEXT,
    responded_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(gathering_id, member_id)
  );
  CREATE INDEX gathering_invitations_gathering_idx ON gathering_invitations(gathering_id);

  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    gathering_id TEXT REFERENCES gatherings(id) ON DELETE SET NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    note TEXT,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('note', 'photo', 'video', 'audio')),
    visibility TEXT NOT NULL CHECK(visibility IN ('private', 'family_admin', 'family', 'selected')),
    ai_processing_allowed INTEGER NOT NULL DEFAULT 0 CHECK(ai_processing_allowed IN (0, 1)),
    media_mime_type TEXT,
    media_size_bytes INTEGER,
    storage_path TEXT,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX memories_family_captured_idx ON memories(family_id, captured_at);

  CREATE TABLE memory_viewers (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    PRIMARY KEY(memory_id, member_id)
  );

  CREATE TABLE reward_ledger (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK(points <> 0),
    reason_code TEXT NOT NULL,
    description TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    dedupe_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(family_id, dedupe_key)
  );
  CREATE INDEX reward_ledger_family_created_idx ON reward_ledger(family_id, created_at);

  CREATE TABLE reward_offers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    points_cost INTEGER NOT NULL CHECK(points_cost > 0),
    partner_name TEXT,
    is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE reward_redemptions (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    offer_id TEXT NOT NULL REFERENCES reward_offers(id),
    redeemed_by_user_id TEXT NOT NULL REFERENCES users(id),
    points_spent INTEGER NOT NULL CHECK(points_spent > 0),
    status TEXT NOT NULL CHECK(status IN ('pending', 'issued', 'cancelled')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE reconnection_plans (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    suggested_member_ids_json TEXT NOT NULL,
    suggested_gathering_json TEXT NOT NULL,
    suggested_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
    reward_challenge TEXT,
    evidence_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'accepted', 'dismissed', 'completed')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX reconnection_plans_family_created_idx ON reconnection_plans(family_id, created_at);
`;

/** Clearly labelled prototype data; none of these rows claims a live partner. */
export const ENGAGEMENT_SEED_SQL = `
  INSERT OR IGNORE INTO activities
    (id, title, category, emirate, location_name, price_range, age_suitability,
     elderly_friendly, indoor_outdoor, description, estimated_duration,
     weather_suitability, source_label, is_sample, active, created_at, updated_at)
  VALUES
    ('10000000-0000-4000-8000-000000000001', 'Family Heritage Walk', 'Culture', 'Abu Dhabi',
     'Heritage area selected by the family', 'Free', 'All ages', 1, 'Outdoor',
     'A sample self-guided heritage walk template. Confirm accessibility, opening hours, and conditions before visiting.',
     '2 hours', 'Best during cooler hours', 'Prototype sample — not a live listing', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000002', 'Quiet Family Museum Visit', 'Culture', 'Dubai',
     'Museum selected by the family', 'Budget', 'Children and elders', 1, 'Indoor',
     'A sample museum-gathering template designed around slower pacing and shared storytelling.',
     '2–3 hours', 'Indoor option', 'Prototype sample — not a live listing', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000003', 'Cousins Park Picnic', 'Outdoors', 'Sharjah',
     'Public park selected by the family', 'Budget', 'All ages', 1, 'Outdoor',
     'A sample low-cost picnic plan. Check the selected park rules, weather, and accessibility before confirming.',
     '3 hours', 'Cooler months or evenings', 'Prototype sample — not a live listing', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000004', 'Home Storytelling Majlis', 'Heritage', 'Abu Dhabi',
     'Private family home', 'Free', 'All ages', 1, 'Indoor',
     'A sample home gathering focused on recording an elder story with explicit consent.',
     '90 minutes', 'Any weather', 'Prototype sample — not a live listing', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  INSERT OR IGNORE INTO reward_offers
    (id, title, description, points_cost, partner_name, is_demo, active, created_at, updated_at)
  VALUES
    ('20000000-0000-4000-8000-000000000001', 'Family restaurant voucher example',
     'Demonstrates how a future verified partner voucher would appear.', 1500, NULL, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('20000000-0000-4000-8000-000000000002', 'Heritage workshop voucher example',
     'Demonstrates a future family heritage reward. No partner is connected.', 2500, NULL, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`;

const familyParams = z.object({ familyId: z.string().uuid() });
const gatheringParams = z.object({ gatheringId: z.string().uuid() });
const memoryParams = z.object({ memoryId: z.string().uuid() });
const invitationParams = z.object({ token: z.string().min(32).max(200) });

const respondSchema = z.object({ status: z.enum(["going", "maybe", "declined"]) });

type GatheringRow = {
  id: string;
  family_id: string;
  title: string;
  purpose: string;
  start_at: string;
  timezone: string;
  location_name: string;
  notes: string | null;
  gathering_type: string;
  status: "draft" | "inviting" | "completed" | "cancelled";
  created_by_user_id: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type GatheringCreationRequestRow = {
  payload_hash: string;
  gathering_id: string;
};

type InvitationRow = {
  id: string;
  gathering_id: string;
  member_id: string;
  channel: "share_link" | "whatsapp";
  status: "pending" | "going" | "maybe" | "declined";
  prepared_at: string;
  opened_at: string | null;
  responded_at: string | null;
  updated_at: string;
};

type MemoryRow = {
  id: string;
  family_id: string;
  gathering_id: string | null;
  created_by_user_id: string;
  title: string;
  note: string | null;
  memory_type: "note" | "photo" | "video" | "audio";
  visibility: "private" | "family_admin" | "family" | "selected";
  ai_processing_allowed: 0 | 1;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  storage_path: string | null;
  captured_at: string;
  created_at: string;
  updated_at: string;
};

function rowToGathering(database: AppDatabase, row: GatheringRow, auth: AuthContext) {
  const membership = getMembership(database, row.family_id, auth.userId);
  const maySeeFullRoster = membership.role !== "member" || row.created_by_user_id === auth.userId;
  const invitations = (database
    .prepare(
      `SELECT gi.id, gi.member_id, fm.display_name, gi.channel, gi.status,
              gi.prepared_at, gi.opened_at, gi.responded_at
       FROM gathering_invitations gi
       JOIN family_members fm ON fm.id = gi.member_id
       WHERE gi.gathering_id = ? ORDER BY fm.display_name`,
    )
    .all(row.id) as Array<{
      id: string;
      member_id: string;
      display_name: string;
      channel: string;
      status: string;
      prepared_at: string;
      opened_at: string | null;
      responded_at: string | null;
    }>).filter((invitation) => maySeeFullRoster || invitation.member_id === membership.linkedMemberId);
  return {
    id: row.id,
    familyId: row.family_id,
    title: row.title,
    purpose: row.purpose,
    startAt: row.start_at,
    timezone: row.timezone,
    locationName: row.location_name,
    ...(row.notes ? { notes: row.notes } : {}),
    type: row.gathering_type,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      memberId: invitation.member_id,
      memberName: invitation.display_name,
      channel: invitation.channel,
      status: invitation.status,
      preparedAt: invitation.prepared_at,
      ...(invitation.opened_at ? { openedAt: invitation.opened_at } : {}),
      ...(invitation.responded_at ? { respondedAt: invitation.responded_at } : {}),
    })),
  };
}

function getGathering(database: AppDatabase, gatheringId: string): GatheringRow {
  const row = database.prepare("SELECT * FROM gatherings WHERE id = ?").get(gatheringId) as GatheringRow | undefined;
  if (!row) throw new HttpError(404, "GATHERING_NOT_FOUND", "Gathering not found.");
  return row;
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function rowToMemory(row: MemoryRow) {
  return {
    id: row.id,
    familyId: row.family_id,
    createdByUserId: row.created_by_user_id,
    ...(row.gathering_id ? { gatheringId: row.gathering_id } : {}),
    title: row.title,
    ...(row.note ? { note: row.note } : {}),
    memoryType: row.memory_type,
    visibility: row.visibility,
    aiProcessingAllowed: Boolean(row.ai_processing_allowed),
    hasMedia: Boolean(row.storage_path),
    ...(row.media_mime_type ? { mediaMimeType: row.media_mime_type } : {}),
    ...(row.media_size_bytes !== null ? { mediaSizeBytes: row.media_size_bytes } : {}),
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canViewMemory(database: AppDatabase, row: MemoryRow, auth: AuthContext): void {
  const membership = getMembership(database, row.family_id, auth.userId);
  if (row.created_by_user_id === auth.userId || row.visibility === "family") return;
  if (row.visibility === "family_admin" && membership.role !== "member") return;
  if (row.visibility === "selected" && membership.linkedMemberId) {
    const allowed = database
      .prepare("SELECT 1 FROM memory_viewers WHERE memory_id = ? AND member_id = ?")
      .get(row.id, membership.linkedMemberId);
    if (allowed) return;
  }
  throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found.");
}

const mediaTypes: Record<string, { kind: MemoryRow["memory_type"]; extension: string }> = {
  "image/jpeg": { kind: "photo", extension: ".jpg" },
  "image/png": { kind: "photo", extension: ".png" },
  "image/webp": { kind: "photo", extension: ".webp" },
  "video/mp4": { kind: "video", extension: ".mp4" },
  "audio/mpeg": { kind: "audio", extension: ".mp3" },
  "audio/mp4": { kind: "audio", extension: ".m4a" },
  "audio/webm": { kind: "audio", extension: ".webm" },
};

function hasMediaSignature(contentType: string, data: Buffer): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  const asciiAt = (offset: number, value: string) => data.subarray(offset, offset + value.length).toString("ascii") === value;
  switch (contentType) {
    case "image/jpeg":
      return data.length >= 3 && startsWith(0xff, 0xd8, 0xff);
    case "image/png":
      return data.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return data.length >= 12 && asciiAt(0, "RIFF") && asciiAt(8, "WEBP");
    case "video/mp4":
    case "audio/mp4":
      return data.length >= 12 && asciiAt(4, "ftyp");
    case "audio/mpeg":
      return (data.length >= 3 && asciiAt(0, "ID3")) || (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
    case "audio/webm":
      return data.length >= 4 && startsWith(0x1a, 0x45, 0xdf, 0xa3);
    default:
      return false;
  }
}

export interface EngagementRouteOptions {
  uploadRoot?: string;
  production?: boolean;
  publicAppUrl?: string;
  mediaUserQuotaBytes?: number;
  mediaFamilyQuotaBytes?: number;
}

export function registerEngagementRoutes(
  app: Express,
  database: AppDatabase,
  options: EngagementRouteOptions = {},
): void {
  const uploadRoot = path.resolve(options.uploadRoot ?? path.join(process.cwd(), "data", "uploads"));
  const publicAppUrl = options.publicAppUrl?.trim().replace(/\/$/, "");
  const mediaUserQuotaBytes = options.mediaUserQuotaBytes ?? 100 * 1024 * 1024;
  const mediaFamilyQuotaBytes = options.mediaFamilyQuotaBytes ?? 500 * 1024 * 1024;
  const mediaBody = express.raw({ type: Object.keys(mediaTypes), limit: "15mb" });

  app.get("/api/activities", (_request, response) => {
    const rows = database.prepare("SELECT * FROM activities WHERE active = 1 ORDER BY emirate, title").all() as Array<Record<string, unknown>>;
    response.json({
      activities: rows.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        emirate: row.emirate,
        location: row.location_name,
        priceRange: row.price_range,
        ageSuitability: row.age_suitability,
        elderlyFriendly: Boolean(row.elderly_friendly),
        indoorOutdoor: row.indoor_outdoor,
        description: row.description,
        estimatedDuration: row.estimated_duration,
        weatherSuitability: row.weather_suitability,
        ...(row.image_url ? { image: row.image_url } : {}),
        sourceLabel: row.source_label,
        ...(row.source_url ? { sourceUrl: row.source_url } : {}),
        ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
        isSample: Boolean(row.is_sample),
      })),
    });
  });

  app.get("/api/families/:familyId/gatherings", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    const membership = getMembership(database, familyId, auth.userId);
    const rows = (membership.role === "member"
      ? database
          .prepare(
            `SELECT DISTINCT g.* FROM gatherings g
             LEFT JOIN gathering_invitations gi ON gi.gathering_id = g.id
             WHERE g.family_id = ?
               AND (g.created_by_user_id = ? OR gi.member_id = ?)
             ORDER BY g.start_at`,
          )
          .all(familyId, auth.userId, membership.linkedMemberId)
      : database
          .prepare("SELECT * FROM gatherings WHERE family_id = ? ORDER BY start_at")
          .all(familyId)) as GatheringRow[];
    response.json({ gatherings: rows.map((row) => rowToGathering(database, row, auth)) });
  });

  app.post("/api/families/:familyId/gatherings", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    const input = parseBody(createGatheringSchema, request.body);
    const idempotencyKey = parseGatheringIdempotencyKey(request.get("Idempotency-Key"));

    // Preserve the original endpoint behavior for callers which do not opt in
    // to retry idempotency.
    if (!idempotencyKey) {
      const result = database.transaction(() =>
        createGatheringDraft(database, familyId, input, { actorUserId: auth.userId }),
      )();
      response.status(201).json({ gathering: rowToGathering(database, getGathering(database, result.gatheringId), auth) });
      return;
    }

    const payloadHash = hashGatheringCreationPayload(input);
    const createIdempotently = database.transaction(() => {
      // A replay must still pass today's family authorization checks.
      getMembership(database, familyId, auth.userId);
      const existing = database
        .prepare(
          `SELECT payload_hash, gathering_id
           FROM gathering_creation_requests
           WHERE family_id = ? AND actor_user_id = ? AND idempotency_key = ?`,
        )
        .get(familyId, auth.userId, idempotencyKey) as GatheringCreationRequestRow | undefined;

      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          throw new HttpError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with different gathering details.",
          );
        }
        return { gatheringId: existing.gathering_id, alreadyCreated: true };
      }

      const created = createGatheringDraft(database, familyId, input, { actorUserId: auth.userId });
      database
        .prepare(
          `INSERT INTO gathering_creation_requests
           (family_id, actor_user_id, idempotency_key, payload_hash, gathering_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(familyId, auth.userId, idempotencyKey, payloadHash, created.gatheringId, new Date().toISOString());
      return { gatheringId: created.gatheringId, alreadyCreated: false };
    });
    // Acquire the SQLite write lock before the lookup so two server processes
    // cannot both observe a missing key and create duplicate rows.
    const result = createIdempotently.immediate();

    response.status(result.alreadyCreated ? 200 : 201).json({
      gathering: rowToGathering(database, getGathering(database, result.gatheringId), auth),
      alreadyCreated: result.alreadyCreated,
    });
  });

  app.post("/api/gatherings/:gatheringId/invitations", (request, response) => {
    const auth = requireAuth(response);
    const { gatheringId } = parseParams(gatheringParams, request.params);
    const input = parseBody(prepareInvitationsSchema, request.body);
    const result = database.transaction(() =>
      prepareInvitationLinks(database, gatheringId, input, {
        actorUserId: auth.userId,
        production: options.production,
        publicAppUrl,
        requestOrigin: `${request.protocol}://${request.get("host")}`,
      }),
    )();
    response.status(201).json({
      invitations: result.invitations,
      deliveryNotice: "Links are ready to share. The app has not contacted anyone automatically.",
      gathering: rowToGathering(database, getGathering(database, gatheringId), auth),
    });
  });

  app.get("/api/invitations/:token", (request, response) => {
    const { token } = parseParams(invitationParams, request.params);
    const row = database
      .prepare(
        `SELECT gi.*, g.family_id, g.status AS gathering_status, g.title, g.purpose, g.start_at, g.timezone,
                g.location_name, g.notes, g.gathering_type, fm.display_name AS invitee_name,
                u.display_name AS host_name, f.name AS family_name
         FROM gathering_invitations gi
         JOIN gatherings g ON g.id = gi.gathering_id
         JOIN family_members fm ON fm.id = gi.member_id
         JOIN users u ON u.id = g.created_by_user_id
         JOIN families f ON f.id = g.family_id
         WHERE gi.token_hash = ?`,
      )
      .get(hashInvitationToken(token)) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found or no longer valid.");
    if (row.gathering_status === "completed" || row.gathering_status === "cancelled") {
      throw new HttpError(410, "INVITATION_CLOSED", "This invitation is closed.");
    }
    const invitationClosesAt = new Date(String(row.start_at)).getTime() + 24 * 60 * 60 * 1_000;
    if (!Number.isFinite(invitationClosesAt) || invitationClosesAt <= Date.now()) {
      throw new HttpError(410, "INVITATION_EXPIRED", "This invitation has expired.");
    }
    response.json({
      invitation: {
        familyName: row.family_name,
        inviteeName: row.invitee_name,
        hostName: row.host_name,
        title: row.title,
        purpose: row.purpose,
        startAt: row.start_at,
        timezone: row.timezone,
        locationName: row.location_name,
        ...(row.notes ? { notes: row.notes } : {}),
        type: row.gathering_type,
        status: row.status,
      },
    });
  });

  app.post("/api/invitations/:token/respond", (request, response) => {
    const { token } = parseParams(invitationParams, request.params);
    const input = parseBody(respondSchema, request.body);
    const row = database
      .prepare(
        `SELECT gi.id, gi.gathering_id, g.family_id, g.status AS gathering_status, g.start_at
         FROM gathering_invitations gi JOIN gatherings g ON g.id = gi.gathering_id
         WHERE gi.token_hash = ?`,
      )
      .get(hashInvitationToken(token)) as { id: string; gathering_id: string; family_id: string; gathering_status: string; start_at: string } | undefined;
    if (!row) throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found or no longer valid.");
    if (row.gathering_status === "completed" || row.gathering_status === "cancelled") {
      throw new HttpError(410, "INVITATION_CLOSED", "This invitation is closed.");
    }
    const invitationClosesAt = new Date(row.start_at).getTime() + 24 * 60 * 60 * 1_000;
    if (!Number.isFinite(invitationClosesAt) || invitationClosesAt <= Date.now()) {
      throw new HttpError(410, "INVITATION_EXPIRED", "This invitation has expired.");
    }
    const now = new Date().toISOString();
    const transaction = database.transaction(() => {
      database
        .prepare("UPDATE gathering_invitations SET status = ?, opened_at = COALESCE(opened_at, ?), responded_at = ?, updated_at = ? WHERE id = ?")
        .run(input.status, now, now, now, row.id);
      addRewardEntry(database, {
        familyId: row.family_id,
        points: 150,
        reasonCode: "FIRST_INVITATION_RESPONSE",
        description: "A prepared family invitation received its first RSVP.",
        entityType: "gathering",
        entityId: row.gathering_id,
        dedupeKey: `gathering:${row.gathering_id}:first-rsvp`,
      });
      const goingCount = (
        database
          .prepare("SELECT COUNT(*) AS count FROM gathering_invitations WHERE gathering_id = ? AND status = 'going'")
          .get(row.gathering_id) as { count: number }
      ).count;
      if (goingCount >= 4) {
        addRewardEntry(database, {
          familyId: row.family_id,
          points: 200,
          reasonCode: "FOUR_RSVPS",
          description: "Four family members confirmed attendance.",
          entityType: "gathering",
          entityId: row.gathering_id,
          dedupeKey: `gathering:${row.gathering_id}:four-going`,
        });
      }
      writeAudit(database, {
        familyId: row.family_id,
        action: "invitation.responded",
        entityType: "invitation",
        entityId: row.id,
        details: { status: input.status },
      });
    });
    transaction();
    response.json({ status: input.status, message: "Your RSVP has been recorded." });
  });

  app.post("/api/gatherings/:gatheringId/complete", (request, response) => {
    const auth = requireAuth(response);
    const { gatheringId } = parseParams(gatheringParams, request.params);
    const input = parseBody(completeGatheringSchema, request.body);
    const result = database.transaction(() =>
      completeGathering(database, gatheringId, input, { actorUserId: auth.userId }),
    )();
    response.json({
      gathering: rowToGathering(database, getGathering(database, gatheringId), auth),
      pointsAwarded: result.pointsAwarded,
    });
  });

  app.get("/api/families/:familyId/memories", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    getMembership(database, familyId, auth.userId);
    const rows = database
      .prepare("SELECT * FROM memories WHERE family_id = ? ORDER BY captured_at DESC")
      .all(familyId) as MemoryRow[];
    response.json({
      memories: rows.flatMap((row) => {
        try {
          canViewMemory(database, row, auth);
          return [rowToMemory(row)];
        } catch {
          return [];
        }
      }),
    });
  });

  app.post("/api/gatherings/:gatheringId/memories", (request, response) => {
    const auth = requireAuth(response);
    const { gatheringId } = parseParams(gatheringParams, request.params);
    const input = parseBody(createMemorySchema, request.body);
    const result = database.transaction(() =>
      createMemory(database, gatheringId, input, { actorUserId: auth.userId }),
    )();
    const row = database.prepare("SELECT * FROM memories WHERE id = ?").get(result.memoryId) as MemoryRow;
    response.status(201).json({
      memory: rowToMemory(row),
      ...(input.memoryType !== "note" ? { uploadPath: `/api/memories/${result.memoryId}/media` } : {}),
    });
  });

  app.put(
    "/api/memories/:memoryId/media",
    mediaBody,
    asyncRoute(async (request, response) => {
      const auth = requireAuth(response);
      const { memoryId } = parseParams(memoryParams, request.params);
      const row = database.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow | undefined;
      if (!row) throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found.");
      if (row.created_by_user_id !== auth.userId) {
        throw new HttpError(403, "MEMORY_OWNER_REQUIRED", "Only the memory creator can upload its media.");
      }
      const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
      const mediaType = mediaTypes[contentType];
      if (!mediaType || mediaType.kind !== row.memory_type) {
        throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "The uploaded file type does not match this memory.");
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        throw new HttpError(400, "EMPTY_MEDIA", "Choose a non-empty media file.");
      }
      if (!hasMediaSignature(contentType, request.body)) {
        throw new HttpError(415, "INVALID_MEDIA_CONTENT", "The file contents do not match the declared media type.");
      }
      const existingSize = row.media_size_bytes ?? 0;
      const userUsage = (
        database
          .prepare("SELECT COALESCE(SUM(media_size_bytes), 0) AS bytes FROM memories WHERE created_by_user_id = ?")
          .get(auth.userId) as { bytes: number }
      ).bytes;
      const familyUsage = (
        database
          .prepare("SELECT COALESCE(SUM(media_size_bytes), 0) AS bytes FROM memories WHERE family_id = ?")
          .get(row.family_id) as { bytes: number }
      ).bytes;
      if (userUsage - existingSize + request.body.length > mediaUserQuotaBytes) {
        throw new HttpError(413, "USER_MEDIA_QUOTA_EXCEEDED", "Your private media storage quota has been reached.");
      }
      if (familyUsage - existingSize + request.body.length > mediaFamilyQuotaBytes) {
        throw new HttpError(413, "FAMILY_MEDIA_QUOTA_EXCEEDED", "This family's private media storage quota has been reached.");
      }
      await mkdir(uploadRoot, { recursive: true });
      const storagePath = path.join(uploadRoot, `${memoryId}${mediaType.extension}`);
      const previousPath = row.storage_path;
      await writeFile(storagePath, request.body, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        await writeFile(storagePath, request.body);
      });
      if (previousPath && path.resolve(previousPath) !== path.resolve(storagePath)) {
        await unlink(previousPath).catch(() => undefined);
      }
      const now = new Date().toISOString();
      database
        .prepare("UPDATE memories SET media_mime_type = ?, media_size_bytes = ?, storage_path = ?, updated_at = ? WHERE id = ?")
        .run(contentType, request.body.length, storagePath, now, memoryId);
      addRewardEntry(database, {
        familyId: row.family_id,
        points: 150,
        reasonCode: "MEMORY_CAPTURED",
        description: "A memory was preserved after a gathering.",
        entityType: "gathering",
        entityId: row.gathering_id ?? memoryId,
        dedupeKey: row.gathering_id ? `gathering:${row.gathering_id}:memory` : `memory:${memoryId}:uploaded`,
      });
      writeAudit(database, {
        familyId: row.family_id,
        actorUserId: auth.userId,
        action: "memory.media_uploaded",
        entityType: "memory",
        entityId: memoryId,
        details: { contentType, sizeBytes: request.body.length },
      });
      const updated = database.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow;
      response.json({ memory: rowToMemory(updated) });
    }),
  );

  app.get(
    "/api/memories/:memoryId/media",
    asyncRoute(async (request, response) => {
      const auth = requireAuth(response);
      const { memoryId } = parseParams(memoryParams, request.params);
      const row = database.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId) as MemoryRow | undefined;
      if (!row || !row.storage_path || !row.media_mime_type) {
        throw new HttpError(404, "MEMORY_MEDIA_NOT_FOUND", "Memory media not found.");
      }
      canViewMemory(database, row, auth);
      let data: Buffer;
      try {
        data = await readFile(row.storage_path);
      } catch {
        throw new HttpError(404, "MEMORY_MEDIA_NOT_FOUND", "Memory media not found.");
      }
      response.setHeader("Content-Type", row.media_mime_type);
      response.setHeader("Cache-Control", "private, no-store");
      response.send(data);
    }),
  );

  app.delete(
    "/api/memories/:memoryId",
    asyncRoute(async (request, response) => {
      const auth = requireAuth(response);
      const { memoryId } = parseParams(memoryParams, request.params);
      const deleted = database.transaction(() =>
        deleteMemory(database, memoryId, { actorUserId: auth.userId }),
      )();
      cleanupDeletedMemoryFile(deleted.storagePath);
      response.status(204).end();
    }),
  );

  app.get("/api/families/:familyId/rewards", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    getMembership(database, familyId, auth.userId);
    const entries = database
      .prepare("SELECT * FROM reward_ledger WHERE family_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(familyId) as Array<Record<string, unknown>>;
    const balance = (
      database.prepare("SELECT COALESCE(SUM(points), 0) AS balance FROM reward_ledger WHERE family_id = ?").get(familyId) as { balance: number }
    ).balance;
    const offers = database
      .prepare("SELECT * FROM reward_offers WHERE active = 1 ORDER BY points_cost")
      .all() as Array<Record<string, unknown>>;
    response.json({
      balance,
      entries: entries.map((entry) => ({
        id: entry.id,
        points: entry.points,
        reasonCode: entry.reason_code,
        description: entry.description,
        createdAt: entry.created_at,
      })),
      offers: offers.map((offer) => ({
        id: offer.id,
        title: offer.title,
        description: offer.description,
        pointsCost: offer.points_cost,
        ...(offer.partner_name ? { partnerName: offer.partner_name } : {}),
        isDemo: Boolean(offer.is_demo),
        redeemable: !offer.is_demo && balance >= Number(offer.points_cost),
      })),
    });
  });

  app.post("/api/families/:familyId/rewards/:id/redeem", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    const { id } = parseParams(z.object({ id: z.string().uuid() }), request.params);
    const membership = getMembership(database, familyId, auth.userId);
    requireFamilyAdmin(membership);
    const offer = database.prepare("SELECT * FROM reward_offers WHERE id = ? AND active = 1").get(id) as
      | { id: string; title: string; points_cost: number; is_demo: 0 | 1 }
      | undefined;
    if (!offer) throw new HttpError(404, "REWARD_NOT_FOUND", "Reward offer not found.");
    if (offer.is_demo) {
      throw new HttpError(409, "DEMO_REWARD", "This is a transparent demo offer and cannot be redeemed.");
    }
    const balance = (
      database.prepare("SELECT COALESCE(SUM(points), 0) AS balance FROM reward_ledger WHERE family_id = ?").get(familyId) as { balance: number }
    ).balance;
    if (balance < offer.points_cost) throw new HttpError(409, "INSUFFICIENT_POINTS", "The family does not have enough points.");
    const redemptionId = randomUUID();
    const transaction = database.transaction(() => {
      database
        .prepare(
          `INSERT INTO reward_redemptions
           (id, family_id, offer_id, redeemed_by_user_id, points_spent, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(redemptionId, familyId, id, auth.userId, offer.points_cost, new Date().toISOString());
      addRewardEntry(database, {
        familyId,
        points: -offer.points_cost,
        reasonCode: "REWARD_REDEEMED",
        description: `Redeemed: ${offer.title}`,
        entityType: "redemption",
        entityId: redemptionId,
        dedupeKey: `redemption:${redemptionId}`,
      });
      writeAudit(database, {
        familyId,
        actorUserId: auth.userId,
        action: "reward.redeemed",
        entityType: "redemption",
        entityId: redemptionId,
        details: { offerId: id, pointsSpent: offer.points_cost },
      });
    });
    transaction();
    response.status(201).json({ redemption: { id: redemptionId, status: "pending", pointsSpent: offer.points_cost } });
  });

  app.get("/api/families/:familyId/reconnection-plans", (request, response) => {
    const auth = requireAuth(response);
    const { familyId } = parseParams(familyParams, request.params);
    const membership = getMembership(database, familyId, auth.userId);
    const rows = (membership.role === "member"
      ? database
          .prepare("SELECT * FROM reconnection_plans WHERE family_id = ? AND created_by_user_id = ? ORDER BY created_at DESC LIMIT 25")
          .all(familyId, auth.userId)
      : database
          .prepare("SELECT * FROM reconnection_plans WHERE family_id = ? ORDER BY created_at DESC LIMIT 25")
          .all(familyId)) as Array<Record<string, unknown>>;
    response.json({
      plans: rows.map((row) => ({
        id: row.id,
        createdByUserId: row.created_by_user_id,
        title: row.title,
        rationale: row.rationale,
        suggestedMemberIds: safeJsonArray(String(row.suggested_member_ids_json)),
        suggestedGathering: JSON.parse(String(row.suggested_gathering_json)) as unknown,
        ...(row.suggested_activity_id ? { suggestedActivityId: row.suggested_activity_id } : {}),
        ...(row.reward_challenge ? { rewardChallenge: row.reward_challenge } : {}),
        evidence: JSON.parse(String(row.evidence_json)) as unknown,
        status: row.status,
        provider: row.provider,
        model: row.model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  app.patch("/api/reconnection-plans/:id", (request, response) => {
    const auth = requireAuth(response);
    const { id } = parseParams(z.object({ id: z.string().uuid() }), request.params);
    const input = parseBody(updatePlanStatusSchema, request.body);
    const result = database.transaction(() =>
      updateReconnectionPlanStatus(database, id, input, { actorUserId: auth.userId }),
    )();
    response.json({ id, status: result.status });
  });
}

export interface ReconnectionPlanInput {
  familyId: string;
  createdByUserId: string;
  title: string;
  rationale: string;
  suggestedMemberIds: string[];
  suggestedGathering: Record<string, unknown>;
  suggestedActivityId?: string;
  rewardChallenge?: string;
  evidence: Record<string, unknown>;
  provider: string;
  model: string;
}

/** Used only by the confirmed agent action; callers must already be in a DB transaction. */
export function insertReconnectionPlan(database: AppDatabase, input: ReconnectionPlanInput): string {
  getMembership(database, input.familyId, input.createdByUserId);
  input.suggestedMemberIds.forEach((memberId) => getMemberRow(database, input.familyId, memberId));
  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO reconnection_plans
       (id, family_id, created_by_user_id, title, rationale, suggested_member_ids_json,
        suggested_gathering_json, suggested_activity_id, reward_challenge, evidence_json,
        status, provider, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.familyId,
      input.createdByUserId,
      input.title,
      input.rationale,
      JSON.stringify(input.suggestedMemberIds),
      JSON.stringify(input.suggestedGathering),
      input.suggestedActivityId ?? null,
      input.rewardChallenge ?? null,
      JSON.stringify(input.evidence),
      input.provider,
      input.model,
      now,
      now,
    );
  return id;
}
