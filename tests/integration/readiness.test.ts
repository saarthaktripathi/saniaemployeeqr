import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ready/route";
import { db } from "@/server/db/client";

describe("readiness probe", () => {
  it("reports ready when the database and the row-level-security role are usable", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ready" });
  });

  it("does not leave the pooled connection switched to the RLS role", async () => {
    await GET();
    const [row] = await db.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    expect(row.role).not.toBe("sania_rls");
  });
});
