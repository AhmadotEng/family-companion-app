import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { AppDatabase } from "./database.js";
import { HttpError } from "./http.js";

export const SESSION_COOKIE_NAME = "fc_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
}

export interface SessionOptions {
  secureCookies: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        return [[key, decodeURIComponent(value)]];
      } catch {
        return [];
      }
    }),
  );
}

export function readSessionToken(request: Request): string | undefined {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
}

export function createSession(
  database: AppDatabase,
  response: Response,
  userId: string,
  options: SessionOptions,
): void {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  database.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(now.toISOString());
  database
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), userId, hashToken(token), now.toISOString(), expiresAt.toISOString(), now.toISOString());

  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secureCookies,
    path: "/",
    maxAge: SESSION_DURATION_MS,
  });
}

export function revokeSession(database: AppDatabase, request: Request, response: Response, options: SessionOptions): void {
  const token = readSessionToken(request);
  if (token) {
    database
      .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), hashToken(token));
  }
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secureCookies,
    path: "/",
  });
}

export function sessionMiddleware(database: AppDatabase): RequestHandler {
  return (request, response, next) => {
    const token = readSessionToken(request);
    if (!token) {
      next();
      return;
    }

    const now = new Date().toISOString();
    const row = database
      .prepare(
        `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashToken(token), now) as
      | { session_id: string; user_id: string; email: string; display_name: string }
      | undefined;

    if (row) {
      response.locals.auth = {
        sessionId: row.session_id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
      } satisfies AuthContext;
      database.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, row.session_id);
    }
    next();
  };
}

export function requireAuth(response: Response): AuthContext {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth) {
    throw new HttpError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  }
  return auth;
}
