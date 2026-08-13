import express, { type Express, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { registerAgentRoutes, type AgentProvider } from "./agent.js";
import { openDatabase, type AppDatabase } from "./database.js";
import { registerEngagementRoutes } from "./engagement.js";
import { errorHandler } from "./http.js";
import { createAuthRouter } from "./routes/auth.js";
import { createFamilyRouter } from "./routes/families.js";
import { sessionMiddleware, type AuthContext } from "./security.js";

export interface CreateAppOptions {
  database?: AppDatabase;
  databasePath?: string;
  secureCookies?: boolean;
  bcryptRounds?: number;
  rateLimitEnabled?: boolean;
  production?: boolean;
  agentProvider?: AgentProvider;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  uploadRoot?: string;
  mediaUploadRateLimit?: number;
  mediaUserQuotaBytes?: number;
  mediaFamilyQuotaBytes?: number;
  apiRateLimit?: number;
  agentRateLimit?: number;
  trustProxyHops?: number;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : undefined;
}

function authenticatedRateLimitKey(request: Request, response: Response): string {
  const auth = response.locals.auth as AuthContext | undefined;
  if (auth?.userId) return `user:${auth.userId}`;
  return `ip:${ipKeyGenerator(request.ip || request.socket.remoteAddress || "unknown")}`;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const env = options.env ?? process.env;
  const production = options.production ?? env.NODE_ENV === "production";
  const database = options.database ?? openDatabase({ path: options.databasePath });
  const rateLimitEnabled = options.rateLimitEnabled ?? env.NODE_ENV !== "test";
  const trustProxyHops = options.trustProxyHops ?? nonNegativeInteger(env.TRUST_PROXY_HOPS) ?? (production ? 1 : 0);
  const app = express();

  app.disable("x-powered-by");
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.locals.database = database;
  app.locals.ownsDatabase = !options.database;

  app.use(
    helmet({
      contentSecurityPolicy: production ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "100kb", type: ["application/json", "application/*+json"] }));
  app.use("/api", (_request, response, next) => {
    // Authenticated family data and public capability-token responses must not
    // be retained by shared browsers, proxies, or link-preview caches.
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(sessionMiddleware(database));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitEnabled ? (options.apiRateLimit ?? 240) : 100_000,
      keyGenerator: authenticatedRateLimitKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } },
    }),
  );
  app.put(
    "/api/memories/:memoryId/media",
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitEnabled ? (options.mediaUploadRateLimit ?? 6) : 100_000,
      keyGenerator: authenticatedRateLimitKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "MEDIA_UPLOAD_RATE_LIMITED", message: "Too many media uploads. Try again shortly." } },
    }),
  );

  app.use(
    "/api/auth",
    createAuthRouter(database, {
      bcryptRounds: options.bcryptRounds ?? 12,
      secureCookies: options.secureCookies ?? production,
      rateLimitEnabled,
    }),
  );
  app.use("/api", createFamilyRouter(database));
  registerEngagementRoutes(app, database, {
    ...((options.uploadRoot ?? env.UPLOAD_PATH) ? { uploadRoot: options.uploadRoot ?? env.UPLOAD_PATH } : {}),
    production,
    ...(env.PUBLIC_APP_URL ? { publicAppUrl: env.PUBLIC_APP_URL } : {}),
    mediaUserQuotaBytes: options.mediaUserQuotaBytes ?? positiveInteger(env.MEDIA_USER_QUOTA_BYTES),
    mediaFamilyQuotaBytes: options.mediaFamilyQuotaBytes ?? positiveInteger(env.MEDIA_FAMILY_QUOTA_BYTES),
  });
  app.use(
    "/api/agent",
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitEnabled ? (options.agentRateLimit ?? 12) : 100_000,
      keyGenerator: authenticatedRateLimitKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "AGENT_RATE_LIMITED", message: "Too many agent requests. Try again shortly." } },
    }),
  );
  registerAgentRoutes(app, database, {
    ...(options.agentProvider ? { provider: options.agentProvider } : {}),
    env,
    ...(options.now ? { now: options.now } : {}),
    production,
    ...(env.PUBLIC_APP_URL ? { publicAppUrl: env.PUBLIC_APP_URL } : {}),
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: { code: "API_NOT_FOUND", message: "API endpoint not found." } });
  });
  app.use(errorHandler);

  return app;
}
