import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { ThinkingLevel } from "@google/genai";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_PROVIDER_CONTEXT_LIMITS,
  GEMINI_RESPONSE_JSON_SCHEMA,
  GeminiAgentProvider,
  assertAgentProviderInputWithinLimits,
  type AgentFamilyContext,
  type AgentProvider,
  type AgentProviderInput,
} from "../server/agent.js";
import { GEMINI_AGENT_SYSTEM_INSTRUCTION } from "../server/agentPrompt.js";
import { createApp } from "../server/app.js";
import { openDatabase, type AppDatabase } from "../server/database.js";
import { AGENT_ACTION_TYPES, type AgentActionType } from "../src/lib/agentActionTypes.js";

const TEST_NOW = new Date("2026-08-13T12:00:00.000Z");
const databases: AppDatabase[] = [];
const apps: Express[] = [];
const temporaryDirectories: string[] = [];

type HttpAgent = ReturnType<typeof request.agent>;

interface RegisteredFamily {
  familyId: string;
  memberId: string;
  userId: string;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (apps.length > 0) {
    const app = apps.pop();
    const timers = (app?.locals.backgroundTimers ?? []) as Array<ReturnType<typeof setInterval>>;
    timers.forEach(clearInterval);
  }
  while (databases.length > 0) databases.pop()?.close();
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function database(options: { path?: string } = {}): AppDatabase {
  const value = openDatabase({ path: options.path ?? ":memory:" });
  databases.push(value);
  return value;
}

function appWith(
  db: AppDatabase,
  provider: AgentProvider | undefined,
  options: Parameters<typeof createApp>[0] = {},
): Express {
  const app = createApp({
    database: db,
    ...(provider ? { agentProvider: provider } : {}),
    bcryptRounds: 4,
    rateLimitEnabled: false,
    now: () => TEST_NOW,
    ...options,
  });
  apps.push(app);
  return app;
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

function callbackProvider(
  callback: (input: AgentProviderInput) => unknown | Promise<unknown>,
  metadata: Pick<AgentProvider, "providerName" | "modelName" | "requiresExternalDataConsent"> = {},
): AgentProvider {
  return { ...metadata, generate: async (input) => callback(input) };
}

const DOMAIN_TABLES = [
  "families",
  "family_members",
  "family_users",
  "relationships",
  "location_consents",
  "member_locations",
  "gatherings",
  "gathering_invitations",
  "memories",
  "memory_viewers",
  "reconnection_plans",
  "reward_ledger",
  "activities",
  "reward_offers",
  "reward_redemptions",
  "gathering_creation_requests",
  "audit_events",
] as const;

function domainSnapshot(db: AppDatabase, includeAudit = true): Record<string, unknown[]> {
  return Object.fromEntries(
    DOMAIN_TABLES.filter((table) => includeAudit || table !== "audit_events").map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

function controlCounts(db: AppDatabase) {
  return {
    sessions: (db.prepare("SELECT count(*) AS count FROM agent_sessions").get() as { count: number }).count,
    messages: (db.prepare("SELECT count(*) AS count FROM agent_messages").get() as { count: number }).count,
    proposals: (db.prepare("SELECT count(*) AS count FROM agent_action_proposals").get() as { count: number }).count,
  };
}

function plannerDecision() {
  return {
    kind: "gathering_planner" as const,
    message: "Review this gathering.",
    planner: {
      title: "Golden Park family outing",
      purpose: "Spend time together at Golden Park",
      startAt: "2026-09-12T17:00:00+04:00",
      timezone: "Asia/Dubai" as const,
      locationName: "Golden Park",
      type: "Outdoor activity" as const,
      memberIds: [],
      invitationChannel: "share_link" as const,
    },
  };
}

function legacyGatheringProposal() {
  return {
    kind: "proposal" as const,
    message: "Review this draft before creating it.",
    action: {
      type: "CREATE_GATHERING_DRAFT" as const,
      payload: {
        title: "Protocol draft",
        purpose: "Exercise proposal persistence",
        startAt: "2026-09-12T17:00:00+04:00",
        timezone: "Asia/Dubai" as const,
        locationName: "Golden Park",
        type: "Outdoor activity",
      },
    },
  };
}

function minimalFamilyContext(): AgentFamilyContext {
  return {
    id: randomUUID(),
    name: "Bounded Family",
    currentDateTime: TEST_NOW.toISOString(),
    timezone: "Asia/Dubai",
    requester: { role: "owner", linkedMemberId: null },
    members: [],
    relationships: [],
    effectiveRelationships: [],
    engagement: {
      evidenceSignals: [],
      sampleActivities: [],
      gatherings: [],
      memories: [],
      plans: [],
      limitations: [],
    },
  };
}

function providerInput(family: AgentFamilyContext): Omit<AgentProviderInput, "signal"> {
  return { request: "Bound this context.", history: [], family };
}

function expectContextLimit(callback: () => void): void {
  try {
    callback();
    throw new Error("Expected the context limit to reject the input.");
  } catch (error) {
    expect(error).toMatchObject({ status: 413, code: "AGENT_CONTEXT_TOO_LARGE" });
    expect((error as Error).message).toContain("No data was sent to the AI provider");
  }
}

describe("agent protocol matrix", () => {
  const responseCases = [
    {
      label: "message",
      requestMessage: "Hello agent.",
      decision: { kind: "message", message: "Hello. How can I help?" },
      status: 200,
      storedKind: "message",
      proposalCount: 0,
    },
    {
      label: "clarification",
      requestMessage: "Help me plan something.",
      decision: { kind: "clarification", message: "What would you like to plan?" },
      status: 200,
      storedKind: "clarification",
      proposalCount: 0,
    },
    {
      label: "gathering planner",
      requestMessage: "Plan an outing at Golden Park on September 12, 2026 at 5 PM.",
      decision: plannerDecision(),
      status: 200,
      storedKind: "gathering_planner",
      proposalCount: 0,
    },
    {
      label: "proposal",
      requestMessage: "Create a gathering draft for review.",
      decision: legacyGatheringProposal(),
      status: 201,
      storedKind: "proposal",
      proposalCount: 1,
    },
  ] as const;

  it.each(responseCases)(
    "round-trips the $label response without a domain write",
    async ({ requestMessage, decision, status, storedKind, proposalCount }) => {
      const db = database();
      const app = appWith(db, callbackProvider(() => decision));
      const browser = request.agent(app);
      const family = await register(browser, db, {
        email: `${storedKind}@protocol.test`,
        displayName: "Protocol Owner",
        familyName: "Protocol Family",
      });
      const before = domainSnapshot(db);

      const sent = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: requestMessage })
        .expect(status);

      expect(sent.headers["cache-control"]).toContain("no-store");
      expect(sent.body).toMatchObject({ kind: storedKind });
      expect(controlCounts(db)).toEqual({ sessions: 1, messages: 2, proposals: proposalCount });
      expect(domainSnapshot(db)).toEqual(before);

      const restored = await browser
        .get(`/api/agent/sessions/${sent.body.sessionId as string}/messages`)
        .query({ familyId: family.familyId })
        .expect(200);
      expect(restored.body.messages).toHaveLength(2);
      expect(restored.body.messages.map((message: { role: string; kind: string }) => [message.role, message.kind]))
        .toEqual([["user", "message"], ["assistant", storedKind]]);
      if (storedKind === "gathering_planner") {
        expect(restored.body.messages[1]).toMatchObject({
          id: sent.body.messageId,
          planner: {
            startAt: "2026-09-12T17:00:00+04:00",
            timezone: "Asia/Dubai",
            locationName: "Golden Park",
            memberIds: [],
          },
        });
      } else if (storedKind === "proposal") {
        expect(restored.body.messages[1]).toMatchObject({
          proposal: sent.body.proposal,
          proposalStatus: "pending",
        });
      } else {
        expect(restored.body.messages[1]).not.toHaveProperty("planner");
      }
    },
  );

  it("rejects a wrong provider kind for a complete obvious gathering-planner request", async () => {
    const wrongKinds: Array<{ label: string; decision: unknown }> = [
      { label: "message", decision: { kind: "message", message: "I can help with outings." } },
      { label: "unrelated clarification", decision: { kind: "clarification", message: "What else would you like?" } },
      { label: "proposal", decision: legacyGatheringProposal() },
    ];
    let nextDecision: unknown;
    const db = database();
    const app = appWith(db, callbackProvider(() => nextDecision));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "wrong-planner-kind@protocol.test",
      displayName: "Planner Owner",
      familyName: "Planner Family",
    });
    const before = domainSnapshot(db);

    for (const testCase of wrongKinds) {
      nextDecision = testCase.decision;
      const response = await browser
        .post("/api/agent/messages")
        .send({
          familyId: family.familyId,
          message: "Plan an outing at Golden Park on September 12, 2026 at 5 PM.",
        })
        .expect(502);
      expect(response.body.error, testCase.label).toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
      expect(controlCounts(db), testCase.label).toEqual({ sessions: 0, messages: 0, proposals: 0 });
      expect(domainSnapshot(db), testCase.label).toEqual(before);
    }

    nextDecision = { kind: "message", message: "I can help with budgets." };
    const budgetedOuting = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan a family outing at Golden Park on September 12, 2026 at 5 PM with a budget of AED 100.",
      })
      .expect(502);
    expect(budgetedOuting.body.error).toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
    expect(controlCounts(db)).toEqual({ sessions: 0, messages: 0, proposals: 0 });
    expect(domainSnapshot(db)).toEqual(before);
  });

  it.each([
    ["message", { kind: "message", message: "I can help with outings." }],
    ["unrelated clarification", { kind: "clarification", message: "What else would you like?" }],
    ["invented legacy proposal", legacyGatheringProposal()],
  ])("replaces a wrong %s for an incomplete natural planner request with the canonical question", async (_label, decision) => {
    const db = database();
    const app = appWith(db, callbackProvider(() => decision));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: `${randomUUID()}@incomplete-planner.protocol.test`,
      displayName: "Planner Owner",
      familyName: "Incomplete Planner Family",
    });
    const before = domainSnapshot(db);

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan an outing at Golden Park." })
      .expect(200);

    expect(response.body).toMatchObject({ kind: "clarification" });
    expect(response.body.message).toMatch(/what date/i);
    expect(response.body.message).toMatch(/Dubai time/i);
    expect(controlCounts(db)).toEqual({ sessions: 1, messages: 2, proposals: 0 });
    expect(domainSnapshot(db)).toEqual(before);
  });

  it("uses deterministic invitee and venue questions before accepting any wrong proposal kind", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => legacyGatheringProposal()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-preflight@protocol.test",
      displayName: "Planner Owner",
      familyName: "Planner Preflight Family",
    });
    const before = domainSnapshot(db);

    const unknownInvitee = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan an outing at Golden Park with Noura on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    expect(unknownInvitee.body).toMatchObject({ kind: "clarification" });
    expect(unknownInvitee.body.message).toMatch(/couldn't match.*Noura/i);

    const missingVenue = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan a family outing on September 12, 2026 at 5 PM." })
      .expect(200);
    expect(missingVenue.body).toMatchObject({ kind: "clarification" });
    expect(missingVenue.body.message).toMatch(/where/i);

    expect(controlCounts(db)).toEqual({ sessions: 2, messages: 4, proposals: 0 });
    expect(domainSnapshot(db)).toEqual(before);
  });

  it("preserves genuine planner clarification and the explicit legacy draft action", async () => {
    let nextDecision: unknown = {
      kind: "clarification",
      message: "What date and Dubai time would you like for this gathering?",
    };
    const db = database();
    const app = appWith(db, callbackProvider(() => nextDecision));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-kind-exemptions@protocol.test",
      displayName: "Planner Owner",
      familyName: "Planner Exemption Family",
    });

    const incomplete = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan an outing at Golden Park." })
      .expect(200);
    expect(incomplete.body).toMatchObject({ kind: "clarification" });

    nextDecision = legacyGatheringProposal();
    const legacy = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Create a gathering draft at Golden Park on September 12, 2026 at 5 PM.",
      })
      .expect(201);
    expect(legacy.body).toMatchObject({ kind: "proposal", proposal: { actionType: "CREATE_GATHERING_DRAFT" } });
  });

  it.each([
    "Create a reconnection plan for Dad at Golden Park on September 12, 2026 at 5 PM.",
    "Plan my route to Golden Park on September 12, 2026 at 5 PM.",
    "Plan my route to a family gathering at Golden Park on September 12, 2026 at 5 PM.",
    "Plan my budget for a visit to Golden Park on September 12, 2026 at 5 PM.",
    "How do I plan a family gathering?",
  ])("does not misclassify non-gathering planning language: %s", async (message) => {
    const db = database();
    const app = appWith(db, callbackProvider(() => ({
      kind: "message",
      message: "This request is not an editable gathering-planner action.",
    })));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: `${randomUUID()}@planner-negative.protocol.test`,
      displayName: "Planner Owner",
      familyName: "Planner Negative Family",
    });

    const response = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message })
      .expect(200);

    expect(response.body).toMatchObject({ kind: "message" });
    expect(controlCounts(db)).toEqual({ sessions: 1, messages: 2, proposals: 0 });
  });

  it("allows the user to abandon a pending planner clarification", async () => {
    let calls = 0;
    const db = database();
    const app = appWith(db, callbackProvider(() => {
      calls += 1;
      return calls === 1
        ? { kind: "message", message: "I can help with outings." }
        : { kind: "message", message: "Okay, I won't continue that plan." };
    }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-abandonment@protocol.test",
      displayName: "Planner Owner",
      familyName: "Planner Abandonment Family",
    });
    const before = domainSnapshot(db);

    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan an outing at Golden Park." })
      .expect(200);
    expect(first.body).toMatchObject({ kind: "clarification" });

    const abandoned = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Never mind." })
      .expect(200);
    expect(abandoned.body).toMatchObject({ kind: "message", message: "Okay, I won't continue that plan." });
    expect(controlCounts(db)).toEqual({ sessions: 1, messages: 4, proposals: 0 });
    expect(domainSnapshot(db)).toEqual(before);
  });

  it("rejects a wrong provider kind after an active planner clarification without changing that session", async () => {
    let calls = 0;
    const db = database();
    const app = appWith(db, callbackProvider(() => {
      calls += 1;
      return calls === 1
        ? { kind: "clarification", message: "What date and Dubai time would you like for this gathering?" }
        : { kind: "message", message: "Your outing sounds good." };
    }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-follow-up-kind@protocol.test",
      displayName: "Planner Owner",
      familyName: "Planner Follow-up Family",
    });
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Plan an outing at Golden Park." })
      .expect(200);
    const before = db
      .prepare("SELECT role, kind, content_text FROM agent_messages WHERE session_id = ? ORDER BY message_order")
      .all(first.body.sessionId);

    const rejected = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: first.body.sessionId,
        message: "September 12, 2026 at 5 PM.",
      })
      .expect(502);

    expect(rejected.body.error).toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
    expect(
      db.prepare("SELECT role, kind, content_text FROM agent_messages WHERE session_id = ? ORDER BY message_order")
        .all(first.body.sessionId),
    ).toEqual(before);
    expect(controlCounts(db)).toEqual({ sessions: 1, messages: 2, proposals: 0 });
  });

  it("rejects every malformed provider envelope atomically", async () => {
    const invalidDecisions: Array<{ label: string; decision: unknown }> = [
      { label: "null", decision: null },
      { label: "scalar", decision: "message" },
      { label: "unknown kind", decision: { kind: "tool", message: "No" } },
      { label: "missing message", decision: { kind: "message" } },
      { label: "blank message", decision: { kind: "message", message: "   " } },
      { label: "oversized response message", decision: { kind: "message", message: "x".repeat(2_001) } },
      { label: "extra root property", decision: { kind: "message", message: "No", action: {} } },
      {
        label: "incomplete planner",
        decision: { kind: "gathering_planner", message: "No", planner: { title: "Missing fields" } },
      },
      {
        label: "planner with an invalid timezone",
        decision: { ...plannerDecision(), planner: { ...plannerDecision().planner, timezone: "UTC" } },
      },
      {
        label: "planner with malformed member id",
        decision: { ...plannerDecision(), planner: { ...plannerDecision().planner, memberIds: ["not-a-uuid"] } },
      },
      {
        label: "planner with extra property",
        decision: { ...plannerDecision(), planner: { ...plannerDecision().planner, verified: true } },
      },
      {
        label: "unsupported action",
        decision: { kind: "proposal", message: "No", action: { type: "SEND_INVITATIONS", payload: {} } },
      },
      {
        label: "malformed supported action",
        decision: {
          kind: "proposal",
          message: "No",
          action: { type: "CREATE_GATHERING_DRAFT", payload: { title: "Only a title" } },
        },
      },
      {
        label: "extra action property",
        decision: {
          ...legacyGatheringProposal(),
          action: { ...legacyGatheringProposal().action, executeImmediately: true },
        },
      },
    ];
    let nextDecision: unknown;
    const db = database();
    const app = appWith(db, callbackProvider(() => nextDecision));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "invalid-provider-envelope@protocol.test",
      displayName: "Envelope Owner",
      familyName: "Envelope Family",
    });
    const before = domainSnapshot(db);

    for (const testCase of invalidDecisions) {
      nextDecision = testCase.decision;
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: `Case: ${testCase.label}` })
        .expect(502);
      expect(response.body.error, testCase.label).toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
      expect(controlCounts(db), testCase.label).toEqual({ sessions: 0, messages: 0, proposals: 0 });
      expect(domainSnapshot(db), testCase.label).toEqual(before);
    }
  });

  it("uses the exact Gemini adapter contract and rejects empty, malformed, or schema-invalid output", async () => {
    const generateContent = vi.fn();
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key",
      model: "gemini-test-model",
      timeoutMs: 12_345,
    });
    (provider as unknown as {
      client: { models: { generateContent: typeof generateContent } };
    }).client = { models: { generateContent } };
    const family = minimalFamilyContext();
    const controller = new AbortController();
    const input: AgentProviderInput = {
      request: "Plan a safe family visit.",
      history: [{ role: "assistant", message: "What day works?" }],
      family,
      signal: controller.signal,
    };
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ kind: "message", message: "Tell me the date." }),
    });

    await expect(provider.generate(input)).resolves.toEqual({ kind: "message", message: "Tell me the date." });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-test-model",
      contents: JSON.stringify({
        currentRequest: input.request,
        previousConversation: input.history,
        permittedFamilyContext: family,
      }),
      config: {
        abortSignal: controller.signal,
        httpOptions: { timeout: 12_345 },
        systemInstruction: GEMINI_AGENT_SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: 4_096,
        responseMimeType: "application/json",
        responseJsonSchema: GEMINI_RESPONSE_JSON_SCHEMA,
      },
    });

    generateContent.mockResolvedValueOnce({ text: "" });
    await expect(provider.generate(input)).rejects.toThrow("The Gemini response was empty.");
    generateContent.mockResolvedValueOnce({ text: "{not-json" });
    await expect(provider.generate(input)).rejects.toBeInstanceOf(SyntaxError);

    for (const invalidDecision of [
      { kind: "tool", message: "Unsupported" },
      { kind: "message", message: "Extra", execute: true },
      { kind: "gathering_planner", message: "Incomplete", planner: { title: "Only title" } },
    ]) {
      generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalidDecision) });
      await expect(provider.generate(input)).rejects.toMatchObject({ name: "ZodError" });
    }
  });

  it("maps malformed JSON, generic rejection, and quota errors without persisting a turn", async () => {
    const failures = [
      {
        label: "malformed JSON",
        error: new SyntaxError("Unexpected token in provider JSON"),
        status: 502,
        code: "AGENT_PROVIDER_ERROR",
      },
      {
        label: "generic upstream status",
        error: Object.assign(new Error("upstream unavailable"), { status: 503 }),
        status: 502,
        code: "AGENT_PROVIDER_ERROR",
      },
      {
        label: "quota",
        error: Object.assign(new Error("quota"), { status: 429 }),
        status: 429,
        code: "AGENT_QUOTA_EXHAUSTED",
      },
    ] as const;
    let nextError: unknown;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = database();
    const app = appWith(db, callbackProvider(() => Promise.reject(nextError)));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "provider-failure-matrix@protocol.test",
      displayName: "Failure Owner",
      familyName: "Failure Family",
    });
    const before = domainSnapshot(db);

    for (const failure of failures) {
      nextError = failure.error;
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, message: failure.label })
        .expect(failure.status);
      expect(response.body.error).toMatchObject({ code: failure.code });
      expect(controlCounts(db)).toEqual({ sessions: 0, messages: 0, proposals: 0 });
      expect(domainSnapshot(db)).toEqual(before);
    }
  });

  it("enforces authentication, strict request validation, JSON and transport-size limits", async () => {
    let providerCalls = 0;
    const db = database();
    const app = appWith(db, callbackProvider(() => {
      providerCalls += 1;
      return { kind: "message", message: "Accepted." };
    }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "transport-validation@protocol.test",
      displayName: "Transport Owner",
      familyName: "Transport Family",
    });
    const before = domainSnapshot(db);

    await request(app)
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "No cookie." })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe("AUTH_REQUIRED"));

    const invalidBodies: Array<{ label: string; body: unknown }> = [
      { label: "missing body", body: {} },
      { label: "bad family id", body: { familyId: "not-a-uuid", message: "Hello" } },
      { label: "bad session id", body: { familyId: family.familyId, sessionId: "bad", message: "Hello" } },
      { label: "blank input", body: { familyId: family.familyId, message: "  " } },
      { label: "over input limit", body: { familyId: family.familyId, message: "x".repeat(2_001) } },
      { label: "wrong consent type", body: { familyId: family.familyId, message: "Hello", aiProcessingConsent: "yes" } },
      { label: "unknown property", body: { familyId: family.familyId, message: "Hello", execute: true } },
    ];
    for (const testCase of invalidBodies) {
      await browser
        .post("/api/agent/messages")
        .send(testCase.body as Record<string, unknown>)
        .expect(400)
        .expect(({ body }) => expect(body.error.code, testCase.label).toBe("VALIDATION_ERROR"));
    }

    await browser
      .post("/api/agent/messages")
      .set("Content-Type", "application/json")
      .send('{"familyId":')
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_JSON"));
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "x".repeat(103_000) })
      .expect(413)
      .expect(({ body }) => expect(body.error.code).toBe("PAYLOAD_TOO_LARGE"));

    expect(providerCalls).toBe(0);
    expect(controlCounts(db)).toEqual({ sessions: 0, messages: 0, proposals: 0 });
    expect(domainSnapshot(db)).toEqual(before);

    const boundary = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "x".repeat(2_000) })
      .expect(200);
    expect(boundary.body.kind).toBe("message");
    expect(providerCalls).toBe(1);
    expect(
      (db.prepare("SELECT content_text FROM agent_messages WHERE role = 'user'").get() as { content_text: string })
        .content_text,
    ).toHaveLength(2_000);
  });

  it("requires per-turn external-data consent and audits disclosures without storing failed conversations", async () => {
    let calls = 0;
    let rejectNext = false;
    const provider = callbackProvider(
      () => {
        calls += 1;
        if (rejectNext) throw new Error("provider rejected after disclosure");
        return { kind: "message", message: "Consent was supplied for this turn." };
      },
      { providerName: "external-protocol", modelName: "test-model", requiresExternalDataConsent: true },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = database();
    const app = appWith(db, provider);
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "consent-matrix@protocol.test",
      displayName: "Consent Owner",
      familyName: "Consent Family",
    });
    const domainBefore = domainSnapshot(db, false);

    for (const consent of [undefined, false] as const) {
      const body: Record<string, unknown> = { familyId: family.familyId, message: "Do not disclose this." };
      if (consent !== undefined) body.aiProcessingConsent = consent;
      await browser
        .post("/api/agent/messages")
        .send(body)
        .expect(400)
        .expect(({ body: responseBody }) => expect(responseBody.error.code).toBe("AGENT_DATA_CONSENT_REQUIRED"));
    }
    expect(calls).toBe(0);
    expect(controlCounts(db)).toEqual({ sessions: 0, messages: 0, proposals: 0 });
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(0);

    const accepted = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Disclose with consent.", aiProcessingConsent: true })
      .expect(200);
    expect(calls).toBe(1);
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(1);

    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: accepted.body.sessionId, message: "No consent on follow-up." })
      .expect(400);
    expect(calls).toBe(1);
    expect(controlCounts(db).messages).toBe(2);

    rejectNext = true;
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: accepted.body.sessionId, message: "This provider fails.", aiProcessingConsent: true })
      .expect(502);
    expect(calls).toBe(2);
    expect(controlCounts(db).messages).toBe(2);
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(2);
    expect(domainSnapshot(db, false)).toEqual(domainBefore);

    const disclosure = db
      .prepare("SELECT details_json FROM audit_events WHERE action = 'agent.external_context_disclosed' ORDER BY rowid LIMIT 1")
      .get() as { details_json: string };
    expect(JSON.parse(disclosure.details_json)).toMatchObject({
      provider: "external-protocol",
      model: "test-model",
      categories: expect.arrayContaining(["request_and_recent_agent_conversation"]),
    });
    expect(disclosure.details_json).not.toContain("Disclose with consent");
  });

  it("does not require disclosure consent or emit a disclosure audit for an internal provider", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => ({ kind: "message", message: "Internal response." })));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "internal-provider@protocol.test",
      displayName: "Internal Owner",
      familyName: "Internal Family",
    });
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "No external consent flag." })
      .expect(200);
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "A redundant true flag is harmless.", aiProcessingConsent: true })
      .expect(200);
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(0);
  });

  it("isolates sessions by creator and family and never calls the provider for an unauthorized continuation", async () => {
    let calls = 0;
    const db = database();
    const app = appWith(db, callbackProvider(() => {
      calls += 1;
      return { kind: "message", message: "Owned response." };
    }));
    const ownerBrowser = request.agent(app);
    const owner = await register(ownerBrowser, db, {
      email: "session-owner@protocol.test",
      displayName: "Session Owner",
      familyName: "Owner Family",
    });
    const turn = await ownerBrowser
      .post("/api/agent/messages")
      .send({ familyId: owner.familyId, message: "Create my session." })
      .expect(200);
    const sessionId = turn.body.sessionId as string;

    const otherBrowser = request.agent(app);
    const other = await register(otherBrowser, db, {
      email: "session-other@protocol.test",
      displayName: "Session Other",
      familyName: "Other Family",
    });
    const otherLinkedInOwnerFamily = randomUUID();
    db.prepare(
      `INSERT INTO family_members
       (id, family_id, user_id, display_name, interests_json, created_at, updated_at)
       VALUES (?, ?, ?, 'Session Other', '[]', ?, ?)`,
    ).run(otherLinkedInOwnerFamily, owner.familyId, other.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare(
      `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
       VALUES (?, ?, 'member', ?, ?)`,
    ).run(owner.familyId, other.userId, otherLinkedInOwnerFamily, TEST_NOW.toISOString());
    const ownerLinkedInOtherFamily = randomUUID();
    db.prepare(
      `INSERT INTO family_members
       (id, family_id, user_id, display_name, interests_json, created_at, updated_at)
       VALUES (?, ?, ?, 'Session Owner', '[]', ?, ?)`,
    ).run(ownerLinkedInOtherFamily, other.familyId, owner.userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db.prepare(
      `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
       VALUES (?, ?, 'admin', ?, ?)`,
    ).run(other.familyId, owner.userId, ownerLinkedInOtherFamily, TEST_NOW.toISOString());

    await otherBrowser
      .post("/api/agent/messages")
      .send({ familyId: owner.familyId, sessionId, message: "Try another creator's session." })
      .expect(404);
    await otherBrowser
      .get(`/api/agent/sessions/${sessionId}/messages`)
      .query({ familyId: owner.familyId })
      .expect(404);
    await otherBrowser.delete(`/api/agent/sessions/${sessionId}`).expect(404);
    await ownerBrowser
      .post("/api/agent/messages")
      .send({ familyId: other.familyId, sessionId, message: "Try the same id in another family." })
      .expect(404);
    await ownerBrowser
      .get(`/api/agent/sessions/${sessionId}/messages`)
      .query({ familyId: other.familyId })
      .expect(404);

    expect(calls).toBe(1);
    expect(controlCounts(db)).toEqual({ sessions: 1, messages: 2, proposals: 0 });
    await ownerBrowser
      .get(`/api/agent/sessions/${sessionId}/messages`)
      .query({ familyId: owner.familyId })
      .expect(200);
  });

  it.each(["owner", "admin", "member"] as const)("allows a %s to use non-mutating agent responses", async (role) => {
    const db = database();
    const app = appWith(db, callbackProvider(() => ({ kind: "message", message: `Hello ${role}.` })));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: `${role}-protocol-role@protocol.test`,
      displayName: `${role} user`,
      familyName: `${role} family`,
    });
    db.prepare("UPDATE family_users SET role = ? WHERE family_id = ? AND user_id = ?")
      .run(role, family.familyId, family.userId);
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Give me a non-mutating response." })
      .expect(200)
      .expect(({ body }) => expect(body.kind).toBe("message"));
  });

  it("emits every finite evidence and sample-activity enum option in the bounded provider context", async () => {
    let received: AgentProviderInput | undefined;
    const db = database();
    const app = appWith(db, callbackProvider((input) => {
      received = input;
      return { kind: "message", message: "Context captured." };
    }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "context-enums@protocol.test",
      displayName: "Context Owner",
      familyName: "Context Enum Family",
    });
    const relativeId = randomUUID();
    const locationConsentId = randomUUID();
    const gatheringId = randomUUID();
    const now = TEST_NOW.toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO family_members
         (id, family_id, display_name, interests_json, created_at, updated_at)
         VALUES (?, ?, 'Relative', '[]', ?, ?)`,
      ).run(relativeId, family.familyId, now, now);
      db.prepare(
        `INSERT INTO relationships
         (id, family_id, source_member_id, target_member_id, type, created_at)
         VALUES (?, ?, ?, ?, 'sibling', ?)`,
      ).run(randomUUID(), family.familyId, family.memberId, relativeId, now);
      db.prepare(
        `INSERT INTO location_consents
         (id, family_id, member_id, recorded_by_user_id, basis, precision, visibility, granted_at)
         VALUES (?, ?, ?, ?, 'self_consent', 'city', 'family', ?)`,
      ).run(locationConsentId, family.familyId, relativeId, family.userId, now);
      db.prepare(
        `INSERT INTO member_locations
         (id, family_id, member_id, consent_id, source, precision, visibility, emirate, city,
          captured_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', 'city', 'family', 'Dubai', 'Dubai', ?, ?)`,
      ).run(randomUUID(), family.familyId, relativeId, locationConsentId, now, now);
      db.prepare(
        `INSERT INTO gatherings
         (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
          status, created_by_user_id, completed_at, created_at, updated_at)
         VALUES (?, ?, 'Completed gathering', 'Context evidence', '2026-08-01T17:00:00+04:00',
                 'Asia/Dubai', 'Family home', 'Visit', 'completed', ?, ?, ?, ?)`,
      ).run(gatheringId, family.familyId, family.userId, now, now, now);
      db.prepare(
        `INSERT INTO gathering_invitations
         (id, gathering_id, member_id, channel, token_hash, status, prepared_at, responded_at, updated_at)
         VALUES (?, ?, ?, 'share_link', ?, 'going', ?, ?, ?)`,
      ).run(randomUUID(), gatheringId, relativeId, `hash-${randomUUID()}`, now, now, now);
      db.prepare(
        `INSERT INTO memories
         (id, family_id, gathering_id, created_by_user_id, title, memory_type, visibility,
          ai_processing_allowed, captured_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Shared memory label', 'note', 'family', 1, ?, ?, ?)`,
      ).run(randomUUID(), family.familyId, gatheringId, family.userId, now, now, now);
      db.prepare(
        `INSERT INTO reward_ledger
         (id, family_id, points, reason_code, description, entity_type, entity_id, dedupe_key, created_at)
         VALUES (?, ?, 25, 'PROTOCOL_TEST', 'Context aggregate', 'gathering', ?, ?, ?)`,
      ).run(randomUUID(), family.familyId, gatheringId, randomUUID(), now);
      db.prepare(
        `INSERT INTO activities
         (id, title, category, emirate, location_name, price_range, age_suitability,
          elderly_friendly, indoor_outdoor, description, estimated_duration,
          weather_suitability, source_label, is_sample, active, created_at, updated_at)
         VALUES (?, 'Premium indoor sample', 'Culture', 'Dubai', 'Family-selected venue',
                 'Premium', 'Adults', 0, 'Indoor', 'Protocol sample', '1 hour',
                 'Any weather', 'Protocol test sample', 1, 1, ?, ?)`,
      ).run(randomUUID(), now, now);
    })();

    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Capture every context enum." })
      .expect(200);
    expect(received).toBeDefined();
    const kinds = [...new Set(received!.family.engagement.evidenceSignals.map((signal) => signal.kind))].sort();
    expect(kinds).toEqual([
      "ai_consented_shared_memory_count",
      "confirmed_participation_count",
      "family_member_count",
      "gathering_count",
      "invitation_count",
      "last_completed_gathering",
      "relationship_count",
      "reward_balance",
      "reward_event_count",
      "safe_location",
    ]);
    for (const signal of received!.family.engagement.evidenceSignals) {
      if (typeof signal.value === "number") expect(Number.isFinite(signal.value), signal.id).toBe(true);
    }
    expect([...new Set(received!.family.engagement.sampleActivities.map((activity) => activity.priceRange))].sort())
      .toEqual(["Budget", "Free", "Premium"]);
    expect([...new Set(received!.family.engagement.sampleActivities.map((activity) => activity.indoorOutdoor))].sort())
      .toEqual(["Indoor", "Outdoor"]);
    expect([...new Set(received!.family.engagement.sampleActivities.map((activity) => activity.elderlyFriendly))].sort())
      .toEqual([false, true]);
  });

  it("applies an independent per-user agent rate limit and returns the stable error envelope", async () => {
    let calls = 0;
    const db = database();
    const app = appWith(
      db,
      callbackProvider(() => {
        calls += 1;
        return { kind: "message", message: "Within the limit." };
      }),
      { rateLimitEnabled: true, apiRateLimit: 100, agentRateLimit: 1 },
    );
    const firstBrowser = request.agent(app);
    const first = await register(firstBrowser, db, {
      email: "rate-first@protocol.test",
      displayName: "Rate First",
      familyName: "Rate First Family",
    });
    const secondBrowser = request.agent(app);
    const second = await register(secondBrowser, db, {
      email: "rate-second@protocol.test",
      displayName: "Rate Second",
      familyName: "Rate Second Family",
    });

    await firstBrowser
      .post("/api/agent/messages")
      .send({ familyId: first.familyId, message: "First request." })
      .expect(200);
    const limited = await firstBrowser
      .post("/api/agent/messages")
      .send({ familyId: first.familyId, message: "Second request." })
      .expect(429);
    expect(limited.body.error).toEqual({
      code: "AGENT_RATE_LIMITED",
      message: "Too many agent requests. Try again shortly.",
    });
    expect(limited.headers["cache-control"]).toContain("no-store");
    expect(calls).toBe(1);

    await secondBrowser
      .post("/api/agent/messages")
      .send({ familyId: second.familyId, message: "A different user has an independent bucket." })
      .expect(200);
    expect(calls).toBe(2);
  });

  it("times out and aborts a provider without saving either a new or existing turn", async () => {
    let calls = 0;
    let aborted = 0;
    const provider: AgentProvider = {
      generate: (input) => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ kind: "message", message: "Initial response." });
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            aborted += 1;
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
    };
    const db = database();
    const app = appWith(db, provider, { env: { AGENT_PROVIDER_TIMEOUT_MS: "100" } });
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "timeout-matrix@protocol.test",
      displayName: "Timeout Owner",
      familyName: "Timeout Family",
    });
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Initial." })
      .expect(200);
    const before = db.prepare("SELECT * FROM agent_messages ORDER BY message_order").all();
    const timedOut = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Stall." })
      .expect(504);
    expect(timedOut.body.error.code).toBe("AGENT_PROVIDER_TIMEOUT");
    expect(aborted).toBe(1);
    expect(db.prepare("SELECT * FROM agent_messages ORDER BY message_order").all()).toEqual(before);
  });

  it("uses stable insertion order while bounding provider history to 20 and restore output to 100 messages", async () => {
    const histories: AgentProviderInput["history"][] = [];
    const db = database();
    const app = appWith(db, callbackProvider((input) => {
      histories.push(input.history);
      return { kind: "message", message: `assistant-${input.request}` };
    }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "history-order@protocol.test",
      displayName: "History Owner",
      familyName: "History Family",
    });

    let sessionId: string | undefined;
    for (let turn = 1; turn <= 56; turn += 1) {
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, ...(sessionId ? { sessionId } : {}), message: `user-${turn}` })
        .expect(200);
      sessionId = response.body.sessionId as string;
    }

    expect(histories[0]).toEqual([]);
    expect(histories.at(-1)).toEqual(
      Array.from({ length: 10 }, (_, index) => 46 + index).flatMap((turn) => [
        { role: "user", message: `user-${turn}` },
        { role: "assistant", message: `assistant-user-${turn}` },
      ]),
    );
    const restored = await browser
      .get(`/api/agent/sessions/${sessionId!}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    expect(restored.body.messages).toHaveLength(100);
    expect(restored.body.messages[0]).toMatchObject({ role: "user", message: "user-7" });
    expect(restored.body.messages.at(-1)).toMatchObject({ role: "assistant", message: "assistant-user-56" });
    expect(restored.body.messages.map((message: { message: string }) => message.message)).toEqual(
      Array.from({ length: 50 }, (_, index) => 7 + index).flatMap((turn) => [
        `user-${turn}`,
        `assistant-user-${turn}`,
      ]),
    );
    const orders = db
      .prepare("SELECT message_order FROM agent_messages WHERE session_id = ? ORDER BY message_order")
      .all(sessionId) as Array<{ message_order: number }>;
    expect(orders.map((row) => row.message_order)).toEqual(Array.from({ length: 112 }, (_, index) => index + 1));
  });

  it("purges rows older than retention, retains the exact boundary, and rejects closed sessions", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => ({ kind: "message", message: "Current." })));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "stale-sessions@protocol.test",
      displayName: "Stale Owner",
      familyName: "Stale Family",
    });
    const old = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Old." })
      .expect(200);
    const boundary = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Boundary." })
      .expect(200);
    const closed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Closed." })
      .expect(200);
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?")
      .run("2026-07-14T11:59:59.999Z", old.body.sessionId);
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?")
      .run("2026-07-14T12:00:00.000Z", boundary.body.sessionId);
    db.prepare("UPDATE agent_sessions SET status = 'closed' WHERE id = ?").run(closed.body.sessionId);

    await browser
      .get(`/api/agent/sessions/${old.body.sessionId as string}/messages`)
      .query({ familyId: family.familyId })
      .expect(404);
    expect(db.prepare("SELECT 1 FROM agent_sessions WHERE id = ?").get(old.body.sessionId)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM agent_messages WHERE session_id = ?").get(old.body.sessionId)).toBeUndefined();
    await browser
      .get(`/api/agent/sessions/${boundary.body.sessionId as string}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: closed.body.sessionId, message: "Cannot continue." })
      .expect(404);
    await browser
      .get(`/api/agent/sessions/${closed.body.sessionId as string}/messages`)
      .query({ familyId: family.familyId })
      .expect(404);
  });

  it("rejects expired and corrupted stored proposals without a domain mutation", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => legacyGatheringProposal()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "stale-proposal@protocol.test",
      displayName: "Proposal Owner",
      familyName: "Proposal Family",
    });
    const expired = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Prepare expired proposal." })
      .expect(201);
    const corrupt = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Prepare corrupt proposal." })
      .expect(201);
    const invalidExpiration = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Prepare invalid-expiration proposal." })
      .expect(201);
    db.prepare("UPDATE agent_action_proposals SET expires_at = ? WHERE id = ?")
      .run(TEST_NOW.toISOString(), expired.body.proposal.id);
    db.prepare("UPDATE agent_action_proposals SET payload_json = '{}' WHERE id = ?")
      .run(corrupt.body.proposal.id);
    db.prepare("UPDATE agent_action_proposals SET expires_at = 'not-a-date' WHERE id = ?")
      .run(invalidExpiration.body.proposal.id);
    const before = domainSnapshot(db);

    await browser
      .post(`/api/agent/action-proposals/${expired.body.proposal.id as string}/confirm`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("PROPOSAL_EXPIRED"));
    await browser
      .post(`/api/agent/action-proposals/${corrupt.body.proposal.id as string}/confirm`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_STORED_PROPOSAL"));
    await browser
      .post(`/api/agent/action-proposals/${invalidExpiration.body.proposal.id as string}/confirm`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_STORED_PROPOSAL"));
    expect(domainSnapshot(db)).toEqual(before);
    expect(
      db.prepare("SELECT count(*) AS count FROM agent_action_proposals WHERE status = 'pending'").get(),
    ).toEqual({ count: 3 });
  });

  it("binds every proposal resolution to the exact presented action type before any write", async () => {
    const mismatchCases: Array<[AgentActionType, AgentActionType]> = [
      ["DELETE_MEMBER", "UPDATE_MEMBER"],
      ["UPDATE_MEMBER", "DELETE_MEMBER"],
      ["ADD_MEMBER", "CREATE_GATHERING_DRAFT"],
      ["CREATE_NOTE_MEMORY", "CREATE_RELATIONSHIP"],
      ["CREATE_RELATIONSHIP", "CREATE_RECONNECTION_PLAN"],
      ["UPDATE_PLAN_STATUS", "CREATE_GATHERING_DRAFT"],
      ["CREATE_GATHERING_DRAFT", "CREATE_NOTE_MEMORY"],
      ["PREPARE_INVITATION_LINKS", "CREATE_GATHERING_DRAFT"],
    ];
    expect(new Set(AGENT_ACTION_TYPES).size).toBe(12);
    const db = database();
    const app = appWith(db, callbackProvider(() => legacyGatheringProposal()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "proposal-action-binding@protocol.test",
      displayName: "Binding Owner",
      familyName: "Binding Family",
    });
    const proposed = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Prepare a bound proposal." })
      .expect(201);
    const proposalId = proposed.body.proposal.id as string;
    const before = domainSnapshot(db);

    for (const [storedAction, presentedAction] of mismatchCases) {
      db.prepare("UPDATE agent_action_proposals SET action_type = ? WHERE id = ?").run(storedAction, proposalId);
      const mismatched = await browser
        .post(`/api/agent/action-proposals/${proposalId}/confirm`)
        .send({ expectedActionType: presentedAction })
        .expect(409);
      expect(mismatched.body.error).toMatchObject({ code: "PROPOSAL_ACTION_MISMATCH" });
      expect(db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(proposalId)).toEqual({ status: "pending" });
      expect(domainSnapshot(db)).toEqual(before);
    }

    db.prepare("UPDATE agent_action_proposals SET action_type = 'CREATE_GATHERING_DRAFT' WHERE id = ?").run(proposalId);
    const confirmed = await browser
      .post(`/api/agent/action-proposals/${proposalId}/confirm`)
      .send({ expectedActionType: "CREATE_GATHERING_DRAFT" })
      .expect(200);
    expect(confirmed.body).toMatchObject({
      proposalId,
      actionType: "CREATE_GATHERING_DRAFT",
      status: "confirmed",
    });

    const rejectedProposal = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: proposed.body.sessionId, message: "Prepare a second bound proposal." })
      .expect(201);
    await browser
      .post(`/api/agent/action-proposals/${rejectedProposal.body.proposal.id as string}/reject`)
      .send({ expectedActionType: "CREATE_NOTE_MEMORY" })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("PROPOSAL_ACTION_MISMATCH"));
    expect(
      db.prepare("SELECT status FROM agent_action_proposals WHERE id = ?").get(rejectedProposal.body.proposal.id),
    ).toEqual({ status: "pending" });
    const rejected = await browser
      .post(`/api/agent/action-proposals/${rejectedProposal.body.proposal.id as string}/reject`)
      .send({ expectedActionType: "CREATE_GATHERING_DRAFT" })
      .expect(200);
    expect(rejected.body).toMatchObject({
      actionType: "CREATE_GATHERING_DRAFT",
      status: "rejected",
    });
  });

  it("degrades an incompatible stored planner payload without corrupting the rest of the transcript", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => plannerDecision()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "planner-restore-corruption@protocol.test",
      displayName: "Restore Owner",
      familyName: "Restore Family",
    });
    const turn = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        message: "Plan an outing at Golden Park on September 12, 2026 at 5 PM.",
      })
      .expect(200);
    db.prepare("UPDATE agent_messages SET payload_json = '{}' WHERE id = ?").run(turn.body.messageId);

    const restored = await browser
      .get(`/api/agent/sessions/${turn.body.sessionId as string}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    expect(restored.body.messages).toHaveLength(2);
    expect(restored.body.messages[0]).toMatchObject({ role: "user", kind: "message" });
    expect(restored.body.messages[1]).toMatchObject({
      role: "assistant",
      kind: "message",
      message: expect.stringContaining("editable planner could not be restored"),
    });
    expect(restored.body.messages[1]).not.toHaveProperty("planner");
  });

  it("restores pending, confirmed, rejected, and expired proposal states from authoritative owned rows", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => legacyGatheringProposal()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "proposal-status-restore@protocol.test",
      displayName: "Status Owner",
      familyName: "Status Family",
    });
    const created: Array<{ sessionId: string; proposal: { id: string } }> = [];
    let sessionId: string | undefined;
    for (const label of ["pending", "confirmed", "rejected", "expired"] as const) {
      const response = await browser
        .post("/api/agent/messages")
        .send({ familyId: family.familyId, ...(sessionId ? { sessionId } : {}), message: `Create ${label}.` })
        .expect(201);
      sessionId = response.body.sessionId as string;
      created.push(response.body as { sessionId: string; proposal: { id: string } });
    }
    db.prepare(
      "UPDATE agent_action_proposals SET status = 'confirmed', confirmed_at = ?, result_entity_id = ? WHERE id = ?",
    ).run(TEST_NOW.toISOString(), randomUUID(), created[1].proposal.id);
    db.prepare(
      "UPDATE agent_action_proposals SET status = 'rejected', rejected_at = ? WHERE id = ?",
    ).run(TEST_NOW.toISOString(), created[2].proposal.id);
    db.prepare("UPDATE agent_action_proposals SET expires_at = ? WHERE id = ?")
      .run(TEST_NOW.toISOString(), created[3].proposal.id);

    const restored = await browser
      .get(`/api/agent/sessions/${sessionId!}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    const proposals = restored.body.messages.filter((message: { proposal?: { id: string } }) => message.proposal);
    expect(proposals.map((message: { proposal: { id: string }; proposalStatus: string }) => ({
      id: message.proposal.id,
      status: message.proposalStatus,
    }))).toEqual([
      { id: created[0].proposal.id, status: "pending" },
      { id: created[1].proposal.id, status: "confirmed" },
      { id: created[2].proposal.id, status: "rejected" },
      { id: created[3].proposal.id, status: "expired" },
    ]);
    for (const proposalMessage of proposals) {
      expect(proposalMessage.proposal).toMatchObject({
        actionType: "CREATE_GATHERING_DRAFT",
        title: "Create draft: Protocol draft",
        summary: expect.stringContaining("unsent"),
        details: expect.objectContaining({ locationName: "Golden Park" }),
        warnings: expect.any(Array),
      });
    }
    const persistedTranscriptPayloads = db
      .prepare("SELECT payload_json FROM agent_messages WHERE kind = 'proposal' ORDER BY message_order")
      .all() as Array<{ payload_json: string }>;
    for (const row of persistedTranscriptPayloads) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["details", "proposalId"]);
      expect(JSON.stringify(payload)).not.toMatch(/invitationUrl|token|ephemeralResult/i);
    }
  });

  it("degrades legacy, corrupt, and cross-session proposal metadata instead of guessing controls", async () => {
    const db = database();
    const app = appWith(db, callbackProvider(() => legacyGatheringProposal()));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "proposal-degradation@protocol.test",
      displayName: "Degrade Owner",
      familyName: "Degrade Family",
    });
    const first = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Legacy metadata." })
      .expect(201);
    const second = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, sessionId: first.body.sessionId, message: "Missing proposal." })
      .expect(201);
    const otherSession = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "Other session." })
      .expect(201);
    const proposalMessages = db
      .prepare("SELECT id FROM agent_messages WHERE session_id = ? AND kind = 'proposal' ORDER BY message_order")
      .all(first.body.sessionId) as Array<{ id: string }>;
    db.prepare("UPDATE agent_messages SET payload_json = NULL WHERE id = ?").run(proposalMessages[0].id);
    db.prepare("UPDATE agent_messages SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({ proposalId: otherSession.body.proposal.id, details: {} }), proposalMessages[1].id);

    const restored = await browser
      .get(`/api/agent/sessions/${first.body.sessionId as string}/messages`)
      .query({ familyId: family.familyId })
      .expect(200);
    expect(restored.body.messages).toHaveLength(4);
    const degraded = restored.body.messages.filter((message: { message: string }) =>
      message.message.includes("proposal controls could not be restored safely"),
    );
    expect(degraded).toHaveLength(2);
    for (const message of degraded) {
      expect(message).toMatchObject({ role: "assistant", kind: "message" });
      expect(message).not.toHaveProperty("proposal");
      expect(message).not.toHaveProperty("proposalStatus");
    }
  });

  it("accepts every provider-context count at its boundary and rejects boundary plus one", () => {
    const member = { id: randomUUID(), displayName: "Member", canUpdate: false, canDelete: false };
    const relationship = {
      id: randomUUID(),
      sourceMemberId: randomUUID(),
      targetMemberId: randomUUID(),
      type: "relative" as const,
    };
    const effective = {
      memberId: randomUUID(),
      parentMemberIds: [] as string[],
      spouseMemberIds: [] as string[],
      siblingMemberIds: [] as string[],
      childMemberIds: [] as string[],
    };
    const gathering = {
      id: randomUUID(),
      title: "Gathering",
      status: "draft" as const,
      startAt: "2026-09-12T17:00:00+04:00",
      canPrepareInvitations: true,
      canComplete: false,
      invitationStatuses: [] as Array<{
        memberId: string;
        memberName: string;
        status: "pending";
      }>,
    };
    const invitation = { memberId: randomUUID(), memberName: "Member", status: "pending" as const };
    const memory = {
      id: randomUUID(),
      title: "Memory",
      memoryType: "note" as const,
      visibility: "family" as const,
      canDelete: false,
    };
    const plan = { id: randomUUID(), title: "Plan", status: "active" as const, canUpdate: false };

    const cases: Array<{
      label: string;
      maximum: number;
      setCount: (family: AgentFamilyContext, count: number) => void;
    }> = [
      {
        label: "members",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.members,
        setCount: (family, count) => { family.members = Array.from({ length: count }, () => member); },
      },
      {
        label: "relationships",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.relationships,
        setCount: (family, count) => { family.relationships = Array.from({ length: count }, () => relationship); },
      },
      {
        label: "effective relationship references",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.effectiveRelationshipReferences,
        setCount: (family, count) => {
          family.effectiveRelationships = [{ ...effective, siblingMemberIds: Array.from({ length: count }, () => member.id) }];
        },
      },
      {
        label: "gatherings",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.gatherings,
        setCount: (family, count) => { family.engagement.gatherings = Array.from({ length: count }, () => gathering); },
      },
      {
        label: "invitation statuses",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.invitationStatuses,
        setCount: (family, count) => {
          family.engagement.gatherings = [{ ...gathering, invitationStatuses: Array.from({ length: count }, () => invitation) }];
        },
      },
      {
        label: "memories",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.memories,
        setCount: (family, count) => { family.engagement.memories = Array.from({ length: count }, () => memory); },
      },
      {
        label: "plans",
        maximum: AGENT_PROVIDER_CONTEXT_LIMITS.plans,
        setCount: (family, count) => { family.engagement.plans = Array.from({ length: count }, () => plan); },
      },
    ];

    for (const testCase of cases) {
      const atBoundary = minimalFamilyContext();
      testCase.setCount(atBoundary, testCase.maximum);
      expect(() => assertAgentProviderInputWithinLimits(providerInput(atBoundary)), testCase.label).not.toThrow();

      const overBoundary = minimalFamilyContext();
      testCase.setCount(overBoundary, testCase.maximum + 1);
      expectContextLimit(() => assertAgentProviderInputWithinLimits(providerInput(overBoundary)));
    }
  });

  it("measures the complete serialized provider payload in UTF-8 bytes", () => {
    const atBoundary = minimalFamilyContext();
    atBoundary.name = "Small enough";
    expect(() => assertAgentProviderInputWithinLimits(providerInput(atBoundary))).not.toThrow();

    const overBoundary = minimalFamilyContext();
    overBoundary.name = "é".repeat(AGENT_PROVIDER_CONTEXT_LIMITS.serializedBytes);
    expectContextLimit(() => assertAgentProviderInputWithinLimits(providerInput(overBoundary)));
  });

  it("fails closed before provider disclosure when the authorized family exceeds a context bound", async () => {
    let providerCalls = 0;
    const db = database();
    const app = appWith(db, callbackProvider(() => {
      providerCalls += 1;
      return { kind: "message", message: "Within context limits." };
    }, { requiresExternalDataConsent: true, providerName: "bounded-external" }));
    const browser = request.agent(app);
    const family = await register(browser, db, {
      email: "context-boundary@protocol.test",
      displayName: "Boundary Owner",
      familyName: "Boundary Family",
    });
    const insertMember = db.prepare(
      `INSERT INTO family_members
       (id, family_id, display_name, interests_json, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, ?)`,
    );
    db.transaction(() => {
      for (let index = 1; index < AGENT_PROVIDER_CONTEXT_LIMITS.members; index += 1) {
        insertMember.run(
          randomUUID(),
          family.familyId,
          `Member ${String(index).padStart(3, "0")}`,
          TEST_NOW.toISOString(),
          TEST_NOW.toISOString(),
        );
      }
    })();
    const accepted = await browser
      .post("/api/agent/messages")
      .send({ familyId: family.familyId, message: "At the exact member boundary.", aiProcessingConsent: true })
      .expect(200);
    expect(providerCalls).toBe(1);
    expect(controlCounts(db).messages).toBe(2);
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(1);

    insertMember.run(
      randomUUID(),
      family.familyId,
      "One member too many",
      TEST_NOW.toISOString(),
      TEST_NOW.toISOString(),
    );
    const domainBefore = domainSnapshot(db);
    const rejected = await browser
      .post("/api/agent/messages")
      .send({
        familyId: family.familyId,
        sessionId: accepted.body.sessionId,
        message: "This must not reach the provider.",
        aiProcessingConsent: true,
      })
      .expect(413);
    expect(rejected.body.error).toMatchObject({
      code: "AGENT_CONTEXT_TOO_LARGE",
      message: expect.stringContaining("No data was sent to the AI provider"),
    });
    expect(providerCalls).toBe(1);
    expect(controlCounts(db).messages).toBe(2);
    expect((db.prepare("SELECT count(*) AS count FROM audit_events WHERE action = 'agent.external_context_disclosed'").get() as { count: number }).count).toBe(1);
    expect(domainSnapshot(db)).toEqual(domainBefore);
  });

  it("creates the complete fresh schema once and enforces transcript storage invariants after reopen", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "agent-protocol-schema-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "protocol.sqlite");
    const first = database({ path: databasePath });
    expect(first.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
      .toEqual(Array.from({ length: 8 }, (_, index) => ({ version: index + 1 })));
    const migrationCount = (first.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count;
    first.close();
    databases.splice(databases.indexOf(first), 1);

    const reopened = database({ path: databasePath });
    expect((reopened.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count)
      .toBe(migrationCount);
    const now = TEST_NOW.toISOString();
    const userId = randomUUID();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    reopened.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, 'schema@protocol.test', 'hash', 'Schema', ?, ?)",
    ).run(userId, now, now);
    reopened.prepare(
      "INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Schema', ?, ?, ?)",
    ).run(familyId, userId, now, now);
    reopened.prepare(
      "INSERT INTO agent_sessions (id, family_id, created_by_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    ).run(sessionId, familyId, userId, now, now);

    const insert = (id: string, kind: string, payload: string | null, order: number) => reopened.prepare(
      `INSERT INTO agent_messages
       (id, session_id, role, kind, content_text, payload_json, message_order, created_at)
       VALUES (?, ?, 'assistant', ?, 'Stored', ?, ?, ?)`,
    ).run(id, sessionId, kind, payload, order, now);
    expect(() => insert(randomUUID(), "gathering_planner", JSON.stringify(plannerDecision().planner), 1)).not.toThrow();
    expect(() => insert(randomUUID(), "unknown_kind", null, 2)).toThrow();
    expect(() => insert(randomUUID(), "message", "not-json", 2)).toThrow();
    expect(() => insert(randomUUID(), "message", null, 1)).toThrow();
    expect(() => insert(randomUUID(), "message", null, 0)).toThrow();
  });

});
