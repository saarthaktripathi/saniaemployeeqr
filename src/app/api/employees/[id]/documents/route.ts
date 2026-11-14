import { AppError } from "@/lib/errors";
import { authed, db, json, readBytes } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { listDocuments, uploadDocument } from "@/server/services/documents";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import { DOCUMENT_MAX_BYTES, documentTypeAllowed } from "@/features/directory/schema";

type P = { id: string };

export const GET = authed<P>(async ({ actor, ctx, params }) => json({ documents: await listDocuments(db, actor, uuidParam(params.id), ctx) }));

/**
 * Raw file body (PDF, JPEG, PNG or WebP, max 5 MB). Metadata travels in the
 * `X-Document-Meta` header as URI-encoded JSON: { category, title, fileName, notes? }
 * (a header rather than the query string, so names stay out of access logs).
 */
export const POST = authed<P>(async ({ req, actor, ctx, params }) => {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!documentTypeAllowed(type)) throw new AppError("VALIDATION", "Upload a PDF, JPEG, PNG or WebP file");
  let meta: unknown;
  try {
    meta = JSON.parse(decodeURIComponent(req.headers.get("x-document-meta") ?? ""));
  } catch {
    throw new AppError("VALIDATION", "Missing or malformed document details");
  }
  await enforceRateLimit(db, "document", actor.id, RATE_RULES.documentUpload);
  const file = await readBytes(req, DOCUMENT_MAX_BYTES);
  return json({ document: await uploadDocument(db, actor, uuidParam(params.id), meta, file, ctx) }, { status: 201 });
});
