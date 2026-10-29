import "server-only";
import QRCode from "qrcode";
import type { Db } from "@/server/db/client";
import { AppError, notFound } from "@/lib/errors";
import { baseUrl } from "@/lib/env";
import { revokeSchema } from "@/features/employees/schema";
import { credentialState, addDays } from "@/features/employees/rules";
import { decryptToken, encryptToken, generateCredentialToken, hashToken } from "@/server/security/crypto";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./employees";
import { getSettings } from "./settings";

export function verificationUrl(token: string): string {
  return `${baseUrl()}/verify/${token}`;
}

export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0b1f3a", light: "#ffffff" },
  });
}

/**
 * Issues a new credential for an employee, revoking any live one in the same
 * transaction (reissue). Never changes the employee's employment status.
 */
export async function issueCredential(db: Db, actor: Actor, employeeId: string, ctx: RequestContext) {
  await authorize(db, actor, "credential:issue", ctx, { type: "employee", id: employeeId });
  const settings = await getSettings(db);
  const token = generateCredentialToken();
  const now = new Date();

  const credential = await db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, archivedAt: true } });
    if (!employee) throw notFound("Employee");
    if (employee.archivedAt) throw new AppError("INVALID_STATE", "Cannot issue a credential to an archived employee");

    const previous = await tx.employeeCredential.updateMany({
      where: { employeeId, revokedAt: null },
      data: { revokedAt: now, revokedById: actor.id, revokeReason: "Reissued", tokenCiphertext: null },
    });
    const created = await tx.employeeCredential.create({
      data: {
        employeeId,
        tokenHash: hashToken(token),
        tokenCiphertext: encryptToken(token),
        issuedAt: now,
        expiresAt: addDays(now, settings.credentialValidityDays),
        issuedById: actor.id,
      },
      select: { id: true, issuedAt: true, expiresAt: true },
    });
    await recordAudit(tx, ctx, {
      actor,
      action: previous.count ? "credential.reissued" : "credential.issued",
      targetType: "employee",
      targetId: employeeId,
      metadata: { credentialId: created.id, expiresAt: created.expiresAt.toISOString() },
    });
    await emitEvent(tx, "credential.issued", { employeeId, credentialId: created.id });
    return created;
  });
  return { ...credential, url: verificationUrl(token) };
}

export async function revokeCredential(db: Db, actor: Actor, credentialId: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "credential:revoke", ctx, { type: "credential", id: credentialId });
  const { reason } = revokeSchema.parse(rawInput);
  return db.$transaction(async (tx) => {
    const cred = await tx.employeeCredential.findUnique({
      where: { id: credentialId },
      select: { id: true, employeeId: true, revokedAt: true },
    });
    if (!cred) throw notFound("Credential");
    if (cred.revokedAt) throw new AppError("INVALID_STATE", "Credential is already revoked");
    await tx.employeeCredential.update({
      where: { id: credentialId },
      data: { revokedAt: new Date(), revokedById: actor.id, revokeReason: reason, tokenCiphertext: null },
    });
    await recordAudit(tx, ctx, {
      actor,
      action: "credential.revoked",
      targetType: "employee",
      targetId: cred.employeeId,
      metadata: { credentialId, reason },
    });
    await emitEvent(tx, "credential.revoked", { employeeId: cred.employeeId, credentialId });
    return { id: credentialId, employeeId: cred.employeeId };
  });
}

/** Returns the live credential's verification URL and QR for authorized HR display. */
export async function getCredentialPreview(db: Db, actor: Actor, employeeId: string, ctx: RequestContext) {
  await authorize(db, actor, "credential:read", ctx, { type: "employee", id: employeeId });
  const cred = await db.employeeCredential.findFirst({
    where: { employeeId, revokedAt: null },
    select: { id: true, issuedAt: true, expiresAt: true, revokedAt: true, tokenCiphertext: true },
  });
  if (!cred || !cred.tokenCiphertext) return null;
  const url = verificationUrl(decryptToken(cred.tokenCiphertext));
  return {
    id: cred.id,
    issuedAt: cred.issuedAt,
    expiresAt: cred.expiresAt,
    state: credentialState(cred),
    url,
    qrSvg: await renderQrSvg(url),
  };
}
