import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "The request body is invalid.", result.error.issues);
  }
  return result.data;
}

export function parseParams<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "The request path is invalid.", result.error.issues);
  }
  return result.data;
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { issues: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "The request is invalid.", issues: error.issues },
    });
    return;
  }

  if (typeof error === "object" && error !== null && "type" in error) {
    const parserError = error as { type?: string };
    if (parserError.type === "entity.too.large") {
      response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." } });
      return;
    }
    if (parserError.type === "entity.parse.failed") {
      response.status(400).json({ error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } });
      return;
    }
  }

  console.error("Unhandled server error", error);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}
