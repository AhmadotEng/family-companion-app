import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppDatabase } from "../database.js";
import { writeAudit } from "../domain.js";
import { asyncRoute, HttpError, parseBody } from "../http.js";
import { loginSchema, registerSchema } from "../schemas.js";
import { createSession, requireAuth, revokeSession, type SessionOptions } from "../security.js";

interface AuthRouterOptions extends SessionOptions {
  bcryptRounds: number;
  rateLimitEnabled: boolean;
}

function authenticationResponse(database: AppDatabase, userId: string) {
  const user = database.prepare("SELECT id, email, display_name FROM users WHERE id = ?").get(userId) as {
    id: string;
    email: string;
    display_name: string;
  };
  const families = database
    .prepare(
      `SELECT f.id, f.name, fu.role, fu.linked_member_id
       FROM family_users fu JOIN families f ON f.id = fu.family_id
       WHERE fu.user_id = ? ORDER BY f.created_at`,
    )
    .all(userId) as Array<{ id: string; name: string; role: string; linked_member_id: string | null }>;

  return {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    families: families.map((family) => ({
      id: family.id,
      name: family.name,
      role: family.role,
      ...(family.linked_member_id ? { linkedMemberId: family.linked_member_id } : {}),
    })),
  };
}

export function createAuthRouter(database: AppDatabase, options: AuthRouterOptions): Router {
  const router = Router();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.rateLimitEnabled ? 20 : 10_000,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many authentication attempts. Try again later." } },
  });

  router.post(
    "/register",
    authLimiter,
    asyncRoute(async (request, response) => {
      const input = parseBody(registerSchema, request.body);
      const existing = database.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(input.email);
      if (existing) {
        throw new HttpError(409, "EMAIL_IN_USE", "An account already exists for this email address.");
      }

      const passwordHash = await bcrypt.hash(input.password, options.bcryptRounds);
      const now = new Date().toISOString();
      const userId = randomUUID();
      const familyId = randomUUID();
      const memberId = randomUUID();

      database.transaction(() => {
        database
          .prepare(
            "INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(userId, input.email, passwordHash, input.displayName, now, now);
        database
          .prepare(
            "INSERT INTO families (id, name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(familyId, input.familyName, userId, now, now);
        database
          .prepare(
            `INSERT INTO family_members
             (id, family_id, user_id, display_name, email, interests_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
          )
          .run(memberId, familyId, userId, input.displayName, input.email, now, now);
        database
          .prepare(
            `INSERT INTO family_users (family_id, user_id, role, linked_member_id, created_at)
             VALUES (?, ?, 'owner', ?, ?)`,
          )
          .run(familyId, userId, memberId, now);
        writeAudit(database, {
          familyId,
          actorUserId: userId,
          action: "family.created",
          entityType: "family",
          entityId: familyId,
        });
      })();

      createSession(database, response, userId, options);
      response.status(201).json(authenticationResponse(database, userId));
    }),
  );

  router.post(
    "/login",
    authLimiter,
    asyncRoute(async (request, response) => {
      const input = parseBody(loginSchema, request.body);
      const user = database
        .prepare("SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE")
        .get(input.email) as { id: string; password_hash: string } | undefined;

      if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
        throw new HttpError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
      }

      createSession(database, response, user.id, options);
      response.json(authenticationResponse(database, user.id));
    }),
  );

  router.post("/logout", (request, response) => {
    revokeSession(database, request, response, options);
    response.status(204).end();
  });

  router.get("/me", (_request, response) => {
    const auth = requireAuth(response);
    response.json(authenticationResponse(database, auth.userId));
  });

  return router;
}
