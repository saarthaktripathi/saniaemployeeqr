import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/server/services/context";

const session = vi.hoisted(() => ({ actor: null as Actor | null, mfa: false }));
vi.mock("@/server/auth/session", () => ({
  getActorFromHeaders: async () => session.actor,
  mfaSetupRequired: async () => session.mfa,
}));
vi.mock("@/server/db/client", () => ({ db: {} }));

const { authed, errorResponse, json, readJson, readText } = await import("@/server/http/api");
const { uuidParam } = await import("@/server/http/params");

const ORIGIN = "https://verify.example.test";
const actor: Actor = { id: "u1", email: "o@x", name: "Owner", role: "OWNER", extraPermissions: [], twoFactorEnabled: true };
const req = (init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new NextRequest(`${ORIGIN}/api/x`, { method: init.method ?? "GET", headers: init.headers, body: init.body });
const ok = authed(async ({ actor }) => json({ hello: actor.name }));
const call = (h: typeof ok, r: NextRequest) => h(r, { params: Promise.resolve({}) });

beforeEach(() => {
  session.actor = actor;
  session.mfa = false;
});

describe("authed route wrapper", () => {
  it("returns 401 without a session", async () => {
    session.actor = null;
    const res = await call(ok, req());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("passes the actor and sets no-store + request id", async () => {
    const res = await call(ok, req({ headers: { "x-request-id": "abcdef12-req" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "Owner" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe("abcdef12-req");
  });

  it("blocks cross-origin and origin-less mutations (CSRF)", async () => {
    expect((await call(ok, req({ method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await call(ok, req({ method: "POST" }))).status).toBe(403);
    expect((await call(ok, req({ method: "POST", headers: { origin: ORIGIN } }))).status).toBe(200);
  });

  it("requires MFA enrolment for privileged users when the policy is on", async () => {
    session.mfa = true;
    const res = await call(ok, req());
    expect(res.status).toBe(403);
    expect((await res.json()).error.details).toEqual({ mfaRequired: true });
  });

  it("never leaks internal error details", async () => {
    const boom = authed(async () => {
      throw new Error("relation \"employee\" does not exist at db.internal:5432");
    });
    const res = await call(boom, req());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("db.internal");
    expect(body.requestId).toBeTruthy();
  });
});

describe("error mapping", () => {
  it("maps validation, app and rate-limit errors", async () => {
    const zerr = z.object({ a: z.string() }).safeParse({}).error!;
    const v = errorResponse(zerr, "r1");
    expect(v.status).toBe(422);
    expect((await v.json()).error.fields[0].path).toBe("a");
    const rl = errorResponse(new AppError("RATE_LIMITED", "slow down", { retryAfter: 12 }), "r2");
    expect(rl.status).toBe(429);
    expect(rl.headers.get("retry-after")).toBe("12");
    expect(errorResponse(new AppError("NOT_FOUND", "x"), "r3").status).toBe(404);
  });
});

describe("body parsing limits", () => {
  it("requires JSON content type and valid JSON", async () => {
    await expect(readJson(req({ method: "POST", body: "{}", headers: { "content-type": "text/plain" } }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readJson(req({ method: "POST", body: "{bad", headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readJson(req({ method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } }))).resolves.toEqual({ a: 1 });
  });

  it("rejects oversized bodies", async () => {
    const big = JSON.stringify({ a: "x".repeat(70 * 1024) });
    await expect(readJson(req({ method: "POST", body: big, headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(readText(req({ method: "POST", body: "x".repeat(2000) }), 1000)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("path params", () => {
  it("only accepts UUIDs", () => {
    expect(uuidParam("0b9a1f8e-2c3d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("0b9a1f8e-2c3d-4e5f-8a9b-0c1d2e3f4a5b");
    for (const bad of ["1", "' OR 1=1", "../etc", "0b9a1f8e2c3d4e5f8a9b0c1d2e3f4a5b"]) expect(() => uuidParam(bad)).toThrow(AppError);
  });
});
