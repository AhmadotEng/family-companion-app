import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  addMemberPayloadSchema,
  GEMINI_RESPONSE_JSON_SCHEMA,
  type AgentProvider,
  type AgentProviderInput,
} from "../server/agent.js";
import { createApp } from "../server/app.js";
import { openDatabase, type AppDatabase } from "../server/database.js";

const TEST_NOW = new Date("2026-08-13T12:00:00.000Z");

type HttpAgent = ReturnType<typeof request.agent>;

interface RegisteredFamily {
  familyId: string;
  memberId: string;
  userId: string;
}

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
  agent: HttpAgent,
  db: AppDatabase,
  identity: { email: string; displayName: string; familyName: string },
): Promise<RegisteredFamily> {
  const response = await agent
    .post("/api/auth/register")
    .send({ ...identity, password: "a-secure-password" })
    .expect(201);

  const family = response.body.families[0] as { id: string; linkedMemberId: string };
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(identity.email) as { id: string };
  return { familyId: family.id, memberId: family.linkedMemberId, userId: user.id };
}

function callbackProvider(
  callback: (input: AgentProviderInput) => unknown,
  metadata: { providerName?: string; modelName?: string; requiresExternalDataConsent?: boolean } = {},
): AgentProvider {
  return { ...metadata, generate: async (input) => callback(input) };
}

function addMemberDecision(input: AgentProviderInput, name = "Khaled") {
  const existingMemberId = input.family.requester.linkedMemberId ?? input.family.members[0]?.id;
  if (!existingMemberId) throw new Error("The test family needs an existing member.");
  return {
    kind: "proposal" as const,
    message: `I can prepare ${name}'s family profile. Review the exact change below.`,
    action: {
      type: "ADD_MEMBER" as const,
      payload: {
        displayName: name,
        interests: ["Falconry"],
        relationships: [
          {
            existingMemberId,
            type: "sibling" as const,
            direction: "new_to_existing" as const,
          },
        ],
        location: { city: "Sharjah", emirate: "Sharjah" },
      },
    },
  };
}

function reconnectionPlanDecision(input: AgentProviderInput, overrides: Record<string, unknown> = {}) {
  const requesterId = input.family.requester.linkedMemberId;
  const target = input.family.members.find((member) => member.id !== requesterId);
  if (!target) throw new Error("The test family needs a second family member.");
  return {
    kind: "proposal" as const,
    message: "I prepared a gentle plan for you to review. Nothing will be scheduled unless you choose to do so.",
    action: {
      type: "CREATE_RECONNECTION_PLAN" as const,
      payload: {
        title: `A relaxed catch-up with ${target.displayName}`,
        rationale: "A short, optional gathering could create time for a shared conversation.",
        suggestedMemberIds: [target.id],
        evidenceSignalIds: ["family.relationship_count", "gatherings.completed"],
        suggestedGathering: {
          format: "family_meal" as const,
          purpose: "Share a relaxed meal and choose a topic everyone enjoys.",
          durationMinutes: 90,
          timingGuidance: "Choose a time that works for everyone.",
          locationGuidance: "Agree on a convenient, accessible place.",
          accessibilityNotes: "Ask participants about mobility, dietary, and sensory preferences.",
        },
        suggestedActivityId: "10000000-0000-4000-8000-000000000002",
        rewardChallenge: "After the gathering, preserve one shared memory with everyone's consent.",
        ...overrides,
      },
    },
  };
}

function addUnlinkedRelative(db: AppDatabase, familyId: string, displayName: string): string {
  const memberId = randomUUID();
  const now = TEST_NOW.toISOString();
  db.prepare(
    `INSERT INTO family_members
     (id, family_id, display_name, interests_json, created_at, updated_at)
     VALUES (?, ?, ?, '[]', ?, ?)`,
  ).run(memberId, familyId, displayName, now, now);
  return memberId;
}

