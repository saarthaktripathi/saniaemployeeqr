import "server-only";
import sharp, { type Metadata } from "sharp";
import type { Db, Tx } from "@/server/db/client";
import { AppError, notFound } from "@/lib/errors";
import { can } from "@/server/authorization/permissions";
import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_MIN_SIDE, PHOTO_SIZE, PHOTO_THUMB_SIZE } from "@/features/employees/photo";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./employees";

// ---------------------------------------------------------------------------
// Storage. Photos live in their own table (never in the employee row) behind this
// interface, so an object store (R2/S3) can replace it by implementing the same methods.
// ---------------------------------------------------------------------------

export interface StoredPhoto {
  contentType: string;
  data: Buffer;
}

export interface PhotoStore {
  put(client: Db | Tx, employeeId: string, photo: { contentType: string; data: Buffer; thumb: Buffer }): Promise<string>;
  get(client: Db | Tx, key: string, size: "full" | "thumb"): Promise<StoredPhoto | null>;
  remove(client: Db | Tx, key: string): Promise<void>;
}

const DB_PREFIX = "db:";

export const dbPhotoStore: PhotoStore = {
  async put(client, employeeId, photo) {
    const row = { contentType: photo.contentType, data: new Uint8Array(photo.data), thumb: new Uint8Array(photo.thumb) };
    await client.employeePhoto.upsert({ where: { employeeId }, create: { employeeId, ...row }, update: row });
    return `${DB_PREFIX}${employeeId}`;
  },
  async get(client, key, size) {
    if (!key.startsWith(DB_PREFIX)) return null;
    const row = await client.employeePhoto.findUnique({
      where: { employeeId: key.slice(DB_PREFIX.length) },
      select: { contentType: true, data: size === "full", thumb: size === "thumb" },
    });
    const data = size === "full" ? row?.data : row?.thumb;
    return row && data ? { contentType: row.contentType, data: Buffer.from(data) } : null;
  },
  async remove(client, key) {
    if (!key.startsWith(DB_PREFIX)) return;
    await client.employeePhoto.deleteMany({ where: { employeeId: key.slice(DB_PREFIX.length) } });
  },
};

const store = dbPhotoStore;

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

const PIXEL_LIMIT = PHOTO_MAX_SIDE * PHOTO_MAX_SIDE;

/**
 * Validates an uploaded image by its actual content (not the declared type) and
 * re-encodes it to square WebP images. Re-encoding drops EXIF/GPS metadata and any
 * payload hidden in the original file.
 */
export async function processPhoto(input: Buffer): Promise<{ data: Buffer; thumb: Buffer; contentType: string }> {
  if (input.byteLength === 0) throw new AppError("VALIDATION", "The file is empty");
  if (input.byteLength > PHOTO_MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Photo must be 5 MB or smaller");
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: PIXEL_LIMIT }).metadata();
  } catch {
    throw new AppError("VALIDATION", "The file is not a readable image");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new AppError("VALIDATION", "Use a JPEG, PNG or WebP image");
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < PHOTO_MIN_SIDE) throw new AppError("VALIDATION", `Photo must be at least ${PHOTO_MIN_SIDE}×${PHOTO_MIN_SIDE} pixels`);
  if (Math.max(w, h) > PHOTO_MAX_SIDE) throw new AppError("VALIDATION", `Photo must be at most ${PHOTO_MAX_SIDE} pixels on each side`);

  // rotate() applies EXIF orientation before metadata is discarded.
  const base = sharp(input, { limitInputPixels: PIXEL_LIMIT }).rotate();
  try {
    const [data, thumb] = await Promise.all([
      base.clone().resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer(),
      base.clone().resize(PHOTO_THUMB_SIZE, PHOTO_THUMB_SIZE, { fit: "cover", position: "attention" }).webp({ quality: 72 }).toBuffer(),
    ]);
    return { data, thumb, contentType: "image/webp" };
  } catch {
    throw new AppError("VALIDATION", "The image could not be processed. Try another file.");
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/** HR who can edit employees may change photos; creators may set photos on records they created. */
async function findWritable(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  const employee = await db.employee.findUnique({ where: { id }, select: { id: true, createdById: true, archivedAt: true, photoKey: true } });
  const creator = employee && can(actor, "employee:create") && employee.createdById === actor.id;
  if (!creator) await authorize(db, actor, "employee:update", ctx, { type: "employee", id });
  if (!employee) throw notFound("Employee");
  if (employee.archivedAt) throw new AppError("INVALID_STATE", "Archived employees cannot be edited. Unarchive first.");
  return employee;
}

export async function uploadEmployeePhoto(db: Db, actor: Actor, id: string, file: Buffer, ctx: RequestContext) {
  await findWritable(db, actor, id, ctx);
  const photo = await processPhoto(file);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const key = await store.put(tx, id, photo);
    // Photo changes deliberately leave `version` alone, so an open edit form isn't invalidated.
    await tx.employee.update({ where: { id }, data: { photoKey: key, photoUpdatedAt: now, updatedById: actor.id } });
    await recordAudit(tx, ctx, { actor, action: "employee.photo_updated", targetType: "employee", targetId: id });
    await emitEvent(tx, "employee.updated", { employeeId: id });
  });
  return { photoUpdatedAt: now.toISOString(), bytes: photo.data.byteLength };
}

export async function removeEmployeePhoto(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  const employee = await findWritable(db, actor, id, ctx);
  const key = employee.photoKey;
  if (!key) return { removed: false };
  await db.$transaction(async (tx) => {
    await store.remove(tx, key);
    await tx.employee.update({ where: { id }, data: { photoKey: null, photoUpdatedAt: new Date(), updatedById: actor.id } });
    await recordAudit(tx, ctx, { actor, action: "employee.photo_removed", targetType: "employee", targetId: id });
    await emitEvent(tx, "employee.updated", { employeeId: id });
  });
  return { removed: true };
}

export async function getEmployeePhoto(db: Db, actor: Actor, id: string, size: "full" | "thumb", ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx, { type: "employee", id });
  const employee = await db.employee.findUnique({ where: { id }, select: { photoKey: true, photoUpdatedAt: true } });
  const photo = employee?.photoKey ? await store.get(db, employee.photoKey, size) : null;
  if (!photo) throw notFound("Photo");
  return { ...photo, updatedAt: employee?.photoUpdatedAt ?? null };
}

/** Internal read for already-authorized flows (public verification, ID card). Returns a data URL. */
export async function photoDataUrl(db: Db, photoKey: string | null, size: "full" | "thumb" = "full"): Promise<string | null> {
  if (!photoKey) return null;
  const photo = await store.get(db, photoKey, size);
  return photo ? `data:${photo.contentType};base64,${photo.data.toString("base64")}` : null;
}
