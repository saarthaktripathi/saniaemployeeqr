import type { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { requestContextFromHeaders } from "@/server/auth/request";
import { verifyToken } from "@/server/services/verification";

/** Public JSON verification API (same allow-listed view as the page). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await verifyToken(db, token, requestContextFromHeaders(req.headers));
  const status = view.status === "RATE_LIMITED" ? 429 : view.status === "UNAVAILABLE" ? 503 : 200;
  return Response.json(view, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}
