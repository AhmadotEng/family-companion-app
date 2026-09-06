import { randomUUID } from "node:crypto";
import type { Application } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  GATHERING_PLANNER_TYPES,
  GEMINI_RESPONSE_JSON_SCHEMA,
  addMemberPayloadSchema,
  agentActionSchema,
  completeGatheringPayloadSchema,
  createGatheringDraftPayloadSchema,
  createNoteMemoryPayloadSchema,
  createRelationshipPayloadSchema,
  deleteMemberPayloadSchema,
  deleteMemoryPayloadSchema,
  deleteRelationshipPayloadSchema,
  gatheringPlannerPayloadSchema,
  prepareInvitationLinksPayloadSchema,
  reconnectionPlanPayloadSchema,
  updateMemberPayloadSchema,
  updatePlanStatusPayloadSchema,
  type AgentAction,
  type AgentProvider,
} from "../server/agent.js";
import { createApp } from "../server/app.js";
import { openDatabase, type AppDatabase } from "../server/database.js";
import type { FamilyRole } from "../server/domain.js";

const TEST_NOW = new Date("2026-08-13T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();

const ACTION_TYPES = [
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
] as const;

const RELATIONSHIP_TYPES = ["parent", "spouse", "sibling", "guardian", "relative"] as const;
const RELATIONSHIP_DIRECTIONS = ["new_to_existing", "existing_to_new"] as const;
const RECONNECTION_FORMATS = ["home_visit", "phone_call", "video_call", "family_meal", "outing", "other"] as const;
const INVITATION_CHANNELS = ["share_link", "whatsapp"] as const;
const MEMORY_VISIBILITIES = ["private", "family_admin", "family", "selected"] as const;
const MEMORY_TYPES = ["note", "photo", "video", "audio"] as const;
const PLAN_STATUSES = ["active", "accepted", "dismissed", "completed"] as const;
const PLAN_TARGET_STATUSES = ["accepted", "dismissed", "completed"] as const;
const ALLOWED_PLAN_TRANSITIONS: Record<
  (typeof PLAN_STATUSES)[number],
  readonly (typeof PLAN_TARGET_STATUSES)[number][]
> = {
  active: ["accepted", "dismissed"],
  accepted: ["dismissed", "completed"],
  dismissed: ["accepted"],
  completed: [],
};
const GATHERING_STATUSES = ["draft", "inviting", "completed", "cancelled"] as const;
const INVITATION_STATUSES = ["pending", "going", "maybe", "declined"] as const;
const SESSION_STATUSES = ["active", "closed"] as const;
const PROPOSAL_STATUSES = ["pending", "confirmed", "rejected"] as const;
const MESSAGE_ROLES = ["user", "assistant"] as const;
const MESSAGE_KINDS = ["message", "clarification", "proposal", "result", "gathering_planner"] as const;
const FIRST_PERSON_RELATIONSHIPS = [
  { term: "brother", type: "sibling", direction: "new_to_existing" },
  { term: "sister", type: "sibling", direction: "new_to_existing" },
  { term: "parent", type: "parent", direction: "new_to_existing" },
  { term: "mother", type: "parent", direction: "new_to_existing" },
  { term: "father", type: "parent", direction: "new_to_existing" },
  { term: "child", type: "parent", direction: "existing_to_new" },
  { term: "son", type: "parent", direction: "existing_to_new" },
  { term: "daughter", type: "parent", direction: "existing_to_new" },
  { term: "spouse", type: "spouse", direction: "new_to_existing" },
  { term: "wife", type: "spouse", direction: "new_to_existing" },
  { term: "husband", type: "spouse", direction: "new_to_existing" },
] as const;

type ActionType = (typeof ACTION_TYPES)[number];
type HttpAgent = ReturnType<typeof request.agent>;

interface RegisteredFamily {
  familyId: string;
  memberId: string;
  userId: string;
}

interface MatrixFixture {
  action: AgentAction;
  actor: RegisteredFamily;
  browser: HttpAgent;
  database: AppDatabase;
  intruder: RegisteredFamily;
  intruderBrowser: HttpAgent;
}

type FixtureActionBuilder = (
  database: AppDatabase,
  actor: RegisteredFamily,
  intruder: RegisteredFamily,
) => AgentAction;

const openDatabases: AppDatabase[] = [];

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close();
});

function database(): AppDatabase {
  const value = openDatabase({ path: ":memory:" });
  openDatabases.push(value);
  return value;
}

async function register(
  browser: HttpAgent,
  db: AppDatabase,
  identity: { email: string; displayName: string; familyName: string },
): Promise<RegisteredFamily> {
  const response = await browser
    .post("/api/auth/register")
    .send({ ...identity, password: "a-secure-password" })
    .expect(201);
  const family = response.body.families[0] as { id: string; linkedMemberId: string };
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(identity.email) as { id: string };
  return { familyId: family.id, memberId: family.linkedMemberId, userId: user.id };
}

function providerFor(readAction: () => AgentAction): AgentProvider {
  return {
    providerName: "action-matrix",
    modelName: "deterministic-test-double",
    generate: async () => ({
      kind: "proposal",
      message: "Review this exact action before deciding whether to confirm it.",
      action: readAction(),
    }),
  };
}

function addUnlinkedMember(db: AppDatabase, familyId: string, displayName: string): string {
  const memberId = randomUUID();
  db.prepare(
    `INSERT INTO family_members
     (id, family_id, display_name, interests_json, created_at, updated_at)
     VALUES (?, ?, ?, '[]', ?, ?)`,
  ).run(memberId, familyId, displayName, TEST_NOW_ISO, TEST_NOW_ISO);
  return memberId;
}

