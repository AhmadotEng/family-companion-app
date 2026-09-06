import { createHash } from "node:crypto";
import { z } from "zod";
import type { CreateGatheringInput } from "./engagementCommands.js";
import { HttpError } from "./http.js";

/**
 * Keeps retry metadata separate from the gathering itself. The composite key
 * scopes a client token to the authenticated user and family, while the
 * gathering foreign key removes stale retry metadata if its gathering is
 * deleted.
 */
export const GATHERING_CREATION_IDEMPOTENCY_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS gathering_creation_requests (
    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    gathering_id TEXT NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(family_id, actor_user_id, idempotency_key),
    UNIQUE(gathering_id)
  );
`;

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._~-]*$/,
    "Use 8-128 letters, numbers, dots, underscores, tildes, or hyphens.",
  );

export function parseGatheringIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "The Idempotency-Key header is invalid.",
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/**
 * Hash the schema-validated, normalized command rather than the raw JSON.
 * Fixed property ordering makes object key order irrelevant; equivalent
 * offset-aware timestamps are normalized to the same instant.
 */
export function hashGatheringCreationPayload(input: CreateGatheringInput): string {
  const canonicalPayload = {
    title: input.title,
    purpose: input.purpose,
    startAt: new Date(input.startAt).toISOString(),
    timezone: input.timezone,
    locationName: input.locationName,
    notes: input.notes ?? null,
    type: input.type,
  };
  return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}
