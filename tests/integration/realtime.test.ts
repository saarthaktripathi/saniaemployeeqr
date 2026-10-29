import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hub, replaySince, type HubEvent } from "@/server/realtime/hub";
import { createEmployee } from "@/server/services/employees";
import { emitEvent } from "@/server/services/outbox";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

beforeEach(resetDb);

const unsubs: (() => void)[] = [];
afterEach(() => unsubs.splice(0).forEach((u) => u()));

function collect(): HubEvent[] {
  const events: HubEvent[] = [];
  unsubs.push(hub().subscribe((e) => events.push(e)));
  return events;
}

async function waitFor(pred: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for condition");
}

describe("real-time hub (LISTEN/NOTIFY + outbox)", () => {
  it("delivers committed events with minimal payloads", async () => {
    const events = collect();
    await waitFor(() => hub().listening);
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await waitFor(() => events.some((x) => x.type === "employee.created"));
    const ev = events.find((x) => x.type === "employee.created")!;
    expect(ev.payload).toEqual({ scope: "employee:read", employeeId: e.id });
    expect(JSON.stringify(ev)).not.toContain("Asha");
  });

  it("never delivers events from rolled-back transactions", async () => {
    const events = collect();
    await waitFor(() => hub().listening);
    await expect(
      db.$transaction(async (tx) => {
        await emitEvent(tx, "employee.updated", { employeeId: "00000000-0000-4000-8000-00000000dead" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    // A committed marker proves the hub was draining during the window.
    await emitEvent(db, "dashboard.changed", {});
    await waitFor(() => events.some((x) => x.type === "dashboard.changed"));
    expect(events.some((x) => x.payload.employeeId === "00000000-0000-4000-8000-00000000dead")).toBe(false);
  });

  it("delivers each event once to every subscriber, in order", async () => {
    const a = collect();
    const b = collect();
    await waitFor(() => hub().listening);
    for (let i = 0; i < 5; i++) await emitEvent(db, "employee.updated", { employeeId: `00000000-0000-4000-8000-00000000000${i}` });
    await waitFor(() => a.length >= 5 && b.length >= 5);
    await new Promise((r) => setTimeout(r, 300));
    const ids = a.map((e) => e.payload.employeeId);
    expect(ids).toEqual([0, 1, 2, 3, 4].map((i) => `00000000-0000-4000-8000-00000000000${i}`));
    expect(b.map((e) => e.id)).toEqual(a.map((e) => e.id));
  });

  it("replays missed events after a given id for reconnecting clients", async () => {
    await emitEvent(db, "employee.updated", { employeeId: "e1" });
    const first = await db.outboxEvent.findFirstOrThrow({ orderBy: { id: "asc" } });
    await emitEvent(db, "employee.updated", { employeeId: "e2" });
    await emitEvent(db, "credential.revoked", { employeeId: "e3" });
    const missed = await replaySince(first.id);
    expect(missed.map((m) => m.payload.employeeId)).toEqual(["e2", "e3"]);
  });

  it("releases its database connection when nobody is subscribed, and restarts on demand", async () => {
    process.env.REALTIME_IDLE_STOP_MS = "200";
    try {
      const unsub = hub().subscribe(() => {});
      await waitFor(() => hub().listening);
      unsub();
      await waitFor(() => !hub().listening, 3000);
      const events = collect();
      await waitFor(() => hub().listening);
      await emitEvent(db, "dashboard.changed", {});
      await waitFor(() => events.some((e) => e.type === "dashboard.changed"));
    } finally {
      delete process.env.REALTIME_IDLE_STOP_MS;
    }
  });

  it("tags audit events with the permission needed to receive them", async () => {
    const events = collect();
    await waitFor(() => hub().listening);
    const owner = await makeUser("OWNER");
    const { recordAudit } = await import("@/server/services/audit");
    await recordAudit(db, ctx, { actor: owner, action: "auth.login.success" });
    await recordAudit(db, ctx, { actor: owner, action: "employee.updated" });
    await waitFor(() => events.filter((e) => e.type === "audit.created").length >= 2);
    const scopes = events.filter((e) => e.type === "audit.created").map((e) => e.payload.scope);
    expect(scopes).toEqual(["audit:read:security", "audit:read"]);
  });
});