function addRelationship(
  db: AppDatabase,
  familyId: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: "parent" | "spouse" | "sibling" | "guardian" | "relative" = "relative",
): string {
  const relationshipId = randomUUID();
  db.prepare(
    `INSERT INTO relationships
     (id, family_id, source_member_id, target_member_id, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(relationshipId, familyId, sourceMemberId, targetMemberId, type, TEST_NOW_ISO);
  return relationshipId;
}

function addGathering(
  db: AppDatabase,
  familyId: string,
  creatorUserId: string,
  status: "draft" | "inviting" | "completed" | "cancelled",
  title = "Matrix gathering",
): string {
  const gatheringId = randomUUID();
  const startAt = status === "draft" ? "2026-08-15T13:00:00.000Z" : "2026-08-12T12:00:00.000Z";
  db.prepare(
    `INSERT INTO gatherings
     (id, family_id, title, purpose, start_at, timezone, location_name, notes,
      gathering_type, status, created_by_user_id, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Exercise the action matrix', ?, 'Asia/Dubai', 'Family home', NULL,
             'Family gathering', ?, ?, ?, ?, ?)`,
  ).run(
    gatheringId,
    familyId,
    title,
    startAt,
    status,
    creatorUserId,
    status === "completed" ? TEST_NOW_ISO : null,
    TEST_NOW_ISO,
    TEST_NOW_ISO,
  );
  return gatheringId;
}

function addInvitation(
  db: AppDatabase,
  gatheringId: string,
  memberId: string,
  status: "pending" | "going" | "maybe" | "declined" = "going",
): string {
  const invitationId = randomUUID();
  db.prepare(
    `INSERT INTO gathering_invitations
     (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
     VALUES (?, ?, ?, 'share_link', ?, ?, ?, ?)`,
  ).run(invitationId, gatheringId, memberId, `matrix-token-${randomUUID()}`, status, TEST_NOW_ISO, TEST_NOW_ISO);
  return invitationId;
}

function addMemory(
  db: AppDatabase,
  familyId: string,
  creatorUserId: string,
  options: {
    memoryType?: "note" | "photo" | "video" | "audio";
    visibility?: "private" | "family_admin" | "family" | "selected";
  } = {},
): string {
  const memoryId = randomUUID();
  db.prepare(
    `INSERT INTO memories
     (id, family_id, gathering_id, created_by_user_id, title, note, memory_type, visibility,
      ai_processing_allowed, captured_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'Matrix memory', 'A consented matrix note', ?, ?, 1, ?, ?, ?)`,
  ).run(
    memoryId,
    familyId,
    creatorUserId,
    options.memoryType ?? "note",
    options.visibility ?? "family",
    TEST_NOW_ISO,
    TEST_NOW_ISO,
    TEST_NOW_ISO,
  );
  return memoryId;
}

function addPlan(
  db: AppDatabase,
  familyId: string,
  creatorUserId: string,
  status: "active" | "accepted" | "dismissed" | "completed" = "active",
): string {
  const planId = randomUUID();
  db.prepare(
    `INSERT INTO reconnection_plans
     (id, family_id, created_by_user_id, title, rationale, suggested_member_ids_json,
      suggested_gathering_json, evidence_json, status, provider, model, created_at, updated_at)
     VALUES (?, ?, ?, 'Matrix plan', 'A neutral plan', '[]', '{}', '[]', ?, 'test', 'test-model', ?, ?)`,
  ).run(planId, familyId, creatorUserId, status, TEST_NOW_ISO, TEST_NOW_ISO);
  return planId;
}

function buildAction(
  db: AppDatabase,
  actor: RegisteredFamily,
  type: ActionType,
  resourceCreatorUserId = actor.userId,
): AgentAction {
  if (type === "ADD_MEMBER") {
    return {
      type,
      payload: {
        displayName: "Matrix Added Relative",
        interests: ["Testing"],
        relationships: [{
          existingMemberId: actor.memberId,
          type: "relative",
          direction: "new_to_existing",
        }],
      },
    };
  }
  if (type === "UPDATE_MEMBER") {
    return { type, payload: { memberId: actor.memberId, changes: { notes: "Matrix update" } } };
  }
  if (type === "DELETE_MEMBER") {
    return { type, payload: { memberId: addUnlinkedMember(db, actor.familyId, "Matrix Removed Relative") } };
  }
  if (type === "CREATE_RELATIONSHIP") {
    return {
      type,
      payload: {
        sourceMemberId: actor.memberId,
        targetMemberId: addUnlinkedMember(db, actor.familyId, "Matrix Relationship Target"),
        type: "guardian",
      },
    };
  }
  if (type === "DELETE_RELATIONSHIP") {
    const targetMemberId = addUnlinkedMember(db, actor.familyId, "Matrix Disconnected Relative");
    return {
      type,
      payload: {
        relationshipId: addRelationship(db, actor.familyId, actor.memberId, targetMemberId, "sibling"),
      },
    };
  }
  if (type === "CREATE_RECONNECTION_PLAN") {
    const targetMemberId = addUnlinkedMember(db, actor.familyId, "Matrix Plan Relative");
    return {
      type,
      payload: {
        title: "A calm matrix catch-up",
        rationale: "A short optional visit could provide time together.",
        suggestedMemberIds: [targetMemberId],
        evidenceSignalIds: ["family.member_count"],
        suggestedGathering: {
          format: "other",
          purpose: "Spend a little time together.",
          durationMinutes: 30,
        },
        rewardChallenge: "Preserve a shared memory afterward if everyone agrees.",
      },
    };
  }
  if (type === "CREATE_GATHERING_DRAFT") {
    return {
      type,
      payload: {
        title: "Matrix family tea",
        purpose: "Spend time together",
        startAt: "2026-08-15T17:00:00+04:00",
        timezone: "Asia/Dubai",
        locationName: "Family home",
        type: "Family gathering",
      },
    };
  }
  if (type === "PREPARE_INVITATION_LINKS") {
    const inviteeId = addUnlinkedMember(db, actor.familyId, "Matrix Invitee");
    const gatheringId = addGathering(db, actor.familyId, resourceCreatorUserId, "draft", "Matrix invitations");
    return { type, payload: { gatheringId, memberIds: [inviteeId], channel: "share_link" } };
  }
  if (type === "COMPLETE_GATHERING") {
    const attendeeId = addUnlinkedMember(db, actor.familyId, "Matrix Second Attendee");
    const gatheringId = addGathering(db, actor.familyId, resourceCreatorUserId, "inviting", "Matrix completion");
    addInvitation(db, gatheringId, actor.memberId, "going");
    addInvitation(db, gatheringId, attendeeId, "going");
    return { type, payload: { gatheringId, confirmAttendeeMemberIds: [actor.memberId, attendeeId] } };
  }
  if (type === "CREATE_NOTE_MEMORY") {
    const gatheringId = addGathering(db, actor.familyId, resourceCreatorUserId, "completed", "Matrix memory source");
    return {
      type,
      payload: {
        gatheringId,
        title: "Matrix written memory",
        note: "We enjoyed tea and shared family stories.",
        visibility: "family",
        selectedMemberIds: [],
      },
    };
  }
  if (type === "DELETE_MEMORY") {
    return { type, payload: { memoryId: addMemory(db, actor.familyId, resourceCreatorUserId) } };
  }
  return {
    type: "UPDATE_PLAN_STATUS",
    payload: { planId: addPlan(db, actor.familyId, resourceCreatorUserId), status: "accepted" },
  };
}

async function createCustomFixture(role: FamilyRole, actionBuilder: FixtureActionBuilder): Promise<MatrixFixture> {
  const db = database();
  let action: AgentAction;
  const app = createApp({
    database: db,
    agentProvider: providerFor(() => action),
    bcryptRounds: 4,
    rateLimitEnabled: false,
    now: () => TEST_NOW,
  });
  const browser = request.agent(app);
  const actor = await register(browser, db, {
    email: `matrix-${role}-${randomUUID()}@example.test`,
    displayName: "Matrix Actor",
    familyName: "Action Matrix Family",
  });
  db.prepare("UPDATE family_users SET role = ? WHERE family_id = ? AND user_id = ?")
    .run(role, actor.familyId, actor.userId);

  const intruderBrowser = request.agent(app);
  const intruder = await register(intruderBrowser, db, {
    email: `matrix-intruder-${randomUUID()}@example.test`,
    displayName: "Matrix Intruder",
    familyName: "Intruder Temporary Family",
  });
  db.prepare(
    `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
     VALUES (?, ?, 'admin', NULL, ?)`,
  ).run(actor.familyId, intruder.userId, TEST_NOW_ISO);

  action = actionBuilder(db, actor, intruder);
  return {
    action,
    actor,
    browser,
    database: db,
    intruder,
    intruderBrowser,
  };
}


async function createFixture(role: FamilyRole, type: ActionType): Promise<MatrixFixture> {
  return createCustomFixture(role, (db, actor) => buildAction(db, actor, type));
}

function rows(db: AppDatabase, sql: string, ...parameters: unknown[]): unknown[] {
  return db.prepare(sql).all(...parameters);
}

function familyDomainSnapshot(db: AppDatabase, familyId: string): string {
  return JSON.stringify({
    memberships: rows(
      db,
      "SELECT user_id, role, linked_member_id FROM family_users WHERE family_id = ? ORDER BY user_id",
      familyId,
    ),
    members: rows(
      db,
      `SELECT id, user_id, display_name, birth_date, phone, email, interests_json, notes, photo_url,
              created_at, updated_at FROM family_members WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    relationships: rows(
      db,
      `SELECT id, source_member_id, target_member_id, type, created_at
       FROM relationships WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    locations: rows(
      db,
      `SELECT id, member_id, consent_id, source, precision, city, emirate, latitude, longitude,
              accuracy_m, visibility, captured_at, expires_at, updated_at
       FROM member_locations WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    locationConsents: rows(
      db,
      `SELECT id, member_id, basis, precision, visibility, granted_at, revoked_at
       FROM location_consents WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    gatherings: rows(
      db,
      `SELECT id, title, purpose, start_at, timezone, location_name, notes, gathering_type, status,
              created_by_user_id, completed_at, created_at, updated_at
       FROM gatherings WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    invitations: rows(
      db,
      `SELECT gi.id, gi.gathering_id, gi.member_id, gi.channel, gi.token_hash, gi.status,
              gi.prepared_at, gi.opened_at, gi.responded_at, gi.updated_at
       FROM gathering_invitations gi
       JOIN gatherings g ON g.id = gi.gathering_id
       WHERE g.family_id = ? ORDER BY gi.id`,
      familyId,
    ),
    memories: rows(
      db,
      `SELECT id, gathering_id, created_by_user_id, title, note, memory_type, visibility,
              ai_processing_allowed, storage_path, captured_at, created_at, updated_at
       FROM memories WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    memoryViewers: rows(
      db,
      `SELECT mv.memory_id, mv.member_id FROM memory_viewers mv
       JOIN memories m ON m.id = mv.memory_id WHERE m.family_id = ? ORDER BY mv.memory_id, mv.member_id`,
      familyId,
    ),
    plans: rows(
      db,
      `SELECT id, created_by_user_id, title, rationale, suggested_member_ids_json,
              suggested_gathering_json, suggested_activity_id, reward_challenge, evidence_json,
              status, provider, model, created_at, updated_at
       FROM reconnection_plans WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
    rewards: rows(
      db,
      `SELECT id, points, reason_code, description, entity_type, entity_id, dedupe_key, created_at
       FROM reward_ledger WHERE family_id = ? ORDER BY id`,
      familyId,
    ),
  });
}

function count(db: AppDatabase, sql: string, ...parameters: unknown[]): number {
  return (db.prepare(sql).get(...parameters) as { count: number }).count;
}

function expectActionOutcomeAppliedExactlyOnce(
  db: AppDatabase,
  familyId: string,
  action: AgentAction,
): void {
  if (action.type === "ADD_MEMBER") {
    expect(count(
      db,
      "SELECT COUNT(*) AS count FROM family_members WHERE family_id = ? AND display_name = ?",
      familyId,
      action.payload.displayName,
    )).toBe(1);
    return;
  }
  if (action.type === "UPDATE_MEMBER") {
    expect(db.prepare("SELECT notes FROM family_members WHERE family_id = ? AND id = ?")
      .get(familyId, action.payload.memberId)).toMatchObject({ notes: action.payload.changes.notes });
    return;
  }
  if (action.type === "DELETE_MEMBER") {
    expect(db.prepare("SELECT id FROM family_members WHERE family_id = ? AND id = ?")
      .get(familyId, action.payload.memberId)).toBeUndefined();
    return;
  }
  if (action.type === "CREATE_RELATIONSHIP") {
    expect(count(
      db,
      `SELECT COUNT(*) AS count FROM relationships
       WHERE family_id = ? AND source_member_id = ? AND target_member_id = ? AND type = ?`,
      familyId,
      action.payload.sourceMemberId,
      action.payload.targetMemberId,
      action.payload.type,
    )).toBe(1);
    return;
  }
  if (action.type === "DELETE_RELATIONSHIP") {
    expect(db.prepare("SELECT id FROM relationships WHERE family_id = ? AND id = ?")
      .get(familyId, action.payload.relationshipId)).toBeUndefined();
    return;
  }
  if (action.type === "CREATE_RECONNECTION_PLAN") {
    expect(count(
      db,
      "SELECT COUNT(*) AS count FROM reconnection_plans WHERE family_id = ? AND title = ?",
      familyId,
      action.payload.title,
    )).toBe(1);
    return;
  }
  if (action.type === "CREATE_GATHERING_DRAFT") {
    expect(count(
      db,
      "SELECT COUNT(*) AS count FROM gatherings WHERE family_id = ? AND title = ?",
      familyId,
      action.payload.title,
    )).toBe(1);
    return;
  }
  if (action.type === "PREPARE_INVITATION_LINKS") {
    for (const memberId of action.payload.memberIds) {
      expect(count(
        db,
        `SELECT COUNT(*) AS count FROM gathering_invitations
         WHERE gathering_id = ? AND member_id = ? AND status = 'pending'`,
        action.payload.gatheringId,
        memberId,
      )).toBe(1);
    }
    return;
  }
  if (action.type === "COMPLETE_GATHERING") {
    expect(db.prepare("SELECT status FROM gatherings WHERE family_id = ? AND id = ?")
      .get(familyId, action.payload.gatheringId)).toEqual({ status: "completed" });
    return;
  }
  if (action.type === "CREATE_NOTE_MEMORY") {
    expect(count(
      db,
      `SELECT COUNT(*) AS count FROM memories
       WHERE family_id = ? AND gathering_id = ? AND title = ? AND ai_processing_allowed = 0`,
      familyId,
      action.payload.gatheringId,
      action.payload.title,
    )).toBe(1);
    return;
  }
  if (action.type === "DELETE_MEMORY") {
    expect(db.prepare("SELECT id FROM memories WHERE family_id = ? AND id = ?")
      .get(familyId, action.payload.memoryId)).toBeUndefined();
    return;
  }
  expect(db.prepare("SELECT status FROM reconnection_plans WHERE family_id = ? AND id = ?")
    .get(familyId, action.payload.planId)).toEqual({ status: action.payload.status });
}

function expectFailedConfirmationRolledBack(
  fixture: MatrixFixture,
  proposalId: string,
  expectedDomain: string,
  expectedAuditCount: number,
): void {
  expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
    .toEqual({ status: "pending" });
  expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(expectedDomain);
  expect(count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events")).toBe(expectedAuditCount);
}

const MEMBER_ALLOWED_ACTIONS = new Set<ActionType>([
  "UPDATE_MEMBER",
  "CREATE_RECONNECTION_PLAN",
  "CREATE_GATHERING_DRAFT",
  "PREPARE_INVITATION_LINKS",
  "CREATE_NOTE_MEMORY",
  "DELETE_MEMORY",
  "UPDATE_PLAN_STATUS",
]);

const ROLE_ACTION_MATRIX = (["owner", "admin", "member"] as const).flatMap((role) =>
  ACTION_TYPES.map((type) => ({
    role,
    type,
    allowed: role !== "member" || MEMBER_ALLOWED_ACTIONS.has(type),
  })),
);

function schemaAction(type: ActionType): AgentAction {
  const firstId = "10000000-0000-4000-8000-000000000101";
  const secondId = "10000000-0000-4000-8000-000000000102";
  if (type === "ADD_MEMBER") {
    return {
      type,
      payload: {
        displayName: "Schema Relative",
        interests: [],
        relationships: [{ existingMemberId: firstId, type: "relative", direction: "new_to_existing" }],
      },
    };
  }
  if (type === "UPDATE_MEMBER") {
    return { type, payload: { memberId: firstId, changes: { displayName: "Updated Name" } } };
  }
  if (type === "DELETE_MEMBER") return { type, payload: { memberId: firstId } };
  if (type === "CREATE_RELATIONSHIP") {
    return { type, payload: { sourceMemberId: firstId, targetMemberId: secondId, type: "sibling" } };
  }
  if (type === "DELETE_RELATIONSHIP") return { type, payload: { relationshipId: firstId } };
  if (type === "CREATE_RECONNECTION_PLAN") {
    return {
      type,
      payload: {
        title: "Schema plan",
        rationale: "Use supported administrative evidence only.",
        suggestedMemberIds: [firstId],
        evidenceSignalIds: ["family.member_count"],
        suggestedGathering: {
          format: "other",
          purpose: "Spend time together",
          durationMinutes: 30,
        },
        rewardChallenge: "Save a memory with consent.",
      },
    };
  }
  if (type === "CREATE_GATHERING_DRAFT") {
    return {
      type,
      payload: {
        title: "Schema gathering",
        purpose: "Spend time together",
        startAt: "2026-09-01T17:00:00+04:00",
        timezone: "Asia/Dubai",
        locationName: "Family home",
        type: "Family gathering",
      },
    };
  }
  if (type === "PREPARE_INVITATION_LINKS") {
    return { type, payload: { gatheringId: firstId, memberIds: [secondId], channel: "share_link" } };
  }
  if (type === "COMPLETE_GATHERING") {
    return { type, payload: { gatheringId: firstId, confirmAttendeeMemberIds: [firstId, secondId] } };
  }
  if (type === "CREATE_NOTE_MEMORY") {
    return {
      type,
      payload: {
        gatheringId: firstId,
        title: "Schema memory",
        note: "A supported written memory.",
        visibility: "family",
        selectedMemberIds: [],
      },
    };
  }
  if (type === "DELETE_MEMORY") return { type, payload: { memoryId: firstId } };
  return { type: "UPDATE_PLAN_STATUS", payload: { planId: firstId, status: "accepted" } };
}

function schemaReconnectionPlanPayload(): Extract<AgentAction, { type: "CREATE_RECONNECTION_PLAN" }>["payload"] {
  const action = schemaAction("CREATE_RECONNECTION_PLAN");
  if (action.type !== "CREATE_RECONNECTION_PLAN") throw new Error("Reconnection schema fixture is misconfigured.");
  return action.payload;
}

describe("backend AI action matrix", () => {
  it("keeps every executable action registry in exact lockstep", () => {
    const geminiTypes = GEMINI_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum;
    expect(geminiTypes).toEqual(ACTION_TYPES);
    expect(new Set(geminiTypes).size).toBe(ACTION_TYPES.length);
    for (const type of ACTION_TYPES) {
      expect(agentActionSchema.safeParse(schemaAction(type)).success, type).toBe(true);
    }
    expect(agentActionSchema.safeParse({ type: "UNREGISTERED_ACTION", payload: {} }).success).toBe(false);
  });

  it.each(ACTION_TYPES)("enforces required fields and strict payload boundaries for %s", (type) => {
    const valid = schemaAction(type) as unknown as { type: ActionType; payload: Record<string, unknown> };
    expect(agentActionSchema.safeParse(valid).success).toBe(true);
    expect(agentActionSchema.safeParse({ ...valid, unexpectedActionField: true }).success).toBe(false);
    expect(agentActionSchema.safeParse({ type }).success).toBe(false);
    expect(agentActionSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, unexpectedPayloadField: true },
    }).success).toBe(false);
  });

  it.each(RELATIONSHIP_TYPES)("accepts relationship type %s everywhere an AI action can express it", (type) => {
    const existingMemberId = randomUUID();
    const sourceMemberId = randomUUID();
    const targetMemberId = randomUUID();
    expect(addMemberPayloadSchema.safeParse({
      displayName: "Relationship Matrix",
      interests: [],
      relationships: [{ existingMemberId, type, direction: "new_to_existing" }],
    }).success).toBe(true);
    expect(createRelationshipPayloadSchema.safeParse({ sourceMemberId, targetMemberId, type }).success).toBe(true);
  });

  it.each(RELATIONSHIP_DIRECTIONS)("accepts initial-member relationship direction %s", (direction) => {
    expect(addMemberPayloadSchema.safeParse({
      displayName: "Direction Matrix",
      interests: [],
      relationships: [{ existingMemberId: randomUUID(), type: "parent", direction }],
    }).success).toBe(true);
  });

  it.each(RECONNECTION_FORMATS)("accepts reconnection gathering format %s", (format) => {
    const payload = schemaReconnectionPlanPayload();
    expect(reconnectionPlanPayloadSchema.safeParse({
      ...payload,
      suggestedGathering: { ...payload.suggestedGathering, format },
    }).success).toBe(true);
  });

  it.each(GATHERING_PLANNER_TYPES)("accepts the fixed gathering-planner type %s", (type) => {
    expect(gatheringPlannerPayloadSchema.safeParse({
      title: "Planner matrix",
      purpose: "Spend time together",
      startAt: "2026-09-01T17:00:00+04:00",
      timezone: "Asia/Dubai",
      locationName: "Family home",
      type,
      memberIds: [],
      invitationChannel: "share_link",
    }).success).toBe(true);
  });

  it.each(INVITATION_CHANNELS)("accepts invitation channel %s in planner and invitation actions", (channel) => {
    expect(prepareInvitationLinksPayloadSchema.safeParse({
      gatheringId: randomUUID(),
      memberIds: [randomUUID()],
      channel,
    }).success).toBe(true);
    expect(gatheringPlannerPayloadSchema.safeParse({
      title: "Channel matrix",
      purpose: "Spend time together",
      startAt: "2026-09-01T17:00:00+04:00",
      timezone: "Asia/Dubai",
      locationName: "Family home",
      type: "Family gathering",
      memberIds: [],
      invitationChannel: channel,
    }).success).toBe(true);
  });

  it.each(MEMORY_VISIBILITIES)("accepts written-memory visibility %s with its required viewer shape", (visibility) => {
    expect(createNoteMemoryPayloadSchema.safeParse({
      gatheringId: randomUUID(),
      title: "Visibility matrix",
      note: "A written memory",
      visibility,
      selectedMemberIds: visibility === "selected" ? [randomUUID()] : [],
    }).success).toBe(true);
  });

  it.each(PLAN_TARGET_STATUSES)("accepts reconnection-plan target status %s", (status) => {
    expect(updatePlanStatusPayloadSchema.safeParse({ planId: randomUUID(), status }).success).toBe(true);
  });

  it("rejects every out-of-domain enum and action-specific lower/upper boundary", () => {
    const id = randomUUID();
    const otherId = randomUUID();
    const invalidCases: Array<{ label: string; success: boolean }> = [
      {
        label: "ADD_MEMBER display-name minimum",
        success: addMemberPayloadSchema.safeParse({ displayName: "x", interests: [], relationships: [] }).success,
      },
      {
        label: "ADD_MEMBER relationship maximum",
        success: addMemberPayloadSchema.safeParse({
          displayName: "Too Connected",
          interests: [],
          relationships: Array.from({ length: 9 }, () => ({
            existingMemberId: randomUUID(),
            type: "relative",
            direction: "new_to_existing",
          })),
        }).success,
      },
      {
        label: "UPDATE_MEMBER empty changes",
        success: updateMemberPayloadSchema.safeParse({ memberId: id, changes: {} }).success,
      },
      {
        label: "DELETE_MEMBER UUID",
        success: deleteMemberPayloadSchema.safeParse({ memberId: "not-a-uuid" }).success,
      },
      {
        label: "CREATE_RELATIONSHIP type",
        success: createRelationshipPayloadSchema.safeParse({
          sourceMemberId: id,
          targetMemberId: otherId,
          type: "cousin",
        }).success,
      },
      {
        label: "DELETE_RELATIONSHIP UUID",
        success: deleteRelationshipPayloadSchema.safeParse({ relationshipId: "not-a-uuid" }).success,
      },
      {
        label: "CREATE_RECONNECTION_PLAN attendee minimum",
        success: reconnectionPlanPayloadSchema.safeParse({
          ...schemaAction("CREATE_RECONNECTION_PLAN").payload,
          suggestedMemberIds: [],
        }).success,
      },
      {
        label: "CREATE_RECONNECTION_PLAN duration minimum",
        success: reconnectionPlanPayloadSchema.safeParse({
          ...schemaReconnectionPlanPayload(),
          suggestedGathering: {
            ...schemaReconnectionPlanPayload().suggestedGathering,
            durationMinutes: 14,
          },
        }).success,
      },
      {
        label: "CREATE_GATHERING_DRAFT timezone",
        success: createGatheringDraftPayloadSchema.safeParse({
          ...schemaAction("CREATE_GATHERING_DRAFT").payload,
          timezone: "UTC",
        }).success,
      },
      {
        label: "PREPARE_INVITATION_LINKS attendee minimum",
        success: prepareInvitationLinksPayloadSchema.safeParse({
          gatheringId: id,
          memberIds: [],
          channel: "share_link",
        }).success,
      },
      {
        label: "COMPLETE_GATHERING attendee minimum",
        success: completeGatheringPayloadSchema.safeParse({
          gatheringId: id,
          confirmAttendeeMemberIds: [otherId],
        }).success,
      },
      {
        label: "CREATE_NOTE_MEMORY selected viewer minimum",
        success: createNoteMemoryPayloadSchema.safeParse({
          gatheringId: id,
          title: "Selected memory",
          note: "A written memory",
          visibility: "selected",
          selectedMemberIds: [],
        }).success,
      },
      {
        label: "DELETE_MEMORY UUID",
        success: deleteMemoryPayloadSchema.safeParse({ memoryId: "not-a-uuid" }).success,
      },
      {
        label: "UPDATE_PLAN_STATUS status",
        success: updatePlanStatusPayloadSchema.safeParse({ planId: id, status: "active" }).success,
      },
      {
        label: "gathering planner type",
        success: gatheringPlannerPayloadSchema.safeParse({
          title: "Invalid planner",
          purpose: "Spend time together",
          startAt: "2026-09-01T17:00:00+04:00",
          timezone: "Asia/Dubai",
          locationName: "Family home",
          type: "Road trip",
          memberIds: [],
          invitationChannel: "share_link",
        }).success,
      },
    ];
    expect(invalidCases.filter((entry) => entry.success).map((entry) => entry.label)).toEqual([]);
  });

  it("enforces every finite agent-storage option in the migrated SQLite schema", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: providerFor(() => schemaAction("CREATE_GATHERING_DRAFT")),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const actor = await register(browser, db, {
      email: `matrix-storage-${randomUUID()}@example.test`,
      displayName: "Storage Matrix Actor",
      familyName: "Storage Matrix Family",
    });

    const sessionIds = new Map<string, string>();
    for (const status of SESSION_STATUSES) {
      const sessionId = randomUUID();
      sessionIds.set(status, sessionId);
      expect(() => db.prepare(
        `INSERT INTO agent_sessions
         (id, family_id, created_by_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(sessionId, actor.familyId, actor.userId, status, TEST_NOW_ISO, TEST_NOW_ISO)).not.toThrow();
    }
    expect(() => db.prepare(
      `INSERT INTO agent_sessions
       (id, family_id, created_by_user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'paused', ?, ?)`,
    ).run(randomUUID(), actor.familyId, actor.userId, TEST_NOW_ISO, TEST_NOW_ISO)).toThrow();

    let messageOrder = 1;
    for (const role of MESSAGE_ROLES) {
      for (const kind of MESSAGE_KINDS) {
        expect(() => db.prepare(
          `INSERT INTO agent_messages
           (id, session_id, role, kind, content_text, payload_json, message_order, created_at)
           VALUES (?, ?, ?, ?, 'matrix', NULL, ?, ?)`,
        ).run(randomUUID(), sessionIds.get("active"), role, kind, messageOrder, TEST_NOW_ISO)).not.toThrow();
        messageOrder += 1;
      }
    }
    expect(() => db.prepare(
      `INSERT INTO agent_messages
       (id, session_id, role, kind, content_text, payload_json, message_order, created_at)
       VALUES (?, ?, 'system', 'message', 'matrix', NULL, ?, ?)`,
    ).run(randomUUID(), sessionIds.get("active"), messageOrder, TEST_NOW_ISO)).toThrow();
    expect(() => db.prepare(
      `INSERT INTO agent_messages
       (id, session_id, role, kind, content_text, payload_json, message_order, created_at)
       VALUES (?, ?, 'assistant', 'tool', 'matrix', NULL, ?, ?)`,
    ).run(randomUUID(), sessionIds.get("active"), messageOrder, TEST_NOW_ISO)).toThrow();

    for (const actionType of ACTION_TYPES) {
      for (const status of PROPOSAL_STATUSES) {
        expect(() => db.prepare(
          `INSERT INTO agent_action_proposals
           (id, session_id, family_id, created_by_user_id, action_type, payload_json,
            title, summary, warnings_json, status, created_at, updated_at, expires_at,
            confirmed_at, rejected_at)
           VALUES (?, ?, ?, ?, ?, '{}', 'matrix', 'matrix', '[]', ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          sessionIds.get("active"),
          actor.familyId,
          actor.userId,
          actionType,
          status,
          TEST_NOW_ISO,
          TEST_NOW_ISO,
          "2026-08-14T12:00:00.000Z",
          status === "confirmed" ? TEST_NOW_ISO : null,
          status === "rejected" ? TEST_NOW_ISO : null,
        )).not.toThrow();
      }
    }
    expect(() => db.prepare(
      `INSERT INTO agent_action_proposals
       (id, session_id, family_id, created_by_user_id, action_type, payload_json,
        title, summary, warnings_json, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, 'UNREGISTERED_ACTION', '{}', 'matrix', 'matrix', '[]',
               'pending', ?, ?, ?)`,
    ).run(
      randomUUID(),
      sessionIds.get("active"),
      actor.familyId,
      actor.userId,
      TEST_NOW_ISO,
      TEST_NOW_ISO,
      "2026-08-14T12:00:00.000Z",
    )).toThrow();
  });

  it.each(FIRST_PERSON_RELATIONSHIPS)(
    "grounds 'my $term' as $type / $direction instead of trusting the provider",
    async ({ term, type, direction }) => {
      const fixture = await createCustomFixture("owner", (_db, actor) => ({
        type: "ADD_MEMBER",
        payload: {
          displayName: "First Person Matrix",
          interests: [],
          // Deliberately wrong: the deterministic request parser must replace
          // the provider's requester link before previewing the action.
          relationships: [{
            existingMemberId: actor.memberId,
            type: "relative",
            direction: direction === "new_to_existing" ? "existing_to_new" : "new_to_existing",
          }],
        },
      }));
      const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Add my ${term} First Person Matrix.` })
        .expect(201);
      expect(proposed.body.proposal.details.relationships).toEqual([
        expect.objectContaining({ existingMember: "Matrix Actor", type, direction }),
      ]);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
      await fixture.browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/reject`).expect(200);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    },
  );

  it.each(RELATIONSHIP_TYPES.flatMap((type) =>
    RELATIONSHIP_DIRECTIONS.map((direction) => ({ type, direction }))))(
    "applies ADD_MEMBER relationship $type / $direction with exact source-target direction",
    async ({ type, direction }) => {
      const fixture = await createCustomFixture("owner", (_db, actor) => ({
        type: "ADD_MEMBER",
        payload: {
          displayName: "Directed Matrix Relative",
          interests: [],
          relationships: [{ existingMemberId: actor.memberId, type, direction }],
        },
      }));
      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: "Prepare this exact directed family profile." })
        .expect(201);
      const confirmed = await fixture.browser
        .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
        .expect(200);
      const newMemberId = confirmed.body.result.memberId as string;
      const relationship = fixture.database.prepare(
        `SELECT source_member_id, target_member_id, type FROM relationships
         WHERE family_id = ? AND (source_member_id = ? OR target_member_id = ?)`,
      ).get(fixture.actor.familyId, newMemberId, newMemberId);
      expect(relationship).toEqual({
        source_member_id: direction === "new_to_existing" ? newMemberId : fixture.actor.memberId,
        target_member_id: direction === "new_to_existing" ? fixture.actor.memberId : newMemberId,
        type,
      });
    },
  );

  it.each(RELATIONSHIP_TYPES)("applies CREATE_RELATIONSHIP type %s", async (relationshipType) => {
    let targetMemberId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      targetMemberId = addUnlinkedMember(db, actor.familyId, `Create ${relationshipType} target`);
      return {
        type: "CREATE_RELATIONSHIP",
        payload: { sourceMemberId: actor.memberId, targetMemberId, type: relationshipType },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Create the exact ${relationshipType} connection.` })
      .expect(201);
    await fixture.browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(fixture.database.prepare(
      `SELECT type FROM relationships
       WHERE family_id = ? AND source_member_id = ? AND target_member_id = ?`,
    ).get(fixture.actor.familyId, fixture.actor.memberId, targetMemberId)).toEqual({ type: relationshipType });
  });

  it.each(RECONNECTION_FORMATS)("stores reconnection gathering format %s only after confirmation", async (format) => {
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const targetMemberId = addUnlinkedMember(db, actor.familyId, `Plan ${format} relative`);
      return {
        type: "CREATE_RECONNECTION_PLAN",
        payload: {
          title: `Matrix ${format} plan`,
          rationale: "A short optional activity could provide time together.",
          suggestedMemberIds: [targetMemberId],
          evidenceSignalIds: ["family.member_count"],
          suggestedGathering: {
            format,
            purpose: "Spend a little time together.",
            durationMinutes: 30,
          },
          rewardChallenge: "Preserve a memory afterward if everyone agrees.",
        },
      };
    });
    const before = count(fixture.database, "SELECT COUNT(*) AS count FROM reconnection_plans");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare the ${format} plan.` })
      .expect(201);
    expect(count(fixture.database, "SELECT COUNT(*) AS count FROM reconnection_plans")).toBe(before);
    const confirmed = await fixture.browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    const row = fixture.database.prepare("SELECT suggested_gathering_json FROM reconnection_plans WHERE id = ?")
      .get(confirmed.body.result.planId) as { suggested_gathering_json: string };
    expect(JSON.parse(row.suggested_gathering_json)).toMatchObject({ format });
  });

  it.each(INVITATION_CHANNELS)("prepares %s invitation output without automatic delivery", async (channel) => {
    let gatheringId = "";
    let inviteeId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      inviteeId = addUnlinkedMember(db, actor.familyId, `${channel} invitee`);
      gatheringId = addGathering(db, actor.familyId, actor.userId, "draft", `${channel} gathering`);
      return {
        type: "PREPARE_INVITATION_LINKS",
        payload: { gatheringId, memberIds: [inviteeId], channel },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare ${channel} links without sending them.` })
      .expect(201);
    expect(fixture.database.prepare(
      "SELECT id FROM gathering_invitations WHERE gathering_id = ? AND member_id = ?",
    ).get(gatheringId, inviteeId)).toBeUndefined();
    const confirmed = await fixture.browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    expect(confirmed.body.result.deliveryNotice).toContain("has not contacted anyone automatically");
    expect(confirmed.body.result.invitations[0]).toMatchObject({ memberId: inviteeId });
    if (channel === "whatsapp") {
      expect(confirmed.body.result.invitations[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    } else {
      expect(confirmed.body.result.invitations[0].whatsappUrl).toBeUndefined();
    }
    expect(fixture.database.prepare(
      "SELECT channel, status FROM gathering_invitations WHERE gathering_id = ? AND member_id = ?",
    ).get(gatheringId, inviteeId)).toEqual({ channel, status: "pending" });
  });

  it.each(MEMORY_VISIBILITIES)("creates written-memory visibility %s with exact viewer scope", async (visibility) => {
    let selectedMemberId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const gatheringId = addGathering(db, actor.familyId, actor.userId, "completed", "Memory visibility source");
      selectedMemberId = addUnlinkedMember(db, actor.familyId, "Selected memory viewer");
      return {
        type: "CREATE_NOTE_MEMORY",
        payload: {
          gatheringId,
          title: `${visibility} matrix memory`,
          note: "A written memory with an explicit visibility.",
          visibility,
          selectedMemberIds: visibility === "selected" ? [selectedMemberId] : [],
        },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Save the ${visibility} written memory.` })
      .expect(201);
    const confirmed = await fixture.browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    const memoryId = confirmed.body.result.memoryId as string;
    expect(fixture.database.prepare(
      "SELECT memory_type, visibility, ai_processing_allowed FROM memories WHERE id = ?",
    ).get(memoryId)).toEqual({ memory_type: "note", visibility, ai_processing_allowed: 0 });
    expect(rows(
      fixture.database,
      "SELECT member_id FROM memory_viewers WHERE memory_id = ? ORDER BY member_id",
      memoryId,
    )).toEqual(visibility === "selected" ? [{ member_id: selectedMemberId }] : []);
  });

  it.each(MEMORY_TYPES.flatMap((memoryType) =>
    MEMORY_VISIBILITIES.map((visibility) => ({ memoryType, visibility }))))(
    "deletes a consent-visible $memoryType / $visibility memory only after confirmation",
    async ({ memoryType, visibility }) => {
      let memoryId = "";
      const fixture = await createCustomFixture("owner", (db, actor) => {
        memoryId = addMemory(db, actor.familyId, actor.userId, { memoryType, visibility });
        return { type: "DELETE_MEMORY", payload: { memoryId } };
      });
      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Delete the ${memoryType} matrix memory.` })
        .expect(201);
      expect(fixture.database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId)).toBeDefined();
      await fixture.browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
      expect(fixture.database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId)).toBeUndefined();
    },
  );

  it.each(PLAN_STATUSES.flatMap((currentStatus) =>
    PLAN_TARGET_STATUSES.map((targetStatus) => ({ currentStatus, targetStatus }))))(
    "enforces the plan transition $currentStatus -> $targetStatus",
    async ({ currentStatus, targetStatus }) => {
      let planId = "";
      const fixture = await createCustomFixture("owner", (db, actor) => {
        planId = addPlan(db, actor.familyId, actor.userId, currentStatus);
        return { type: "UPDATE_PLAN_STATUS", payload: { planId, status: targetStatus } };
      });
      const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      const auditCountBefore = count(
        fixture.database,
        "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
      );
      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Mark the plan ${targetStatus}.` });
      expect(fixture.database.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
        .toEqual({ status: currentStatus });
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);

      if (ALLOWED_PLAN_TRANSITIONS[currentStatus].includes(targetStatus)) {
        expect(proposed.status, proposed.text).toBe(201);
        const confirmation = await fixture.browser
          .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`);
        expect(confirmation.status, confirmation.text).toBe(200);
        expect(confirmation.body.message).toContain(targetStatus);
        expect(fixture.database.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
          .toEqual({ status: targetStatus });
        expect(count(
          fixture.database,
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
        )).toBe(auditCountBefore + 1);
      } else {
        expect(proposed.status, proposed.text).toBe(409);
        expect(proposed.body.error.code).toBe("INVALID_PLAN_STATUS_TRANSITION");
        expect(fixture.database.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
          .toEqual({ status: currentStatus });
        expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
        expect(count(
          fixture.database,
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
        )).toBe(auditCountBefore);
        expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
      }
    },
  );

  it.each(PLAN_STATUSES.flatMap((currentStatus) =>
    PLAN_TARGET_STATUSES.map((targetStatus) => ({ currentStatus, targetStatus }))))(
    "enforces the shared manual-command transition $currentStatus -> $targetStatus",
    async ({ currentStatus, targetStatus }) => {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: providerFor(() => schemaAction("UPDATE_PLAN_STATUS")),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const actor = await register(browser, db, {
        email: `manual-plan-transition-${randomUUID()}@example.test`,
        displayName: "Manual Transition Actor",
        familyName: "Manual Transition Family",
      });
      const planId = addPlan(db, actor.familyId, actor.userId, currentStatus);
      const baseline = familyDomainSnapshot(db, actor.familyId);
      const auditCountBefore = count(
        db,
        "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
      );
      const response = await browser.patch(`/api/reconnection-plans/${planId}`).send({ status: targetStatus });

      if (ALLOWED_PLAN_TRANSITIONS[currentStatus].includes(targetStatus)) {
        expect(response.status, response.text).toBe(200);
        expect(response.body).toMatchObject({ id: planId, status: targetStatus });
        expect(db.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
          .toEqual({ status: targetStatus });
        expect(count(
          db,
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
        )).toBe(auditCountBefore + 1);
      } else {
        expect(response.status, response.text).toBe(409);
        expect(response.body.error.code).toBe("INVALID_PLAN_STATUS_TRANSITION");
        expect(db.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
          .toEqual({ status: currentStatus });
        expect(count(
          db,
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
        )).toBe(auditCountBefore);
        expect(familyDomainSnapshot(db, actor.familyId)).toBe(baseline);
      }
    },
  );

  it("rejects an otherwise valid plan transition when the expected source status becomes stale", async () => {
    let planId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      planId = addPlan(db, actor.familyId, actor.userId, "active");
      return { type: "UPDATE_PLAN_STATUS", payload: { planId, status: "accepted" } };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Accept the active plan." })
      .expect(201);
    fixture.database.prepare("UPDATE reconnection_plans SET status = 'dismissed', updated_at = ? WHERE id = ?")
      .run("2026-08-13T13:00:00.000Z", planId);
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const auditCountBefore = count(
      fixture.database,
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
    );

    await fixture.browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));
    expect(fixture.database.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId))
      .toEqual({ status: "dismissed" });
    expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?")
      .get(proposed.body.proposal.id)).toEqual({ status: "pending" });
    expect(count(
      fixture.database,
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
    )).toBe(auditCountBefore);
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
  });

  it.each(GATHERING_STATUSES)("gates invitation preparation for gathering status %s", async (status) => {
    let gatheringId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const inviteeId = addUnlinkedMember(db, actor.familyId, `${status} link invitee`);
      gatheringId = addGathering(db, actor.familyId, actor.userId, status, `${status} link gathering`);
      return {
        type: "PREPARE_INVITATION_LINKS",
        payload: { gatheringId, memberIds: [inviteeId], channel: "share_link" },
      };
    });
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const response = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare links for the ${status} gathering.` });
    if (status === "draft" || status === "inviting") {
      expect(response.status, response.text).toBe(201);
      await fixture.browser.post(`/api/agent/action-proposals/${response.body.proposal.id}/confirm`).expect(200);
      expect(fixture.database.prepare("SELECT status FROM gatherings WHERE id = ?").get(gatheringId))
        .toEqual({ status: "inviting" });
    } else {
      expect(response.status, response.text).toBe(409);
      expect(response.body.error.code).toBe("GATHERING_CLOSED");
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    }
  });

  it.each(GATHERING_STATUSES)("gates gathering completion for status %s", async (status) => {
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const attendeeId = addUnlinkedMember(db, actor.familyId, `${status} completion attendee`);
      const gatheringId = addGathering(db, actor.familyId, actor.userId, status, `${status} completion gathering`);
      addInvitation(db, gatheringId, actor.memberId, "going");
      addInvitation(db, gatheringId, attendeeId, "going");
      return {
        type: "COMPLETE_GATHERING",
        payload: { gatheringId, confirmAttendeeMemberIds: [actor.memberId, attendeeId] },
      };
    });
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const response = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Complete the ${status} gathering.` });
    if (status === "inviting") {
      expect(response.status, response.text).toBe(201);
      await fixture.browser.post(`/api/agent/action-proposals/${response.body.proposal.id}/reject`).expect(200);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    } else {
      expect(response.status, response.text).toBe(403);
      expect(response.body.error.code).toBe("INSUFFICIENT_ROLE");
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    }
  });

  it.each(GATHERING_STATUSES)("gates written-memory creation for gathering status %s", async (status) => {
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const gatheringId = addGathering(db, actor.familyId, actor.userId, status, `${status} memory gathering`);
      return {
        type: "CREATE_NOTE_MEMORY",
        payload: {
          gatheringId,
          title: `${status} gathering memory`,
          note: "Only completed gatherings may receive this note.",
          visibility: "private",
          selectedMemberIds: [],
        },
      };
    });
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const response = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Save a note for the ${status} gathering.` });
    if (status === "completed") {
      expect(response.status, response.text).toBe(201);
      await fixture.browser.post(`/api/agent/action-proposals/${response.body.proposal.id}/reject`).expect(200);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    } else {
      expect(response.status, response.text).toBe(409);
      expect(response.body.error.code).toBe("GATHERING_NOT_COMPLETED");
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    }
  });

  it.each(INVITATION_STATUSES)("requires Going, not %s, when proposing confirmed attendance", async (status) => {
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const attendeeId = addUnlinkedMember(db, actor.familyId, `${status} attendee`);
      const gatheringId = addGathering(db, actor.familyId, actor.userId, "inviting", `${status} RSVP gathering`);
      addInvitation(db, gatheringId, actor.memberId, status);
      addInvitation(db, gatheringId, attendeeId, status);
      return {
        type: "COMPLETE_GATHERING",
        payload: { gatheringId, confirmAttendeeMemberIds: [actor.memberId, attendeeId] },
      };
    });
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const response = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Complete with ${status} RSVPs.` });
    if (status === "going") {
      expect(response.status, response.text).toBe(201);
      await fixture.browser.post(`/api/agent/action-proposals/${response.body.proposal.id}/reject`).expect(200);
    } else {
      expect(response.status, response.text).toBe(502);
      expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
    }
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
  });

  it.each(INVITATION_STATUSES)("snapshots and intentionally resets an existing %s RSVP when links rotate", async (status) => {
    let invitationId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const inviteeId = addUnlinkedMember(db, actor.familyId, `${status} rotation invitee`);
      const gatheringId = addGathering(db, actor.familyId, actor.userId, "inviting", `${status} rotation gathering`);
      invitationId = addInvitation(db, gatheringId, inviteeId, status);
      return {
        type: "PREPARE_INVITATION_LINKS",
        payload: { gatheringId, memberIds: [inviteeId], channel: "share_link" },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Rotate the existing ${status} RSVP link.` })
      .expect(201);
    expect(fixture.database.prepare("SELECT status FROM gathering_invitations WHERE id = ?").get(invitationId))
      .toEqual({ status });
    await fixture.browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(fixture.database.prepare("SELECT status FROM gathering_invitations WHERE id = ?").get(invitationId))
      .toEqual({ status: "pending" });
  });

  it.each(ACTION_TYPES)("fails closed on a malformed stored %s payload and rolls back its claim", async (type) => {
    const fixture = await createFixture("owner", type);
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare ${type} for stored-payload validation.` })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    fixture.database.prepare("UPDATE agent_action_proposals SET payload_json = '{}' WHERE id = ?").run(proposalId);
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);

    await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("INVALID_STORED_PROPOSAL"));
    expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
      .toEqual({ status: "pending" });
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
  });

  it.each(ACTION_TYPES)("expires %s without applying a domain write", async (type) => {
    const fixture = await createFixture("owner", type);
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare expiring ${type}.` })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    fixture.database.prepare("UPDATE agent_action_proposals SET expires_at = ? WHERE id = ?")
      .run(TEST_NOW_ISO, proposalId);
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);

    await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_EXPIRED"));
    expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
      .toEqual({ status: "pending" });
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    await fixture.browser.post(`/api/agent/action-proposals/${proposalId}/reject`).expect(200);
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
  });

  it.each(ACTION_TYPES)("serializes simultaneous %s confirmations into one application", async (type) => {
    const fixture = await createFixture("owner", type);
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare concurrent ${type}.` })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const responses = await Promise.all([
      fixture.browser.post(`/api/agent/action-proposals/${proposalId}/confirm`),
      fixture.browser.post(`/api/agent/action-proposals/${proposalId}/confirm`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.alreadyCompleted).sort()).toEqual([false, true]);
    const after = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    expect(after).not.toBe(baseline);
    expectActionOutcomeAppliedExactlyOnce(
      fixture.database,
      fixture.actor.familyId,
      fixture.action,
    );
    expect(count(
      fixture.database,
      "SELECT COUNT(*) AS count FROM agent_messages WHERE session_id = ? AND kind = 'result'",
      proposed.body.sessionId,
    )).toBe(1);
    expect(count(
      fixture.database,
      "SELECT COUNT(*) AS count FROM audit_events WHERE details_json LIKE ?",
      `%${proposalId}%`,
    )).toBe(1);
  });

  it("rejects ADD_MEMBER when the requester's linked profile changes after the preview", async () => {
    const fixture = await createCustomFixture("owner", (_db, actor) => ({
      type: "ADD_MEMBER",
      payload: {
        displayName: "New Brother",
        interests: [],
        relationships: [{
          existingMemberId: actor.memberId,
          type: "sibling",
          direction: "new_to_existing",
        }],
      },
    }));
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Add my brother New Brother." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    const newlyLinkedMemberId = addUnlinkedMember(
      fixture.database,
      fixture.actor.familyId,
      "Replacement linked profile",
    );
    fixture.database.prepare(
      "UPDATE family_users SET linked_member_id = ? WHERE family_id = ? AND user_id = ?",
    ).run(newlyLinkedMemberId, fixture.actor.familyId, fixture.actor.userId);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "ADD_MEMBER" })
      .expect(409);
    expect(response.body.error.code).toBe("REQUESTER_LINK_CHANGED");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_RELATIONSHIP when the same relationship is added after the preview", async () => {
    const fixture = await createFixture("owner", "CREATE_RELATIONSHIP");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Connect these two family profiles." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    if (fixture.action.type !== "CREATE_RELATIONSHIP") throw new Error("Fixture action mismatch.");
    addRelationship(
      fixture.database,
      fixture.actor.familyId,
      fixture.action.payload.sourceMemberId,
      fixture.action.payload.targetMemberId,
      fixture.action.payload.type,
    );
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_RELATIONSHIP" })
      .expect(409);
    expect(response.body.error.code).toBe("RELATIONSHIP_EXISTS");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_RELATIONSHIP when a new parent edge would make it cyclic", async () => {
    let targetMemberId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      targetMemberId = addUnlinkedMember(db, actor.familyId, "Cycle target");
      return {
        type: "CREATE_RELATIONSHIP",
        payload: {
          sourceMemberId: actor.memberId,
          targetMemberId,
          type: "parent",
        },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Add the parent connection." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    addRelationship(
      fixture.database,
      fixture.actor.familyId,
      targetMemberId,
      fixture.actor.memberId,
      "parent",
    );
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_RELATIONSHIP" })
      .expect(409);
    expect(response.body.error.code).toBe("RELATIONSHIP_CYCLE");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_RELATIONSHIP when a target profile is removed after the preview", async () => {
    const fixture = await createFixture("owner", "CREATE_RELATIONSHIP");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Connect these two family profiles." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    if (fixture.action.type !== "CREATE_RELATIONSHIP") throw new Error("Fixture action mismatch.");
    fixture.database.prepare("DELETE FROM family_members WHERE family_id = ? AND id = ?")
      .run(fixture.actor.familyId, fixture.action.payload.targetMemberId);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_RELATIONSHIP" })
      .expect(404);
    expect(response.body.error.code).toBe("MEMBER_NOT_FOUND");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects DELETE_RELATIONSHIP when the relationship is removed after the preview", async () => {
    const fixture = await createFixture("owner", "DELETE_RELATIONSHIP");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Remove the family connection." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    if (fixture.action.type !== "DELETE_RELATIONSHIP") throw new Error("Fixture action mismatch.");
    fixture.database.prepare("DELETE FROM relationships WHERE family_id = ? AND id = ?")
      .run(fixture.actor.familyId, fixture.action.payload.relationshipId);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "DELETE_RELATIONSHIP" })
      .expect(409);
    expect(response.body.error.code).toBe("RELATIONSHIP_CHANGED");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_RECONNECTION_PLAN when a suggested member is removed after the preview", async () => {
    const fixture = await createFixture("owner", "CREATE_RECONNECTION_PLAN");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Prepare the reconnection plan." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    if (fixture.action.type !== "CREATE_RECONNECTION_PLAN") throw new Error("Fixture action mismatch.");
    fixture.database.prepare("DELETE FROM family_members WHERE family_id = ? AND id = ?")
      .run(fixture.actor.familyId, fixture.action.payload.suggestedMemberIds[0]);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_RECONNECTION_PLAN" })
      .expect(404);
    expect(response.body.error.code).toBe("MEMBER_NOT_FOUND");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_RECONNECTION_PLAN when its sample activity is deactivated after the preview", async () => {
    let activityId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      const activity = db.prepare(
        "SELECT id FROM activities WHERE active = 1 AND is_sample = 1 ORDER BY id LIMIT 1",
      ).get() as { id: string } | undefined;
      if (!activity) throw new Error("The matrix requires a seeded sample activity.");
      activityId = activity.id;
      const targetMemberId = addUnlinkedMember(db, actor.familyId, "Activity plan relative");
      return {
        type: "CREATE_RECONNECTION_PLAN",
        payload: {
          title: "Activity-backed plan",
          rationale: "A short optional activity could provide time together.",
          suggestedMemberIds: [targetMemberId],
          evidenceSignalIds: ["family.member_count"],
          suggestedActivityId: activityId,
          suggestedGathering: {
            format: "other",
            purpose: "Spend a little time together.",
            durationMinutes: 30,
          },
          rewardChallenge: "Preserve a memory afterward if everyone agrees.",
        },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Prepare the activity-backed plan." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    fixture.database.prepare("UPDATE activities SET active = 0 WHERE id = ?").run(activityId);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_RECONNECTION_PLAN" })
      .expect(409);
    expect(response.body.error.code).toBe("SUGGESTED_ACTIVITY_UNAVAILABLE");
    expect(fixture.database.prepare("SELECT active FROM activities WHERE id = ?").get(activityId))
      .toEqual({ active: 0 });
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  it("rejects CREATE_NOTE_MEMORY when a selected viewer is removed after the preview", async () => {
    let viewerMemberId = "";
    const fixture = await createCustomFixture("owner", (db, actor) => {
      viewerMemberId = addUnlinkedMember(db, actor.familyId, "Selected viewer");
      const gatheringId = addGathering(db, actor.familyId, actor.userId, "completed", "Selected memory source");
      return {
        type: "CREATE_NOTE_MEMORY",
        payload: {
          gatheringId,
          title: "Selected memory",
          note: "A memory shared only with the selected viewer.",
          visibility: "selected",
          selectedMemberIds: [viewerMemberId],
        },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Save the selected written memory." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    fixture.database.prepare("DELETE FROM family_members WHERE family_id = ? AND id = ?")
      .run(fixture.actor.familyId, viewerMemberId);
    const expectedDomain = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const expectedAuditCount = count(fixture.database, "SELECT COUNT(*) AS count FROM audit_events");

    const response = await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_NOTE_MEMORY" })
      .expect(404);
    expect(response.body.error.code).toBe("MEMBER_NOT_FOUND");
    expectFailedConfirmationRolledBack(fixture, proposalId, expectedDomain, expectedAuditCount);
  });

  function buildCrossFamilyAction(
    db: AppDatabase,
    actor: RegisteredFamily,
    foreign: RegisteredFamily,
    type: Exclude<ActionType, "CREATE_GATHERING_DRAFT">,
  ): AgentAction {
    if (type === "ADD_MEMBER") {
      return {
        type,
        payload: {
          displayName: "Cross-family relative",
          interests: [],
          relationships: [{
            existingMemberId: foreign.memberId,
            type: "relative",
            direction: "new_to_existing",
          }],
        },
      };
    }
    if (type === "UPDATE_MEMBER") {
      return { type, payload: { memberId: foreign.memberId, changes: { notes: "Cross-family update" } } };
    }
    if (type === "DELETE_MEMBER") return { type, payload: { memberId: foreign.memberId } };
    if (type === "CREATE_RELATIONSHIP") {
      return {
        type,
        payload: { sourceMemberId: actor.memberId, targetMemberId: foreign.memberId, type: "relative" },
      };
    }
    if (type === "DELETE_RELATIONSHIP") {
      const secondForeignMemberId = addUnlinkedMember(db, foreign.familyId, "Foreign relationship target");
      return {
        type,
        payload: {
          relationshipId: addRelationship(db, foreign.familyId, foreign.memberId, secondForeignMemberId),
        },
      };
    }
    if (type === "CREATE_RECONNECTION_PLAN") {
      return {
        type,
        payload: {
          title: "Cross-family plan",
          rationale: "This malicious provider output must be rejected.",
          suggestedMemberIds: [foreign.memberId],
          evidenceSignalIds: ["family.member_count"],
          suggestedGathering: {
            format: "other",
            purpose: "Attempt a cross-family plan",
            durationMinutes: 30,
          },
          rewardChallenge: "Do not persist this plan.",
        },
      };
    }
    if (type === "PREPARE_INVITATION_LINKS") {
      const gatheringId = addGathering(db, foreign.familyId, foreign.userId, "draft", "Foreign gathering");
      return {
        type,
        payload: { gatheringId, memberIds: [actor.memberId], channel: "share_link" },
      };
    }
    if (type === "COMPLETE_GATHERING") {
      const secondForeignMemberId = addUnlinkedMember(db, foreign.familyId, "Foreign attendee");
      const gatheringId = addGathering(db, foreign.familyId, foreign.userId, "inviting", "Foreign completion");
      addInvitation(db, gatheringId, foreign.memberId, "going");
      addInvitation(db, gatheringId, secondForeignMemberId, "going");
      return {
        type,
        payload: { gatheringId, confirmAttendeeMemberIds: [foreign.memberId, secondForeignMemberId] },
      };
    }
    if (type === "CREATE_NOTE_MEMORY") {
      const gatheringId = addGathering(db, foreign.familyId, foreign.userId, "completed", "Foreign memory source");
      return {
        type,
        payload: {
          gatheringId,
          title: "Cross-family memory",
          note: "This must not cross the family boundary.",
          visibility: "private",
          selectedMemberIds: [],
        },
      };
    }
    if (type === "DELETE_MEMORY") {
      return { type, payload: { memoryId: addMemory(db, foreign.familyId, foreign.userId) } };
    }
    return {
      type: "UPDATE_PLAN_STATUS",
      payload: { planId: addPlan(db, foreign.familyId, foreign.userId), status: "accepted" },
    };
  }

  it.each(ACTION_TYPES.filter((type): type is Exclude<ActionType, "CREATE_GATHERING_DRAFT"> =>
    type !== "CREATE_GATHERING_DRAFT"))(
    "rejects a malicious provider's cross-family target for %s",
    async (type) => {
      const fixture = await createCustomFixture(
        "owner",
        (db, actor, intruder) => buildCrossFamilyAction(db, actor, intruder, type),
      );
      const actorBaseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      const foreignBaseline = familyDomainSnapshot(fixture.database, fixture.intruder.familyId);
      const response = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Attempt cross-family ${type}.` })
        .expect(502);
      expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(actorBaseline);
      expect(familyDomainSnapshot(fixture.database, fixture.intruder.familyId)).toBe(foreignBaseline);
    },
  );

  it("always scopes CREATE_GATHERING_DRAFT to the requested family", async () => {
    const fixture = await createFixture("member", "CREATE_GATHERING_DRAFT");
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Create the family-scoped draft." })
      .expect(201);
    const confirmed = await fixture.browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    expect(fixture.database.prepare("SELECT family_id FROM gatherings WHERE id = ?")
      .get(confirmed.body.result.gatheringId)).toEqual({ family_id: fixture.actor.familyId });
  });

  it.each(ACTION_TYPES)("revalidates current membership permissions before confirming %s", async (type) => {
    const fixture = await createFixture("admin", type);
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare ${type} before a role change.` })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;

    fixture.database.prepare("UPDATE family_users SET role = 'member' WHERE family_id = ? AND user_id = ?")
      .run(fixture.actor.familyId, fixture.actor.userId);
    const afterDemotion = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
    const confirmation = await fixture.browser.post(`/api/agent/action-proposals/${proposalId}/confirm`);

    if (MEMBER_ALLOWED_ACTIONS.has(type)) {
      expect(confirmation.status, confirmation.text).toBe(200);
      expect(confirmation.body).toMatchObject({ status: "confirmed", alreadyCompleted: false });
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).not.toBe(afterDemotion);
      return;
    }

    expect(confirmation.status, confirmation.text).toBe(403);
    expect(confirmation.body.error.code).toBe("INSUFFICIENT_ROLE");
    expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
      .toEqual({ status: "pending" });
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(afterDemotion);
    await fixture.browser.post(`/api/agent/action-proposals/${proposalId}/reject`).expect(200);
  });

  it.each(ACTION_TYPES)("blocks %s confirmation after family membership is revoked", async (type) => {
    const fixture = await createFixture("owner", type);
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: `Prepare ${type} before membership revocation.` })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    fixture.database.prepare("DELETE FROM family_users WHERE family_id = ? AND user_id = ?")
      .run(fixture.actor.familyId, fixture.actor.userId);
    const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);

    await fixture.browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .expect(404)
      .expect((response) => expect(response.body.error.code).toBe("FAMILY_NOT_FOUND"));
    expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
      .toEqual({ status: "pending" });
    expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
  });

  const FOREIGN_RESOURCE_ACTIONS = [
    "UPDATE_MEMBER",
    "PREPARE_INVITATION_LINKS",
    "DELETE_MEMORY",
    "UPDATE_PLAN_STATUS",
  ] as const;

  function buildForeignResourceAction(
    db: AppDatabase,
    actor: RegisteredFamily,
    intruder: RegisteredFamily,
    type: (typeof FOREIGN_RESOURCE_ACTIONS)[number],
    exposeGatheringToMember = false,
  ): AgentAction {
    if (type === "UPDATE_MEMBER") {
      const otherMemberId = addUnlinkedMember(db, actor.familyId, "Another profile");
      return { type, payload: { memberId: otherMemberId, changes: { notes: "Forbidden update" } } };
    }
    if (type === "PREPARE_INVITATION_LINKS") {
      const gatheringId = addGathering(db, actor.familyId, intruder.userId, "draft", "Another creator's gathering");
      if (exposeGatheringToMember) addInvitation(db, gatheringId, actor.memberId, "pending");
      const inviteeId = addUnlinkedMember(db, actor.familyId, "Foreign gathering invitee");
      return { type, payload: { gatheringId, memberIds: [inviteeId], channel: "share_link" } };
    }
    if (type === "DELETE_MEMORY") {
      return { type, payload: { memoryId: addMemory(db, actor.familyId, intruder.userId) } };
    }
    return {
      type: "UPDATE_PLAN_STATUS",
      payload: { planId: addPlan(db, actor.familyId, intruder.userId), status: "accepted" },
    };
  }

  it.each(FOREIGN_RESOURCE_ACTIONS)(
    "revalidates creator ownership for %s when an administrator is demoted before confirmation",
    async (type) => {
      const fixture = await createCustomFixture(
        "admin",
        (db, actor, intruder) => buildForeignResourceAction(db, actor, intruder, type),
      );
      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Prepare foreign-resource ${type}.` })
        .expect(201);
      const proposalId = proposed.body.proposal.id as string;
      fixture.database.prepare("UPDATE family_users SET role = 'member' WHERE family_id = ? AND user_id = ?")
        .run(fixture.actor.familyId, fixture.actor.userId);
      const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);

      const response = await fixture.browser.post(`/api/agent/action-proposals/${proposalId}/confirm`).expect(403);
      const expectedCode = type === "DELETE_MEMORY"
        ? "MEMORY_OWNER_REQUIRED"
        : type === "UPDATE_PLAN_STATUS"
          ? "PLAN_OWNER_REQUIRED"
          : "INSUFFICIENT_ROLE";
      expect(response.body.error.code).toBe(expectedCode);
      expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId))
        .toEqual({ status: "pending" });
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    },
  );

  it.each(FOREIGN_RESOURCE_ACTIONS)(
    "blocks a member from proposing %s against another creator's resource",
    async (type) => {
      const fixture = await createCustomFixture(
        "member",
        (db, actor, intruder) => buildForeignResourceAction(db, actor, intruder, type, true),
      );
      const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      const response = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Try foreign-resource ${type}.` });

      if (type === "UPDATE_PLAN_STATUS") {
        // Ordinary members cannot see another creator's private plan, so the
        // trust boundary deliberately hides whether the referenced ID exists.
        expect(response.status, response.text).toBe(502);
        expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      } else {
        expect(response.status, response.text).toBe(403);
        expect(response.body.error.code).toBe(type === "DELETE_MEMORY" ? "MEMORY_OWNER_REQUIRED" : "INSUFFICIENT_ROLE");
      }
      expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(0);
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
    },
  );

  it("allows a member to create a note for a visible completed gathering owned by someone else", async () => {
    const fixture = await createCustomFixture("member", (db, actor, intruder) => {
      const gatheringId = addGathering(db, actor.familyId, intruder.userId, "completed", "Shared completed gathering");
      addInvitation(db, gatheringId, actor.memberId, "going");
      return {
        type: "CREATE_NOTE_MEMORY",
        payload: {
          gatheringId,
          title: "Member-owned note",
          note: "A member may preserve their own written memory.",
          visibility: "private",
          selectedMemberIds: [],
        },
      };
    });
    const proposed = await fixture.browser
      .post("/api/agent/messages")
      .send({ familyId: fixture.actor.familyId, message: "Save my note for the completed gathering." })
      .expect(201);
    await fixture.browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(count(
      fixture.database,
      "SELECT COUNT(*) AS count FROM memories WHERE family_id = ? AND created_by_user_id = ?",
      fixture.actor.familyId,
      fixture.actor.userId,
    )).toBe(1);
  });

  it.each(ROLE_ACTION_MATRIX)(
    "$role / $type obeys proposal ownership, reject, confirm, idempotency, and no-write rules",
    async ({ role, type, allowed }) => {
      const fixture = await createFixture(role, type);
      const baseline = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      const proposalCountBefore = count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals");

      const proposed = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Prepare the exact ${type} matrix action.` });

      if (!allowed) {
        expect(proposed.status, proposed.text).toBe(403);
        expect(proposed.body.error.code).toBe("INSUFFICIENT_ROLE");
        expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
        expect(count(fixture.database, "SELECT COUNT(*) AS count FROM agent_action_proposals")).toBe(
          proposalCountBefore,
        );
        return;
      }

      expect(proposed.status, proposed.text).toBe(201);
      expect(proposed.body).toMatchObject({ kind: "proposal", proposal: { actionType: type } });
      const rejectedProposalId = proposed.body.proposal.id as string;
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);

      await fixture.intruderBrowser
        .post(`/api/agent/action-proposals/${rejectedProposalId}/confirm`)
        .expect(404)
        .expect((response) => expect(response.body.error.code).toBe("AGENT_PROPOSAL_NOT_FOUND"));
      await fixture.intruderBrowser
        .post(`/api/agent/action-proposals/${rejectedProposalId}/reject`)
        .expect(404)
        .expect((response) => expect(response.body.error.code).toBe("AGENT_PROPOSAL_NOT_FOUND"));
      expect(fixture.database.prepare("SELECT status FROM agent_action_proposals WHERE id = ?")
        .get(rejectedProposalId)).toEqual({ status: "pending" });
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);

      const rejected = await fixture.browser
        .post(`/api/agent/action-proposals/${rejectedProposalId}/reject`)
        .expect(200);
      const rejectedAgain = await fixture.browser
        .post(`/api/agent/action-proposals/${rejectedProposalId}/reject`)
        .expect(200);
      expect(rejected.body).toMatchObject({ status: "rejected", alreadyRejected: false });
      expect(rejectedAgain.body).toMatchObject({ status: "rejected", alreadyRejected: true });
      await fixture.browser
        .post(`/api/agent/action-proposals/${rejectedProposalId}/confirm`)
        .expect(409)
        .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_REJECTED"));
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);
      expect(count(
        fixture.database,
        "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'agent.action.rejected' AND entity_id = ?",
        rejectedProposalId,
      )).toBe(1);

      const secondProposal = await fixture.browser
        .post("/api/agent/messages")
        .send({ familyId: fixture.actor.familyId, message: `Prepare ${type} again for confirmation.` })
        .expect(201);
      const confirmedProposalId = secondProposal.body.proposal.id as string;
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(baseline);

      const confirmed = await fixture.browser
        .post(`/api/agent/action-proposals/${confirmedProposalId}/confirm`)
        .expect(200);
      expect(confirmed.body).toMatchObject({ status: "confirmed", alreadyCompleted: false });
      const afterFirstConfirmation = familyDomainSnapshot(fixture.database, fixture.actor.familyId);
      expect(afterFirstConfirmation).not.toBe(baseline);
      expect(fixture.database.prepare(
        "SELECT status, result_entity_id FROM agent_action_proposals WHERE id = ?",
      ).get(confirmedProposalId)).toMatchObject({ status: "confirmed", result_entity_id: expect.any(String) });

      const confirmedAgain = await fixture.browser
        .post(`/api/agent/action-proposals/${confirmedProposalId}/confirm`)
        .expect(200);
      expect(confirmedAgain.body).toMatchObject({ status: "confirmed", alreadyCompleted: true });
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(afterFirstConfirmation);
      expect(count(
        fixture.database,
        "SELECT COUNT(*) AS count FROM audit_events WHERE details_json LIKE ?",
        `%${confirmedProposalId}%`,
      )).toBe(1);

      await fixture.browser
        .post(`/api/agent/action-proposals/${confirmedProposalId}/reject`)
        .expect(409)
        .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_CONFIRMED"));
      expect(familyDomainSnapshot(fixture.database, fixture.actor.familyId)).toBe(afterFirstConfirmation);
    },
    20_000,
  );
});
