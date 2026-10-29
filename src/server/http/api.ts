import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, httpStatus } from "@/lib/errors";
import { baseUrl } from "@/lib/env";
import { db } from "@/server/db/client";
import { getActorFromHeaders, mfaSetupRequired } from "@/server/auth/session";
import { requestContextFromHeaders } from "@/server/auth/request";
import { logger } from "@/server/logging/logger";
import type { Actor, RequestContext } from "@/server/services/context";

const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
}

export function errorResponse(err: unknown, requestId: string) {
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION",
          message: "Please correct the highlighted fields",
          fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        requestId,
      },
      { status: 422, headers: { "x-request-id": requestId } },
    );
  }
  if (err instanceof AppError) {
    const headers: Record<string, string> = { "x-request-id": requestId };
    if (err.code === "RATE_LIMITED" && typeof err.details?.retryAfter === "number") headers["Retry-After"] = String(err.details.retryAfter);
    return json({ error: { code: err.code, message: err.message, details: err.details }, requestId }, { status: httpStatus[err.code], headers });
  }
  logger.error("api.unhandled", { requestId, err });
  // Never leak internals: generic message plus a correlation id.
  return json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." }, requestId },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}

/** CSRF defence for cookie-authenticated mutations: require a same-origin Origin header. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new URL(baseUrl()).origin;
  if (!origin || origin !== allowed) throw new AppError("FORBIDDEN", "Cross-origin request blocked");
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new AppError("VALIDATION", "Expected application/json");
  const text = await readBounded(req, MAX_JSON_BYTES);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION", "Malformed JSON body");
  }
}

export async function readText(req: NextRequest, max = MAX_UPLOAD_BYTES): Promise<string> {
  return readBounded(req, max);
}

async function readBounded(req: NextRequest, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large");
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface ApiContext<P> {
  req: NextRequest;
  actor: Actor;
  ctx: RequestContext;
  params: P;
}

/**
 * Wraps an authenticated route handler: resolves the actor, enforces MFA policy and
 * same-origin for mutations, and maps errors to safe JSON responses.
 * Permission checks happen in the service layer (single enforcement point).
 */
export function authed<P = Record<string, string>>(handler: (c: ApiContext<P>) => Promise<Response>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const ctx = requestContextFromHeaders(req.headers);
    try {
      assertSameOrigin(req);
      const actor = await getActorFromHeaders(req.headers);
      if (!actor) throw new AppError("UNAUTHENTICATED", "Sign in required");
      if (await mfaSetupRequired(actor)) throw new AppError("FORBIDDEN", "Multi-factor authentication must be enabled first", { mfaRequired: true });
      const res = await handler({ req, actor, ctx, params: await route.params });
      res.headers.set("x-request-id", ctx.requestId);
      return res;
    } catch (err) {
      return errorResponse(err, ctx.requestId);
    }
  };
}

export { db };
