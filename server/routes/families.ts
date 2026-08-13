import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AppDatabase } from "../database.js";
import {
  getMembership,
  getMemberRow,
  findDuplicateMember,
  insertRelationship,
  mapMember,
  mapRelationship,
  requireFamilyAdmin,
  writeAudit,
  type MemberRow,
  type RelationshipRow,
} from "../domain.js";
import { HttpError, parseBody, parseParams } from "../http.js";
import {
  createMemberSchema,
  createRelationshipSchema,
  familyParamsSchema,
  idParamsSchema,
  memberParamsSchema,
  memberPatchSchema,
  updateLocationSchema,
  type LocationPrecision,
  type LocationVisibility,
} from "../schemas.js";
import { requireAuth } from "../security.js";

interface LocationRow {
  member_id: string;
  source: "manual" | "browser" | "member_shared";
  precision: LocationPrecision;
  visibility: LocationVisibility;
  latitude: number | null;
  longitude: number | null;
  emirate: string | null;
  city: string | null;
  captured_at: string;
  expires_at: string | null;
}

interface SafeLocation {
  memberId: string;
  source: LocationRow["source"];
  precision: LocationPrecision;
  visibility: LocationVisibility;
  emirate?: string;
  city?: string;
  distanceBand?: string;
  capturedAt: string;
  expiresAt?: string;
}

function isVisibleLocation(
  row: LocationRow,
  viewer: { role: "owner" | "admin" | "member"; linkedMemberId: string | null },
): boolean {
  if (row.member_id === viewer.linkedMemberId) return true;
  if (row.visibility === "private") return false;
  if (row.visibility === "family_admin") return viewer.role === "owner" || viewer.role === "admin";
  return true;
}

