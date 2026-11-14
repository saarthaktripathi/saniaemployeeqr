import { AppError } from "@/lib/errors";
import { authed, db, json, readBytes } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { DOCUMENT_MAX_BYTES } from "@/features/directory/schema";
import { uploadTaskFile } from "@/server/services/task-files";

/**
 * Raw file body (PDF/JPEG/PNG/WebP, max 5 MB). The file name travels URI-encoded in `X-File-Name`;
 * `?assignment=<id>` uploads a deliverable for that assignment, otherwise a brief attachment.
 */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  let fileName: string;
  try {
    fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  } catch {
    throw new AppError("VALIDATION", "Malformed file name");
  }
  const assignment = req.nextUrl.searchParams.get("assignment");
  const file = await readBytes(req, DOCUMENT_MAX_BYTES);
  const target = { taskId: uuidParam(params.id, "Task"), ...(assignment ? { assignmentId: uuidParam(assignment, "Task") } : {}) };
  return json({ file: await uploadTaskFile(db, actor, target, { fileName }, file, ctx) }, { status: 201 });
});
