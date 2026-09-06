import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  AGENT_ACTION_PARITY_MIGRATION_SQL,
  AGENT_ENGAGEMENT_ACTION_PARITY_MIGRATION_SQL,
  AGENT_GATHERING_PLANNER_MESSAGE_MIGRATION_SQL,
  AGENT_SCHEMA_MIGRATION_SQL,
} from "./agentSchema.js";
import { ENGAGEMENT_SCHEMA_SQL, ENGAGEMENT_SEED_SQL } from "./engagement.js";
import { GATHERING_CREATION_IDEMPOTENCY_MIGRATION_SQL } from "./gatheringIdempotency.js";

export type AppDatabase = Database.Database;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "core_family_platform",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);

      CREATE TABLE families (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE family_members (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        display_name TEXT NOT NULL,
        birth_date TEXT,
        phone TEXT,
        email TEXT,
        interests_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        photo_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(family_id, user_id)
      );
      CREATE INDEX family_members_family_id_idx ON family_members(family_id);

      CREATE TABLE family_users (
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
        linked_member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(family_id, user_id)
      );
      CREATE INDEX family_users_user_id_idx ON family_users(user_id);

      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        source_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
        target_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('parent', 'spouse', 'sibling', 'guardian', 'relative')),
        created_at TEXT NOT NULL,
        CHECK(source_member_id <> target_member_id),
        UNIQUE(family_id, source_member_id, target_member_id, type)
      );
      CREATE INDEX relationships_family_id_idx ON relationships(family_id);
      CREATE INDEX relationships_source_idx ON relationships(source_member_id);
      CREATE INDEX relationships_target_idx ON relationships(target_member_id);

      CREATE TABLE location_consents (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
        recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
        basis TEXT NOT NULL CHECK(basis IN ('self_consent', 'admin_reported')),
        precision TEXT NOT NULL CHECK(precision IN ('emirate', 'city', 'approximate', 'exact')),
        visibility TEXT NOT NULL CHECK(visibility IN ('private', 'family_admin', 'family')),
        granted_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX location_consents_member_id_idx ON location_consents(member_id);

      CREATE TABLE member_locations (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL UNIQUE REFERENCES family_members(id) ON DELETE CASCADE,
        consent_id TEXT NOT NULL REFERENCES location_consents(id),
        source TEXT NOT NULL CHECK(source IN ('manual', 'browser', 'member_shared')),
        precision TEXT NOT NULL CHECK(precision IN ('emirate', 'city', 'approximate', 'exact')),
        visibility TEXT NOT NULL CHECK(visibility IN ('private', 'family_admin', 'family')),
        latitude REAL CHECK(latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
        longitude REAL CHECK(longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
        accuracy_m REAL CHECK(accuracy_m IS NULL OR accuracy_m >= 0),
        emirate TEXT,
        city TEXT,
        captured_at TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX member_locations_family_id_idx ON member_locations(family_id);

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        family_id TEXT REFERENCES families(id) ON DELETE SET NULL,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_family_id_idx ON audit_events(family_id);
      CREATE INDEX audit_events_actor_user_id_idx ON audit_events(actor_user_id);
    `,
  },
  {
    version: 2,
    name: "engagement_core_loop",
    sql: `${ENGAGEMENT_SCHEMA_SQL}\n${ENGAGEMENT_SEED_SQL}`,
  },
  {
    version: 3,
    name: "controlled_agent_actions",
    sql: AGENT_SCHEMA_MIGRATION_SQL,
  },
  {
    version: 4,
    name: "agent_transcript_retention_index",
    sql: "CREATE INDEX IF NOT EXISTS agent_sessions_updated_at_idx ON agent_sessions(updated_at);",
  },
  {
    version: 5,
    name: "agent_family_graph_action_parity",
    sql: AGENT_ACTION_PARITY_MIGRATION_SQL,
  },
  {
    version: 6,
    name: "agent_engagement_action_parity",
    sql: AGENT_ENGAGEMENT_ACTION_PARITY_MIGRATION_SQL,
  },
  {
    version: 7,
    name: "agent_gathering_planner_messages",
    sql: AGENT_GATHERING_PLANNER_MESSAGE_MIGRATION_SQL,
  },
  {
    version: 8,
    name: "gathering_creation_idempotency",
    sql: GATHERING_CREATION_IDEMPOTENCY_MIGRATION_SQL,
  },
];

export interface OpenDatabaseOptions {
  path?: string;
}

export function openDatabase(options: OpenDatabaseOptions = {}): AppDatabase {
  const databasePath = options.path ?? process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "family-companion.sqlite");

  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (databasePath !== ":memory:") {
    database.pragma("journal_mode = WAL");
  }

  migrate(database);
  return database;
}

function migrate(database: AppDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version),
  );

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      applyMigration(migration);
    }
  }
}
