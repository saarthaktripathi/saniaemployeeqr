import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmployee, deleteEmployees, importEmployeesCsv, listEmployees } from "@/server/services/employees";
import { getEmployeePhoto, processPhoto, removeEmployeePhoto, uploadEmployeePhoto } from "@/server/services/photos";
import { issueCredential } from "@/server/services/credentials";
import { decryptToken } from "@/server/security/crypto";
import { verifyToken } from "@/server/services/verification";
import { getDashboardStats } from "@/server/services/dashboard";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

const image = (w: number, h: number, format: "jpeg" | "png" | "webp" = "jpeg") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    [format]()
    .toBuffer();

async function tokenFor(employeeId: string) {
  const cred = await db.employeeCredential.findFirstOrThrow({ where: { employeeId, revokedAt: null } });
  return decryptToken(cred.tokenCiphertext!);
}

beforeEach(resetDb);

describe("photo processing", () => {
  it("re-encodes JPEG, PNG and WebP to square WebP with metadata removed", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const input = await sharp(await image(900, 600, format)).withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } }).toBuffer();
      const out = await processPhoto(input);
      const meta = await sharp(out.data).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });
      expect(meta.exif).toBeUndefined();
      expect((await sharp(out.thumb).metadata()).width).toBe(96);
      expect(out.data.byteLength).toBeLessThan(60_000);
    }
  });

  it("rejects non-images, tiny images, oversized files and unsupported formats", async () => {
    await expect(processPhoto(Buffer.from("not an image at all"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(processPhoto(Buffer.alloc(0))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(processPhoto(await image(100, 300))).rejects.toThrow(/at least 128/);
    await expect(processPhoto(Buffer.alloc(6 * 1024 * 1024, 1))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    const gif = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(processPhoto(gif)).rejects.toThrow(/JPEG, PNG or WebP/);
  });
});

describe("employee photos", () => {
  it("stores the photo outside the employee row, serves it to HR and shows it on the directory", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const res = await uploadEmployeePhoto(db, owner, e.id, await image(800, 800), ctx);
    expect(res.bytes).toBeGreaterThan(0);

    const stored = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(stored.photoKey).toBe(`db:${e.id}`);
    expect(stored.version).toBe(1); // photo changes don't invalidate an open edit form
    expect(await db.employeePhoto.count()).toBe(1);

    const thumb = await getEmployeePhoto(db, owner, e.id, "thumb", ctx);
    expect(thumb.contentType).toBe("image/webp");
    expect((await sharp(thumb.data).metadata()).width).toBe(96);

    const list = await listEmployees(db, owner, {}, ctx);
    expect(list.rows[0]).toMatchObject({ photoKey: `db:${e.id}` });
    expect((await db.auditLog.findMany({ where: { targetId: e.id } })).map((a) => a.action)).toContain("employee.photo_updated");
  });

  it("replaces and removes a photo", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await uploadEmployeePhoto(db, owner, e.id, await image(400, 400), ctx);
    const first = (await db.employee.findUniqueOrThrow({ where: { id: e.id } })).photoUpdatedAt!;
    await new Promise((r) => setTimeout(r, 5));
    await uploadEmployeePhoto(db, owner, e.id, await image(600, 300, "png"), ctx);
    const second = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(second.photoUpdatedAt!.getTime()).toBeGreaterThan(first.getTime());
    expect(await db.employeePhoto.count()).toBe(1);

    await expect(removeEmployeePhoto(db, owner, e.id, ctx)).resolves.toEqual({ removed: true });
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).photoKey).toBeNull();
    expect(await db.employeePhoto.count()).toBe(0);
    await expect(getEmployeePhoto(db, owner, e.id, "full", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces permissions: read-only staff cannot upload; creators can set photos on their own records", async () => {
    const owner = await makeUser("OWNER");
    const staff = await makeUser("HR_STAFF");
    const creator = await makeUser("HR_STAFF", ["employee:create"]);
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const img = await image(300, 300);

    await expect(uploadEmployeePhoto(db, staff, e.id, img, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadEmployeePhoto(db, creator, e.id, img, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const own = await createEmployee(db, creator, { ...baseEmployee, firstName: "Own" }, ctx);
    await expect(uploadEmployeePhoto(db, creator, own.id, img, ctx)).resolves.toBeTruthy();
    // Reading photos only needs employee:read.
    await expect(getEmployeePhoto(db, staff, own.id, "thumb", ctx)).resolves.toBeTruthy();
    expect(await db.auditLog.count({ where: { action: "authz.denied" } })).toBeGreaterThanOrEqual(2);
  });

  it("refuses archived employees and cascades the photo when an employee is deleted", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await uploadEmployeePhoto(db, owner, e.id, await image(300, 300), ctx);
    await deleteEmployees(db, owner, { ids: [e.id], reason: "test" }, ctx);
    expect(await db.employeePhoto.count()).toBe(0);

    const a = await createEmployee(db, owner, baseEmployee, ctx);
    await db.employee.update({ where: { id: a.id }, data: { archivedAt: new Date() } });
    await expect(uploadEmployeePhoto(db, owner, a.id, await image(300, 300), ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("photo on public verification", () => {
  it("includes the photo for a valid credential, hides it when revoked or when System Rules turn it off", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await uploadEmployeePhoto(db, owner, e.id, await image(500, 500), ctx);
    await issueCredential(db, owner, e.id, ctx);
    const token = await tokenFor(e.id);

    const view = await verifyToken(db, token, ctx);
    expect(view.status).toBe("VERIFIED");
    expect(view.employee?.photo).toMatch(/^data:image\/webp;base64,/);
    // Never exposes internal identifiers.
    expect(JSON.stringify(view)).not.toContain(e.id);

    await db.companySettings.update({ where: { id: 1 }, data: { publicShowPhoto: false } });
    expect((await verifyToken(db, token, ctx)).employee?.photo).toBeNull();

    await db.companySettings.update({ where: { id: 1 }, data: { publicShowPhoto: true } });
    await db.employeeCredential.updateMany({ where: { employeeId: e.id }, data: { revokedAt: new Date() } });
    const revoked = await verifyToken(db, token, ctx);
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.employee?.photo).toBeNull();
  });

  it("reflects deactivation immediately for the same QR", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await issueCredential(db, owner, e.id, ctx);
    const token = await tokenFor(e.id);
    expect((await verifyToken(db, token, ctx)).status).toBe("VERIFIED");
    await db.employee.update({ where: { id: e.id }, data: { employmentStatus: "INACTIVE" } });
    expect((await verifyToken(db, token, ctx)).status).toBe("INACTIVE");
  });
});

describe("initial employment status and dashboard trend", () => {
  it("creates an employee as inactive when requested, including from CSV", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, { ...baseEmployee, employmentStatus: "INACTIVE" }, ctx);
    expect(e.employmentStatus).toBe("INACTIVE");
    await importEmployeesCsv(db, owner, "firstName,department,jobTitle,employmentStatus\r\nRavi,Ops,Lead,inactive\r\nMeera,Ops,Lead,\r\n", ctx);
    const rows = await db.employee.findMany({ orderBy: { createdAt: "asc" }, select: { firstName: true, employmentStatus: true } });
    expect(rows).toEqual([
      { firstName: "Asha", employmentStatus: "INACTIVE" },
      { firstName: "Ravi", employmentStatus: "INACTIVE" },
      { firstName: "Meera", employmentStatus: "ACTIVE" },
    ]);
    await expect(createEmployee(db, owner, { ...baseEmployee, employmentStatus: "PENDING" }, ctx)).rejects.toThrow();
  });

  it("counts employees added in the last 30 days", async () => {
    const owner = await makeUser("OWNER");
    await createEmployee(db, owner, baseEmployee, ctx);
    const old = await createEmployee(db, owner, { ...baseEmployee, firstName: "Old" }, ctx);
    await db.employee.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect((await getDashboardStats(db, owner, ctx)).newLast30d).toBe(1);
  });
});
