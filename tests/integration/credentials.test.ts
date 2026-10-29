import { beforeEach, describe, expect, it } from "vitest";
import { createEmployee, changeEmployeeStatus } from "@/server/services/employees";
import { getCredentialPreview, issueCredential, revokeCredential } from "@/server/services/credentials";
import { verifyToken } from "@/server/services/verification";
import { hashToken } from "@/server/security/crypto";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

beforeEach(resetDb);

const tokenOf = (url: string) => url.split("/verify/")[1]!;
let n = 0;
const fresh = () => ({ requestId: "verify", ipHash: `ip-${++n}` });

async function setup() {
  const owner = await makeUser("OWNER");
  const e = await createEmployee(db, owner, { ...baseEmployee, workEmail: "asha@example.com", phone: "+91 90000 11111" }, ctx);
  const issued = await issueCredential(db, owner, e.id, ctx);
  return { owner, e, issued, token: tokenOf(issued.url) };
}

describe("credential issuance", () => {
  it("stores only a hash and ciphertext, and builds a canonical HTTPS URL", async () => {
    const { issued, token } = await setup();
    expect(issued.url).toBe(`https://verify.example.test/verify/${token}`);
    const row = await db.employeeCredential.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("reissue revokes the previous credential atomically", async () => {
    const { owner, e, token } = await setup();
    const second = await issueCredential(db, owner, e.id, ctx);
    expect((await verifyToken(db, token, fresh())).status).toBe("REVOKED");
    expect((await verifyToken(db, tokenOf(second.url), fresh())).status).toBe("VERIFIED");
    expect(await db.employeeCredential.count({ where: { employeeId: e.id, revokedAt: null } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "credential.reissued" } })).toBe(1);
  });

  it("database enforces one live credential per employee", async () => {
    const { e } = await setup();
    await expect(
      db.employeeCredential.create({ data: { employeeId: e.id, tokenHash: "x".repeat(64), expiresAt: new Date(Date.now() + 1e9) } }),
    ).rejects.toThrow();
  });

  it("does not reactivate an inactive employee", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, owner, e.id, { action: "deactivate" }, ctx);
    const issued = await issueCredential(db, owner, e.id, ctx);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).employmentStatus).toBe("INACTIVE");
    expect((await verifyToken(db, tokenOf(issued.url), fresh())).status).toBe("INACTIVE");
  });

  it("refuses archived employees and unauthorized users", async () => {
    const { owner, e } = await setup();
    const staff = await makeUser("HR_STAFF");
    await expect(issueCredential(db, staff, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "left" }, ctx);
    await expect(issueCredential(db, owner, e.id, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("preview decrypts the live credential for authorized users only", async () => {
    const { e, issued } = await setup();
    const staff = await makeUser("HR_STAFF");
    const p = await getCredentialPreview(db, staff, e.id, ctx);
    expect(p?.url).toBe(issued.url);
    expect(p?.qrSvg.startsWith("<svg")).toBe(true);
    await expect(getCredentialPreview(db, { ...staff, role: "NOBODY" as never }, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("public verification", () => {
  it("returns only allow-listed public fields", async () => {
    const { token, e } = await setup();
    const v = await verifyToken(db, token, fresh());
    expect(v.status).toBe("VERIFIED");
    expect(Object.keys(v.employee!).sort()).toEqual(
      ["businessVertical", "department", "displayName", "employeeCode", "employmentStatus", "idExpiresAt", "idIssueDate", "jobTitle", "workLocation"].sort(),
    );
    const json = JSON.stringify(v);
    for (const secret of [e.id, "asha@example.com", "90000", token]) expect(json).not.toContain(secret);
  });

  it("respects public field settings", async () => {
    const { token } = await setup();
    await db.companySettings.update({ where: { id: 1 }, data: { publicShowWorkLocation: false, publicShowBusinessVertical: false } });
    const v = await verifyToken(db, token, fresh());
    expect(v.employee).toMatchObject({ workLocation: null, businessVertical: null, department: "Recruitment" });
  });

  it("reflects deactivation, ID expiry, credential expiry and revocation", async () => {
    const { owner, e, issued, token } = await setup();
    await changeEmployeeStatus(db, owner, e.id, { action: "deactivate" }, ctx);
    expect((await verifyToken(db, token, fresh())).status).toBe("INACTIVE");
    await changeEmployeeStatus(db, owner, e.id, { action: "reactivate" }, ctx);
    expect((await verifyToken(db, token, fresh())).status).toBe("VERIFIED");

    await db.employee.update({ where: { id: e.id }, data: { idIssueDate: new Date("2020-01-01"), idExpiresAt: new Date("2021-01-01") } });
    expect((await verifyToken(db, token, fresh())).status).toBe("ID_EXPIRED");
    await db.employee.update({ where: { id: e.id }, data: { idExpiresAt: new Date("2099-01-01") } });

    await db.employeeCredential.update({ where: { id: issued.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyToken(db, token, fresh())).status).toBe("CREDENTIAL_EXPIRED");
    await db.employeeCredential.update({ where: { id: issued.id }, data: { expiresAt: new Date(Date.now() + 1e9) } });

    await revokeCredential(db, owner, issued.id, { reason: "lost card" }, ctx);
    const revoked = await verifyToken(db, token, fresh());
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.employee).toMatchObject({ department: null, jobTitle: null });
    expect(revoked.credentialExpiresAt).toBeNull();
    await expect(revokeCredential(db, owner, issued.id, { reason: "again" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    // Revocation also discards the stored ciphertext.
    expect((await db.employeeCredential.findUniqueOrThrow({ where: { id: issued.id } })).tokenCiphertext).toBeNull();
  });

  it("archiving revokes the live credential", async () => {
    const { owner, e, token } = await setup();
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "left" }, ctx);
    expect((await verifyToken(db, token, fresh())).status).toBe("REVOKED");
  });

  it("handles unknown and malformed tokens without revealing anything", async () => {
    await setup();
    expect(await verifyToken(db, "A".repeat(43), fresh())).toMatchObject({ status: "UNKNOWN", employee: null });
    for (const bad of ["", "abc", "' OR 1=1 --", "../../../etc/passwd", "A".repeat(10_000)]) {
      expect((await verifyToken(db, bad, fresh())).status).toBe("MALFORMED");
    }
  });

  it("records privacy-conscious verification events", async () => {
    const { token } = await setup();
    await verifyToken(db, token, { requestId: "r", ipHash: "hashed-ip" });
    const ev = await db.verificationEvent.findFirstOrThrow({ where: { result: "VERIFIED" } });
    expect(ev.ipHash).toBe("hashed-ip");
  });

  it("rate-limits verification per client", async () => {
    const { token } = await setup();
    const client = { requestId: "r", ipHash: "abuser" };
    const results = [];
    for (let i = 0; i < 32; i++) results.push((await verifyToken(db, token, client)).status);
    expect(results.slice(0, 30).every((s) => s === "VERIFIED")).toBe(true);
    expect(results.slice(30)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    // Other clients are unaffected.
    expect((await verifyToken(db, token, fresh())).status).toBe("VERIFIED");
  });
});
