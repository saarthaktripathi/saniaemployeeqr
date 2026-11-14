import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/server/db/client";
import { AppError, notFound } from "@/lib/errors";
import { DOCUMENT_MAX_BYTES, documentMetaSchema } from "@/features/directory/schema";
import type { DocumentCategory } from "@/features/employees/labels";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./authorize";

// ---------------------------------------------------------------------------
// Storage. Bytes live in their own table behind this interface, so an object store
// (Cloudflare R2 / S3) can replace it by implementing the same methods.
// ---------------------------------------------------------------------------

export interface DocumentStore {
  put(client: Db | Tx, documentId: string, data: Buffer): Promise<string>;
  get(client: Db | Tx, key: string): Promise<Buffer | null>;
  remove(client: Db | Tx, key: string): Promise<void>;
}

const DB_PREFIX = "db:";

export const dbDocumentStore: DocumentStore = {
  async put(client, documentId, data) {
    await client.employeeDocumentBlob.create({ data: { documentId, data: new Uint8Array(data) } });
    return `${DB_PREFIX}${documentId}`;
  },
  async get(client, key) {
    if (!key.startsWith(DB_PREFIX)) return null;
    const row = await client.employeeDocumentBlob.findUnique({ where: { documentId: key.slice(DB_PREFIX.length) } });
    return row ? Buffer.from(row.data) : null;
  },
  async remove(client, key) {
    if (!key.startsWith(DB_PREFIX)) return;
    await client.employeeDocumentBlob.deleteMany({ where: { documentId: key.slice(DB_PREFIX.length) } });
  },
};

const store = dbDocumentStore;

/** Detects the real file type from its first bytes (the declared type is not trusted). */
export function sniffDocumentType(buf: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Keeps a safe display/download name: no paths or control characters, extension matching the real type. */
export function safeFileName(name: string, contentType: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .trim()
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .slice(0, 150);
  return `${base || "document"}.${EXTENSIONS[contentType] ?? "bin"}`;
}

export interface DocumentRow {
  id: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  notes: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export async function listDocuments(db: Db, actor: Actor, employeeId: string, ctx: RequestContext): Promise<DocumentRow[]> {
  await authorize(db, actor, "document:read", ctx, { type: "employee", id: employeeId });
  const rows = await db.employeeDocument.findMany({
    where: { employeeId },
    orderBy: { uploadedAt: "desc" },
    take: 200,
    include: { uploadedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    fileName: r.fileName,
    contentType: r.contentType,
    size: r.size,
    notes: r.notes,
    uploadedAt: r.uploadedAt.toISOString(),
    uploadedBy: r.uploadedBy?.name ?? null,
  }));
}

/** Stores one PDF/JPEG/PNG/WebP file (≤ 5 MB) for an employee. */
export async function uploadDocument(db: Db, actor: Actor, employeeId: string, rawMeta: unknown, file: Buffer, ctx: RequestContext) {
  await authorize(db, actor, "document:manage", ctx, { type: "employee", id: employeeId });
  const meta = documentMetaSchema.parse(rawMeta);
  if (file.byteLength === 0) throw new AppError("VALIDATION", "The file is empty");
  if (file.byteLength > DOCUMENT_MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Documents must be 5 MB or smaller");
  const contentType = sniffDocumentType(file);
  if (!contentType) throw new AppError("VALIDATION", "Upload a PDF, JPEG, PNG or WebP file");

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) throw notFound("Employee");
    const id = randomUUID();
    await tx.employeeDocument.create({
      data: {
        id,
        employeeId,
        category: meta.category,
        title: meta.title,
        fileName: safeFileName(meta.fileName, contentType),
        contentType,
        size: file.byteLength,
        storageKey: "pending",
        notes: meta.notes,
        uploadedById: actor.id,
      },
    });
    const key = await store.put(tx, id, file);
    await tx.employeeDocument.update({ where: { id }, data: { storageKey: key } });
    await recordAudit(tx, ctx, { actor, action: "document.uploaded", targetType: "employee", targetId: employeeId, metadata: { documentId: id, category: meta.category, size: file.byteLength } });
    await emitEvent(tx, "employee.updated", { employeeId, scope: "document:read" });
    return { id, contentType, size: file.byteLength };
  });
}

/** File bytes for download. Downloads are audited (documents may contain ID proofs). */
export async function getDocumentFile(db: Db, actor: Actor, employeeId: string, documentId: string, ctx: RequestContext) {
  await authorize(db, actor, "document:read", ctx, { type: "employee", id: employeeId });
  const doc = await db.employeeDocument.findFirst({ where: { id: documentId, employeeId }, select: { id: true, fileName: true, contentType: true, storageKey: true, category: true } });
  if (!doc) throw notFound("Document");
  const data = await store.get(db, doc.storageKey);
  if (!data) throw notFound("Document");
  await recordAudit(db, ctx, { actor, action: "document.downloaded", targetType: "employee", targetId: employeeId, metadata: { documentId, category: doc.category } });
  return { fileName: doc.fileName, contentType: doc.contentType, data };
}

export async function deleteDocument(db: Db, actor: Actor, employeeId: string, documentId: string, ctx: RequestContext) {
  await authorize(db, actor, "document:manage", ctx, { type: "employee", id: employeeId });
  await db.$transaction(async (tx) => {
    const doc = await tx.employeeDocument.findFirst({ where: { id: documentId, employeeId }, select: { id: true, storageKey: true, category: true } });
    if (!doc) throw notFound("Document");
    await store.remove(tx, doc.storageKey);
    await tx.employeeDocument.delete({ where: { id: documentId } });
    await recordAudit(tx, ctx, { actor, action: "document.deleted", targetType: "employee", targetId: employeeId, metadata: { documentId, category: doc.category } });
    await emitEvent(tx, "employee.updated", { employeeId, scope: "document:read" });
  });
  return { deleted: true };
}
