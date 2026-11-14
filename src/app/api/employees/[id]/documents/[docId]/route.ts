import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteDocument, getDocumentFile } from "@/server/services/documents";

type P = { id: string; docId: string };

/** Downloads the file. `?inline=1` displays images in the browser; PDFs always download. */
export const GET = authed<P>(async ({ req, actor, ctx, params }) => {
  const file = await getDocumentFile(db, actor, uuidParam(params.id), uuidParam(params.docId, "Document"), ctx);
  const inline = req.nextUrl.searchParams.get("inline") === "1" && file.contentType.startsWith("image/");
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      // Sensitive records: never cached, never sniffed, never able to run scripts.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
});

export const DELETE = authed<P>(async ({ actor, ctx, params }) => {
  return json(await deleteDocument(db, actor, uuidParam(params.id), uuidParam(params.docId, "Document"), ctx));
});