function haversineKm(a: LocationRow, b: LocationRow): number | undefined {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return undefined;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function deriveDistanceBand(location: LocationRow, viewerLocation?: LocationRow): string | undefined {
  if (!viewerLocation || location.member_id === viewerLocation.member_id) return undefined;
  const distance = haversineKm(viewerLocation, location);
  if (distance !== undefined) {
    if (distance < 5) return "under-5-km";
    if (distance < 25) return "5-to-25-km";
    if (distance < 75) return "25-to-75-km";
    return "over-75-km";
  }
  if (location.city && viewerLocation.city && location.city.toLowerCase() === viewerLocation.city.toLowerCase()) {
    return "same-city";
  }
  if (
    location.emirate &&
    viewerLocation.emirate &&
    location.emirate.toLowerCase() === viewerLocation.emirate.toLowerCase()
  ) {
    return "same-emirate";
  }
  return undefined;
}

function quantizeDeviceCoordinate(value: number | undefined, precision: LocationPrecision): number | null {
  if (value === undefined) return null;
  if (precision === "exact") return value;
  // Never retain browser precision that is more detailed than the user chose.
  // City shares use an ~11 km grid; approximate/emirate shares use ~25 km.
  const step = precision === "city" ? 0.1 : 0.25;
  return Math.round(value / step) * step;
}

function mapSafeLocation(row: LocationRow, viewerLocation?: LocationRow): SafeLocation {
  const distanceBand = deriveDistanceBand(row, viewerLocation);
  return {
    memberId: row.member_id,
    source: row.source,
    precision: row.precision,
    visibility: row.visibility,
    ...(row.emirate ? { emirate: row.emirate } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(distanceBand ? { distanceBand } : {}),
    capturedAt: row.captured_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  };
}

function requireMemberAccess(database: AppDatabase, memberId: string, userId: string) {
  const row = database
    .prepare(
      `SELECT fm.*, fu.role, fu.linked_member_id
       FROM family_members fm
       JOIN family_users fu ON fu.family_id = fm.family_id AND fu.user_id = ?
       WHERE fm.id = ?`,
    )
    .get(userId, memberId) as (MemberRow & { role: "owner" | "admin" | "member"; linked_member_id: string | null }) | undefined;
  if (!row) throw new HttpError(404, "MEMBER_NOT_FOUND", "Family member not found.");
  return row;
}

function createReportedLocation(
  database: AppDatabase,
  input: {
    familyId: string;
    memberId: string;
    userId: string;
    precision: "emirate" | "city" | "approximate";
    visibility: LocationVisibility;
    emirate?: string;
    city?: string;
  },
): SafeLocation {
  const now = new Date().toISOString();
  const consentId = randomUUID();
  database
    .prepare(
      `INSERT INTO location_consents
       (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
       VALUES (?, ?, ?, ?, 'admin_reported', ?, ?, ?)`,
    )
    .run(consentId, input.familyId, input.memberId, input.userId, input.precision, input.visibility, now);
  database
    .prepare(
      `INSERT INTO member_locations
       (id, family_id, member_id, consent_id, source, precision, visibility, emirate, city, captured_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.familyId,
      input.memberId,
      consentId,
      input.precision,
      input.visibility,
      input.emirate ?? null,
      input.city ?? null,
      now,
      now,
    );
  return {
    memberId: input.memberId,
    source: "manual",
    precision: input.precision,
    visibility: input.visibility,
    ...(input.emirate ? { emirate: input.emirate } : {}),
    ...(input.city ? { city: input.city } : {}),
    capturedAt: now,
  };
}

export function createFamilyRouter(database: AppDatabase): Router {
  const router = Router();

  router.get("/families/:familyId/context", (request, response) => {
    const { familyId } = parseParams(familyParamsSchema, request.params);
    const auth = requireAuth(response);
    const membership = getMembership(database, familyId, auth.userId);
    const family = database.prepare("SELECT id, name FROM families WHERE id = ?").get(familyId) as {
      id: string;
      name: string;
    };
    const members = database
      .prepare("SELECT * FROM family_members WHERE family_id = ? ORDER BY created_at, display_name")
      .all(familyId) as MemberRow[];
    const relationships = database
      .prepare("SELECT * FROM relationships WHERE family_id = ? ORDER BY created_at")
      .all(familyId) as RelationshipRow[];
    const now = new Date().toISOString();
    const locationRows = database
      .prepare(
        `SELECT member_id, source, precision, visibility, latitude, longitude, emirate, city, captured_at, expires_at
         FROM member_locations WHERE family_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .all(familyId, now) as LocationRow[];
    const viewerLocation = locationRows.find((location) => location.member_id === membership.linkedMemberId);

    response.json({
      family: { id: family.id, name: family.name, role: membership.role },
      currentUser: {
        id: auth.userId,
        email: auth.email,
        displayName: auth.displayName,
        ...(membership.linkedMemberId ? { linkedMemberId: membership.linkedMemberId } : {}),
      },
      members: members.map((member) => {
        const mapped = mapMember(member);
        const canSeePrivateProfile = membership.role === "owner" || membership.role === "admin" || membership.linkedMemberId === member.id;
        if (canSeePrivateProfile) return mapped;
        return {
          id: mapped.id,
          familyId: mapped.familyId,
          displayName: mapped.displayName,
          interests: [],
          ...(mapped.photoUrl ? { photoUrl: mapped.photoUrl } : {}),
          createdAt: mapped.createdAt,
          updatedAt: mapped.updatedAt,
        };
      }),
      relationships: relationships.map(mapRelationship),
      safeLocations: locationRows
        .filter((location) => isVisibleLocation(location, membership))
        .map((location) => mapSafeLocation(location, viewerLocation)),
    });
  });

  router.post("/families/:familyId/members", (request, response) => {
    const { familyId } = parseParams(familyParamsSchema, request.params);
    const input = parseBody(createMemberSchema, request.body);
    const auth = requireAuth(response);
    const membership = getMembership(database, familyId, auth.userId);
    requireFamilyAdmin(membership);

    if (findDuplicateMember(database, familyId, input)) {
      throw new HttpError(409, "MEMBER_EXISTS", "A matching family member already exists.");
    }
    const initialRelationships = input.relationships ?? (input.relationship ? [input.relationship] : []);
    initialRelationships.forEach((relationship) => getMemberRow(database, familyId, relationship.relatedMemberId));

    const result = database.transaction(() => {
      const now = new Date().toISOString();
      const memberId = randomUUID();
      database
        .prepare(
          `INSERT INTO family_members
           (id, family_id, display_name, birth_date, phone, email, interests_json, notes, photo_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          memberId,
          familyId,
          input.displayName,
          input.birthDate ?? null,
          input.phone ?? null,
          input.email ?? null,
          JSON.stringify(input.interests),
          input.notes ?? null,
          input.photoUrl ?? null,
          now,
          now,
        );

      const relationships = initialRelationships.map((initialRelationship) => {
        const sourceMemberId =
          initialRelationship.direction === "source" ? memberId : initialRelationship.relatedMemberId;
        const targetMemberId =
          initialRelationship.direction === "source" ? initialRelationship.relatedMemberId : memberId;
        return insertRelationship(database, familyId, sourceMemberId, targetMemberId, initialRelationship.type);
      });

      const safeLocation = input.location
        ? createReportedLocation(database, {
            familyId,
            memberId,
            userId: auth.userId,
            precision: input.location.precision,
            visibility: input.location.visibility,
            ...(input.location.emirate ? { emirate: input.location.emirate } : {}),
            ...(input.location.city ? { city: input.location.city } : {}),
          })
        : undefined;

      writeAudit(database, {
        familyId,
        actorUserId: auth.userId,
        action: "family_member.created",
        entityType: "family_member",
        entityId: memberId,
        details: { relationshipsCreated: relationships.length, approximateLocationAdded: Boolean(safeLocation) },
      });
      database.prepare("UPDATE families SET updated_at = ? WHERE id = ?").run(now, familyId);
      return {
        member: mapMember(getMemberRow(database, familyId, memberId)),
        relationships,
        ...(relationships[0] ? { relationship: relationships[0] } : {}),
        ...(safeLocation ? { safeLocation } : {}),
      };
    })();

    response.status(201).json(result);
  });

  router.patch("/family-members/:memberId", (request, response) => {
    const { memberId } = parseParams(memberParamsSchema, request.params);
    const input = parseBody(memberPatchSchema, request.body);
    const auth = requireAuth(response);
    const member = requireMemberAccess(database, memberId, auth.userId);
    const membership = getMembership(database, member.family_id, auth.userId);
    const isSelf = membership.linkedMemberId === memberId;
    if (!isSelf) requireFamilyAdmin(membership);

    const columns: Record<string, unknown> = {};
    if (input.displayName !== undefined) columns.display_name = input.displayName;
    if (input.birthDate !== undefined) columns.birth_date = input.birthDate;
    if (input.phone !== undefined) columns.phone = input.phone;
    if (input.email !== undefined) columns.email = input.email;
    if (input.interests !== undefined) columns.interests_json = JSON.stringify(input.interests);
    if (input.notes !== undefined) columns.notes = input.notes;
    if (input.photoUrl !== undefined) columns.photo_url = input.photoUrl;
    columns.updated_at = new Date().toISOString();

    if (input.email !== undefined || input.displayName !== undefined || input.birthDate !== undefined) {
      const nextEmail = input.email === undefined ? member.email : input.email;
      const nextBirthDate = input.birthDate === undefined ? member.birth_date : input.birthDate;
      const duplicate = findDuplicateMember(
        database,
        member.family_id,
        {
          displayName: input.displayName ?? member.display_name,
          birthDate: nextBirthDate,
          email: nextEmail,
        },
        memberId,
      );
      if (duplicate) throw new HttpError(409, "MEMBER_EXISTS", "A matching family member already exists.");
    }

    const assignments = Object.keys(columns).map((column) => `${column} = ?`);
    database
      .prepare(`UPDATE family_members SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...Object.values(columns), memberId);
    writeAudit(database, {
      familyId: member.family_id,
      actorUserId: auth.userId,
      action: "family_member.updated",
      entityType: "family_member",
      entityId: memberId,
      details: { changedFields: Object.keys(input) },
    });
    response.json({ member: mapMember(getMemberRow(database, member.family_id, memberId)) });
  });

  router.delete("/family-members/:memberId", (request, response) => {
    const { memberId } = parseParams(memberParamsSchema, request.params);
    const auth = requireAuth(response);
    const member = requireMemberAccess(database, memberId, auth.userId);
    const membership = getMembership(database, member.family_id, auth.userId);
    requireFamilyAdmin(membership);

    if (database.prepare("SELECT 1 FROM family_users WHERE linked_member_id = ? LIMIT 1").get(memberId)) {
      throw new HttpError(409, "MEMBER_HAS_ACCOUNT", "A member linked to a user account cannot be deleted.");
    }
    database.transaction(() => {
      database.prepare("DELETE FROM family_members WHERE id = ?").run(memberId);
      writeAudit(database, {
        familyId: member.family_id,
        actorUserId: auth.userId,
        action: "family_member.deleted",
        entityType: "family_member",
        entityId: memberId,
      });
    })();
    response.status(204).end();
  });

  router.post("/families/:familyId/relationships", (request, response) => {
    const { familyId } = parseParams(familyParamsSchema, request.params);
    const input = parseBody(createRelationshipSchema, request.body);
    const auth = requireAuth(response);
    const membership = getMembership(database, familyId, auth.userId);
    requireFamilyAdmin(membership);
    const relationship = insertRelationship(
      database,
      familyId,
      input.sourceMemberId,
      input.targetMemberId,
      input.type,
    );
    writeAudit(database, {
      familyId,
      actorUserId: auth.userId,
      action: "relationship.created",
      entityType: "relationship",
      entityId: relationship.id,
      details: { type: relationship.type },
    });
    response.status(201).json({ relationship });
  });

  router.delete("/relationships/:id", (request, response) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const auth = requireAuth(response);
    const relationship = database
      .prepare(
        `SELECT r.* FROM relationships r
         JOIN family_users fu ON fu.family_id = r.family_id AND fu.user_id = ?
         WHERE r.id = ?`,
      )
      .get(auth.userId, id) as RelationshipRow | undefined;
    if (!relationship) throw new HttpError(404, "RELATIONSHIP_NOT_FOUND", "Relationship not found.");
    requireFamilyAdmin(getMembership(database, relationship.family_id, auth.userId));
    database.prepare("DELETE FROM relationships WHERE id = ?").run(id);
    writeAudit(database, {
      familyId: relationship.family_id,
      actorUserId: auth.userId,
      action: "relationship.deleted",
      entityType: "relationship",
      entityId: id,
    });
    response.status(204).end();
  });

  router.put("/family-members/:memberId/location", (request, response) => {
    const { memberId } = parseParams(memberParamsSchema, request.params);
    const input = parseBody(updateLocationSchema, request.body);
    const auth = requireAuth(response);
    const member = requireMemberAccess(database, memberId, auth.userId);
    const membership = getMembership(database, member.family_id, auth.userId);
    const isSelf = membership.linkedMemberId === memberId;

    if (!isSelf) {
      requireFamilyAdmin(membership);
      if (input.consentGranted && (input.precision === "exact" || input.source !== "manual")) {
        throw new HttpError(
          403,
          "LOCATION_CONSENT_REQUIRED",
          "Only a member can share their device or exact location. Administrators may record an approximate manual location.",
        );
      }
      if (input.latitude !== undefined || input.longitude !== undefined) {
        throw new HttpError(403, "LOCATION_CONSENT_REQUIRED", "Coordinates can only be shared by the linked member.");
      }
    }

    if (!input.consentGranted) {
      database.transaction(() => {
        const now = new Date().toISOString();
        database
          .prepare("UPDATE location_consents SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL")
          .run(now, memberId);
        database.prepare("DELETE FROM member_locations WHERE member_id = ?").run(memberId);
        writeAudit(database, {
          familyId: member.family_id,
          actorUserId: auth.userId,
          action: "location.revoked",
          entityType: "family_member",
          entityId: memberId,
        });
      })();
      response.json({ safeLocation: null });
      return;
    }

    if (!input.source || !input.precision || !input.visibility) {
      throw new HttpError(400, "VALIDATION_ERROR", "Location source, precision, and visibility are required.");
    }

    const now = new Date().toISOString();
    const consentId = randomUUID();
    const locationId = randomUUID();
    const storedLatitude = quantizeDeviceCoordinate(input.latitude, input.precision);
    const storedLongitude = quantizeDeviceCoordinate(input.longitude, input.precision);
    const storedAccuracy = input.precision === "exact" ? (input.accuracyM ?? null) : null;
    database.transaction(() => {
      database
        .prepare("UPDATE location_consents SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL")
        .run(now, memberId);
      database
        .prepare(
          `INSERT INTO location_consents
           (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          consentId,
          member.family_id,
          memberId,
          auth.userId,
          isSelf ? "self_consent" : "admin_reported",
          input.precision,
          input.visibility,
          now,
        );
      database
        .prepare(
          `INSERT INTO member_locations
           (id, family_id, member_id, consent_id, source, precision, visibility, latitude, longitude,
            accuracy_m, emirate, city, captured_at, expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(member_id) DO UPDATE SET
             id = excluded.id, consent_id = excluded.consent_id, source = excluded.source,
             precision = excluded.precision, visibility = excluded.visibility, latitude = excluded.latitude,
             longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, emirate = excluded.emirate,
             city = excluded.city, captured_at = excluded.captured_at, expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          locationId,
          member.family_id,
          memberId,
          consentId,
          input.source,
          input.precision,
          input.visibility,
          storedLatitude,
          storedLongitude,
          storedAccuracy,
          input.emirate ?? null,
          input.city ?? null,
          now,
          input.expiresAt ?? null,
          now,
        );
      writeAudit(database, {
        familyId: member.family_id,
        actorUserId: auth.userId,
        action: "location.shared",
        entityType: "family_member",
        entityId: memberId,
        details: {
          precision: input.precision,
          visibility: input.visibility,
          source: input.source,
          coordinatesQuantized: input.latitude !== undefined && input.precision !== "exact",
        },
      });
    })();

    response.json({
      safeLocation: {
        memberId,
        source: input.source,
        precision: input.precision,
        visibility: input.visibility,
        ...(input.emirate ? { emirate: input.emirate } : {}),
        ...(input.city ? { city: input.city } : {}),
        capturedAt: now,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
    });
  });

  return router;
}
