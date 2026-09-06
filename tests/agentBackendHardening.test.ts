import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentAction,
  AgentProvider,
  AgentProviderDecision,
  GatheringPlannerPayload,
} from "../server/agent.js";
import { createApp } from "../server/app.js";
import { openDatabase, type AppDatabase } from "../server/database.js";

const TEST_NOW = new Date("2026-08-13T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();
const openDatabases: AppDatabase[] = [];

type HttpAgent = ReturnType<typeof request.agent>;
type FamilyRole = "owner" | "admin" | "member";

interface FamilyIdentity {
  familyId: string;
  memberId: string;
  userId: string;
}

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
): Promise<FamilyIdentity> {
  const response = await browser
    .post("/api/auth/register")
    .send({ ...identity, password: "a-secure-password" })
    .expect(201);
  const family = response.body.families[0] as { id: string; linkedMemberId: string };
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(identity.email) as { id: string };
  return { familyId: family.id, memberId: family.linkedMemberId, userId: user.id };
}

function plannerDecision(
  startAt: string,
  overrides: Partial<GatheringPlannerPayload> = {},
): AgentProviderDecision {
  return {
    kind: "gathering_planner",
    message: "Review the gathering details.",
    planner: {
      title: "Provider-suggested title",
      purpose: "Provider-suggested purpose",
      startAt,
      timezone: "Asia/Dubai",
      locationName: "Golden Park",
      type: "Outdoor activity",
      memberIds: [],
      invitationChannel: "share_link",
      ...overrides,
    },
  };
}

async function scheduleFixture(readDecision: () => AgentProviderDecision) {
  const db = database();
  const provider: AgentProvider = { generate: async () => readDecision() };
  const app = createApp({
    database: db,
    agentProvider: provider,
    bcryptRounds: 4,
    rateLimitEnabled: false,
    now: () => TEST_NOW,
  });
  const browser = request.agent(app);
  const identity = await register(browser, db, {
    email: `agent-schedule-hardening-${randomUUID()}@example.test`,
    displayName: "Schedule Tester",
    familyName: "Schedule Hardening Family",
  });
  return { browser, db, identity };
}

function count(db: AppDatabase, sql: string, ...parameters: unknown[]): number {
  return (db.prepare(sql).get(...parameters) as { count: number }).count;
}

describe("AI gathering schedule hardening", () => {
  it.each([
    {
      name: "calendar date",
      correction: "Use Golden Park on February 30, 2099.",
      expectedMessage: /valid calendar date/i,
    },
    {
      name: "Dubai time",
      correction: "Use Golden Park at 25:00.",
      expectedMessage: /valid Dubai time/i,
    },
  ])(
    "does not fall back to an older valid schedule after a newest invalid $name correction",
    async ({ correction, expectedMessage }) => {
      const { browser, db, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-12T17:00:00+04:00"),
      );
      const first = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          message: "Plan a picnic on September 12, 2099 at 5 PM.",
        })
        .expect(200);
      expect(first.body).toMatchObject({ kind: "clarification" });
      expect(first.body.message).toMatch(/where/i);

      const second = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, sessionId: first.body.sessionId, message: correction })
        .expect(200);

      expect(second.body).toMatchObject({ kind: "clarification" });
      expect(second.body.message).toMatch(expectedMessage);
      expect(second.body.planner).toBeUndefined();
      expect(count(db, "SELECT COUNT(*) AS count FROM gatherings WHERE family_id = ?", identity.familyId)).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS count FROM agent_action_proposals WHERE family_id = ?", identity.familyId)).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS count FROM reward_ledger WHERE family_id = ?", identity.familyId)).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS count FROM agent_messages WHERE kind = 'gathering_planner'")).toBe(0);
    },
  );

  it("uses a newest valid date/time correction and canonicalizes provider sub-minute drift", async () => {
    let providerStartAt = "2099-09-12T17:00:00+04:00";
    const { browser, identity } = await scheduleFixture(() => plannerDecision(providerStartAt));
    const first = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "Plan a picnic on September 12, 2099 at 5 PM.",
      })
      .expect(200);
    expect(first.body).toMatchObject({ kind: "clarification" });

    providerStartAt = "2099-09-14T18:30:47.987+04:00";
    const corrected = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: first.body.sessionId,
        message: "Use Golden Park on September 14, 2099 at 6:30 PM instead.",
      })
      .expect(200);

    expect(corrected.body).toMatchObject({
      kind: "gathering_planner",
      planner: { startAt: "2099-09-14T18:30:00+04:00", locationName: "Golden Park" },
    });
  });

  it("normalizes provider seconds and fractions to the exact minute requested by the user", async () => {
    const { browser, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:59.999+04:00"),
    );
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "Plan a picnic at Golden Park on September 12, 2099 at 5 PM.",
      })
      .expect(200);

    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { startAt: "2099-09-12T17:00:00+04:00" },
    });
  });

  it("asks for a supported minute-precision time when the user supplies nonzero seconds", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00"),
    );
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "Plan a picnic at Golden Park on September 12, 2099 at 17:00:01.",
      })
      .expect(200);

    expect(response.body).toMatchObject({ kind: "clarification" });
    expect(response.body.message).toMatch(/valid Dubai time to the minute/i);
    expect(count(db, "SELECT COUNT(*) AS count FROM agent_messages WHERE kind = 'gathering_planner'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM gatherings WHERE family_id = ?", identity.familyId)).toBe(0);
  });
});

