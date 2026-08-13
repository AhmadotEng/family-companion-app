import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./database.js";
import { HttpError } from "./http.js";
import type { RelationshipType } from "./schemas.js";

export type FamilyRole = "owner" | "admin" | "member";

export interface Membership {
  familyId: string;
  familyName: string;
  role: FamilyRole;
  linkedMemberId: string | null;
}

export interface MemberRow {
  id: string;
  family_id: string;
  user_id: string | null;
  display_name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  interests_json: string;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipRow {
  id: string;
  family_id: string;
  source_member_id: string;
  target_member_id: string;
  type: RelationshipType;
  created_at: string;
}

export interface MemberDuplicateCandidate {
  displayName: string;
  birthDate?: string | null;
  email?: string | null;
}

/**
 * The single duplicate identity rule used by both manual and agent-managed
 * profile writes. A name on its own is not an identity: profiles conflict only
 * when an email matches, or when both display name and birth date match.
 */
export function findDuplicateMember(
  database: AppDatabase,
  familyId: string,
  candidate: MemberDuplicateCandidate,
  excludeMemberId?: string,
): Pick<MemberRow, "id" | "display_name"> | undefined {
  return database
    .prepare(
      `SELECT id, display_name FROM family_members
       WHERE family_id = ?
         AND (? IS NULL OR id <> ?)
         AND (
           (? IS NOT NULL AND email IS NOT NULL AND lower(email) = lower(?))
           OR (? IS NOT NULL AND lower(display_name) = lower(?) AND birth_date = ?)
         )
       LIMIT 1`,
    )
    .get(
      familyId,
      excludeMemberId ?? null,
      excludeMemberId ?? null,
      candidate.email ?? null,
      candidate.email ?? null,
      candidate.birthDate ?? null,
      candidate.displayName,
      candidate.birthDate ?? null,
    ) as Pick<MemberRow, "id" | "display_name"> | undefined;
}

export function getMembership(database: AppDatabase, familyId: string, userId: string): Membership {
  const row = database
    .prepare(
      `SELECT fu.family_id, f.name AS family_name, fu.role, fu.linked_member_id
       FROM family_users fu
       JOIN families f ON f.id = fu.family_id
       WHERE fu.family_id = ? AND fu.user_id = ?`,
    )
    .get(familyId, userId) as
    | { family_id: string; family_name: string; role: FamilyRole; linked_member_id: string | null }
    | undefined;

  if (!row) {
    throw new HttpError(404, "FAMILY_NOT_FOUND", "Family not found.");
  }
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    role: row.role,
    linkedMemberId: row.linked_member_id,
  };
}

export function requireFamilyAdmin(membership: Membership): void {
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new HttpError(403, "INSUFFICIENT_ROLE", "A family owner or administrator is required.");
  }
}

export function getMemberRow(database: AppDatabase, familyId: string, memberId: string): MemberRow {
  const row = database
    .prepare("SELECT * FROM family_members WHERE family_id = ? AND id = ?")
    .get(familyId, memberId) as MemberRow | undefined;
  if (!row) {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Family member not found.");
  }
  return row;
}

export function mapMember(row: MemberRow) {
  let interests: string[] = [];
  try {
    const parsed = JSON.parse(row.interests_json) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) interests = parsed;
  } catch {
    // A malformed legacy value should not break the entire family context response.
  }
  return {
    id: row.id,
    familyId: row.family_id,
    ...(row.user_id ? { userId: row.user_id } : {}),
    displayName: row.display_name,
    ...(row.birth_date ? { birthDate: row.birth_date } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.email ? { email: row.email } : {}),
    interests,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.photo_url?.startsWith("/api/") ? { photoUrl: row.photo_url } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRelationship(row: RelationshipRow) {
  return {
    id: row.id,
    familyId: row.family_id,
    sourceMemberId: row.source_member_id,
    targetMemberId: row.target_member_id,
    type: row.type,
    createdAt: row.created_at,
  };
}

export function ensureRelationshipIsValid(
  database: AppDatabase,
  familyId: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: RelationshipType,
): void {
  if (sourceMemberId === targetMemberId) {
    throw new HttpError(400, "SELF_RELATIONSHIP", "A member cannot have a relationship with themselves.");
  }
  getMemberRow(database, familyId, sourceMemberId);
  getMemberRow(database, familyId, targetMemberId);

  const symmetric = type === "spouse" || type === "sibling" || type === "relative";
  const duplicate = database
    .prepare(
      symmetric
        ? `SELECT id FROM relationships
           WHERE family_id = ? AND type = ?
             AND ((source_member_id = ? AND target_member_id = ?)
               OR (source_member_id = ? AND target_member_id = ?))`
        : `SELECT id FROM relationships
           WHERE family_id = ? AND type = ? AND source_member_id = ? AND target_member_id = ?`,
    )
    .get(
      ...(symmetric
        ? [familyId, type, sourceMemberId, targetMemberId, targetMemberId, sourceMemberId]
        : [familyId, type, sourceMemberId, targetMemberId]),
    );
  if (duplicate) {
    throw new HttpError(409, "RELATIONSHIP_EXISTS", "This relationship already exists.");
  }

  if (type === "parent") {
    const cycle = database
      .prepare(
        `WITH RECURSIVE descendants(member_id) AS (
           SELECT target_member_id FROM relationships
           WHERE family_id = ? AND type = 'parent' AND source_member_id = ?
           UNION
           SELECT r.target_member_id
           FROM relationships r
           JOIN descendants d ON r.source_member_id = d.member_id
           WHERE r.family_id = ? AND r.type = 'parent'
         )
         SELECT 1 FROM descendants WHERE member_id = ? LIMIT 1`,
      )
      .get(familyId, targetMemberId, familyId, sourceMemberId);
    if (cycle) {
      throw new HttpError(409, "RELATIONSHIP_CYCLE", "This parent relationship would create a cycle.");
    }
  }
}

export function insertRelationship(
  database: AppDatabase,
  familyId: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: RelationshipType,
) {
  ensureRelationshipIsValid(database, familyId, sourceMemberId, targetMemberId, type);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO relationships
       (id, family_id, source_member_id, target_member_id, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, familyId, sourceMemberId, targetMemberId, type, createdAt);
  return { id, familyId, sourceMemberId, targetMemberId, type, createdAt };
}

export function writeAudit(
  database: AppDatabase,
  input: {
    familyId?: string | null;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
): void {
  database
    .prepare(
      `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.familyId ?? null,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.details ?? {}),
      new Date().toISOString(),
    );
}
