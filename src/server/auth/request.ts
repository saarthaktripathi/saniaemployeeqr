import "server-only";
import { randomUUID } from "node:crypto";
import { hashIp } from "@/server/security/crypto";
import type { RequestContext } from "@/server/services/context";

/**
 * Client IP from proxy headers. Only meaningful behind a trusted reverse proxy
 * (Render/Railway/Vercel/ALB) that overwrites these headers; see SECURITY.md.
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return h.get("x-real-ip") ?? null;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestContextFromHeaders(h: Headers): RequestContext {
  const incoming = h.get("x-request-id");
  return {
    requestId: incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID(),
    ipHash: hashIp(clientIpFromHeaders(h)),
  };
}