function addRelationship(
  db: AppDatabase,
  familyId: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: "parent" | "spouse" | "sibling" | "guardian" | "relative",
): string {
  const relationshipId = randomUUID();
  db.prepare(
    `INSERT INTO relationships
     (id, family_id, source_member_id, target_member_id, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(relationshipId, familyId, sourceMemberId, targetMemberId, type, TEST_NOW.toISOString());
  return relationshipId;
}

function gatheringPlannerDecision(overrides: Record<string, unknown> = {}) {
  return {
    kind: "gathering_planner" as const,
    message: "The venue is definitely open and perfect.",
    planner: {
      title: "Golden Park family outing",
      purpose: "Spend time together at Golden Park",
      startAt: "2026-09-12T17:00:00+04:00",
      timezone: "Asia/Dubai" as const,
      locationName: "Golden Park",
      type: "Outdoor activity" as const,
      memberIds: [],
      invitationChannel: "share_link" as const,
      ...overrides,
    },
  };
}

describe("controlled family agent", () => {
  it("requires explicit disclosure consent before calling an external provider", async () => {
    const db = database();
    let calls = 0;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(
        () => {
          calls += 1;
          return { kind: "message", message: "Consent received." };
        },
        { providerName: "external-test", requiresExternalDataConsent: true },
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "consent-owner@example.test",
      displayName: "Consent Owner",
      familyName: "Consent Family",
    });
    await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Help me." }).expect(400);
    expect(calls).toBe(0);
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Help me.", aiProcessingConsent: true })
      .expect(200);
    expect(calls).toBe(1);
  });

  it("expires old transcripts and lets only the session creator delete a current conversation", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({ kind: "message", message: "How else can I help?" })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const ownerBrowser = request.agent(app);
    const family = await register(ownerBrowser, db, {
      email: "retention-owner@example.test",
      displayName: "Retention Owner",
      familyName: "Retention Family",
    });

    const oldTurn = await ownerBrowser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "This conversation will expire." })
      .expect(200);
    const oldSessionId = oldTurn.body.sessionId as string;
    db.prepare("UPDATE agent_sessions SET updated_at = '2026-06-01T00:00:00.000Z' WHERE id = ?").run(oldSessionId);

    const currentTurn = await ownerBrowser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Start a current conversation." })
      .expect(200);
    const currentSessionId = currentTurn.body.sessionId as string;
    expect(db.prepare("SELECT id FROM agent_sessions WHERE id = ?").get(oldSessionId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM agent_sessions WHERE id = ?").get(currentSessionId)).toBeDefined();

    const otherBrowser = request.agent(app);
    await register(otherBrowser, db, {
      email: "retention-other@example.test",
      displayName: "Other Owner",
      familyName: "Other Family",
    });
    await otherBrowser.delete(`/api/agent/sessions/${currentSessionId}`).expect(404);
    await ownerBrowser.delete(`/api/agent/sessions/${currentSessionId}`).expect(204);
    expect(db.prepare("SELECT id FROM agent_sessions WHERE id = ?").get(currentSessionId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM agent_messages WHERE session_id = ?").get(currentSessionId)).toBeUndefined();
  });
  it("validates AI-proposed birth dates exactly like manual member profiles", () => {
    const base = { displayName: "Khaled", interests: [], relationships: [] };

    expect(addMemberPayloadSchema.safeParse({ ...base, birthDate: "2024-02-29" }).success).toBe(true);
    for (const birthDate of ["2026-02-31", "2025-13-01", "2999-01-01", "01-01-2000"]) {
      const result = addMemberPayloadSchema.safeParse({ ...base, birthDate });
      expect(result.success, birthDate).toBe(false);
    }
  });

  it("uses the manual profile constraints for interests and initial relationships", () => {
    const existingMemberId = randomUUID();
    const base = {
      displayName: "Khaled",
      interests: ["Falconry", "Falconry", "Poetry"],
      relationships: [{ existingMemberId, type: "sibling" as const, direction: "new_to_existing" as const }],
    };
    const parsed = addMemberPayloadSchema.parse(base);
    expect(parsed.interests).toEqual(["Falconry", "Poetry"]);

    expect(addMemberPayloadSchema.safeParse({
      ...base,
      interests: ["x".repeat(51)],
    }).success).toBe(false);
    expect(addMemberPayloadSchema.safeParse({
      ...base,
      relationships: Array.from({ length: 9 }, () => ({
        existingMemberId: randomUUID(),
        type: "relative" as const,
        direction: "new_to_existing" as const,
      })),
    }).success).toBe(false);
    expect(addMemberPayloadSchema.safeParse({
      ...base,
      relationships: [base.relationships[0], base.relationships[0]],
    }).success).toBe(false);
  });

  it("keeps Gemini's response schema compact and within its supported keyword subset", () => {
    const unsupported = new Set(["minLength", "maxLength", "pattern", "minProperties"]);
    const found: string[] = [];
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        if (unsupported.has(key)) found.push(key);
        visit(nested);
      }
    };
    visit(GEMINI_RESPONSE_JSON_SCHEMA);
    expect(found).toEqual([]);
    expect(JSON.stringify(GEMINI_RESPONSE_JSON_SCHEMA).length).toBeLessThan(2_000);
    expect(GEMINI_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum).toEqual([
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
    ]);
  });

  it("returns an honest 503 without credentials and creates no session", async () => {
    const db = database();
    const app = createApp({
      database: db,
      env: {},
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "owner-no-key@example.test",
      displayName: "No Key Owner",
      familyName: "No Key Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my uncle Khaled." })
      .expect(503);

    expect(response.body.error).toMatchObject({
      code: "AGENT_NOT_CONFIGURED",
      message: expect.stringContaining("GEMINI_API_KEY"),
    });
    expect((db.prepare("SELECT count(*) AS count FROM agent_sessions").get() as { count: number }).count).toBe(0);
  });

  it("does not persist a new session or user message when the provider rejects", async () => {
    const db = database();
    const provider: AgentProvider = {
      generate: async () => {
        throw new Error("upstream unavailable");
      },
    };
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "provider-error-owner@example.test",
      displayName: "Provider Error Owner",
      familyName: "Provider Error Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my uncle." })
      .expect(502);

    expect(response.body.error).toMatchObject({
      code: "AGENT_PROVIDER_ERROR",
      message: "The AI provider could not complete the request.",
    });
    expect((db.prepare("SELECT count(*) AS count FROM agent_sessions").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT count(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
  });

  it("reports provider quota exhaustion without persisting an orphan turn", async () => {
    const db = database();
    const provider: AgentProvider = {
      generate: async () => {
        throw Object.assign(new Error("synthetic quota response"), { status: 429 });
      },
    };
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "provider-quota-owner@example.test",
      displayName: "Provider Quota Owner",
      familyName: "Provider Quota Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my brother Test Khaled." })
      .expect(429);

    expect(response.body.error).toMatchObject({
      code: "AGENT_QUOTA_EXHAUSTED",
      message: expect.stringContaining("No conversation or family data was saved"),
    });
    expect((db.prepare("SELECT count(*) AS count FROM agent_sessions").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT count(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
  });

  it("times out a stalled provider, aborts client work, and persists no orphan turn", async () => {
    const db = database();
    let signalWasAborted = false;
    const provider: AgentProvider = {
      generate: (input) => new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => {
          signalWasAborted = true;
          reject(new Error("aborted by caller"));
        }, { once: true });
      }),
    };
    const app = createApp({
      database: db,
      agentProvider: provider,
      env: { AGENT_PROVIDER_TIMEOUT_MS: "100" },
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "provider-timeout-owner@example.test",
      displayName: "Provider Timeout Owner",
      familyName: "Provider Timeout Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Please prepare a plan." })
      .expect(504);

    expect(response.body.error).toMatchObject({
      code: "AGENT_PROVIDER_TIMEOUT",
      message: expect.stringContaining("No conversation or family data was saved"),
    });
    expect(signalWasAborted).toBe(true);
    expect((db.prepare("SELECT count(*) AS count FROM agent_sessions").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT count(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
  });

  it("does not append a failed provider turn to an existing session", async () => {
    const db = database();
    let calls = 0;
    const provider: AgentProvider = {
      generate: async () => {
        calls += 1;
        if (calls === 1) return { kind: "message", message: "What would you like help with?" };
        throw new Error("provider failed on follow-up");
      },
    };
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "existing-session-error@example.test",
      displayName: "Existing Session Owner",
      familyName: "Existing Session Family",
    });
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Hello." })
      .expect(200);
    const sessionId = first.body.sessionId as string;
    const before = db
      .prepare("SELECT role, content_text FROM agent_messages WHERE session_id = ? ORDER BY created_at, id")
      .all(sessionId);

    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId, message: "This turn should not persist." })
      .expect(502);

    const after = db
      .prepare("SELECT role, content_text FROM agent_messages WHERE session_id = ? ORDER BY created_at, id")
      .all(sessionId);
    expect(after).toEqual(before);
    expect((db.prepare("SELECT count(*) AS count FROM agent_sessions WHERE id = ?").get(sessionId) as { count: number }).count).toBe(1);
  });

  it("returns and stores a clarification without changing family data", async () => {
    const db = database();
    const provider = callbackProvider((input) => ({
      kind: "proposal",
      message: "I can add Khaled.",
      action: {
        type: "ADD_MEMBER",
        payload: { displayName: "Khaled", interests: [], relationships: [] },
      },
    }));
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "clarify-owner@example.test",
      displayName: "Clarify Owner",
      familyName: "Clarify Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add Khaled." })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: "clarification",
      message: expect.stringContaining("How is Khaled related"),
    });
    expect(response.body.sessionId).toEqual(expect.any(String));
    expect(
      (db.prepare("SELECT count(*) AS count FROM family_members WHERE family_id = ?").get(family.familyId) as {
        count: number;
      }).count,
    ).toBe(1);
    expect((db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(
      0,
    );
    expect(
      db
        .prepare("SELECT role, kind FROM agent_messages WHERE session_id = ? ORDER BY created_at, id")
        .all(response.body.sessionId),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", kind: "message" }),
        expect.objectContaining({ role: "assistant", kind: "clarification" }),
      ]),
    );
  });

  it("passes only consent-filtered city/emirate context to the provider", async () => {
    const db = database();
    let received: AgentProviderInput | undefined;
    const provider = callbackProvider((input) => {
      received = input;
      return { kind: "message", message: "I can help with that." };
    });
    const app = createApp({
      database: db,
      agentProvider: provider,
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "privacy-owner@example.test",
      displayName: "Privacy Owner",
      familyName: "Privacy Family",
    });

    const hiddenMemberId = randomUUID();
    const hiddenConsentId = randomUUID();
    const hiddenLocationId = randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO family_members
         (id, family_id, display_name, email, interests_json, created_at, updated_at)
         VALUES (?, ?, 'Private Relative', 'private@example.test', '[]', ?, ?)`,
      ).run(hiddenMemberId, family.familyId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
      db.prepare(
        `INSERT INTO location_consents
         (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
         VALUES (?, ?, ?, ?, 'admin_reported', 'exact', 'private', ?)`,
      ).run(hiddenConsentId, family.familyId, hiddenMemberId, family.userId, TEST_NOW.toISOString());
      db.prepare(
        `INSERT INTO member_locations
         (id, family_id, member_id, consent_id, source, precision, visibility, latitude, longitude,
          accuracy_m, emirate, city, captured_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', 'exact', 'private', 25.2048, 55.2708, 5, 'Dubai', 'Dubai', ?, ?)`,
      ).run(
        hiddenLocationId,
        family.familyId,
        hiddenMemberId,
        hiddenConsentId,
        TEST_NOW.toISOString(),
        TEST_NOW.toISOString(),
      );
    })();

    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Who is in my family?" })
      .expect(200);

    expect(received).toBeDefined();
    const hiddenContext = received!.family.members.find((member) => member.id === hiddenMemberId);
    expect(hiddenContext).toEqual({
      id: hiddenMemberId,
      displayName: "Private Relative",
      canUpdate: true,
      canDelete: true,
    });
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("25.2048");
    expect(serialized).not.toContain("55.2708");
    expect(serialized).not.toContain("accuracy");
  });

  it("builds reconnection context from safe aggregates without notes, media, contacts, coordinates, or tokens", async () => {
    const db = database();
    let received: AgentProviderInput | undefined;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => {
        received = input;
        return { kind: "message", message: "Tell me who you would like to include." };
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "safe-plan-owner@example.test",
      displayName: "Safe Plan Owner",
      familyName: "Safe Plan Family",
    });
    const relativeId = addUnlinkedRelative(db, family.familyId, "Safe Relative");
    const requesterLocationConsentId = randomUUID();
    const locationConsentId = randomUUID();
    const gatheringId = randomUUID();
    const now = TEST_NOW.toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO location_consents
         (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
         VALUES (?, ?, ?, ?, 'self_consent', 'exact', 'private', ?)`,
      ).run(requesterLocationConsentId, family.familyId, family.memberId, family.userId, now);
      db.prepare(
        `INSERT INTO member_locations
         (id, family_id, member_id, consent_id, source, precision, visibility, latitude, longitude,
          accuracy_m, captured_at, updated_at)
         VALUES (?, ?, ?, ?, 'browser', 'exact', 'private', 25.2048, 55.2708, 5, ?, ?)`,
      ).run(randomUUID(), family.familyId, family.memberId, requesterLocationConsentId, now, now);
      db.prepare(
        "UPDATE family_members SET phone = ?, email = ?, notes = ? WHERE id = ?",
      ).run("+971-secret-phone", "relative-secret@example.test", "PRIVATE_MEMBER_NOTE", relativeId);
      db.prepare(
        `INSERT INTO relationships (id, family_id, source_member_id, target_member_id, type, created_at)
         VALUES (?, ?, ?, ?, 'sibling', ?)`,
      ).run(randomUUID(), family.familyId, family.memberId, relativeId, now);
      db.prepare(
        `INSERT INTO location_consents
         (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
         VALUES (?, ?, ?, ?, 'admin_reported', 'exact', 'family', ?)`,
      ).run(locationConsentId, family.familyId, relativeId, family.userId, now);
      db.prepare(
        `INSERT INTO member_locations
         (id, family_id, member_id, consent_id, source, precision, visibility, latitude, longitude,
          accuracy_m, emirate, city, captured_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', 'exact', 'family', 25.3573, 55.4033, 3, 'Sharjah', 'Sharjah', ?, ?)`,
      ).run(randomUUID(), family.familyId, relativeId, locationConsentId, now, now);
      db.prepare(
        `INSERT INTO gatherings
         (id, family_id, title, purpose, start_at, timezone, location_name, notes, gathering_type,
          status, created_by_user_id, completed_at, created_at, updated_at)
         VALUES (?, ?, 'Private-title-not-needed', 'Family time', ?, 'Asia/Dubai', 'Private venue',
                 'PRIVATE_GATHERING_NOTE', 'meal', 'completed', ?, ?, ?, ?)`,
      ).run(gatheringId, family.familyId, now, family.userId, now, now, now);
      db.prepare(
        `INSERT INTO gathering_invitations
         (id, gathering_id, member_id, channel, token_hash, status, prepared_at, responded_at, updated_at)
         VALUES (?, ?, ?, 'share_link', 'PRIVATE_TOKEN_HASH', 'going', ?, ?, ?)`,
      ).run(randomUUID(), gatheringId, relativeId, now, now, now);
      db.prepare(
        `INSERT INTO memories
         (id, family_id, gathering_id, created_by_user_id, title, note, memory_type, visibility,
          ai_processing_allowed, media_mime_type, storage_path, captured_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Private memory title', 'PRIVATE_MEMORY_NOTE', 'photo', 'private', 1,
                 'image/jpeg', 'C:/private/media.jpg', ?, ?, ?)`,
      ).run(randomUUID(), family.familyId, gatheringId, family.userId, now, now, now);
      db.prepare(
        `INSERT INTO memories
         (id, family_id, gathering_id, created_by_user_id, title, note, memory_type, visibility,
          ai_processing_allowed, captured_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Shared memory title', 'AI_CONSENTED_MEMORY_CONTENT', 'note', 'family', 1, ?, ?, ?)`,
      ).run(randomUUID(), family.familyId, gatheringId, family.userId, now, now, now);
      db.prepare(
        `INSERT INTO reward_ledger
         (id, family_id, points, reason_code, description, entity_type, entity_id, dedupe_key, created_at)
         VALUES (?, ?, 150, 'TEST_EVENT', 'PRIVATE_REWARD_DESCRIPTION', 'gathering', ?, ?, ?)`,
      ).run(randomUUID(), family.familyId, gatheringId, randomUUID(), now);
    })();

    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Help me make a gentle reconnection plan." })
      .expect(200);

    expect(received).toBeDefined();
    expect(received!.family.members.find((member) => member.id === relativeId)?.location).toEqual({
      city: "Sharjah",
      emirate: "Sharjah",
      distanceBand: "5-to-25-km",
    });
    expect(received!.family.engagement.evidenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gatherings.completed", value: 1 }),
        expect.objectContaining({ id: `invitations.${relativeId}.going`, value: 1 }),
        expect.objectContaining({ id: "memories.ai_consented_shared.count", value: 1 }),
        expect.objectContaining({ id: "rewards.balance", value: 150 }),
      ]),
    );
    const serialized = JSON.stringify(received);
    [
      "+971-secret-phone",
      "relative-secret@example.test",
      "PRIVATE_MEMBER_NOTE",
      "PRIVATE_GATHERING_NOTE",
      "PRIVATE_TOKEN_HASH",
      "PRIVATE_MEMORY_NOTE",
      "AI_CONSENTED_MEMORY_CONTENT",
      "C:/private/media.jpg",
      "PRIVATE_REWARD_DESCRIPTION",
      "25.3573",
      "55.4033",
    ].forEach((secret) => expect(serialized).not.toContain(secret));
  });

  it("rejects reconnection proposals containing unknown member, evidence, or activity IDs", async () => {
    const cases = [
      { suggestedMemberIds: [randomUUID()] },
      { evidenceSignalIds: ["invented.evidence"] },
      { suggestedActivityId: randomUUID() },
    ];

    for (const [index, override] of cases.entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider((input) => reconnectionPlanDecision(input, override)),
        bcryptRounds: 4,
        rateLimitEnabled: false,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `invalid-plan-${index}@example.test`,
        displayName: `Invalid Plan Owner ${index}`,
        familyName: `Invalid Plan Family ${index}`,
      });
      addUnlinkedRelative(db, family.familyId, `Relative ${index}`);

      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: "Make a plan." })
        .expect(502);
      expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      expect(
        (db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count,
      ).toBe(0);
    }
  });

  it("asks for clarification instead of targeting the only recorded family member", async () => {
    const db = database();
    const provider = callbackProvider((input) => ({
      kind: "proposal",
      message: "Here is a plan.",
      action: {
        type: "CREATE_RECONNECTION_PLAN",
        payload: {
          title: "A simple check-in",
          rationale: "A short conversation can be a pleasant shared activity.",
          suggestedMemberIds: [input.family.members[0].id],
          evidenceSignalIds: ["family.member_count"],
          suggestedGathering: {
            format: "phone_call",
            purpose: "Have a relaxed conversation.",
            durationMinutes: 30,
          },
          rewardChallenge: "Write down one shared idea after the call.",
        },
      },
    }));
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "sparse-plan-owner@example.test",
      displayName: "Sparse Plan Owner",
      familyName: "Sparse Plan Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Who should I reconnect with?" })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "clarification",
      message: expect.stringContaining("add at least one relative"),
    });
    expect((db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(
      0,
    );
  });

  it("rejects judgmental or sensitive reconnection-plan language", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) =>
        reconnectionPlanDecision(input, {
          rationale: "This relative is neglectful and does not care about the family.",
        }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "judgment-plan-owner@example.test",
      displayName: "Judgment Plan Owner",
      familyName: "Judgment Plan Family",
    });
    addUnlinkedRelative(db, family.familyId, "Hamad");

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Make a plan with Hamad." })
      .expect(502);
    expect(response.body.error.code).toBe("AGENT_UNSAFE_PLAN_LANGUAGE");
    expect((db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(
      0,
    );
  });

  it("stores a confirmed reconnection plan exactly once without creating a gathering, invitation, or reward", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => reconnectionPlanDecision(input), {
        providerName: "safe-test-provider",
        modelName: "safe-test-model-v1",
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "confirm-plan-owner@example.test",
      displayName: "Plan Owner",
      familyName: "Confirm Plan Family",
    });
    const relativeId = addUnlinkedRelative(db, family.familyId, "Noura");
    db.prepare(
      `INSERT INTO relationships (id, family_id, source_member_id, target_member_id, type, created_at)
       VALUES (?, ?, ?, ?, 'sibling', ?)`,
    ).run(randomUUID(), family.familyId, family.memberId, relativeId, TEST_NOW.toISOString());

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Make a simple plan to spend time with Noura." })
      .expect(201);
    expect(proposed.body).toMatchObject({
      kind: "proposal",
      proposal: {
        actionType: "CREATE_RECONNECTION_PLAN",
        title: "A relaxed catch-up with Noura",
        warnings: expect.arrayContaining([expect.stringContaining("does not create a gathering")]),
      },
    });
    expect((db.prepare("SELECT count(*) AS count FROM reconnection_plans").get() as { count: number }).count).toBe(0);

    const proposalId = proposed.body.proposal.id as string;
    const confirmed = await browser.post(`/api/agent/action-proposals/${proposalId}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposalId}/confirm`).expect(200);

    expect(confirmed.body).toMatchObject({
      status: "confirmed",
      alreadyCompleted: false,
      message: expect.stringContaining("No gathering or invitation was created"),
      result: { planId: expect.any(String) },
    });
    expect(repeated.body).toMatchObject({
      status: "confirmed",
      alreadyCompleted: true,
      result: { planId: confirmed.body.result.planId },
    });
    const plans = db.prepare("SELECT * FROM reconnection_plans WHERE family_id = ?").all(family.familyId) as Array<
      Record<string, unknown>
    >;
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: confirmed.body.result.planId,
      provider: "safe-test-provider",
      model: "safe-test-model-v1",
      suggested_activity_id: "10000000-0000-4000-8000-000000000002",
    });
    expect(JSON.parse(String(plans[0].suggested_member_ids_json))).toEqual([relativeId]);
    const evidence = JSON.parse(String(plans[0].evidence_json)) as { signals: Array<{ id: string }> };
    expect(evidence.signals.map((signal) => signal.id)).toEqual(["family.relationship_count", "gatherings.completed"]);
    expect((db.prepare("SELECT count(*) AS count FROM gatherings").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT count(*) AS count FROM gathering_invitations").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT count(*) AS count FROM reward_ledger").get() as { count: number }).count).toBe(0);
    expect(
      (
        db
          .prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.reconnection_plan.confirmed'")
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it("cancels a reconnection plan proposal without persisting the plan", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => reconnectionPlanDecision(input)),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "reject-plan-owner@example.test",
      displayName: "Reject Plan Owner",
      familyName: "Reject Plan Family",
    });
    addUnlinkedRelative(db, family.familyId, "Mariam");

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Make a plan with Mariam." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    await browser.post(`/api/agent/action-proposals/${proposalId}/reject`).expect(200);
    await browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_REJECTED"));

    expect((db.prepare("SELECT count(*) AS count FROM reconnection_plans").get() as { count: number }).count).toBe(0);
  });

  it("creates an ADD_MEMBER proposal and applies it exactly once after owner confirmation", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => addMemberDecision(input)),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "confirm-owner@example.test",
      displayName: "Ahmed",
      familyName: "Confirm Family",
    });

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my brother Khaled. He lives in Sharjah." })
      .expect(201);

    expect(proposed.body).toMatchObject({
      kind: "proposal",
      proposal: {
        actionType: "ADD_MEMBER",
        title: "Add Khaled to the family",
        details: {
          name: "Khaled",
          approximateLocation: "Sharjah, Sharjah",
          relationships: [expect.objectContaining({ existingMember: "Ahmed", type: "sibling" })],
        },
      },
    });
    expect(
      (db.prepare("SELECT count(*) AS count FROM family_members WHERE family_id = ?").get(family.familyId) as {
        count: number;
      }).count,
    ).toBe(1);

    const proposalId = proposed.body.proposal.id as string;
    const confirmed = await browser.post(`/api/agent/action-proposals/${proposalId}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposalId}/confirm`).expect(200);

    expect(confirmed.body).toMatchObject({ status: "confirmed", alreadyCompleted: false });
    expect(repeated.body).toMatchObject({ status: "confirmed", message: expect.stringContaining("already completed") });
    expect(repeated.body.result.memberId).toBe(confirmed.body.result.memberId);

    const khaled = db
      .prepare("SELECT id, display_name FROM family_members WHERE family_id = ? AND display_name = 'Khaled'")
      .all(family.familyId) as Array<{ id: string; display_name: string }>;
    expect(khaled).toHaveLength(1);
    expect(
      db
        .prepare(
          `SELECT source_member_id, target_member_id, type FROM relationships
           WHERE family_id = ? AND type = 'sibling'`,
        )
        .all(family.familyId),
    ).toEqual([
      expect.objectContaining({ source_member_id: khaled[0].id, target_member_id: family.memberId, type: "sibling" }),
    ]);
    expect(
      db.prepare("SELECT city, emirate, latitude, longitude, visibility FROM member_locations WHERE member_id = ?").get(
        khaled[0].id,
      ),
    ).toEqual({ city: "Sharjah", emirate: "Sharjah", latitude: null, longitude: null, visibility: "family_admin" });
    expect(
      (
        db
          .prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.add_member.confirmed'")
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it("allows a shared name without a matching birth date and persists every supported profile field", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review the complete profile.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            displayName: "Khaled",
            birthDate: "1985-04-12",
            phone: "+971 50 123 4567",
            email: "KHALED@example.test",
            interests: ["Falconry", "Falconry", "Poetry"],
            notes: "Prefers calls in the evening.",
            relationships: [{
              existingMemberId: input.family.requester.linkedMemberId!,
              type: "sibling",
              direction: "new_to_existing",
            }],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "profile-parity-owner@example.test",
      displayName: "Ahmad",
      familyName: "Profile Parity Family",
    });
    addUnlinkedRelative(db, family.familyId, "Khaled");

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my brother Khaled with the profile details I provided." })
      .expect(201);
    expect(proposed.body.proposal.details).toMatchObject({
      name: "Khaled",
      birthDate: "1985-04-12",
      phone: "+971 50 123 4567",
      email: "khaled@example.test",
      interests: ["Falconry", "Poetry"],
      notes: "Prefers calls in the evening.",
    });

    const confirmed = await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    expect(db.prepare(
      `SELECT display_name, birth_date, phone, email, interests_json, notes
       FROM family_members WHERE id = ?`,
    ).get(confirmed.body.result.memberId)).toEqual({
      display_name: "Khaled",
      birth_date: "1985-04-12",
      phone: "+971 50 123 4567",
      email: "khaled@example.test",
      interests_json: '["Falconry","Poetry"]',
      notes: "Prefers calls in the evening.",
    });
  });

  it.each([
    {
      label: "display name plus birth date",
      existing: { displayName: "Khaled", birthDate: "1985-04-12" },
      proposed: { displayName: "khaled", birthDate: "1985-04-12" },
    },
    {
      label: "email",
      existing: { displayName: "Existing Relative", email: "same@example.test" },
      proposed: { displayName: "Different Relative", email: "SAME@example.test" },
    },
  ])("clarifies instead of proposing an ADD_MEMBER duplicate by $label", async ({ existing, proposed }) => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review this profile.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            ...proposed,
            interests: [],
            relationships: [{
              existingMemberId: input.family.requester.linkedMemberId!,
              type: "relative",
              direction: "new_to_existing",
            }],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: `duplicate-${randomUUID()}@example.test`,
      displayName: "Owner",
      familyName: "Duplicate Family",
    });
    const existingId = addUnlinkedRelative(db, family.familyId, existing.displayName);
    db.prepare("UPDATE family_members SET birth_date = ?, email = ? WHERE id = ?")
      .run(existing.birthDate ?? null, existing.email ?? null, existingId);

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add this relative." })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringContaining("already exists") });
    expect((db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(0);
  });

  it("rechecks duplicate identity at confirmation after an intervening manual add", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review this profile.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            displayName: "Mariam",
            email: "mariam@example.test",
            interests: [],
            relationships: [{
              existingMemberId: input.family.requester.linkedMemberId!,
              type: "relative",
              direction: "new_to_existing",
            }],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "confirmation-duplicate-owner@example.test",
      displayName: "Owner",
      familyName: "Confirmation Duplicate Family",
    });
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add Mariam as a relative." })
      .expect(201);

    await browser.post(`/api/families/${family.familyId}/members`).send({
      displayName: "Already Added Elsewhere",
      email: "MARIAM@example.test",
      interests: [],
    }).expect(201);

    await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("MEMBER_EXISTS"));
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id)).toEqual({
      status: "pending",
    });
    expect((db.prepare("SELECT count(*) AS count FROM family_members WHERE lower(email) = lower(?)").get(
      "mariam@example.test",
    ) as { count: number }).count).toBe(1);
  });

  it("rejects a proposal idempotently without a domain write", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => addMemberDecision(input, "Maryam")),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "reject-owner@example.test",
      displayName: "Reject Owner",
      familyName: "Reject Family",
    });

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my sister Maryam." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;

    const rejected = await browser.post(`/api/agent/action-proposals/${proposalId}/reject`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposalId}/reject`).expect(200);

    expect(rejected.body).toMatchObject({ status: "rejected", alreadyRejected: false });
    expect(repeated.body).toMatchObject({ status: "rejected", alreadyRejected: true });
    expect(
      (db.prepare("SELECT count(*) AS count FROM family_members WHERE family_id = ?").get(family.familyId) as {
        count: number;
      }).count,
    ).toBe(1);
    expect(
      (db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.action.rejected'").get() as {
        count: number;
      }).count,
    ).toBe(1);
  });

  it("allows a family member to ask the agent but blocks an administrator-only proposal", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => addMemberDecision(input, "Member Proposal")),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const ownerBrowser = request.agent(app);
    const owner = await register(ownerBrowser, db, {
      email: "role-owner@example.test",
      displayName: "Role Owner",
      familyName: "Role Family",
    });
    const memberBrowser = request.agent(app);
    const other = await register(memberBrowser, db, {
      email: "regular-member@example.test",
      displayName: "Regular Member",
      familyName: "Temporary Family",
    });
    db.prepare(
      `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
       VALUES (?, ?, 'member', NULL, ?)`,
    ).run(owner.familyId, other.userId, TEST_NOW.toISOString());

    const denied = await memberBrowser
      .post("/api/agent/messages")
      .send({ familyId: owner.familyId, message: "Add Member Proposal to this family." })
      .expect(403);
    expect(denied.body.error.code).toBe("INSUFFICIENT_ROLE");
    expect(
      (db.prepare("SELECT count(*) AS count FROM family_members WHERE family_id = ?").get(owner.familyId) as {
        count: number;
      }).count,
    ).toBe(1);
    expect((db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(0);
  });

  it("server-corrects an explicit first-person sibling link before preview and confirmation", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review this addition.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            displayName: "Khaled",
            birthDate: "1985-04-12",
            interests: [],
            relationships: [{
              existingMemberId: input.family.members.find((member) => member.id !== input.family.requester.linkedMemberId)!.id,
              type: "relative",
              direction: "existing_to_new",
            }],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "first-person-owner@example.test",
      displayName: "Ahmad",
      familyName: "First Person Family",
    });
    addUnlinkedRelative(db, family.familyId, "Someone Else");

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my brother Khaled, born 1985-04-12." })
      .expect(201);
    expect(proposed.body.proposal.details.relationships).toEqual([
      expect.objectContaining({ existingMember: "Ahmad", type: "sibling", direction: "new_to_existing" }),
    ]);

    const confirmed = await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    const relationship = db
      .prepare("SELECT source_member_id, target_member_id, type FROM relationships WHERE source_member_id = ?")
      .get(confirmed.body.result.memberId) as { source_member_id: string; target_member_id: string; type: string };
    expect(relationship).toEqual({
      source_member_id: confirmed.body.result.memberId,
      target_member_id: family.memberId,
      type: "sibling",
    });
  });

  it("repairs the requester link while preserving a co-parent link in one atomic child addition", async () => {
    const db = database();
    let coParentId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review both parent connections.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            displayName: "Omar",
            interests: [],
            relationships: [
              {
                existingMemberId: input.family.requester.linkedMemberId!,
                type: "sibling",
                direction: "new_to_existing",
              },
              { existingMemberId: coParentId, type: "parent", direction: "existing_to_new" },
            ],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "co-parent-owner@example.test",
      displayName: "Ahmad",
      familyName: "Co-parent Family",
    });
    coParentId = addUnlinkedRelative(db, family.familyId, "Sara");

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my son Omar; Sara is his mother." })
      .expect(201);
    expect(proposed.body.proposal.details.relationships).toEqual([
      expect.objectContaining({ existingMember: "Ahmad", type: "parent", direction: "existing_to_new" }),
      expect.objectContaining({ existingMember: "Sara", type: "parent", direction: "existing_to_new" }),
    ]);

    const confirmed = await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(200);
    expect(db.prepare(
      `SELECT source_member_id, target_member_id, type FROM relationships
       WHERE target_member_id = ? ORDER BY source_member_id`,
    ).all(confirmed.body.result.memberId)).toEqual([
      { source_member_id: family.memberId, target_member_id: confirmed.body.result.memberId, type: "parent" },
      { source_member_id: coParentId, target_member_id: confirmed.body.result.memberId, type: "parent" },
    ].sort((left, right) => left.source_member_id.localeCompare(right.source_member_id)));
  });

  it("revalidates the deterministic first-person relationship at confirmation", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review this addition.",
        action: {
          type: "ADD_MEMBER",
          payload: { displayName: "Maryam", interests: [], relationships: [] },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "tamper-owner@example.test",
      displayName: "Tamper Owner",
      familyName: "Tamper Family",
    });
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my sister Maryam." })
      .expect(201);
    const row = db
      .prepare("SELECT payload_json FROM agent_action_proposals WHERE id = ?")
      .get(proposed.body.proposal.id) as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as { member: { relationships: Array<Record<string, unknown>> } };
    payload.member.relationships = [];
    db.prepare("UPDATE agent_action_proposals SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), proposed.body.proposal.id);

    await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("INVALID_STORED_PROPOSAL"));
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id)).toEqual({
      status: "pending",
    });
    expect(db.prepare("SELECT id FROM family_members WHERE display_name = 'Maryam'").get()).toBeUndefined();
  });

  it("does not mistake a possessive reference such as my father's brother for a direct parent link", async () => {
    const db = database();
    let fatherId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review this uncle profile.",
        action: {
          type: "ADD_MEMBER",
          payload: {
            displayName: "Khaled",
            interests: [],
            relationships: [{ existingMemberId: fatherId, type: "sibling", direction: "new_to_existing" }],
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "possessive-owner@example.test",
      displayName: "Ahmad",
      familyName: "Possessive Family",
    });
    fatherId = addUnlinkedRelative(db, family.familyId, "Father");
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Add my uncle Khaled. He is my father's brother." })
      .expect(201);
    expect(proposed.body.proposal.details.relationships).toEqual([
      expect.objectContaining({ existingMember: "Father", type: "sibling" }),
    ]);
  });

  it("does not force negated or in-law wording into a direct sibling link", async () => {
    for (const [index, message] of [
      "Add Khaled, not my brother\u2014my cousin.",
      "Add Khaled; he isn\u2019t my brother, he is my cousin.",
      "Add my brother-in-law Khaled.",
    ].entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider((input) => ({
          kind: "proposal",
          message: "Review this relative.",
          action: {
            type: "ADD_MEMBER",
            payload: {
              displayName: `Khaled ${index}`,
              interests: [],
              relationships: [{
                existingMemberId: input.family.requester.linkedMemberId!,
                type: "relative",
                direction: "new_to_existing",
              }],
            },
          },
        })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `negated-kinship-${index}@example.test`,
        displayName: "Ahmad",
        familyName: "Kinship Family",
      });
      const proposed = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(201);
      expect(proposed.body.proposal.details.relationships).toEqual([
        expect.objectContaining({ existingMember: "Ahmad", type: "relative" }),
      ]);
    }
  });

  it("previews and applies UPDATE_MEMBER exactly once", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => ({
        kind: "proposal",
        message: "Review the profile fields.",
        action: {
          type: "UPDATE_MEMBER",
          payload: {
            memberId: input.family.requester.linkedMemberId!,
            changes: { displayName: "Ahmad Updated", birthDate: "1988-05-04", interests: ["Hiking"] },
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "update-owner@example.test",
      displayName: "Ahmad",
      familyName: "Update Family",
    });
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Change my name and birthday." })
      .expect(201);
    expect(proposed.body.proposal).toMatchObject({
      actionType: "UPDATE_MEMBER",
      title: "Update Ahmad",
      details: { memberId: family.memberId, changes: { displayName: "Ahmad Updated", birthDate: "1988-05-04" } },
    });
    expect((db.prepare("SELECT display_name FROM family_members WHERE id = ?").get(family.memberId) as { display_name: string }).display_name).toBe("Ahmad");

    const first = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(first.body).toMatchObject({ alreadyCompleted: false, result: { memberId: family.memberId } });
    expect(repeated.body).toMatchObject({ alreadyCompleted: true, result: { memberId: family.memberId } });
    expect(db.prepare("SELECT display_name, birth_date, interests_json FROM family_members WHERE id = ?").get(family.memberId)).toEqual({
      display_name: "Ahmad Updated",
      birth_date: "1988-05-04",
      interests_json: '["Hiking"]',
    });
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.update_member.confirmed'").get() as { count: number }).count).toBe(1);
  });

  it("creates and destructively removes exact relationship IDs only after confirmation", async () => {
    const db = database();
    let relationshipId: string | undefined;
    const provider = callbackProvider((input) => {
      const owner = input.family.members.find((member) => member.id === input.family.requester.linkedMemberId)!;
      const relative = input.family.members.find((member) => member.id !== input.family.requester.linkedMemberId)!;
      if (!relationshipId) {
        return {
          kind: "proposal",
          message: "Review this connection.",
          action: {
            type: "CREATE_RELATIONSHIP",
            payload: { sourceMemberId: owner.id, targetMemberId: relative.id, type: "parent" },
          },
        };
      }
      return {
        kind: "proposal",
        message: "Review removing this connection.",
        action: { type: "DELETE_RELATIONSHIP", payload: { relationshipId } },
      };
    });
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "relationship-owner@example.test",
      displayName: "Parent",
      familyName: "Relationship Family",
    });
    addUnlinkedRelative(db, family.familyId, "Child");

    const createProposal = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Make me Child's parent." })
      .expect(201);
    expect(createProposal.body.proposal).toMatchObject({
      actionType: "CREATE_RELATIONSHIP",
      details: { sourceMember: "Parent", targetMember: "Child", type: "parent" },
    });
    expect((db.prepare("SELECT count(*) AS count FROM relationships").get() as { count: number }).count).toBe(0);
    const created = await browser.post(`/api/agent/action-proposals/${createProposal.body.proposal.id}/confirm`).expect(200);
    relationshipId = created.body.result.relationshipId;

    const deleteProposal = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Remove that parent relationship." })
      .expect(201);
    expect(deleteProposal.body.proposal).toMatchObject({
      actionType: "DELETE_RELATIONSHIP",
      details: { relationshipId },
      warnings: expect.arrayContaining([expect.stringContaining("Destructive action")]),
    });
    expect(db.prepare("SELECT id FROM relationships WHERE id = ?").get(relationshipId)).toBeDefined();
    const deleted = await browser.post(`/api/agent/action-proposals/${deleteProposal.body.proposal.id}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${deleteProposal.body.proposal.id}/confirm`).expect(200);
    expect(deleted.body).toMatchObject({ alreadyCompleted: false, result: { relationshipId } });
    expect(repeated.body).toMatchObject({ alreadyCompleted: true, result: { relationshipId } });
    expect(db.prepare("SELECT id FROM relationships WHERE id = ?").get(relationshipId)).toBeUndefined();
  });

  it("deletes an unlinked member with destructive preview and blocks one linked after proposal creation", async () => {
    const db = database();
    let targetId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review the permanent removal.",
        action: { type: "DELETE_MEMBER", payload: { memberId: targetId } },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "delete-owner@example.test",
      displayName: "Delete Owner",
      familyName: "Delete Family",
    });
    targetId = addUnlinkedRelative(db, family.familyId, "Temporary Relative");
    db.prepare(
      `INSERT INTO relationships (id, family_id, source_member_id, target_member_id, type, created_at)
       VALUES (?, ?, ?, ?, 'relative', ?)`,
    ).run(randomUUID(), family.familyId, family.memberId, targetId, TEST_NOW.toISOString());

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Remove Temporary Relative." })
      .expect(201);
    expect(proposed.body.proposal).toMatchObject({
      actionType: "DELETE_MEMBER",
      details: { memberId: targetId, connectedRelationshipsRemoved: 1 },
      warnings: expect.arrayContaining([expect.stringContaining("permanently deletes")]),
    });

    // A member can become account-linked between preview and confirmation;
    // confirmation must revalidate and roll back its proposal claim.
    const linkedUser = await register(request.agent(app), db, {
      email: "newly-linked@example.test",
      displayName: "Other Family Owner",
      familyName: "Other Family",
    });
    db.prepare("UPDATE family_members SET user_id = ? WHERE id = ?").run(linkedUser.userId, targetId);
    await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("MEMBER_HAS_ACCOUNT"));
    expect(db.prepare("SELECT id FROM family_members WHERE id = ?").get(targetId)).toBeDefined();
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id)).toEqual({ status: "pending" });

    db.prepare("UPDATE family_members SET user_id = NULL WHERE id = ?").run(targetId);
    const confirmed = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(confirmed.body).toMatchObject({ alreadyCompleted: false, result: { memberId: targetId } });
    expect(repeated.body).toMatchObject({ alreadyCompleted: true, result: { memberId: targetId } });
    expect(db.prepare("SELECT id FROM family_members WHERE id = ?").get(targetId)).toBeUndefined();
  });

  it("rejects member deletion when an existing invitation RSVP changes after preview", async () => {
    const db = database();
    let targetId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review the permanent removal.",
        action: { type: "DELETE_MEMBER", payload: { memberId: targetId } },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "delete-rsvp-stale@example.test",
      displayName: "Delete RSVP Owner",
      familyName: "Delete RSVP Family",
    });
    targetId = addUnlinkedRelative(db, family.familyId, "RSVP Target");
    const gatheringId = randomUUID();
    const invitationId = randomUUID();
    db.prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
        status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Tea', 'Visit', ?, 'Asia/Dubai', 'Home', 'visit', 'inviting', ?, ?, ?)`,
    ).run(gatheringId, family.familyId, "2026-08-12T12:00:00.000Z", family.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare(
      `INSERT INTO gathering_invitations
       (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
       VALUES (?, ?, ?, 'share_link', ?, 'pending', ?, ?)`,
    ).run(invitationId, gatheringId, targetId, randomUUID(), TEST_NOW.toISOString(), TEST_NOW.toISOString());

    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Remove RSVP Target." })
      .expect(201);
    db.prepare("UPDATE gathering_invitations SET status = 'going', updated_at = ? WHERE id = ?")
      .run("2026-08-13T13:00:00.000Z", invitationId);

    await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));
    expect(db.prepare("SELECT id FROM family_members WHERE id = ?").get(targetId)).toBeDefined();
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id)).toEqual({
      status: "pending",
    });
  });

  it("lets regular family members update only their own linked profile", async () => {
    const db = database();
    let requestedAction: "self" | "delete" = "self";
    const provider = callbackProvider((input) => requestedAction === "self"
      ? {
          kind: "proposal",
          message: "Review your profile update.",
          action: {
            type: "UPDATE_MEMBER",
            payload: { memberId: input.family.requester.linkedMemberId!, changes: { notes: "My own note" } },
          },
        }
      : {
          kind: "proposal",
          message: "Review deletion.",
          action: {
            type: "DELETE_MEMBER",
            payload: { memberId: input.family.members.find((member) => member.id !== input.family.requester.linkedMemberId)!.id },
          },
        });
    const app = createApp({ database: db, agentProvider: provider, bcryptRounds: 4, rateLimitEnabled: false });
    const ownerBrowser = request.agent(app);
    const owner = await register(ownerBrowser, db, {
      email: "parity-owner@example.test",
      displayName: "Parity Owner",
      familyName: "Parity Family",
    });
    const memberBrowser = request.agent(app);
    const other = await register(memberBrowser, db, {
      email: "parity-member@example.test",
      displayName: "Temporary Owner",
      familyName: "Temporary Family",
    });
    const linkedMemberId = randomUUID();
    db.prepare(
      `INSERT INTO family_members
       (id, family_id, user_id, display_name, interests_json, created_at, updated_at)
       VALUES (?, ?, ?, 'Regular Member', '[]', ?, ?)`,
    ).run(linkedMemberId, owner.familyId, other.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare(
      `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
       VALUES (?, ?, 'member', ?, ?)`,
    ).run(owner.familyId, other.userId, linkedMemberId, TEST_NOW.toISOString());

    const selfProposal = await memberBrowser
      .post("/api/agent/messages")
      .send({ familyId: owner.familyId, message: "Update my note." })
      .expect(201);
    await memberBrowser.post(`/api/agent/action-proposals/${selfProposal.body.proposal.id}/confirm`).expect(200);
    expect((db.prepare("SELECT notes FROM family_members WHERE id = ?").get(linkedMemberId) as { notes: string }).notes).toBe("My own note");

    requestedAction = "delete";
    await memberBrowser
      .post("/api/agent/messages")
      .send({ familyId: owner.familyId, message: "Delete the other profile." })
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("INSUFFICIENT_ROLE"));
  });

  it("revalidates administrator permission when a pending graph proposal is confirmed", async () => {
    const db = database();
    let targetId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review this removal.",
        action: { type: "DELETE_MEMBER", payload: { memberId: targetId } },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "permission-recheck@example.test",
      displayName: "Permission Owner",
      familyName: "Permission Family",
    });
    targetId = addUnlinkedRelative(db, family.familyId, "Keep Me");
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Remove Keep Me." })
      .expect(201);
    db.prepare("UPDATE family_users SET role = 'member' WHERE family_id = ? AND user_id = ?")
      .run(family.familyId, family.userId);

    await browser
      .post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("INSUFFICIENT_ROLE"));
    expect(db.prepare("SELECT id FROM family_members WHERE id = ?").get(targetId)).toBeDefined();
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id)).toEqual({ status: "pending" });
  });

  it("rejects unknown member and relationship IDs returned by the provider", async () => {
    const cases = [
      { type: "UPDATE_MEMBER", payload: { memberId: randomUUID(), changes: { displayName: "Unknown" } } },
      { type: "DELETE_MEMBER", payload: { memberId: randomUUID() } },
      { type: "CREATE_RELATIONSHIP", payload: { sourceMemberId: randomUUID(), targetMemberId: randomUUID(), type: "sibling" } },
      { type: "DELETE_RELATIONSHIP", payload: { relationshipId: randomUUID() } },
    ];
    for (const [index, action] of cases.entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => ({ kind: "proposal", message: "Invalid action.", action })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `unknown-action-${index}@example.test`,
        displayName: `Unknown Owner ${index}`,
        familyName: `Unknown Family ${index}`,
      });
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: "Do the invalid action." })
        .expect(502);
      expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_action_proposals").get() as { count: number }).count).toBe(0);
    }
  });

  it("creates a gathering draft through confirmation and keeps repeat confirmation idempotent", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review this gathering draft.",
        action: {
          type: "CREATE_GATHERING_DRAFT",
          payload: {
            title: "Family tea",
            purpose: "Spend time together",
            startAt: "2026-08-15T17:00:00.000+04:00",
            timezone: "Asia/Dubai",
            locationName: "Family home",
            type: "visit",
          },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "draft-agent@example.test",
      displayName: "Draft Owner",
      familyName: "Draft Family",
    });
    const proposed = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Draft family tea." }).expect(201);
    const first = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(first.body.result.gatheringId).toMatch(/[0-9a-f-]{36}/);
    const second = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(second.body.alreadyCompleted).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(1);
  });

  it("returns invitation links once, does not persist them, and rejects stale RSVP rotation", async () => {
    const db = database();
    let gatheringId = "";
    let relativeId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review invitation link rotation.",
        action: {
          type: "PREPARE_INVITATION_LINKS",
          payload: { gatheringId, memberIds: [relativeId], channel: "share_link" },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "links-agent@example.test",
      displayName: "Links Owner",
      familyName: "Links Family",
    });
    relativeId = addUnlinkedRelative(db, family.familyId, "Invitee");
    gatheringId = randomUUID();
    db.prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
        status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Tea', 'Visit', ?, 'Asia/Dubai', 'Home', 'visit', 'draft', ?, ?, ?)`,
    ).run(gatheringId, family.familyId, "2026-08-15T13:00:00.000Z", family.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());

    const proposed = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Prepare Invitee's link." }).expect(201);
    const first = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(first.body.result.invitations[0].shareUrl).toContain("/invite/");
    const secretUrl = first.body.result.invitations[0].shareUrl as string;
    const persistent = JSON.stringify({
      proposal: db.prepare("SELECT payload_json, warnings_json FROM agent_action_proposals WHERE id = ?").get(proposed.body.proposal.id),
      messages: db.prepare("SELECT content_text FROM agent_messages").all(),
      audits: db.prepare("SELECT details_json FROM audit_events").all(),
    });
    expect(persistent).not.toContain(secretUrl.split("/invite/")[1]);
    const repeated = await browser.post(`/api/agent/action-proposals/${proposed.body.proposal.id}/confirm`).expect(200);
    expect(repeated.body.result.invitations).toBeUndefined();
    expect(repeated.body.message).toContain("cannot be recovered");

    const stale = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Rotate it again." }).expect(201);
    db.prepare("UPDATE gathering_invitations SET status = 'going', updated_at = ? WHERE gathering_id = ? AND member_id = ?")
      .run("2026-08-13T13:00:00.000Z", gatheringId, relativeId);
    await browser.post(`/api/agent/action-proposals/${stale.body.proposal.id}/confirm`).expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(stale.body.proposal.id)).toEqual({ status: "pending" });
  });

  it("snapshots the complete gathering roster and completes exactly once after a fresh preview", async () => {
    const db = database();
    let gatheringId = "";
    let attendeeIds: string[] = [];
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({
        kind: "proposal",
        message: "Review permanent attendance and rewards.",
        action: {
          type: "COMPLETE_GATHERING",
          payload: { gatheringId, confirmAttendeeMemberIds: attendeeIds },
        },
      })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "complete-agent@example.test",
      displayName: "Complete Owner",
      familyName: "Complete Family",
    });
    const secondAttendeeId = addUnlinkedRelative(db, family.familyId, "Second Attendee");
    const lateGoingId = addUnlinkedRelative(db, family.familyId, "Late Going");
    attendeeIds = [family.memberId, secondAttendeeId];
    gatheringId = randomUUID();
    db.prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
        status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Past Tea', 'Visit', ?, 'Asia/Dubai', 'Home', 'visit', 'inviting', ?, ?, ?)`,
    ).run(gatheringId, family.familyId, "2026-08-12T12:00:00.000Z", family.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    const insertInvitation = db.prepare(
      `INSERT INTO gathering_invitations
       (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
       VALUES (?, ?, ?, 'share_link', ?, ?, ?, ?)`,
    );
    for (const [memberId, status] of [
      [family.memberId, "going"],
      [secondAttendeeId, "going"],
      [lateGoingId, "pending"],
    ] as const) {
      insertInvitation.run(randomUUID(), gatheringId, memberId, randomUUID(), status, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    }

    const stale = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Complete Past Tea with the two Going attendees." })
      .expect(201);
    db.prepare(
      "UPDATE gathering_invitations SET status = 'going', responded_at = ?, updated_at = ? WHERE gathering_id = ? AND member_id = ?",
    ).run("2026-08-13T13:00:00.000Z", "2026-08-13T13:00:00.000Z", gatheringId, lateGoingId);
    await browser
      .post(`/api/agent/action-proposals/${stale.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));
    expect(db.prepare("SELECT status FROM gatherings WHERE id = ?").get(gatheringId)).toEqual({ status: "inviting" });
    expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(stale.body.proposal.id)).toEqual({ status: "pending" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM reward_ledger WHERE family_id = ?").get(family.familyId) as { count: number }).count).toBe(0);

    const fresh = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Complete Past Tea with Ahmad and Second Attendee." })
      .expect(201);
    const confirmed = await browser.post(`/api/agent/action-proposals/${fresh.body.proposal.id}/confirm`).expect(200);
    const repeated = await browser.post(`/api/agent/action-proposals/${fresh.body.proposal.id}/confirm`).expect(200);
    expect(confirmed.body).toMatchObject({ alreadyCompleted: false, result: { gatheringId, pointsAwarded: 500 } });
    expect(repeated.body).toMatchObject({ alreadyCompleted: true, result: { gatheringId } });
    expect(db.prepare("SELECT status FROM gatherings WHERE id = ?").get(gatheringId)).toEqual({ status: "completed" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'gathering.completed'").get() as { count: number }).count).toBe(1);
  });

  it("creates notes, deletes consent-visible memories, and updates plans through controlled confirmations", async () => {
    const db = database();
    let action: unknown;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({ kind: "proposal", message: "Review this engagement change.", action })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "engagement-actions-agent@example.test",
      displayName: "Engagement Owner",
      familyName: "Engagement Actions Family",
    });
    const gatheringId = randomUUID();
    db.prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
        status, created_by_user_id, completed_at, created_at, updated_at)
       VALUES (?, ?, 'Completed Tea', 'Visit', ?, 'Asia/Dubai', 'Home', 'visit', 'completed', ?, ?, ?, ?)`,
    ).run(
      gatheringId,
      family.familyId,
      "2026-08-12T12:00:00.000Z",
      family.userId,
      TEST_NOW.toISOString(),
      TEST_NOW.toISOString(),
      TEST_NOW.toISOString(),
    );

    action = {
      type: "CREATE_NOTE_MEMORY",
      payload: {
        gatheringId,
        title: "Tea story",
        note: "We laughed about the old camping trip.",
        visibility: "family",
        selectedMemberIds: [],
      },
    };
    const noteProposal = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Save this exact story as a family memory." })
      .expect(201);
    const noteConfirmed = await browser
      .post(`/api/agent/action-proposals/${noteProposal.body.proposal.id}/confirm`)
      .expect(200);
    const noteRepeated = await browser
      .post(`/api/agent/action-proposals/${noteProposal.body.proposal.id}/confirm`)
      .expect(200);
    expect(noteRepeated.body.alreadyCompleted).toBe(true);
    expect(db.prepare(
      "SELECT title, note, memory_type, visibility, ai_processing_allowed, captured_at FROM memories WHERE id = ?",
    ).get(noteConfirmed.body.result.memoryId)).toEqual({
      title: "Tea story",
      note: "We laughed about the old camping trip.",
      memory_type: "note",
      visibility: "family",
      ai_processing_allowed: 0,
      captured_at: TEST_NOW.toISOString(),
    });
    expect((db.prepare(
      "SELECT COUNT(*) AS count FROM reward_ledger WHERE family_id = ? AND reason_code = 'MEMORY_CAPTURED'",
    ).get(family.familyId) as { count: number }).count).toBe(1);

    const deletableMemoryId = randomUUID();
    db.prepare(
      `INSERT INTO memories
       (id, family_id, gathering_id, created_by_user_id, title, note, memory_type, visibility,
        ai_processing_allowed, captured_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Delete me', 'Consented text', 'note', 'family', 1, ?, ?, ?)`,
    ).run(
      deletableMemoryId,
      family.familyId,
      gatheringId,
      family.userId,
      TEST_NOW.toISOString(),
      TEST_NOW.toISOString(),
      TEST_NOW.toISOString(),
    );
    action = { type: "DELETE_MEMORY", payload: { memoryId: deletableMemoryId } };
    const staleDelete = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Delete the memory named Delete me." })
      .expect(201);
    db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?")
      .run("2026-08-13T13:00:00.000Z", deletableMemoryId);
    await browser
      .post(`/api/agent/action-proposals/${staleDelete.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));
    expect(db.prepare("SELECT id FROM memories WHERE id = ?").get(deletableMemoryId)).toBeDefined();

    const freshDelete = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Prepare a fresh deletion for Delete me." })
      .expect(201);
    await browser.post(`/api/agent/action-proposals/${freshDelete.body.proposal.id}/confirm`).expect(200);
    const deleteRepeated = await browser
      .post(`/api/agent/action-proposals/${freshDelete.body.proposal.id}/confirm`)
      .expect(200);
    expect(deleteRepeated.body.alreadyCompleted).toBe(true);
    expect(db.prepare("SELECT id FROM memories WHERE id = ?").get(deletableMemoryId)).toBeUndefined();

    const planId = randomUUID();
    db.prepare(
      `INSERT INTO reconnection_plans
       (id, family_id, created_by_user_id, title, rationale, suggested_member_ids_json,
        suggested_gathering_json, evidence_json, status, provider, model, created_at, updated_at)
       VALUES (?, ?, ?, 'Tea plan', 'A gentle plan', '[]', '{}', '[]', 'active', 'test', 'test-model', ?, ?)`,
    ).run(planId, family.familyId, family.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    action = { type: "UPDATE_PLAN_STATUS", payload: { planId, status: "accepted" } };
    const stalePlan = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Accept Tea plan." })
      .expect(201);
    db.prepare("UPDATE reconnection_plans SET status = 'dismissed', updated_at = ? WHERE id = ?")
      .run("2026-08-13T13:00:00.000Z", planId);
    await browser
      .post(`/api/agent/action-proposals/${stalePlan.body.proposal.id}/confirm`)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PROPOSAL_TARGET_CHANGED"));

    const freshPlan = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Now prepare a fresh acceptance for Tea plan." })
      .expect(201);
    await browser.post(`/api/agent/action-proposals/${freshPlan.body.proposal.id}/confirm`).expect(200);
    const planRepeated = await browser
      .post(`/api/agent/action-proposals/${freshPlan.body.proposal.id}/confirm`)
      .expect(200);
    expect(planRepeated.body.alreadyCompleted).toBe(true);
    expect(db.prepare("SELECT status FROM reconnection_plans WHERE id = ?").get(planId)).toEqual({ status: "accepted" });
    expect((db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'reconnection_plan.status_changed'",
    ).get() as { count: number }).count).toBe(1);
  });

  it("rejects stale profile update and complete delete-member impact changes", async () => {
    const db = database();
    let action: unknown;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => ({ kind: "proposal", message: "Review change.", action })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "stale-agent@example.test",
      displayName: "Stale Owner",
      familyName: "Stale Family",
    });
    action = { type: "UPDATE_MEMBER", payload: { memberId: family.memberId, changes: { notes: "AI note" } } };
    const update = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Update me." }).expect(201);
    db.prepare("UPDATE family_members SET notes = 'Manual note', updated_at = ? WHERE id = ?")
      .run("2026-08-13T13:00:00.000Z", family.memberId);
    await browser.post(`/api/agent/action-proposals/${update.body.proposal.id}/confirm`).expect(409);
    expect((db.prepare("SELECT notes FROM family_members WHERE id = ?").get(family.memberId) as { notes: string }).notes).toBe("Manual note");

    const targetId = addUnlinkedRelative(db, family.familyId, "Delete Target");
    action = { type: "DELETE_MEMBER", payload: { memberId: targetId } };
    const deletion = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Delete target." }).expect(201);
    const memoryId = randomUUID();
    db.prepare(
      `INSERT INTO memories
       (id, family_id, created_by_user_id, title, note, memory_type, visibility,
        ai_processing_allowed, captured_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Selected', 'safe', 'note', 'selected', 0, ?, ?, ?)`,
    ).run(memoryId, family.familyId, family.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare("INSERT INTO memory_viewers (memory_id, member_id) VALUES (?, ?)").run(memoryId, targetId);
    await browser.post(`/api/agent/action-proposals/${deletion.body.proposal.id}/confirm`).expect(409);
    expect(db.prepare("SELECT id FROM family_members WHERE id = ?").get(targetId)).toBeDefined();
  });

  it("does not disclose non-consented memory metadata or another member's hidden gathering roster", async () => {
    const db = database();
    let captured: AgentProviderInput | undefined;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => {
        captured = input;
        return { kind: "message", message: "Safe context received." };
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const ownerBrowser = request.agent(app);
    const owner = await register(ownerBrowser, db, {
      email: "context-owner@example.test",
      displayName: "Context Owner",
      familyName: "Context Family",
    });
    const memberBrowser = request.agent(app);
    const memberRegistration = await register(memberBrowser, db, {
      email: "context-member@example.test",
      displayName: "Other Owner",
      familyName: "Other Family",
    });
    const linkedId = randomUUID();
    db.prepare(
      `INSERT INTO family_members (id, family_id, user_id, display_name, interests_json, created_at, updated_at)
       VALUES (?, ?, ?, 'Context Member', '[]', ?, ?)`,
    ).run(linkedId, owner.familyId, memberRegistration.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare("INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at) VALUES (?, ?, 'member', ?, ?)")
      .run(owner.familyId, memberRegistration.userId, linkedId, TEST_NOW.toISOString());
    const hiddenInvitee = addUnlinkedRelative(db, owner.familyId, "Hidden Invitee");
    const gatheringId = randomUUID();
    const hiddenGatheringId = randomUUID();
    for (const [id, title] of [[gatheringId, "Visible Gathering"], [hiddenGatheringId, "HIDDEN_GATHERING"]]) {
      db.prepare(
        `INSERT INTO gatherings
         (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
          status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'Visit', ?, 'Asia/Dubai', 'Home', 'visit', 'inviting', ?, ?, ?)`,
      ).run(id, owner.familyId, title, "2026-08-15T13:00:00.000Z", owner.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    }
    const insertInvitation = db.prepare(
      `INSERT INTO gathering_invitations
       (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
       VALUES (?, ?, ?, 'share_link', ?, 'going', ?, ?)`,
    );
    insertInvitation.run(randomUUID(), gatheringId, linkedId, randomUUID(), TEST_NOW.toISOString(), TEST_NOW.toISOString());
    insertInvitation.run(randomUUID(), gatheringId, hiddenInvitee, randomUUID(), TEST_NOW.toISOString(), TEST_NOW.toISOString());
    insertInvitation.run(randomUUID(), hiddenGatheringId, hiddenInvitee, randomUUID(), TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare(
      `INSERT INTO memories
       (id, family_id, created_by_user_id, title, note, memory_type, visibility,
        ai_processing_allowed, captured_at, created_at, updated_at)
       VALUES (?, ?, ?, 'DO_NOT_DISCLOSE_MEMORY_TITLE', 'DO_NOT_DISCLOSE_CONTENT', 'note', 'family', 0, ?, ?, ?)`,
    ).run(randomUUID(), owner.familyId, owner.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString(), TEST_NOW.toISOString());

    await memberBrowser.post("/api/agent/messages").send({ familyId: owner.familyId, message: "What can I see?" }).expect(200);
    const serialized = JSON.stringify(captured);
    expect(serialized).toContain("Visible Gathering");
    expect(serialized).not.toContain("HIDDEN_GATHERING");
    expect(captured!.family.engagement.gatherings[0].invitationStatuses).toEqual([
      expect.objectContaining({ memberId: linkedId, memberName: "Context Member" }),
    ]);
    expect(serialized).not.toContain("DO_NOT_DISCLOSE_MEMORY_TITLE");
    expect(serialized).not.toContain("DO_NOT_DISCLOSE_CONTENT");
  });

  it("requires user-supplied date and Dubai time before returning a planner and performs no domain writes", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-missing-schedule@example.test",
      displayName: "Ahmad",
      familyName: "Planner Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan an outing to Golden Park." })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: "clarification",
      message: expect.stringMatching(/date.*Dubai time/i),
    });
    expect(response.body).not.toHaveProperty("planner");
    for (const table of ["agent_action_proposals", "gatherings", "gathering_invitations", "reconnection_plans", "reward_ledger"]) {
      expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, table).toBe(0);
    }
  });

  it("asks only for the missing half of the schedule", async () => {
    for (const [index, message, expected, excluded] of [
      [0, "Plan Golden Park on September 12, 2026.", /Dubai time/i, /what date/i],
      [1, "Plan Golden Park at 5 PM.", /what date/i, /Dubai time/i],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision()),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `half-schedule-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Half Schedule Family ${index}`,
      });
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message })
        .expect(200);
      expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(expected) });
      expect(response.body.message).not.toMatch(excluded);
    }
  });

  it("restores the complete multi-turn Golden Park planner and resolves effective parents plus the only sibling", async () => {
    const db = database();
    let calls = 0;
    let secondInput: AgentProviderInput | undefined;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => {
        calls += 1;
        if (calls === 1) {
          return { kind: "clarification", message: "What date and Dubai time would you like to visit Golden Park?" };
        }
        secondInput = input;
        return gatheringPlannerDecision();
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "golden-park-planner@example.test",
      displayName: "Ahmad Mustafa",
      familyName: "Mustafa Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, anasId, "parent");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");

    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "I want to go to Golden Park with my parents and sibling.",
      })
      .expect(200);
    const second = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: first.body.sessionId,
        message: "September 12, 2026 at 5:00 PM.",
      })
      .expect(200);

    expect(second.body).toMatchObject({
      sessionId: first.body.sessionId,
      messageId: expect.any(String),
      kind: "gathering_planner",
      message: expect.stringMatching(/venue has not been verified/i),
      planner: {
        title: "Golden Park family outing",
        purpose: "Spend time together at Golden Park",
        startAt: "2026-09-12T17:00:00+04:00",
        timezone: "Asia/Dubai",
        locationName: "Golden Park",
        type: "Outdoor activity",
        memberIds: [dadId, momId, anasId],
        invitationChannel: "share_link",
      },
    });
    expect(second.body.planner).not.toHaveProperty("notes");
    expect(secondInput?.history.map((turn) => turn.message)).toEqual([
      "I want to go to Golden Park with my parents and sibling.",
      "What date and Dubai time would you like for this gathering?",
    ]);

    const restored = await browser
      .get(`/api/agent/sessions/${first.body.sessionId}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    expect(restored.body.messages.map((message: { role: string; message: string }) => [message.role, message.message])).toEqual([
      ["user", "I want to go to Golden Park with my parents and sibling."],
      ["assistant", "What date and Dubai time would you like for this gathering?"],
      ["user", "September 12, 2026 at 5:00 PM."],
      ["assistant", second.body.message],
    ]);
    expect(restored.body.messages[3]).toMatchObject({
      id: second.body.messageId,
      kind: "gathering_planner",
      planner: second.body.planner,
      createdAt: TEST_NOW.toISOString(),
    });
    for (const table of ["agent_action_proposals", "gatherings", "gathering_invitations", "reconnection_plans", "reward_ledger"]) {
      expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, table).toBe(0);
    }
  });

  it("normalizes planner types, deduplicates invitees, and excludes the requester unless explicitly included", async () => {
    const db = database();
    let dadId = "";
    let requesterId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ type: "outing", memberIds: [dadId, dadId, requesterId] }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "normalized-planner@example.test",
      displayName: "Ahmad",
      familyName: "Normalization Family",
    });
    requesterId = family.memberId;
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");

    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with Dad on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body.planner).toMatchObject({ type: "Outdoor activity", memberIds: [dadId] });

    const explicitlyIncluded = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with Dad and me on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(explicitlyIncluded.body.planner.memberIds).toEqual([dadId, requesterId]);
  });

  it("rejects provider-selected IDs outside the permitted family and rejects past schedules", async () => {
    for (const [index, decision] of [
      gatheringPlannerDecision({ memberIds: [randomUUID()] }),
      gatheringPlannerDecision({ startAt: "2026-08-12T17:00:00+04:00" }),
    ].entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => decision),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `invalid-planner-${index}@example.test`,
        displayName: `Invalid Planner ${index}`,
        familyName: `Invalid Planner Family ${index}`,
      });
      const message =
        index === 0
          ? "Plan Golden Park on September 12, 2026 at 5 PM."
          : "Plan Golden Park on August 12, 2026 at 5 PM.";
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(502);
      expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
      expect((db.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
    }
  });

  it("does not accept a model-invented schedule that differs from the user's exact Dubai date or time", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "invented-schedule@example.test",
      displayName: "Ahmad",
      familyName: "Schedule Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan Golden Park on September 13, 2026 at 6 PM." })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "clarification",
      message: expect.stringMatching(/safely match.*exact date and Dubai time/i),
    });
    expect(response.body).not.toHaveProperty("planner");
  });

  it("uses the latest user-supplied schedule when a follow-up replaces an earlier date and time", async () => {
    const db = database();
    let calls = 0;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => {
        calls += 1;
        if (calls === 1) return { kind: "clarification", message: "Where would you like to hold this gathering?" };
        return gatheringPlannerDecision({ startAt: "2026-09-13T18:00:00+04:00" });
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "replaced-schedule@example.test",
      displayName: "Ahmad",
      familyName: "Replacement Family",
    });
    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan a family outing on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    const second = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: first.body.sessionId,
        message: "Actually, use Golden Park on September 13, 2026 at 6 PM.",
      })
      .expect(200);
    expect(second.body).toMatchObject({
      kind: "gathering_planner",
      planner: { startAt: "2026-09-13T18:00:00+04:00" },
    });
  });

  it("asks which singular sibling is intended and accepts a later exact unique name", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "sibling-choice@example.test",
      displayName: "Ahmad",
      familyName: "Sibling Family",
    });
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const omarId = addUnlinkedRelative(db, family.familyId, "Omar");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");
    addRelationship(db, family.familyId, family.memberId, omarId, "sibling");

    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my sibling on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(first.body).toMatchObject({
      kind: "clarification",
      message: expect.stringMatching(/which sibling.*Anas.*Omar/i),
    });

    const second = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Anas" })
      .expect(200);
    expect(second.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [anasId] } });
  });

  it("asks which singular parent is intended and accepts a later exact unique name", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "parent-choice@example.test",
      displayName: "Ahmad",
      familyName: "Parent Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, family.memberId, "parent");

    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my parent on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(first.body).toMatchObject({
      kind: "clarification",
      message: expect.stringMatching(/which parent.*Dad.*Mom/i),
    });
    const second = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Dad" })
      .expect(200);
    expect(second.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId] } });
  });

  it("clarifies duplicate and unknown explicit family names instead of inventing an invitee", async () => {
    for (const [index, names, requestedName, expected] of [
      [0, ["Sam", "Sam"], "Sam", /multiple matching family profiles/i],
      [1, ["Known Relative"], "Noura", /couldn't match.*Noura/i],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision()),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `name-clarification-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Name Family ${index}`,
      });
      names.forEach((name) => addUnlinkedRelative(db, family.familyId, name));

      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: family.familyId,
          message: `Plan Golden Park and invite ${requestedName} on September 12, 2026 at 5 PM.`,
        })
        .expect(200);
      expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(expected) });
      expect(response.body).not.toHaveProperty("planner");
    }
  });

  it("accepts a latest exact family name after an unknown-name clarification", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "corrected-name@example.test",
      displayName: "Ahmad",
      familyName: "Corrected Name Family",
    });
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park and invite Noura on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(first.body.kind).toBe("clarification");
    const second = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Anas" })
      .expect(200);
    expect(second.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [anasId] } });
  });

  it("projects full-sibling parents without leaking the other parent to a shared-parent half-sibling", async () => {
    const db = database();
    let captured: AgentProviderInput | undefined;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => {
        captured = input;
        return { kind: "message", message: "Context captured." };
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "effective-family-context@example.test",
      displayName: "Ahmad",
      familyName: "Effective Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const leilaId = addUnlinkedRelative(db, family.familyId, "Leila");
    const guardianId = addUnlinkedRelative(db, family.familyId, "Guardian");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, anasId, "parent");
    addRelationship(db, family.familyId, dadId, leilaId, "parent");
    addRelationship(db, family.familyId, dadId, momId, "spouse");
    addRelationship(db, family.familyId, guardianId, family.memberId, "guardian");

    await browser.post("/api/agent/messages").send({ familyId: family.familyId, message: "Show safe context." }).expect(200);
    const byMemberId = new Map(captured!.family.effectiveRelationships.map((item) => [item.memberId, item]));
    expect(byMemberId.get(family.memberId)).toMatchObject({
      parentMemberIds: [dadId, momId],
      siblingMemberIds: [anasId, leilaId],
    });
    expect(byMemberId.get(anasId)?.parentMemberIds).toEqual([dadId, momId]);
    expect(byMemberId.get(leilaId)?.parentMemberIds).toEqual([dadId]);
    expect(byMemberId.get(leilaId)?.parentMemberIds).not.toContain(momId);
    expect(byMemberId.get(family.memberId)?.parentMemberIds).not.toContain(guardianId);
  });

  it("resolves spouse and children while never turning a spouse into a parent", async () => {
    const db = database();
    let spouseId = "";
    let childOneId = "";
    let childTwoId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ memberIds: [spouseId, childOneId, childTwoId] }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "spouse-children-planner@example.test",
      displayName: "Ahmad",
      familyName: "Children Family",
    });
    spouseId = addUnlinkedRelative(db, family.familyId, "Spouse");
    childOneId = addUnlinkedRelative(db, family.familyId, "Child One");
    childTwoId = addUnlinkedRelative(db, family.familyId, "Child Two");
    addRelationship(db, family.familyId, family.memberId, spouseId, "spouse");
    addRelationship(db, family.familyId, family.memberId, childOneId, "parent");
    addRelationship(db, family.familyId, family.memberId, childTwoId, "parent");

    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my spouse and children on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [spouseId, childOneId, childTwoId] },
    });
  });

  it("runs the Golden Park planner through explicit idempotent creation and optional link preparation", async () => {
    const db = database();
    let calls = 0;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => {
        calls += 1;
        return calls === 1
          ? { kind: "clarification", message: "What date and Dubai time would you like to visit Golden Park?" }
          : gatheringPlannerDecision();
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "golden-park-integration@example.test",
      displayName: "Ahmad Mustafa",
      familyName: "Golden Park Integration Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, family.memberId, "parent");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");

    const clarification = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "I want to go to Golden Park with my parents and sibling.",
      })
      .expect(200);
    const prepared = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: clarification.body.sessionId,
        message: "September 12, 2026 at 5:00 PM.",
      })
      .expect(200);
    expect(prepared.body).toMatchObject({
      kind: "gathering_planner",
      messageId: expect.any(String),
      planner: { memberIds: [dadId, momId, anasId] },
    });

    // Preparing and reviewing the Assistant form is intentionally non-mutating.
    expect((db.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS count FROM gathering_invitations").get() as { count: number }).count).toBe(0);
    const { memberIds, invitationChannel, ...gatheringPayload } = prepared.body.planner as {
      title: string;
      purpose: string;
      startAt: string;
      timezone: "Asia/Dubai";
      locationName: string;
      type: string;
      notes?: string;
      memberIds: string[];
      invitationChannel: "share_link" | "whatsapp";
    };

    const created = await browser
      .post(`/api/families/${family.familyId}/gatherings`)
      .set("Idempotency-Key", prepared.body.messageId)
      .send(gatheringPayload)
      .expect(201);
    expect(created.body.alreadyCreated).toBe(false);
    const gatheringId = created.body.gathering.id as string;
    expect((db.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM gathering_invitations").get() as { count: number }).count).toBe(0);

    const replayed = await browser
      .post(`/api/families/${family.familyId}/gatherings`)
      .set("Idempotency-Key", prepared.body.messageId)
      .send(gatheringPayload)
      .expect(200);
    expect(replayed.body).toMatchObject({ alreadyCreated: true, gathering: { id: gatheringId } });
    expect((db.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM gathering_invitations").get() as { count: number }).count).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'gathering.created'").get() as {
        count: number;
      }).count,
    ).toBe(1);

    const links = await browser
      .post(`/api/gatherings/${gatheringId}/invitations`)
      .send({ memberIds, channel: invitationChannel })
      .expect(201);
    expect(links.body).toMatchObject({
      deliveryNotice: expect.stringMatching(/has not contacted anyone automatically/i),
      invitations: [
        expect.objectContaining({ memberId: dadId, shareUrl: expect.any(String) }),
        expect.objectContaining({ memberId: momId, shareUrl: expect.any(String) }),
        expect.objectContaining({ memberId: anasId, shareUrl: expect.any(String) }),
      ],
    });
    expect((db.prepare("SELECT COUNT(*) AS count FROM gathering_invitations").get() as { count: number }).count).toBe(3);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'gathering.created'").get() as {
        count: number;
      }).count,
    ).toBe(1);
  });

  it("keeps a singular sibling choice through a later date/time clarification", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "persistent-sibling-choice@example.test",
      displayName: "Ahmad",
      familyName: "Persistent Choice Family",
    });
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const omarId = addUnlinkedRelative(db, family.familyId, "Omar");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");
    addRelationship(db, family.familyId, family.memberId, omarId, "sibling");

    const chooseSibling = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan Golden Park with my sibling." })
      .expect(200);
    expect(chooseSibling.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/which sibling/i) });
    const askSchedule = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: chooseSibling.body.sessionId, message: "Anas" })
      .expect(200);
    expect(askSchedule.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/date.*Dubai time/i) });
    const completed = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: chooseSibling.body.sessionId,
        message: "September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [anasId] } });
  });

  it("retains independent answers for simultaneous singular parent and sibling ambiguities", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "multiple-singular-choices@example.test",
      displayName: "Ahmad",
      familyName: "Multiple Choice Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const omarId = addUnlinkedRelative(db, family.familyId, "Omar");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, family.memberId, "parent");
    addRelationship(db, family.familyId, family.memberId, anasId, "sibling");
    addRelationship(db, family.familyId, family.memberId, omarId, "sibling");

    const parentQuestion = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my parent and sibling on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(parentQuestion.body.message).toMatch(/which parent/i);
    const siblingQuestion = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: parentQuestion.body.sessionId, message: "Dad" })
      .expect(200);
    expect(siblingQuestion.body.message).toMatch(/which sibling/i);
    const completed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: parentQuestion.body.sessionId, message: "Anas" })
      .expect(200);
    expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId, anasId] } });
  });

  it("bounds common explicit-name invitation forms without swallowing the venue", async () => {
    for (const [index, message] of [
      "Take Dad to Golden Park on September 12, 2026 at 5 PM.",
      "Go with Dad to Golden Park on September 12, 2026 at 5 PM.",
    ].entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision()),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `bounded-name-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Bounded Name Family ${index}`,
      });
      const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId] } });
    }
  });

  it("clarifies unknown or duplicate names in event-for-person phrasing", async () => {
    for (const [index, names, message, expected] of [
      [0, ["Sam", "Sam"], "Plan a visit for Sam at Golden Park on September 12, 2026 at 5 PM.", /multiple/i],
      [1, ["Known"], "Dinner for Noura at Golden Park on September 12, 2026 at 5 PM.", /couldn't match.*Noura/i],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision()),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `event-for-name-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Event For Family ${index}`,
      });
      names.forEach((name) => addUnlinkedRelative(db, family.familyId, name));
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(expected) });
    }
  });

  it("prefers the longest contained full name when family names overlap", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "overlapping-names@example.test",
      displayName: "Owner",
      familyName: "Overlapping Names Family",
    });
    addUnlinkedRelative(db, family.familyId, "Ahmad");
    const ahmadMustafaId = addUnlinkedRelative(db, family.familyId, "Ahmad Mustafa");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park and invite my cousin Ahmad Mustafa on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [ahmadMustafaId] } });
  });

  it("asks for a missing physical venue and preserves the plan when the user supplies it", async () => {
    const db = database();
    let calls = 0;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => {
        calls += 1;
        return gatheringPlannerDecision(calls === 1 ? { type: "Meal" } : { type: "Meal", locationName: "Grandma's house" });
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "missing-location@example.test",
      displayName: "Ahmad",
      familyName: "Location Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const where = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan dinner with Dad on September 12, 2026 at 5 PM." })
      .expect(200);
    expect(where.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/where/i) });
    const completed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: where.body.sessionId, message: "Grandma's house" })
      .expect(200);
    expect(completed.body).toMatchObject({
      kind: "gathering_planner",
      planner: { locationName: "Grandma's house", memberIds: [dadId] },
    });
  });

  it("allows a neutral remote label for video calls without inventing a physical venue", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision({ type: "Video call", locationName: "Online" })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "video-call-location@example.test",
      displayName: "Ahmad",
      familyName: "Video Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan a video call with Dad on September 12, 2026 at 5 PM." })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { locationName: "Online", memberIds: [dadId] } });
  });

  it("normalizes invitation channel from the user's words rather than the provider preference", async () => {
    for (const [index, message, providerChannel, expectedChannel] of [
      [0, "Plan Golden Park on September 12, 2026 at 5 PM.", "whatsapp", "share_link"],
      [1, "Plan Golden Park on September 12, 2026 at 5 PM and use WhatsApp.", "share_link", "whatsapp"],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ invitationChannel: providerChannel })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `planner-channel-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Channel Family ${index}`,
      });
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      expect(response.body.planner.invitationChannel).toBe(expectedChannel);
    }
  });

  it("clarifies ambiguous 12-hour clock text but accepts explicit 24-hour time", async () => {
    for (const [index, message, shouldOpen] of [
      [0, "Plan Golden Park on September 12, 2026 at 5:00.", false],
      [1, "Plan Golden Park on September 12, 2026 at 17:00.", true],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision()),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `clock-ambiguity-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Clock Family ${index}`,
      });
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      if (shouldOpen) expect(response.body.kind).toBe("gathering_planner");
      else expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/AM or PM/i) });
    }
  });

  it("rejects judgmental gathering purpose and invented sensitive or ungrounded notes", async () => {
    for (const [index, overrides, message, expectedCode] of [
      [
        0,
        { purpose: "Help our lonely and estranged dad" },
        "Plan Golden Park with Dad on September 12, 2026 at 5 PM.",
        "AGENT_UNSAFE_GATHERING_LANGUAGE",
      ],
      [
        1,
        { notes: "Bring water because Dad has dementia and feels depressed" },
        "Plan Golden Park with Dad on September 12, 2026 at 5 PM; bring water.",
        "AGENT_UNSAFE_GATHERING_LANGUAGE",
      ],
      [
        2,
        { notes: "Wear blue hats" },
        "Plan Golden Park with Dad on September 12, 2026 at 5 PM; bring water.",
        "AGENT_UNGROUNDED_GATHERING_NOTES",
      ],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision(overrides)),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `unsafe-gathering-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Unsafe Gathering Family ${index}`,
      });
      addUnlinkedRelative(db, family.familyId, "Dad");
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(502);
      expect(response.body.error.code).toBe(expectedCode);
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
    }
  });

  it("keeps a faithfully grounded free-form note even without a cue keyword", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision({ notes: "Please arrive ten minutes early" })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "grounded-planner-note@example.test",
      displayName: "Ahmad",
      familyName: "Grounded Notes Family",
    });
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park on September 12, 2026 at 5 PM. Please arrive ten minutes early.",
      })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { notes: "Please arrive ten minutes early" },
    });
  });

  it("preserves an informal tea request across its schedule follow-up", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ title: "Tea at Grandma's house", type: "Meal", locationName: "Grandma's house" }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "informal-tea-request@example.test",
      displayName: "Ahmad",
      familyName: "Tea Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Let's have tea at Grandma's house with Dad." })
      .expect(200);
    expect(first.body.message).toMatch(/date.*Dubai time/i);
    const second = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: first.body.sessionId,
        message: "September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(second.body).toMatchObject({
      kind: "gathering_planner",
      planner: { locationName: "Grandma's house", memberIds: [dadId] },
    });
  });

  it("rejects a relationship expansion beyond the planner's 200-invitee limit", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-invitee-limit@example.test",
      displayName: "Ahmad",
      familyName: "Invitee Limit Family",
    });
    for (let index = 0; index < 201; index += 1) {
      const siblingId = addUnlinkedRelative(db, family.familyId, `Sibling ${String(index).padStart(3, "0")}`);
      addRelationship(db, family.familyId, family.memberId, siblingId, "sibling");
    }
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my siblings on September 12, 2026 at 5 PM.",
      })
      .expect(502);
    expect(response.body.error.code).toBe("AGENT_INVALID_ACTION");
    expect((db.prepare("SELECT COUNT(*) AS count FROM agent_messages").get() as { count: number }).count).toBe(0);
  });

  it("never accepts provider-originated invitees for empty, solo, or object-only requests", async () => {
    for (const [index, message] of [
      "Plan Golden Park on September 12, 2026 at 5 PM.",
      "Plan Golden Park solo on September 12, 2026 at 5 PM.",
      "Plan Golden Park with nobody on September 12, 2026 at 5 PM.",
      "Plan Golden Park; bring water on September 12, 2026 at 5 PM.",
    ].entries()) {
      const db = database();
      let dadId = "";
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ memberIds: [dadId] })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `no-provider-invitees-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `No Provider Invitees ${index}`,
      });
      dadId = addUnlinkedRelative(db, family.familyId, "Dad");
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      expect(response.body, message).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [] } });
    }
  });

  it("clarifies unresolved invitee wording instead of trusting provider IDs", async () => {
    const db = database();
    let dadId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision({ memberIds: [dadId] })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "unsupported-invitee@example.test",
      displayName: "Ahmad",
      familyName: "Unsupported Invitee Family",
    });
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park and bring someone on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/which family member/i) });
    expect(response.body).not.toHaveProperty("planner");
  });

  it("keeps positive invitees in negative-exception wording and excludes negated names", async () => {
    for (const [index, message, expectedName] of [
      [0, "Plan Golden Park; invite Dad and no one else on September 12, 2026 at 5 PM.", "Dad"],
      [1, "Plan Golden Park; nobody except Dad on September 12, 2026 at 5 PM.", "Dad"],
      [2, "Plan Golden Park with Dad but not Mom on September 12, 2026 at 5 PM.", "Dad"],
    ] as const) {
      const db = database();
      let dadId = "";
      let momId = "";
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ memberIds: [dadId, momId] })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `negative-exception-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Negative Exception Family ${index}`,
      });
      dadId = addUnlinkedRelative(db, family.familyId, "Dad");
      momId = addUnlinkedRelative(db, family.familyId, "Mom");
      const response = await browser.post("/api/agent/messages").send({ familyId: family.familyId, message }).expect(200);
      expect(expectedName).toBe("Dad");
      expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId] } });
    }
  });

  it("does not reinterpret purpose, schedule, or attendee counts after 'for' as member names", async () => {
    for (const [index, phrase] of ["my birthday", "family bonding", "next Saturday", "5 people"].entries()) {
      const db = database();
      let dadId = "";
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ memberIds: [dadId] })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `non-name-for-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Non Name For Family ${index}`,
      });
      dadId = addUnlinkedRelative(db, family.familyId, "Dad");
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: family.familyId,
          message: `Plan dinner for ${phrase} at Golden Park on September 12, 2026 at 5 PM.`,
        })
        .expect(200);
      expect(response.body, phrase).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [] } });
    }
  });

  it("resolves bring-person wording while leaving bring-object wording out of invitees", async () => {
    const db = database();
    let dadId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision({ memberIds: [dadId] })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "bring-person@example.test",
      displayName: "Ahmad",
      familyName: "Bring Person Family",
    });
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park and bring Dad on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId] } });
  });

  it("accumulates multiple explicit-name disambiguations across later prompts", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "multiple-name-corrections@example.test",
      displayName: "Ahmad",
      familyName: "Multiple Name Corrections",
    });
    const samAhmedId = addUnlinkedRelative(db, family.familyId, "Sam Ahmed");
    addUnlinkedRelative(db, family.familyId, "Sam Omar");
    const aliHassanId = addUnlinkedRelative(db, family.familyId, "Ali Hassan");
    addUnlinkedRelative(db, family.familyId, "Ali Khan");

    const samQuestion = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park and invite Sam and Ali on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(samQuestion.body.message).toMatch(/which Sam/i);
    const aliQuestion = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: samQuestion.body.sessionId, message: "Sam Ahmed" })
      .expect(200);
    expect(aliQuestion.body.message).toMatch(/which Ali/i);
    const completed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: samQuestion.body.sessionId, message: "Ali Hassan" })
      .expect(200);
    expect(completed.body).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [samAhmedId, aliHassanId] },
    });
  });

  it("does not use a general name correction to satisfy an unrelated plural relationship", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "category-isolation@example.test",
      displayName: "Ahmad",
      familyName: "Category Isolation Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    addUnlinkedRelative(db, family.familyId, "Anas");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    const nameQuestion = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my parents and Noura on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(nameQuestion.body.message).toMatch(/couldn't match.*Noura/i);
    const parentQuestion = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: nameQuestion.body.sessionId, message: "Anas" })
      .expect(200);
    expect(parentQuestion.body).toMatchObject({
      kind: "clarification",
      message: expect.stringMatching(/only find one visible parent|which other family member/i),
    });
    expect(parentQuestion.body).not.toHaveProperty("planner");
  });

  it("supports repeated singular relationship choices without forgetting the first answer", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "repeated-sibling-choice@example.test",
      displayName: "Ahmad",
      familyName: "Repeated Sibling Choice",
    });
    const anasId = addUnlinkedRelative(db, family.familyId, "Anas");
    const omarId = addUnlinkedRelative(db, family.familyId, "Omar");
    const aliId = addUnlinkedRelative(db, family.familyId, "Ali");
    for (const siblingId of [anasId, omarId, aliId]) {
      addRelationship(db, family.familyId, family.memberId, siblingId, "sibling");
    }
    const firstQuestion = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with my brother and sister on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(firstQuestion.body.message).toMatch(/which siblings/i);
    const secondQuestion = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: firstQuestion.body.sessionId, message: "Anas" })
      .expect(200);
    expect(secondQuestion.body.message).toMatch(/which other sibling/i);
    const completed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: firstQuestion.body.sessionId, message: "Omar" })
      .expect(200);
    expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [anasId, omarId] } });
  });

  it("caps large disambiguation choice lists", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision()),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "bounded-member-choices@example.test",
      displayName: "Ahmad",
      familyName: "Bounded Member Choices",
    });
    for (let index = 0; index < 30; index += 1) addUnlinkedRelative(db, family.familyId, "Sam");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with Sam on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/25 more/i) });
    expect(response.body.message.length).toBeLessThan(1_000);
  });

  it("combines an AM/PM-only answer with the previously ambiguous clock time", async () => {
    for (const [index, answer, startAt] of [
      [0, "AM", "2026-09-12T05:00:00+04:00"],
      [1, "PM", "2026-09-12T17:00:00+04:00"],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ startAt })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `meridiem-followup-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Meridiem Followup ${index}`,
      });
      const question = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: "Plan Golden Park on September 12, 2026 at 5:00." })
        .expect(200);
      expect(question.body.message).toMatch(/AM or PM/i);
      const completed = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, sessionId: question.body.sessionId, message: answer })
        .expect(200);
      expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { startAt } });
    }
  });

  it("uses one reference instant for provider context and relative-date validation across Dubai midnight", async () => {
    let currentNow = new Date("2026-09-06T19:59:00.000Z");
    let contextTime = "";
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider((input) => {
        contextTime = input.family.currentDateTime;
        currentNow = new Date("2026-09-06T20:01:00.000Z");
        return gatheringPlannerDecision({ startAt: "2026-09-07T17:00:00+04:00" });
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => currentNow,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "midnight-reference@example.test",
      displayName: "Ahmad",
      familyName: "Midnight Reference Family",
    });
    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan Golden Park tomorrow at 5 PM." })
      .expect(200);
    expect(contextTime).toBe("2026-09-06T19:59:00.000Z");
    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { startAt: "2026-09-07T17:00:00+04:00" },
    });
  });

  it("replaces stale gathering facts when the user clearly starts a new plan during clarification", async () => {
    const db = database();
    let calls = 0;
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => {
        calls += 1;
        return gatheringPlannerDecision(
          calls === 1
            ? {}
            : {
                startAt: "2026-08-14T12:00:00+04:00",
                locationName: "Home",
                type: "Meal",
              },
        );
      }),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "replacement-plan@example.test",
      displayName: "Ahmad",
      familyName: "Replacement Plan Family",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan Golden Park with Dad." })
      .expect(200);
    expect(question.body.message).toMatch(/date.*Dubai time/i);
    const completed = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: question.body.sessionId,
        message: "Actually, plan lunch at Home tomorrow at noon with Mom instead.",
      })
      .expect(200);
    expect(completed.body).toMatchObject({
      kind: "gathering_planner",
      planner: {
        startAt: "2026-08-14T12:00:00+04:00",
        locationName: "Home",
        type: "Meal",
        memberIds: [momId],
      },
    });
    expect(completed.body.planner.memberIds).not.toContain(dadId);
  });

  it("does not let a provider remote type bypass a missing physical location", async () => {
    const db = database();
    let dadId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ type: "Phone call", locationName: "Online", memberIds: [dadId] }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "remote-type-bypass@example.test",
      displayName: "Ahmad",
      familyName: "Remote Type Bypass Family",
    });
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan dinner with Dad on September 12, 2026 at 5 PM." })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/where/i) });
    expect(response.body).not.toHaveProperty("planner");
  });

  it("derives neutral planner copy instead of surfacing innocuous invented title or purpose facts", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({
          title: "Ahmad's birthday celebration",
          purpose: "Celebrate Ahmad's promotion",
        }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "deterministic-planner-copy@example.test",
      displayName: "Ahmad",
      familyName: "Deterministic Planner Copy",
    });
    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan Golden Park on September 12, 2026 at 5 PM." })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: {
        title: "Golden Park family outing",
        purpose: "Spend time together at Golden Park",
      },
    });
  });

  it("omits unsupported notes, rejects reversed negation, and preserves exact user-supplied notes", async () => {
    for (const [index, requestMessage, providerNote, expectedStatus, expectedNote] of [
      [
        0,
        "Plan Golden Park on September 12, 2026 at 5 PM.",
        "Wear blue hats",
        200,
        undefined,
      ],
      [
        1,
        "Plan Golden Park on September 12, 2026 at 5 PM. Do not bring peanuts.",
        "Bring peanuts",
        502,
        undefined,
      ],
      [
        2,
        "Plan Golden Park on September 12, 2026 at 5 PM. Do not bring peanuts.",
        "Do not bring peanuts",
        200,
        "Do not bring peanuts",
      ],
      [
        3,
        "Plan Golden Park with Dad on September 12, 2026 at 5 PM. Dad has diabetes; bring sugar-free food.",
        "Dad has diabetes; bring sugar-free food",
        200,
        "Dad has diabetes; bring sugar-free food",
      ],
      [
        4,
        "Plan Golden Park on September 12, 2026 at 5 PM.",
        "Golden Park",
        200,
        undefined,
      ],
      [
        5,
        "Plan Golden Park on September 12, 2026 at 5 PM. Do not ever bring peanuts.",
        "Bring peanuts",
        502,
        undefined,
      ],
      [
        6,
        "Plan Golden Park on September 12, 2026 at 5 PM. Bring water.",
        "Golden Park",
        502,
        undefined,
      ],
      [
        7,
        "Plan at Golden Park and bring water on September 12, 2026 at 5 PM.",
        "Golden Park",
        502,
        undefined,
      ],
      [
        8,
        "Plan Golden Park on September 12, 2026 at 5 PM. Bring water.",
        "Water",
        200,
        "Water",
      ],
      [
        9,
        "Plan Golden Park on September 12, 2026 at 5 PM. Medical note: diabetes.",
        "Diabetes",
        200,
        "Diabetes",
      ],
    ] as const) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ notes: providerNote })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `planner-note-grounding-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `Planner Note Grounding ${index}`,
      });
      if (index === 3) addUnlinkedRelative(db, family.familyId, "Dad");
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: requestMessage })
        .expect(expectedStatus);
      if (expectedStatus === 502) {
        expect(response.body.error.code).toBe("AGENT_UNGROUNDED_GATHERING_NOTES");
      } else if (expectedNote) {
        expect(response.body.planner.notes).toBe(expectedNote);
      } else {
        expect(response.body.planner).not.toHaveProperty("notes");
      }
    }
  });

  it("requires an explicit positive WhatsApp request", async () => {
    for (const [index, wording] of [
      "WhatsApp is not needed",
      "without WhatsApp",
      "anything except WhatsApp",
      "avoid WhatsApp",
      "WhatsApp is useful",
    ].entries()) {
      const db = database();
      const app = createApp({
        database: db,
        agentProvider: callbackProvider(() => gatheringPlannerDecision({ invitationChannel: "whatsapp" })),
        bcryptRounds: 4,
        rateLimitEnabled: false,
        now: () => TEST_NOW,
      });
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `whatsapp-opt-in-${index}@example.test`,
        displayName: "Ahmad",
        familyName: `WhatsApp Opt In ${index}`,
      });
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: family.familyId,
          message: `Plan Golden Park on September 12, 2026 at 5 PM. ${wording}.`,
        })
        .expect(200);
      expect(response.body.planner.invitationChannel).toBe("share_link");
    }
  });

  it("ends invitee clauses at a named date even when the user omits 'on'", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({
          startAt: "2099-09-12T17:00:00+04:00",
          locationName: "Home",
          type: "Meal",
        }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "date-bounded-invitees@example.test",
      displayName: "Ahmad",
      familyName: "Date Bounded Invitees",
    });
    const dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const momId = addUnlinkedRelative(db, family.familyId, "Mom");
    addRelationship(db, family.familyId, dadId, family.memberId, "parent");
    addRelationship(db, family.familyId, momId, family.memberId, "parent");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan dinner at Home with my parents September 12 2099 at 5 PM.",
      })
      .expect(200);
    expect(response.body.kind).toBe("gathering_planner");
    expect(response.body.planner.memberIds).toHaveLength(2);
    expect(response.body.planner.memberIds).toEqual(expect.arrayContaining([dadId, momId]));
  });

  it("uses a safe deterministic type when the request contains no recognized type keyword", async () => {
    const db = database();
    let dadId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ type: "Celebration", locationName: "Office", memberIds: [dadId] }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "deterministic-default-type@example.test",
      displayName: "Ahmad",
      familyName: "Deterministic Default Type",
    });
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Meet Dad at Office on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { type: "Family gathering", locationName: "Office", memberIds: [dadId] },
    });
  });

  it("keeps accessibility details introduced by 'with' as notes rather than invitees", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() => gatheringPlannerDecision({ notes: "Wheelchair access" })),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "wheelchair-detail-not-invitee@example.test",
      displayName: "Ahmad",
      familyName: "Accessibility Detail",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan Golden Park with wheelchair access on September 12, 2026 at 5 PM.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [], notes: "Wheelchair access" },
    });
  });

  it("keeps common dietary details introduced by 'with' as notes rather than invitees", async () => {
    const db = database();
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({
          startAt: "2099-09-12T17:00:00+04:00",
          locationName: "Home",
          type: "Meal",
          notes: "Halal food",
        }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "dietary-detail-not-invitee@example.test",
      displayName: "Ahmad",
      familyName: "Dietary Detail",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan dinner at Home with halal food on September 12, 2099 at 5 PM.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: "gathering_planner",
      planner: { type: "Meal", memberIds: [], notes: "Halal food" },
    });
  });

  it("does not accept a provider venue that is only a prefix of the user's venue", async () => {
    const db = database();
    let dadId = "";
    const app = createApp({
      database: db,
      agentProvider: callbackProvider(() =>
        gatheringPlannerDecision({ locationName: "Golden", memberIds: [dadId] }),
      ),
      bcryptRounds: 4,
      rateLimitEnabled: false,
      now: () => TEST_NOW,
    });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "venue-prefix-grounding@example.test",
      displayName: "Ahmad",
      familyName: "Venue Prefix Grounding",
    });
    dadId = addUnlinkedRelative(db, family.familyId, "Dad");

    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Go to Golden Park with Dad on September 12, 2026 at 5 PM.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: "clarification",
      message: "Where would you like to hold this gathering?",
    });
    expect(response.body).not.toHaveProperty("planner");
  });
});
