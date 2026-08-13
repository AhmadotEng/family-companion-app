import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type AppDatabase } from "./database.js";
import { registerEngagementRoutes } from "./engagement.js";
import { errorHandler } from "./http.js";
import { createSession, sessionMiddleware } from "./security.js";

const ownerId = "30000000-0000-4000-8000-000000000001";
const memberUserId = "30000000-0000-4000-8000-000000000002";
const familyId = "40000000-0000-4000-8000-000000000001";
const ownerMemberId = "50000000-0000-4000-8000-000000000001";
const relativeMemberId = "50000000-0000-4000-8000-000000000002";

describe("engagement routes", () => {
  let database: AppDatabase;
  let app: express.Express;
  let uploadRoot: string;

  beforeEach(async () => {
    database = openDatabase({ path: ":memory:" });
    uploadRoot = await mkdtemp(path.join(tmpdir(), "family-companion-test-"));
    const now = new Date().toISOString();
    database
      .prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', ?, ?, ?)")
      .run(ownerId, "owner@example.com", "Owner", now, now);
    database
      .prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', ?, ?, ?)")
      .run(memberUserId, "member@example.com", "Relative", now, now);
    database
      .prepare("INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Test Family', ?, ?, ?)")
      .run(familyId, ownerId, now, now);
    database
      .prepare(
        `INSERT INTO family_members
         (id, family_id, user_id, display_name, birth_date, interests_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(ownerMemberId, familyId, ownerId, "Owner", "1985-01-01", now, now);
    database
      .prepare(
        `INSERT INTO family_members
         (id, family_id, user_id, display_name, birth_date, interests_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(relativeMemberId, familyId, memberUserId, "Grandparent", "1940-01-01", now, now);
    database
      .prepare("INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at) VALUES (?, ?, 'owner', ?, ?)")
      .run(familyId, ownerId, ownerMemberId, now);
    database
      .prepare("INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at) VALUES (?, ?, 'member', ?, ?)")
      .run(familyId, memberUserId, relativeMemberId, now);

    app = express();
    app.use(express.json());
    app.use(sessionMiddleware(database));
    app.post("/__test/login/:userId", (req, res) => {
      createSession(database, res, req.params.userId, { secureCookies: false });
      res.json({ ok: true });
    });
    registerEngagementRoutes(app, database, { uploadRoot });
    app.use(errorHandler);
  });

  afterEach(async () => {
    database.close();
    await rm(uploadRoot, { recursive: true, force: true });
  });

  async function authenticatedAgent(userId = ownerId) {
    const agent = request.agent(app);
    await agent.post(`/__test/login/${userId}`).expect(200);
    return agent;
  }

  async function createGathering(
    agent: ReturnType<typeof request.agent>,
    startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  ) {
    const result = await agent
      .post(`/api/families/${familyId}/gatherings`)
      .send({
        title: "Friday family visit",
        purpose: "Reconnect across generations",
        startAt,
        timezone: "Asia/Dubai",
        locationName: "Family home, Abu Dhabi",
        type: "Friday visit",
      })
      .expect(201);
    return result.body.gathering.id as string;
  }

  it("persists a gathering and prepares honest one-time RSVP links", async () => {
    const agent = await authenticatedAgent();
    const gatheringId = await createGathering(agent);

    const prepared = await agent
      .post(`/api/gatherings/${gatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "whatsapp" })
      .expect(201);

    expect(prepared.body.deliveryNotice).toContain("not contacted anyone");
    expect(prepared.body.invitations).toHaveLength(2);
    expect(prepared.body.invitations[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(prepared.body.invitations[0].shareUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/invite\//);
    expect(decodeURIComponent(prepared.body.invitations[0].whatsappUrl)).toContain(prepared.body.invitations[0].shareUrl);

    const token = String(prepared.body.invitations[0].sharePath).split("/").pop();
    const publicView = await request(app).get(`/api/invitations/${token}`).expect(200);
    expect(publicView.body.invitation.title).toBe("Friday family visit");

    await request(app).post(`/api/invitations/${token}/respond`).send({ status: "going" }).expect(200);
    await request(app).post(`/api/invitations/${token}/respond`).send({ status: "going" }).expect(200);

    const firstResponseRewards = database
      .prepare("SELECT COUNT(*) AS count FROM reward_ledger WHERE family_id = ? AND reason_code = 'FIRST_INVITATION_RESPONSE'")
      .get(familyId) as { count: number };
    expect(firstResponseRewards.count).toBe(1);
  });

  it("rejects unsupported time zones before persisting a gathering", async () => {
    const agent = await authenticatedAgent();
    await agent
      .post(`/api/families/${familyId}/gatherings`)
      .send({
        title: "Invalid timezone gathering",
        purpose: "Validate the API boundary",
        startAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        timezone: "not-a-zone",
        locationName: "Dubai",
        type: "Visit",
      })
      .expect(400);
    expect((database.prepare("SELECT COUNT(*) AS count FROM gatherings").get() as { count: number }).count).toBe(0);
  });

  it("shows ordinary members only their own RSVP record", async () => {
    const owner = await authenticatedAgent();
    const member = await authenticatedAgent(memberUserId);
    const gatheringId = await createGathering(owner);
    const uninvitedView = await member.get(`/api/families/${familyId}/gatherings`).expect(200);
    expect(uninvitedView.body.gatherings).toEqual([]);
    await owner
      .post(`/api/gatherings/${gatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "share_link" })
      .expect(201);

    const ownerView = await owner.get(`/api/families/${familyId}/gatherings`).expect(200);
    const memberView = await member.get(`/api/families/${familyId}/gatherings`).expect(200);
    expect(ownerView.body.gatherings[0].invitations).toHaveLength(2);
    expect(memberView.body.gatherings[0].invitations).toEqual([
      expect.objectContaining({ memberId: relativeMemberId, memberName: "Grandparent" }),
    ]);
    expect(JSON.stringify(memberView.body)).not.toContain(ownerMemberId);

    const memberCreatedId = await createGathering(member);
    const creatorView = await member.get(`/api/families/${familyId}/gatherings`).expect(200);
    expect(creatorView.body.gatherings.map((item: { id: string }) => item.id)).toContain(memberCreatedId);
  });

  it("awards completion points once and detects elder inclusion from persisted birth dates", async () => {
    const agent = await authenticatedAgent();
    const gatheringId = await createGathering(agent, new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString());
    await agent
      .post(`/api/gatherings/${gatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "share_link" })
      .expect(201);
    database.prepare("UPDATE gathering_invitations SET status = 'going', responded_at = ? WHERE gathering_id = ?").run(
      new Date().toISOString(),
      gatheringId,
    );

    const first = await agent
      .post(`/api/gatherings/${gatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(200);
    expect(first.body.pointsAwarded).toBe(800);

    const second = await agent
      .post(`/api/gatherings/${gatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(200);
    expect(second.body.pointsAwarded).toBe(0);
  });

  it("rejects completion before the start and requires persisted Going RSVPs", async () => {
    const agent = await authenticatedAgent();
    const futureGatheringId = await createGathering(agent);
    await agent
      .post(`/api/gatherings/${futureGatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "share_link" })
      .expect(201);
    await agent
      .post(`/api/gatherings/${futureGatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(409);

    const pastGatheringId = await createGathering(agent, new Date(Date.now() - 60 * 60 * 1_000).toISOString());
    await agent
      .post(`/api/gatherings/${pastGatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "share_link" })
      .expect(201);
    await agent
      .post(`/api/gatherings/${pastGatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(400);

    database.prepare("UPDATE gathering_invitations SET status = 'going' WHERE gathering_id = ?").run(pastGatheringId);
    const ordinaryMember = await authenticatedAgent(memberUserId);
    await ordinaryMember
      .post(`/api/gatherings/${pastGatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(403);
  });

  it("stores media outside the public tree and enforces memory visibility", async () => {
    const owner = await authenticatedAgent();
    const member = await authenticatedAgent(memberUserId);
    const gatheringId = await createGathering(owner, new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString());
    await owner
      .post(`/api/gatherings/${gatheringId}/invitations`)
      .send({ memberIds: [ownerMemberId, relativeMemberId], channel: "share_link" })
      .expect(201);
    database.prepare("UPDATE gathering_invitations SET status = 'going', responded_at = ? WHERE gathering_id = ?").run(
      new Date().toISOString(),
      gatheringId,
    );
    await owner
      .post(`/api/gatherings/${gatheringId}/complete`)
      .send({ confirmAttendeeMemberIds: [ownerMemberId, relativeMemberId] })
      .expect(200);
    const created = await owner
      .post(`/api/gatherings/${gatheringId}/memories`)
      .send({
        familyId,
        title: "Private family photo",
        memoryType: "photo",
        visibility: "private",
        selectedMemberIds: [],
        aiProcessingAllowed: false,
        capturedAt: "2026-08-21T18:00:00+04:00",
      })
      .expect(201);
    const memoryId = created.body.memory.id as string;

    await owner
      .put(`/api/memories/${memoryId}/media`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("this is not a jpeg"))
      .expect(415);

    const quotaMemoryId = "70000000-0000-4000-8000-000000000001";
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memories
         (id, family_id, gathering_id, created_by_user_id, title, memory_type, visibility,
          ai_processing_allowed, media_size_bytes, captured_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Quota fixture', 'photo', 'private', 0, ?, ?, ?, ?)`,
      )
      .run(quotaMemoryId, familyId, gatheringId, ownerId, 100 * 1024 * 1024, now, now, now);
    await owner
      .put(`/api/memories/${memoryId}/media`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))
      .expect(413);
    expect(database.prepare("SELECT storage_path FROM memories WHERE id = ?").get(memoryId)).toEqual({ storage_path: null });
    expect(database.prepare("SELECT COUNT(*) AS count FROM reward_ledger WHERE reason_code = 'MEMORY_CAPTURED'").get()).toEqual({ count: 0 });
    database.prepare("DELETE FROM memories WHERE id = ?").run(quotaMemoryId);

    await owner
      .put(`/api/memories/${memoryId}/media`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      .expect(200);
    const media = await owner.get(`/api/memories/${memoryId}/media`).expect(200);
    expect(media.headers["content-type"]).toMatch(/^image\/jpeg/);
    await member.get(`/api/memories/${memoryId}/media`).expect(404);
    await member.delete(`/api/memories/${memoryId}`).expect(403);
    await owner.delete(`/api/memories/${memoryId}`).expect(204);
    await owner.get(`/api/memories/${memoryId}/media`).expect(404);
  });

  it("keeps creator-owned reconnection plans private from ordinary family members", async () => {
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO reconnection_plans
         (id, family_id, created_by_user_id, title, rationale, suggested_member_ids_json,
          suggested_gathering_json, evidence_json, status, provider, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'test', 'test-model', ?, ?)`,
      )
      .run(
        "60000000-0000-4000-8000-000000000001",
        familyId,
        ownerId,
        "Private location-aware plan",
        "Meet nearby",
        JSON.stringify([ownerMemberId, relativeMemberId]),
        JSON.stringify({ format: "visit", locationGuidance: "Dubai" }),
        JSON.stringify({ safeLocations: [{ memberId: ownerMemberId, city: "Dubai" }] }),
        now,
        now,
      );
    const owner = await authenticatedAgent(ownerId);
    const ordinaryMember = await authenticatedAgent(memberUserId);
    const ownerPlans = await owner.get(`/api/families/${familyId}/reconnection-plans`).expect(200);
    const memberPlans = await ordinaryMember.get(`/api/families/${familyId}/reconnection-plans`).expect(200);
    expect(ownerPlans.body.plans).toHaveLength(1);
    expect(memberPlans.body.plans).toEqual([]);
    await ordinaryMember
      .patch("/api/reconnection-plans/60000000-0000-4000-8000-000000000001")
      .send({ status: "accepted" })
      .expect(403);
  });

  it("shows demo rewards but refuses to redeem them", async () => {
    const agent = await authenticatedAgent();
    const rewards = await agent.get(`/api/families/${familyId}/rewards`).expect(200);
    expect(rewards.body.offers[0].isDemo).toBe(true);
    expect(rewards.body.offers[0].redeemable).toBe(false);
    await agent
      .post(`/api/families/${familyId}/rewards/${rewards.body.offers[0].id}/redeem`)
      .expect(409);
  });
});
