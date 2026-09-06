import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type AppDatabase } from "../server/database.js";

const temporaryDirectories: string[] = [];
const openDatabases: AppDatabase[] = [];

afterEach(() => {
  while (openDatabases.length) {
    const database = openDatabases.pop();
    if (database?.open) database.close();
  }
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("agent schema migration", () => {
  it("upgrades the legacy ADD_MEMBER-only proposal table without inspecting DDL text at route time", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "family-agent-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "migration.sqlite");
    const initial = openDatabase({ path: databasePath });
    openDatabases.push(initial);
    const now = "2026-08-13T12:00:00.000Z";
    const userId = randomUUID();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const proposalId = randomUUID();
    initial
      .prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'Owner', ?, ?)")
      .run(userId, "migration@example.test", now, now);
    initial
      .prepare("INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Family', ?, ?, ?)")
      .run(familyId, userId, now, now);
    initial
      .prepare("INSERT INTO agent_sessions (id, family_id, created_by_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(sessionId, familyId, userId, now, now);

    initial.exec(`
      DROP TABLE agent_action_proposals;
      CREATE TABLE agent_action_proposals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL CHECK(action_type IN ('ADD_MEMBER')),
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected')),
        result_entity_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        confirmed_at TEXT,
        rejected_at TEXT,
        CHECK(NOT (confirmed_at IS NOT NULL AND rejected_at IS NOT NULL))
      );
    `);
    initial
      .prepare(
        `INSERT INTO agent_action_proposals
         (id, session_id, family_id, created_by_user_id, action_type, payload_json,
          title, summary, warnings_json, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, 'ADD_MEMBER', '{}', 'Legacy', 'Preserve me', '[]', 'pending', ?, ?, ?)`,
      )
      .run(proposalId, sessionId, familyId, userId, now, now, "2026-08-14T12:00:00.000Z");
    initial.prepare("DELETE FROM schema_migrations WHERE version = 3").run();
    initial.close();

    const upgraded = openDatabase({ path: databasePath });
    openDatabases.push(upgraded);
    expect(upgraded.prepare("SELECT action_type, title FROM agent_action_proposals WHERE id = ?").get(proposalId)).toEqual({
      action_type: "ADD_MEMBER",
      title: "Legacy",
    });
    expect(upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 3").get()).toEqual({
      name: "controlled_agent_actions",
    });

    expect(() => upgraded
      .prepare(
        `INSERT INTO agent_action_proposals
         (id, session_id, family_id, created_by_user_id, action_type, payload_json,
          title, summary, warnings_json, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, 'CREATE_RECONNECTION_PLAN', '{}', 'Plan', 'Supported', '[]', 'pending', ?, ?, ?)`,
      )
      .run(randomUUID(), sessionId, familyId, userId, now, now, "2026-08-14T12:00:00.000Z"))
      .not.toThrow();
  });

  it("migration 5 preserves proposals and expands the action constraint without rewriting migration 3", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "family-agent-parity-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "migration.sqlite");
    const initial = openDatabase({ path: databasePath });
    openDatabases.push(initial);
    const now = "2026-08-13T12:00:00.000Z";
    const userId = randomUUID();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const proposalId = randomUUID();
    initial
      .prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'Owner', ?, ?)")
      .run(userId, "parity-migration@example.test", now, now);
    initial
      .prepare("INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Family', ?, ?, ?)")
      .run(familyId, userId, now, now);
    initial
      .prepare("INSERT INTO agent_sessions (id, family_id, created_by_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(sessionId, familyId, userId, now, now);

    initial.exec(`
      DROP TABLE agent_action_proposals;
      CREATE TABLE agent_action_proposals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL CHECK(action_type IN ('ADD_MEMBER', 'CREATE_RECONNECTION_PLAN')),
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected')),
        result_entity_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        confirmed_at TEXT,
        rejected_at TEXT,
        CHECK(NOT (confirmed_at IS NOT NULL AND rejected_at IS NOT NULL))
      );
    `);
    initial
      .prepare(
        `INSERT INTO agent_action_proposals
         (id, session_id, family_id, created_by_user_id, action_type, payload_json,
          title, summary, warnings_json, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, 'ADD_MEMBER', '{}', 'Legacy', 'Preserve me', '[]', 'pending', ?, ?, ?)`,
      )
      .run(proposalId, sessionId, familyId, userId, now, now, "2026-08-14T12:00:00.000Z");
    initial.prepare("DELETE FROM schema_migrations WHERE version = 5").run();
    initial.close();

    const upgraded = openDatabase({ path: databasePath });
    openDatabases.push(upgraded);
    expect(upgraded.prepare("SELECT action_type, title FROM agent_action_proposals WHERE id = ?").get(proposalId)).toEqual({
      action_type: "ADD_MEMBER",
      title: "Legacy",
    });
    expect(upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 5").get()).toEqual({
      name: "agent_family_graph_action_parity",
    });

    for (const actionType of ["UPDATE_MEMBER", "DELETE_MEMBER", "CREATE_RELATIONSHIP", "DELETE_RELATIONSHIP"]) {
      expect(() => upgraded
        .prepare(
          `INSERT INTO agent_action_proposals
           (id, session_id, family_id, created_by_user_id, action_type, payload_json,
            title, summary, warnings_json, status, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, '{}', 'Parity', 'Supported', '[]', 'pending', ?, ?, ?)`,
        )
        .run(randomUUID(), sessionId, familyId, userId, actionType, now, now, "2026-08-14T12:00:00.000Z"))
        .not.toThrow();
    }
  });

  it("migration 6 preserves proposals and accepts every engagement action", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "family-agent-engagement-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "migration.sqlite");
    const initial = openDatabase({ path: databasePath });
    openDatabases.push(initial);
    const now = "2026-08-13T12:00:00.000Z";
    const userId = randomUUID();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const proposalId = randomUUID();
    initial.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'Owner', ?, ?)")
      .run(userId, "engagement-migration@example.test", now, now);
    initial.prepare("INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Family', ?, ?, ?)")
      .run(familyId, userId, now, now);
    initial.prepare("INSERT INTO agent_sessions (id, family_id, created_by_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(sessionId, familyId, userId, now, now);
    initial.prepare(
      `INSERT INTO agent_action_proposals
       (id, session_id, family_id, created_by_user_id, action_type, payload_json,
        title, summary, warnings_json, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, 'ADD_MEMBER', '{}', 'Existing', 'Preserve me', '[]', 'pending', ?, ?, ?)`,
    ).run(proposalId, sessionId, familyId, userId, now, now, "2026-08-14T12:00:00.000Z");
    initial.prepare("DELETE FROM schema_migrations WHERE version = 6").run();
    initial.close();

    const upgraded = openDatabase({ path: databasePath });
    openDatabases.push(upgraded);
    expect(upgraded.prepare("SELECT title FROM agent_action_proposals WHERE id = ?").get(proposalId)).toEqual({ title: "Existing" });
    expect(upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 6").get()).toEqual({
      name: "agent_engagement_action_parity",
    });
    for (const actionType of [
      "CREATE_GATHERING_DRAFT",
      "PREPARE_INVITATION_LINKS",
      "COMPLETE_GATHERING",
      "CREATE_NOTE_MEMORY",
      "DELETE_MEMORY",
      "UPDATE_PLAN_STATUS",
    ]) {
      expect(() => upgraded.prepare(
        `INSERT INTO agent_action_proposals
         (id, session_id, family_id, created_by_user_id, action_type, payload_json,
          title, summary, warnings_json, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, '{}', 'Engagement', 'Supported', '[]', 'pending', ?, ?, ?)`,
      ).run(randomUUID(), sessionId, familyId, userId, actionType, now, now, "2026-08-14T12:00:00.000Z")).not.toThrow();
    }
  });

  it("migration 7 preserves transcript insertion order and supports restorable gathering planners", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "family-agent-message-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "migration.sqlite");
    const initial = openDatabase({ path: databasePath });
    openDatabases.push(initial);
    const now = "2026-08-13T12:00:00.000Z";
    const userId = randomUUID();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    initial.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'Owner', ?, ?)")
      .run(userId, "message-migration@example.test", now, now);
    initial.prepare("INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Family', ?, ?, ?)")
      .run(familyId, userId, now, now);
    initial.prepare("INSERT INTO agent_sessions (id, family_id, created_by_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(sessionId, familyId, userId, now, now);

    initial.exec(`
      DROP TABLE agent_messages;
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        kind TEXT NOT NULL CHECK(kind IN ('message', 'clarification', 'proposal', 'result')),
        content_text TEXT NOT NULL CHECK(length(content_text) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL
      );
    `);
    // UUID sort order intentionally opposes insertion order; equal timestamps
    // must still restore as user then assistant.
    initial.prepare(
      "INSERT INTO agent_messages (id, session_id, role, kind, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("ffffffff-ffff-4fff-8fff-ffffffffffff", sessionId, "user", "message", "First", now);
    initial.prepare(
      "INSERT INTO agent_messages (id, session_id, role, kind, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("00000000-0000-4000-8000-000000000000", sessionId, "assistant", "clarification", "Second", now);
    initial.prepare("DELETE FROM schema_migrations WHERE version = 7").run();
    initial.close();

    const upgraded = openDatabase({ path: databasePath });
    openDatabases.push(upgraded);
    expect(upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 7").get()).toEqual({
      name: "agent_gathering_planner_messages",
    });
    expect(
      upgraded
        .prepare("SELECT role, content_text, message_order, payload_json FROM agent_messages ORDER BY message_order")
        .all(),
    ).toEqual([
      { role: "user", content_text: "First", message_order: 1, payload_json: null },
      { role: "assistant", content_text: "Second", message_order: 2, payload_json: null },
    ]);
    expect(() =>
      upgraded
        .prepare(
          `INSERT INTO agent_messages
           (id, session_id, role, kind, content_text, payload_json, message_order, created_at)
           VALUES (?, ?, 'assistant', 'gathering_planner', 'Prepared', '{}', 3, ?)`,
        )
        .run(randomUUID(), sessionId, now),
    ).not.toThrow();
  });

  it("migration 8 preserves v7 gatherings and installs scoped idempotency constraints", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "family-gathering-idempotency-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "migration.sqlite");
    const initial = openDatabase({ path: databasePath });
    openDatabases.push(initial);
    const now = "2026-08-13T12:00:00.000Z";
    const userId = randomUUID();
    const familyId = randomUUID();
    const gatheringId = randomUUID();
    initial.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'hash', 'Owner', ?, ?)",
    ).run(userId, "idempotency-migration@example.test", now, now);
    initial.prepare(
      "INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Family', ?, ?, ?)",
    ).run(familyId, userId, now, now);
    initial.prepare(
      `INSERT INTO gatherings
       (id, family_id, title, purpose, start_at, timezone, location_name, gathering_type,
        status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Existing gathering', 'Preserve this row', ?, 'Asia/Dubai', 'Golden Park',
               'Outdoor activity', 'draft', ?, ?, ?)`,
    ).run(gatheringId, familyId, "2026-09-12T13:00:00.000Z", userId, now, now);
    initial.exec("DROP TABLE gathering_creation_requests;");
    initial.prepare("DELETE FROM schema_migrations WHERE version = 8").run();
    initial.close();

    const upgraded = openDatabase({ path: databasePath });
    openDatabases.push(upgraded);
    expect(upgraded.prepare("SELECT title FROM gatherings WHERE id = ?").get(gatheringId)).toEqual({
      title: "Existing gathering",
    });
    expect(upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 8").get()).toEqual({
      name: "gathering_creation_idempotency",
    });

    const insertRequest = upgraded.prepare(
      `INSERT INTO gathering_creation_requests
       (family_id, actor_user_id, idempotency_key, payload_hash, gathering_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertRequest.run(familyId, userId, "planner-existing-1", "hash-one", gatheringId, now);
    expect(() => insertRequest.run(familyId, userId, "planner-existing-1", "hash-two", randomUUID(), now)).toThrow();
    expect(() => insertRequest.run(familyId, userId, "planner-existing-2", "hash-one", gatheringId, now)).toThrow();
    expect(() => insertRequest.run(randomUUID(), userId, "planner-missing-family", "hash", randomUUID(), now)).toThrow();

    upgraded.prepare("DELETE FROM gatherings WHERE id = ?").run(gatheringId);
    expect(upgraded.prepare("SELECT COUNT(*) AS count FROM gathering_creation_requests").get()).toEqual({ count: 0 });
  });
});