function addPlannerMember(db: AppDatabase, familyId: string, displayName: string): string {
  const memberId = randomUUID();
  db.prepare(
    `INSERT INTO family_members
     (id, family_id, display_name, interests_json, created_at, updated_at)
     VALUES (?, ?, ?, '[]', ?, ?)`,
  ).run(memberId, familyId, displayName, TEST_NOW_ISO, TEST_NOW_ISO);
  return memberId;
}

function addPlannerRelationship(
  db: AppDatabase,
  familyId: string,
  sourceMemberId: string,
  targetMemberId: string,
  type: "parent" | "spouse" | "sibling",
): void {
  db.prepare(
    `INSERT INTO relationships
     (id, family_id, source_member_id, target_member_id, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), familyId, sourceMemberId, targetMemberId, type, TEST_NOW_ISO);
}

describe("AI gathering newest-turn corrections", () => {
  it("resolves the user's exact siplinng example to both parents and the sole sibling", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00", { memberIds: [] }),
    );
    const dadId = addPlannerMember(db, identity.familyId, "Dad");
    const momId = addPlannerMember(db, identity.familyId, "Mom");
    const anasId = addPlannerMember(db, identity.familyId, "Anas");
    addPlannerRelationship(db, identity.familyId, dadId, identity.memberId, "parent");
    addPlannerRelationship(db, identity.familyId, momId, identity.memberId, "parent");
    addPlannerRelationship(db, identity.familyId, identity.memberId, anasId, "sibling");

    const question = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "I want to go to the golden park with my parents and siplinng",
      })
      .expect(200);
    expect(question.body).toMatchObject({ kind: "clarification" });
    expect(question.body.message).toMatch(/date.*Dubai time/i);

    const completed = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "September 12, 2099 at 5 PM.",
      })
      .expect(200);
    expect(completed.body.kind).toBe("gathering_planner");
    expect(new Set(completed.body.planner.memberIds)).toEqual(new Set([dadId, momId, anasId]));
    expect(completed.body.planner.memberIds).not.toContain(identity.memberId);
  });

  it.each([
    ["a budget of AED 100", "Budget of AED 100"],
    ["transportation arranged", "Transportation arranged"],
    ["a picnic blanket", "Picnic blanket"],
    ["sunscreen", "Sunscreen"],
    ["a rain backup plan", "Rain backup plan"],
    ["a budget note: keep it under AED 100", "Keep it under AED 100"],
    ["a budget note: we can spend up to AED 100", "Spend up to AED 100"],
    ["a transport note: we will take a taxi", "Take a taxi"],
    ["an equipment note: folding chairs are required", "Folding chairs are required"],
    ["a weather note: if it rains, use the indoor area", "If it rains, use the indoor area"],
  ] as const)(
    "keeps the user-supplied %s adjunct as a grounded planner note without inventing an invitee",
    async (adjunct, providerNote) => {
      const { browser, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-12T17:00:00+04:00", { notes: providerNote }),
      );
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          message: `Plan a family outing at Golden Park with ${adjunct} on September 12, 2099 at 5 PM.`,
        })
        .expect(200);
      expect(response.body, JSON.stringify(response.body)).toMatchObject({
        kind: "gathering_planner",
        planner: { memberIds: [], notes: providerNote },
      });
    },
  );

  it.each([
    "Dad and a budget of AED 100",
    "a budget of AED 100 and Dad",
    "Dad and transportation arranged",
    "transportation arranged and Dad",
    "Dad and a picnic blanket",
    "a picnic blanket and Dad",
    "Dad and sunscreen",
    "sunscreen and Dad",
    "Dad and a rain backup plan",
    "a rain backup plan and Dad",
    "Dad and a taxi",
    "a taxi and Dad",
    "Dad and folding chairs",
    "folding chairs and Dad",
  ] as const)("preserves the real invitee in adjunct ordering: %s", async (wording) => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00"),
    );
    const dadId = addPlannerMember(db, identity.familyId, "Dad");
    addPlannerRelationship(db, identity.familyId, dadId, identity.memberId, "parent");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: `Plan a family outing at Golden Park with ${wording} on September 12, 2099 at 5 PM.`,
      })
      .expect(200);
    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [dadId] },
    });
  });

  it.each([
    ["a budget of AED 100", "Budget of AED 200"],
    ["transportation arranged", "Transportation is not arranged"],
    ["a picnic blanket", "Bring two picnic blankets"],
    ["sunscreen", "Do not bring sunscreen"],
    ["a rain backup plan", "There is no rain backup plan"],
    ["a budget note: keep it under AED 100", "Keep it under AED 200"],
    ["a transport note: we will take a taxi", "Take a bus"],
    ["an equipment note: folding chairs are required", "Folding tables are required"],
    ["a weather note: if it rains, use the indoor area", "If it rains, use the outdoor area"],
  ] as const)("rejects invented or contradicted %s notes", async (adjunct, providerNote) => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00", { notes: providerNote }),
    );
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: `Plan a family outing at Golden Park with ${adjunct} on September 12, 2099 at 5 PM.`,
      })
      .expect(502);
    expect(response.body.error.code).toBe("AGENT_UNGROUNDED_GATHERING_NOTES");
    expect(count(db, "SELECT COUNT(*) AS count FROM agent_messages")).toBe(0);
  });

  it("retains an earlier invitee and then applies a named correction around a budget adjunct", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00", { notes: "Budget of AED 100" }),
    );
    const dadId = addPlannerMember(db, identity.familyId, "Dad");
    const momId = addPlannerMember(db, identity.familyId, "Mom");
    addPlannerRelationship(db, identity.familyId, dadId, identity.memberId, "parent");
    addPlannerRelationship(db, identity.familyId, momId, identity.memberId, "parent");
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a family outing at Golden Park with Dad." })
      .expect(200);
    expect(first.body.kind).toBe("clarification");

    const retained = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: first.body.sessionId,
        message: "September 12, 2099 at 5 PM with a budget of AED 100.",
      })
      .expect(200);
    expect(retained.body).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [dadId], notes: "Budget of AED 100" },
    });

    const correctionStart = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a family outing at Golden Park with Dad." })
      .expect(200);
    const corrected = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: correctionStart.body.sessionId,
        message: "Actually Mom instead, with a budget of AED 100. September 12, 2099 at 5 PM.",
      })
      .expect(200);
    expect(corrected.body).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [momId], notes: "Budget of AED 100" },
    });
  });

  it.each([
    "Plan a quiet outing alone with Dad at Golden Park on September 12, 2099 at 5 PM.",
    "Plan a quiet outing solo with Dad at Golden Park on September 12, 2099 at 5 PM.",
  ])("lets an explicit visible person win over contradictory solo wording: %s", async (message) => {
    let dadId = "";
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00", { memberIds: [] }),
    );
    dadId = addPlannerMember(db, identity.familyId, "Dad");
    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [dadId] } });
  });

  it("lets an explicit relationship win over contradictory solo wording", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00", { memberIds: [] }),
    );
    const spouseId = addPlannerMember(db, identity.familyId, "Spouse");
    addPlannerRelationship(db, identity.familyId, identity.memberId, spouseId, "spouse");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "Plan a solo outing with my spouse at Golden Park on September 12, 2099 at 5 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [spouseId] } });
  });

  it.each(["alone", "solo", "by myself", "no one"])(
    "preserves a true newest no-invitee request: %s",
    async (wording) => {
      let dadId = "";
      const { browser, db, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-12T17:00:00+04:00", { memberIds: [dadId] }),
      );
      dadId = addPlannerMember(db, identity.familyId, "Dad");
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          message: `Plan a picnic ${wording} at Golden Park on September 12, 2099 at 5 PM.`,
        })
        .expect(200);
      expect(response.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [] } });
    },
  );

  it.each(["Mom instead.", "Actually Mom.", "Actually with Mom instead."])(
    "replaces an older invitee with a terse newest unique-name correction: %s",
    async (correction) => {
      let dadId = "";
      const { browser, db, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-14T18:30:00+04:00", { memberIds: [dadId] }),
      );
      dadId = addPlannerMember(db, identity.familyId, "Dad");
      const momId = addPlannerMember(db, identity.familyId, "Mom");
      const question = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park with Dad." })
        .expect(200);
      expect(question.body.message).toMatch(/date.*Dubai time/i);
      const completed = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          sessionId: question.body.sessionId,
          message: `${correction} September 14, 2099 at 6:30 PM.`,
        })
        .expect(200);
      expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [momId] } });
      expect(completed.body.planner.memberIds).not.toContain(dadId);
    },
  );

  it("clarifies a terse newest replacement name when multiple visible profiles match", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00"),
    );
    addPlannerMember(db, identity.familyId, "Sam");
    addPlannerMember(db, identity.familyId, "Sam");
    const dadId = addPlannerMember(db, identity.familyId, "Dad");
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park with Dad." })
      .expect(200);
    expect(question.body.message).toMatch(/date.*Dubai time/i);
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually Sam. September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(response.body).toMatchObject({ kind: "clarification", message: expect.stringMatching(/which Sam/i) });
    expect(response.body).not.toHaveProperty("planner");
    expect(dadId).toBeTruthy();
  });

  it("lets a newest no-invitee correction replace an older person", async () => {
    let dadId = "";
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00", { memberIds: [dadId] }),
    );
    dadId = addPlannerMember(db, identity.familyId, "Dad");
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park with Dad." })
      .expect(200);
    const completed = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually I will go alone on September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(completed.body).toMatchObject({ kind: "gathering_planner", planner: { memberIds: [] } });
  });

  it("lets a newest explicit invitee replace an older no-invitee request", async () => {
    let dadId = "";
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00", { memberIds: [] }),
    );
    dadId = addPlannerMember(db, identity.familyId, "Dad");
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a picnic alone at Golden Park." })
      .expect(200);
    const completed = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually with Dad on September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(completed.body, JSON.stringify(completed.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [dadId] },
    });
  });

  it.each([
    { providerLocation: "Golden Park", kind: "clarification", expected: /updated venue/i },
    { providerLocation: "Creek Venue", kind: "gathering_planner", expected: /review/i },
  ] as const)(
    "uses the newest venue correction when the provider returns $providerLocation",
    async ({ providerLocation, kind, expected }) => {
      let locationName = "Golden Park";
      const { browser, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-14T18:30:00+04:00", { locationName }),
      );
      const question = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park." })
        .expect(200);
      locationName = providerLocation;
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          sessionId: question.body.sessionId,
          message: "Actually use Creek Venue instead on September 14, 2099 at 6:30 PM.",
        })
        .expect(200);
      expect(response.body.kind).toBe(kind);
      expect(response.body.message).toMatch(expected);
      if (kind === "gathering_planner") expect(response.body.planner.locationName).toBe("Creek Venue");
    },
  );

  it.each([
    { providerType: "Outdoor activity", locationName: "Golden Park", kind: "clarification" },
    { providerType: "Video call", locationName: "Online", kind: "gathering_planner" },
  ] as const)(
    "uses the newest type correction when the provider returns $providerType",
    async ({ providerType, locationName, kind }) => {
      let overrides: Partial<GatheringPlannerPayload> = { type: "Outdoor activity", locationName: "Golden Park" };
      const { browser, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-14T18:30:00+04:00", overrides),
      );
      const question = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park." })
        .expect(200);
      overrides = { type: providerType, locationName };
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          sessionId: question.body.sessionId,
          message: "Actually make it a video call on September 14, 2099 at 6:30 PM.",
        })
        .expect(200);
      expect(response.body.kind).toBe(kind);
      if (kind === "clarification") expect(response.body.message).toMatch(/updated gathering type/i);
      else expect(response.body.planner).toMatchObject({ type: "Video call", locationName: "Online" });
    },
  );

  it("uses the newest explicit invitation-channel correction rather than the provider preference", async () => {
    let channel: GatheringPlannerPayload["invitationChannel"] = "whatsapp";
    const { browser, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00", { invitationChannel: channel }),
    );
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park. Use WhatsApp links." })
      .expect(200);
    channel = "whatsapp";
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually use copyable links instead on September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { invitationChannel: "share_link" },
    });
  });

  it.each([
    { providerNote: "Bring water", expectedNote: undefined },
    { providerNote: "Don't bring water", expectedNote: "Don't bring water" },
  ] as const)(
    "does not let an old positive note ground the newest negation: $providerNote",
    async ({ providerNote, expectedNote }) => {
      let notes: string | undefined = "Bring water";
      const { browser, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-14T18:30:00+04:00", { ...(notes ? { notes } : {}) }),
      );
      const question = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park. Bring water." })
        .expect(200);
      notes = providerNote;
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: identity.familyId,
          sessionId: question.body.sessionId,
          message: "Actually don't bring water. September 14, 2099 at 6:30 PM.",
        })
        .expect(200);
      expect(response.body.kind).toBe("gathering_planner");
      if (expectedNote) expect(response.body.planner.notes).toBe(expectedNote);
      else expect(response.body.planner).not.toHaveProperty("notes");
    },
  );

  it("does not let the siplinng typo alias shadow a visible member literally named Siplinng", async () => {
    const { browser, db, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-12T17:00:00+04:00"),
    );
    const literalMemberId = addPlannerMember(db, identity.familyId, "Siplinng");
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        message: "Plan a picnic at Golden Park with Siplinng on September 12, 2099 at 5 PM.",
      })
      .expect(200);
    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { memberIds: [literalMemberId] },
    });
  });

  it.each([
    "Switch from a video call to a picnic at Golden Park on September 12, 2099 at 5 PM.",
    "A picnic rather than a video call at Golden Park on September 12, 2099 at 5 PM.",
  ])("uses the target side of a type replacement: %s", async (message) => {
    for (const providerType of ["Video call", "Outdoor activity"] as const) {
      const { browser, identity } = await scheduleFixture(() =>
        plannerDecision("2099-09-12T17:00:00+04:00", {
          type: providerType,
          locationName: providerType === "Video call" ? "Online" : "Golden Park",
        }),
      );
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: identity.familyId, message })
        .expect(200);
      if (providerType === "Video call") {
        expect(response.body).toMatchObject({
          kind: "clarification",
          message: expect.stringMatching(/updated gathering type/i),
        });
      } else {
        expect(response.body).toMatchObject({
          kind: "gathering_planner",
          planner: { type: "Outdoor activity", locationName: "Golden Park" },
        });
      }
    }
  });

  it("does not reinterpret a newest note correction mentioning coffee as a meal type", async () => {
    let overrides: Partial<GatheringPlannerPayload> = { type: "Outdoor activity", locationName: "Golden Park" };
    const { browser, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00", overrides),
    );
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan a picnic at Golden Park. Bring water." })
      .expect(200);
    overrides = { type: "Meal", locationName: "Golden Park", notes: "Don't bring coffee" };
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually don't bring coffee. September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { type: "Outdoor activity", locationName: "Golden Park", notes: "Don't bring coffee" },
    });
  });

  it("does not reinterpret a note correction mentioning a park as a venue replacement", async () => {
    let notes: string | undefined;
    const { browser, identity } = await scheduleFixture(() =>
      plannerDecision("2099-09-14T18:30:00+04:00", {
        type: "Meal",
        locationName: "Home",
        ...(notes ? { notes } : {}),
      }),
    );
    const question = await browser
      .post("/api/agent/messages")
      .send({ familyId: identity.familyId, message: "Plan dinner at Home. Bring a wheelchair." })
      .expect(200);
    notes = "Bring a wheelchair to the park";
    const response = await browser
      .post("/api/agent/messages")
      .send({
        familyId: identity.familyId,
        sessionId: question.body.sessionId,
        message: "Actually bring a wheelchair to the park. September 14, 2099 at 6:30 PM.",
      })
      .expect(200);
    expect(response.body, JSON.stringify(response.body)).toMatchObject({
      kind: "gathering_planner",
      planner: { type: "Meal", locationName: "Home", notes: "Bring a wheelchair to the park" },
    });
  });
});

function linkUserToFamily(
  db: AppDatabase,
  familyId: string,
  userId: string,
  role: Exclude<FamilyRole, "owner">,
  displayName: string,
): string {
  const memberId = randomUUID();
  db.prepare(
    `INSERT INTO family_members
     (id, family_id, user_id, display_name, interests_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', ?, ?)`,
  ).run(memberId, familyId, userId, displayName, TEST_NOW_ISO, TEST_NOW_ISO);
  db.prepare(
    `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(familyId, userId, role, memberId, TEST_NOW_ISO);
  return memberId;
}

function addCompletedGathering(
  db: AppDatabase,
  familyId: string,
  creatorUserId: string,
  title: string,
): string {
  const gatheringId = randomUUID();
  db.prepare(
    `INSERT INTO gatherings
     (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
      status, created_by_user_id, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Preserve a family story', ?, 'Asia/Dubai', 'Family home',
             'Family gathering', 'completed', ?, ?, ?, ?)`,
  ).run(
    gatheringId,
    familyId,
    title,
    "2026-08-12T12:00:00.000Z",
    creatorUserId,
    TEST_NOW_ISO,
    TEST_NOW_ISO,
    TEST_NOW_ISO,
  );
  return gatheringId;
}

function inviteMember(db: AppDatabase, gatheringId: string, memberId: string): string {
  const invitationId = randomUUID();
  db.prepare(
    `INSERT INTO gathering_invitations
     (id, gathering_id, member_id, channel, token_hash, status, prepared_at, updated_at)
     VALUES (?, ?, ?, 'share_link', ?, 'going', ?, ?)`,
  ).run(invitationId, gatheringId, memberId, `hardening-${randomUUID()}`, TEST_NOW_ISO, TEST_NOW_ISO);
  return invitationId;
}

interface MemoryFixtureOptions {
  actorRole: FamilyRole;
  selfOwned?: boolean;
  invited?: boolean;
}

async function memoryFixture(options: MemoryFixtureOptions) {
  const db = database();
  let action: AgentAction | undefined;
  const provider: AgentProvider = {
    generate: async () => {
      if (!action) throw new Error("The memory action fixture was not initialized.");
      return {
        kind: "proposal",
        message: "Review this written memory before saving it.",
        action,
      };
    },
  };
  const app = createApp({
    database: db,
    agentProvider: provider,
    bcryptRounds: 4,
    rateLimitEnabled: false,
    now: () => TEST_NOW,
  });

  const ownerBrowser = request.agent(app);
  const owner = await register(ownerBrowser, db, {
    email: `memory-owner-${randomUUID()}@example.test`,
    displayName: "Family Owner",
    familyName: "Memory Hardening Family",
  });

  let actorBrowser = ownerBrowser;
  let actor = owner;
  let otherCreatorUserId: string;

  if (options.actorRole === "owner") {
    const otherBrowser = request.agent(app);
    const other = await register(otherBrowser, db, {
      email: `memory-other-${randomUUID()}@example.test`,
      displayName: "Other Creator",
      familyName: "Other Temporary Family",
    });
    linkUserToFamily(db, owner.familyId, other.userId, "member", "Other Creator");
    otherCreatorUserId = other.userId;
  } else {
    actorBrowser = request.agent(app);
    const separateActor = await register(actorBrowser, db, {
      email: `memory-actor-${randomUUID()}@example.test`,
      displayName: "Memory Actor",
      familyName: "Actor Temporary Family",
    });
    const targetMemberId = linkUserToFamily(
      db,
      owner.familyId,
      separateActor.userId,
      options.actorRole,
      "Memory Actor",
    );
    actor = { familyId: owner.familyId, memberId: targetMemberId, userId: separateActor.userId };
    otherCreatorUserId = owner.userId;
  }

  const creatorUserId = options.selfOwned ? actor.userId : otherCreatorUserId;
  const gatheringId = addCompletedGathering(db, owner.familyId, creatorUserId, "Shared completed gathering");
  const invitationId = options.invited ? inviteMember(db, gatheringId, actor.memberId) : undefined;
  action = {
    type: "CREATE_NOTE_MEMORY",
    payload: {
      gatheringId,
      title: "A shared family story",
      note: "We enjoyed tea and remembered an old family trip.",
      visibility: "private",
      selectedMemberIds: [],
    },
  };

  return { actor, actorBrowser, db, gatheringId, invitationId };
}

async function proposeMemory(fixture: Awaited<ReturnType<typeof memoryFixture>>) {
  return fixture.actorBrowser
    .post("/api/agent/messages")
    .send({ familyId: fixture.actor.familyId, message: "Save this written memory for the completed gathering." })
    .expect(201);
}

describe("CREATE_NOTE_MEMORY confirmation authorization", () => {
  it("revalidates an ordinary member's gathering access and makes no write after their invitation is revoked", async () => {
    const fixture = await memoryFixture({ actorRole: "member", invited: true });
    const proposal = await proposeMemory(fixture);
    expect(fixture.invitationId).toBeDefined();
    fixture.db.prepare("DELETE FROM gathering_invitations WHERE id = ?").run(fixture.invitationId);

    const memoryCountBefore = count(fixture.db, "SELECT COUNT(*) AS count FROM memories");
    const rewardCountBefore = count(fixture.db, "SELECT COUNT(*) AS count FROM reward_ledger");
    const auditCountBefore = count(fixture.db, "SELECT COUNT(*) AS count FROM audit_events");
    const confirmation = await fixture.actorBrowser
      .post(`/api/agent/action-proposals/${proposal.body.proposal.id}/confirm`)
      .send({ expectedActionType: "CREATE_NOTE_MEMORY" })
      .expect(403);

    expect(confirmation.body.error.code).toBe("GATHERING_ACCESS_REQUIRED");
    expect(count(fixture.db, "SELECT COUNT(*) AS count FROM memories")).toBe(memoryCountBefore);
    expect(count(fixture.db, "SELECT COUNT(*) AS count FROM reward_ledger")).toBe(rewardCountBefore);
    expect(count(fixture.db, "SELECT COUNT(*) AS count FROM audit_events")).toBe(auditCountBefore);
    expect(
      fixture.db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposal.body.proposal.id),
    ).toEqual({ status: "pending" });
  });

  it.each([
    { name: "owner for another creator's gathering", actorRole: "owner", selfOwned: false, invited: false },
    { name: "admin for another creator's gathering", actorRole: "admin", selfOwned: false, invited: false },
    { name: "member for their self-owned gathering", actorRole: "member", selfOwned: true, invited: false },
    { name: "invited member for another creator's gathering", actorRole: "member", selfOwned: false, invited: true },
  ] as const)("still allows $name", async (options) => {
    const fixture = await memoryFixture(options);
    const proposal = await proposeMemory(fixture);
    const confirmation = await fixture.actorBrowser
      .post(`/api/agent/action-proposals/${proposal.body.proposal.id}/confirm`)
      .send({ expectedActionType: "CREATE_NOTE_MEMORY" })
      .expect(200);

    expect(confirmation.body).toMatchObject({
      actionType: "CREATE_NOTE_MEMORY",
      status: "confirmed",
      result: { memoryId: expect.any(String) },
    });
    expect(
      count(
        fixture.db,
        "SELECT COUNT(*) AS count FROM memories WHERE family_id = ? AND gathering_id = ? AND created_by_user_id = ?",
        fixture.actor.familyId,
        fixture.gatheringId,
        fixture.actor.userId,
      ),
    ).toBe(1);
    expect(
      count(
        fixture.db,
        "SELECT COUNT(*) AS count FROM reward_ledger WHERE family_id = ? AND reason_code = 'MEMORY_CAPTURED'",
        fixture.actor.familyId,
      ),
    ).toBe(1);
  });
});
