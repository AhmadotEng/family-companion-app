import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDatabase, type AppDatabase } from "./database.js";

interface Registration {
  user: { id: string; email: string; displayName: string };
  families: Array<{ id: string; name: string; role: string; linkedMemberId?: string }>;
}

type TestAgent = ReturnType<typeof request.agent>;

describe("Family Companion API", () => {
  let temporaryDirectory: string;
  let database: AppDatabase;
  let app: Express;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "family-companion-test-"));
    database = openDatabase({ path: path.join(temporaryDirectory, "test.sqlite") });
    app = createApp({ database, bcryptRounds: 4, rateLimitEnabled: false, secureCookies: false });
  });

  afterEach(() => {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function register(
    agent: TestAgent,
    overrides: Partial<{ email: string; password: string; displayName: string; familyName: string }> = {},
  ): Promise<Registration> {
    const response = await agent.post("/api/auth/register").send({
      email: "owner@example.com",
      password: "CorrectHorse42!",
      displayName: "Family Owner",
      familyName: "The Example Family",
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body as Registration;
  }

  it("creates a secure, revocable cookie session and never stores a plaintext password", async () => {
    const agent = request.agent(app);
    const registration = await register(agent);

    const registrationResponse = await request(app).post("/api/auth/login").send({
      email: "owner@example.com",
      password: "CorrectHorse42!",
    });
    expect(registrationResponse.status).toBe(200);
    expect(registrationResponse.headers["set-cookie"]?.[0]).toContain("fc_session=");
    expect(registrationResponse.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(registrationResponse.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");

    const storedUser = database.prepare("SELECT password_hash FROM users WHERE id = ?").get(registration.user.id) as {
      password_hash: string;
    };
    expect(storedUser.password_hash).not.toContain("CorrectHorse42!");
    expect(storedUser.password_hash).toMatch(/^\$2[aby]\$/);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("owner@example.com");
    expect(me.body.families[0]).toMatchObject({ role: "owner", linkedMemberId: expect.any(String) });

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    const revoked = database.prepare("SELECT revoked_at FROM sessions WHERE user_id = ?").all(registration.user.id) as Array<{
      revoked_at: string | null;
    }>;
    expect(revoked.some((session) => session.revoked_at !== null)).toBe(true);
  });

  it("validates registration and rejects duplicate accounts without leaking password details", async () => {
    const agent = request.agent(app);
    expect(
      (
        await agent.post("/api/auth/register").send({
          email: "not-an-email",
          password: "short",
          displayName: "A",
          familyName: "F",
        })
      ).status,
    ).toBe(400);
    await register(agent);
    const duplicate = await request(app).post("/api/auth/register").send({
      email: "OWNER@example.com",
      password: "AnotherSecure42!",
      displayName: "Another Owner",
      familyName: "Another Family",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_IN_USE");
    const invalidLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "incorrect" });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body.error.code).toBe("INVALID_CREDENTIALS");

    const tooManyAsciiBytes = await request(app).post("/api/auth/register").send({
      email: "long-password@example.com",
      password: "a".repeat(73),
      displayName: "Long Password",
      familyName: "Long Password Family",
    });
    expect(tooManyAsciiBytes.status).toBe(400);
    const tooManyUnicodeBytes = await request(app).post("/api/auth/register").send({
      email: "unicode-password@example.com",
      password: "😀".repeat(19),
      displayName: "Unicode Password",
      familyName: "Unicode Password Family",
    });
    expect(tooManyUnicodeBytes.status).toBe(400);
  });

  it("persists normalized members and directional relationships atomically", async () => {
    const agent = request.agent(app);
    const registration = await register(agent);
    const family = registration.families[0];
    const selfId = family.linkedMemberId!;

    const parent = await agent.post(`/api/families/${family.id}/members`).send({
      displayName: "Parent Example",
      birthDate: "1960-05-12",
      interests: ["History", "History"],
      relationship: { relatedMemberId: selfId, type: "parent", direction: "source" },
      location: { emirate: "Dubai", precision: "emirate", visibility: "family" },
    });
    expect(parent.status).toBe(201);
    expect(parent.body.member.interests).toEqual(["History"]);
    expect(parent.body.relationship).toMatchObject({
      sourceMemberId: parent.body.member.id,
      targetMemberId: selfId,
      type: "parent",
    });

    const coParent = await agent.post(`/api/families/${family.id}/members`).send({
      displayName: "Co-parent Example",
    });
    expect(coParent.status).toBe(201);

    const child = await agent.post(`/api/families/${family.id}/members`).send({
      displayName: "Child Example",
      relationships: [
        { relatedMemberId: selfId, type: "parent", direction: "target" },
        { relatedMemberId: coParent.body.member.id, type: "parent", direction: "target" },
      ],
    });
    expect(child.status).toBe(201);
    expect(child.body.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMemberId: selfId, targetMemberId: child.body.member.id }),
        expect.objectContaining({ sourceMemberId: coParent.body.member.id, targetMemberId: child.body.member.id }),
      ]),
    );

    const context = await agent.get(`/api/families/${family.id}/context`);
    expect(context.status).toBe(200);
    expect(context.body.family).toEqual({ id: family.id, name: "The Example Family", role: "owner" });
    expect(context.body.members).toHaveLength(4);
    expect(context.body.relationships).toHaveLength(3);
    expect(context.body.safeLocations).toEqual([
      expect.objectContaining({ memberId: parent.body.member.id, emirate: "Dubai" }),
    ]);

    const countBefore = (database.prepare("SELECT count(*) AS count FROM family_members").get() as { count: number }).count;
    const failedAtomicCreate = await agent.post(`/api/families/${family.id}/members`).send({
      displayName: "Must Not Persist",
      relationship: { relatedMemberId: "00000000-0000-4000-8000-000000000000", type: "parent" },
    });
    expect(failedAtomicCreate.status).toBe(404);
    const countAfter = (database.prepare("SELECT count(*) AS count FROM family_members").get() as { count: number }).count;
    expect(countAfter).toBe(countBefore);

    const externalPhoto = await agent.patch(`/api/family-members/${child.body.member.id}`).send({
      photoUrl: "https://tracker.example/profile.png",
    });
    expect(externalPhoto.status).toBe(400);

    const cycle = await agent.post(`/api/families/${family.id}/relationships`).send({
      sourceMemberId: selfId,
      targetMemberId: parent.body.member.id,
      type: "parent",
    });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error.code).toBe("RELATIONSHIP_CYCLE");

    const updated = await agent.patch(`/api/family-members/${child.body.member.id}`).send({ notes: "Likes football" });
    expect(updated.status).toBe(200);
    expect(updated.body.member.notes).toBe("Likes football");
    expect((await agent.delete(`/api/family-members/${child.body.member.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/family-members/${selfId}`)).status).toBe(409);
    expect((database.prepare("SELECT count(*) AS count FROM audit_events").get() as { count: number }).count).toBeGreaterThan(3);
  });

  it("enforces family isolation on reads and every member write endpoint", async () => {
    const ownerA = request.agent(app);
    const ownerB = request.agent(app);
    const registrationA = await register(ownerA, {
      email: "a@example.com",
      displayName: "Owner A",
      familyName: "Family A",
    });
    await register(ownerB, { email: "b@example.com", displayName: "Owner B", familyName: "Family B" });
    const familyA = registrationA.families[0];
    const memberA = familyA.linkedMemberId!;

    expect((await ownerB.get(`/api/families/${familyA.id}/context`)).status).toBe(404);
    expect((await ownerB.patch(`/api/family-members/${memberA}`).send({ displayName: "Hacked" })).status).toBe(404);
    expect(
      (
        await ownerB.put(`/api/family-members/${memberA}/location`).send({
          consentGranted: true,
          source: "browser",
          precision: "exact",
          visibility: "private",
          latitude: 25.2048,
          longitude: 55.2708,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ownerB.post(`/api/families/${familyA.id}/relationships`).send({
          sourceMemberId: memberA,
          targetMemberId: memberA,
          type: "relative",
        })
      ).status,
    ).toBe(404);

    const context = await ownerA.get(`/api/families/${familyA.id}/context`);
    expect(context.body.members[0].displayName).toBe("Owner A");
  });

  it("redacts private profiles for ordinary family members and enforces role-aware writes", async () => {
    const owner = request.agent(app);
    const ordinaryMember = request.agent(app);
    const ownerRegistration = await register(owner, {
      email: "private-owner@example.com",
      displayName: "Private Owner",
      familyName: "Private Family",
    });
    const memberRegistration = await register(ordinaryMember, {
      email: "ordinary@example.com",
      displayName: "Ordinary Member",
      familyName: "Temporary Family",
    });
    const family = ownerRegistration.families[0];
    const ownerMemberId = family.linkedMemberId!;
    const memberUserId = memberRegistration.user.id;
    const linkedMemberId = "a0000000-0000-4000-8000-000000000001";
    const now = new Date().toISOString();
    database.prepare("UPDATE family_members SET phone = ?, notes = ? WHERE id = ?").run("+971500000000", "Private note", ownerMemberId);
    database
      .prepare(
        `INSERT INTO family_members
         (id, family_id, user_id, display_name, email, interests_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Ordinary Member', 'ordinary@example.com', '[]', ?, ?)`,
      )
      .run(linkedMemberId, family.id, memberUserId, now, now);
    database
      .prepare("INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at) VALUES (?, ?, 'member', ?, ?)")
      .run(family.id, memberUserId, linkedMemberId, now);

    const context = await ordinaryMember.get(`/api/families/${family.id}/context`).expect(200);
    const redactedOwner = context.body.members.find((member: { id: string }) => member.id === ownerMemberId);
    const self = context.body.members.find((member: { id: string }) => member.id === linkedMemberId);
    expect(redactedOwner).not.toHaveProperty("phone");
    expect(redactedOwner).not.toHaveProperty("email");
    expect(redactedOwner).not.toHaveProperty("notes");
    expect(redactedOwner).not.toHaveProperty("birthDate");
    expect(self.email).toBe("ordinary@example.com");

    await ordinaryMember
      .post(`/api/families/${family.id}/members`)
      .send({ displayName: "Unauthorized addition" })
      .expect(403);
    await ordinaryMember.patch(`/api/family-members/${ownerMemberId}`).send({ displayName: "Unauthorized edit" }).expect(403);
    await ordinaryMember.patch(`/api/family-members/${linkedMemberId}`).send({ notes: "My own note" }).expect(200);
  });

  it("stores consented locations, returns only safe derivatives, and allows revocation", async () => {
    const agent = request.agent(app);
    const registration = await register(agent);
    const family = registration.families[0];
    const selfId = family.linkedMemberId!;

    const exact = await agent.put(`/api/family-members/${selfId}/location`).send({
      consentGranted: true,
      source: "browser",
      precision: "exact",
      visibility: "private",
      latitude: 25.2048,
      longitude: 55.2708,
      accuracyM: 24,
      emirate: "Dubai",
      city: "Dubai",
    });
    expect(exact.status).toBe(200);
    expect(exact.body.safeLocation).not.toHaveProperty("latitude");
    expect(exact.body.safeLocation).not.toHaveProperty("longitude");
    expect((database.prepare("SELECT latitude FROM member_locations WHERE member_id = ?").get(selfId) as { latitude: number }).latitude).toBe(
      25.2048,
    );

    const rounded = await agent.put(`/api/family-members/${selfId}/location`).send({
      consentGranted: true,
      source: "browser",
      precision: "approximate",
      visibility: "private",
      latitude: 25.2048,
      longitude: 55.2708,
      accuracyM: 24,
    });
    expect(rounded.status).toBe(200);
    const roundedStored = database
      .prepare("SELECT latitude, longitude, accuracy_m FROM member_locations WHERE member_id = ?")
      .get(selfId) as { latitude: number; longitude: number; accuracy_m: number | null };
    expect(roundedStored).toEqual({ latitude: 25.25, longitude: 55.25, accuracy_m: null });

    const relative = await agent
      .post(`/api/families/${family.id}/members`)
      .send({ displayName: "Relative Example" });
    const forbidden = await agent.put(`/api/family-members/${relative.body.member.id}/location`).send({
      consentGranted: true,
      source: "browser",
      precision: "exact",
      visibility: "family",
      latitude: 24.4539,
      longitude: 54.3773,
    });
    expect(forbidden.status).toBe(403);

    const approximate = await agent.put(`/api/family-members/${relative.body.member.id}/location`).send({
      consentGranted: true,
      source: "manual",
      precision: "emirate",
      visibility: "family",
      emirate: "Abu Dhabi",
    });
    expect(approximate.status).toBe(200);
    expect(approximate.body.safeLocation).toMatchObject({ emirate: "Abu Dhabi", source: "manual" });

    const context = await agent.get(`/api/families/${family.id}/context`);
    expect(JSON.stringify(context.body.safeLocations)).not.toContain("latitude");
    expect(context.body.safeLocations).toHaveLength(2);

    const revoked = await agent.put(`/api/family-members/${selfId}/location`).send({ consentGranted: false });
    expect(revoked.status).toBe(200);
    expect(revoked.body.safeLocation).toBeNull();
    expect(database.prepare("SELECT 1 FROM member_locations WHERE member_id = ?").get(selfId)).toBeUndefined();
    expect(
      (database.prepare("SELECT count(*) AS count FROM location_consents WHERE member_id = ? AND revoked_at IS NOT NULL").get(selfId) as {
        count: number;
      }).count,
    ).toBe(2);
  });

  it("uses bounded JSON parsing, consistent errors, and hardened response headers", async () => {
    const noAuth = await request(app).get("/api/auth/me");
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toEqual({ error: { code: "AUTH_REQUIRED", message: "Please sign in to continue." } });
    expect(noAuth.headers["x-content-type-options"]).toBe("nosniff");
    expect(noAuth.headers["x-powered-by"]).toBeUndefined();
    expect(noAuth.headers["cache-control"]).toBe("no-store");

    const malformed = await request(app)
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");

    const oversized = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "x".repeat(110_000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("uses the trusted proxy hop without accepting a spoofed leftmost client address", async () => {
    const rateDatabase = openDatabase({ path: ":memory:" });
    try {
      const limitedApp = createApp({
        database: rateDatabase,
        production: true,
        secureCookies: false,
        rateLimitEnabled: true,
        apiRateLimit: 1,
        trustProxyHops: 1,
        bcryptRounds: 4,
        env: { NODE_ENV: "production" },
      });

      await request(limitedApp).get("/api/auth/me").set("X-Forwarded-For", "198.51.100.10").expect(401);
      await request(limitedApp).get("/api/auth/me").set("X-Forwarded-For", "198.51.100.10").expect(429);
      await request(limitedApp).get("/api/auth/me").set("X-Forwarded-For", "198.51.100.11").expect(401);

      await request(limitedApp)
        .get("/api/auth/me")
        .set("X-Forwarded-For", "203.0.113.1, 198.51.100.50")
        .expect(401);
      await request(limitedApp)
        .get("/api/auth/me")
        .set("X-Forwarded-For", "203.0.113.99, 198.51.100.50")
        .expect(429);
    } finally {
      rateDatabase.close();
    }
  });
});
