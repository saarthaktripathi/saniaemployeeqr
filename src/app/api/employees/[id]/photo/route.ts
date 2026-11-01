import { AppError } from "@/lib/errors";
import { authed, db, json, readBytes } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { getEmployeePhoto, removeEmployeePhoto, uploadEmployeePhoto } from "@/server/services/photos";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import { PHOTO_MAX_BYTES, photoTypeAllowed } from "@/features/employees/photo";

type P = { id: string };

/** Photo bytes for signed-in HR users. `?size=thumb` returns the 96 px thumbnail. */
export const GET = authed<P>(async ({ req, actor, ctx, params }) => {
  const size = req.nextUrl.searchParams.get("size") === "thumb" ? "thumb" : "full";
  const photo = await getEmployeePhoto(db, actor, uuidParam(params.id), size, ctx);
  const etag = `"${photo.updatedAt?.getTime() ?? 0}-${size}"`;
  const headers = {
    "Content-Type": photo.contentType,
    // Private: never stored by shared caches. URLs carry ?v=<photoUpdatedAt>, so a day is safe.
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), { headers });
});

/** Raw image body (image/jpeg, image/png or image/webp), max 5 MB. */
export const PUT = authed<P>(async ({ req, actor, ctx, params }) => {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!photoTypeAllowed(type)) throw new AppError("VALIDATION", "Use a JPEG, PNG or WebP image");
  await enforceRateLimit(db, "photo", actor.id, RATE_RULES.photoUpload);
  const file = await readBytes(req, PHOTO_MAX_BYTES);
  return json(await uploadEmployeePhoto(db, actor, uuidParam(params.id), file, ctx));
});

export const DELETE = authed<P>(async ({ actor, ctx, params }) => json(await removeEmployeePhoto(db, actor, uuidParam(params.id), ctx)));
