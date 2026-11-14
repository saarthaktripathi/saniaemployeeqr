import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteTaskFile, getTaskFile } from "@/server/services/task-files";

type P = { id: string; fileId: string };

/** Downloads as an attachment (images inline with ?inline=1), with a locked-down CSP. */
export const GET = authed<P>(async ({ req, actor, params }) => {
  const f = await getTaskFile(db, actor, uuidParam(params.id, "Task"), uuidParam(params.fileId, "File"));
  const inline = req.nextUrl.searchParams.get("inline") === "1" && f.contentType.startsWith("image/");
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
});

export const DELETE = authed<P>(async ({ actor, ctx, params }) => {
  await deleteTaskFile(db, actor, uuidParam(params.id, "Task"), uuidParam(params.fileId, "File"), ctx);
  return json({ ok: true });
});
