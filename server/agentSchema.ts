/**
 * Versioned agent storage schema.
 *
 * Migration 3 deliberately rebuilds the proposal table every time it is
 * applied. That makes upgrading installations which previously created an
 * ADD_MEMBER-only table at route-registration time deterministic, without
 * inspecting sqlite_master SQL text at runtime.
 */
export const AGENT_SCHEMA_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_sessions_family_user_idx
    ON agent_sessions(family_id, created_by_user_id, updated_at);

  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    kind TEXT NOT NULL CHECK(kind IN ('message', 'clarification', 'proposal', 'result')),
    content_text TEXT NOT NULL CHECK(length(content_text) BETWEEN 1 AND 4000),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_messages_session_created_idx
    ON agent_messages(session_id, created_at, id);

  -- This first create also gives fresh databases a source table for the same
  -- deterministic rebuild used by legacy databases.
  CREATE TABLE IF NOT EXISTS agent_action_proposals (
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

  ALTER TABLE agent_action_proposals RENAME TO agent_action_proposals_migration_3_source;
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
  INSERT INTO agent_action_proposals
    (id, session_id, family_id, created_by_user_id, action_type, payload_json,
     title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
     expires_at, confirmed_at, rejected_at)
  SELECT id, session_id, family_id, created_by_user_id, action_type, payload_json,
         title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
         expires_at, confirmed_at, rejected_at
  FROM agent_action_proposals_migration_3_source;
  DROP TABLE agent_action_proposals_migration_3_source;
  CREATE INDEX agent_action_proposals_owner_idx
    ON agent_action_proposals(created_by_user_id, family_id, status);
  CREATE INDEX agent_action_proposals_session_idx
    ON agent_action_proposals(session_id, created_at);
`;

/**
 * Migration 5 expands the immutable action type constraint. Migration 3 may
 * already be recorded in customer databases, so it must never be edited to
 * retrofit new values.
 */
export const AGENT_ACTION_PARITY_MIGRATION_SQL = `
  ALTER TABLE agent_action_proposals RENAME TO agent_action_proposals_migration_5_source;
  CREATE TABLE agent_action_proposals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK(action_type IN (
      'ADD_MEMBER',
      'UPDATE_MEMBER',
      'DELETE_MEMBER',
      'CREATE_RELATIONSHIP',
      'DELETE_RELATIONSHIP',
      'CREATE_RECONNECTION_PLAN'
    )),
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
  INSERT INTO agent_action_proposals
    (id, session_id, family_id, created_by_user_id, action_type, payload_json,
     title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
     expires_at, confirmed_at, rejected_at)
  SELECT id, session_id, family_id, created_by_user_id, action_type, payload_json,
         title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
         expires_at, confirmed_at, rejected_at
  FROM agent_action_proposals_migration_5_source;
  DROP TABLE agent_action_proposals_migration_5_source;
  CREATE INDEX agent_action_proposals_owner_idx
    ON agent_action_proposals(created_by_user_id, family_id, status);
  CREATE INDEX agent_action_proposals_session_idx
    ON agent_action_proposals(session_id, created_at);
`;

/** Migration 6 expands action parity to server-managed engagement commands. */
export const AGENT_ENGAGEMENT_ACTION_PARITY_MIGRATION_SQL = `
  ALTER TABLE agent_action_proposals RENAME TO agent_action_proposals_migration_6_source;
  CREATE TABLE agent_action_proposals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK(action_type IN (
      'ADD_MEMBER',
      'UPDATE_MEMBER',
      'DELETE_MEMBER',
      'CREATE_RELATIONSHIP',
      'DELETE_RELATIONSHIP',
      'CREATE_RECONNECTION_PLAN',
      'CREATE_GATHERING_DRAFT',
      'PREPARE_INVITATION_LINKS',
      'COMPLETE_GATHERING',
      'CREATE_NOTE_MEMORY',
      'DELETE_MEMORY',
      'UPDATE_PLAN_STATUS'
    )),
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
  INSERT INTO agent_action_proposals
    (id, session_id, family_id, created_by_user_id, action_type, payload_json,
     title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
     expires_at, confirmed_at, rejected_at)
  SELECT id, session_id, family_id, created_by_user_id, action_type, payload_json,
         title, summary, warnings_json, status, result_entity_id, created_at, updated_at,
         expires_at, confirmed_at, rejected_at
  FROM agent_action_proposals_migration_6_source;
  DROP TABLE agent_action_proposals_migration_6_source;
  CREATE INDEX agent_action_proposals_owner_idx
    ON agent_action_proposals(created_by_user_id, family_id, status);
  CREATE INDEX agent_action_proposals_session_idx
    ON agent_action_proposals(session_id, created_at);
`;
