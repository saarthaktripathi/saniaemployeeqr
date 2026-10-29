import { authed } from "@/server/http/api";
import { can, type Permission } from "@/server/authorization/permissions";
import { getActorFromHeaders } from "@/server/auth/session";
import { hub, replaySince, type HubEvent } from "@/server/realtime/hub";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;
const REAUTH_MS = 60_000;

/**
 * Server-Sent Events stream of minimal change notifications for the dashboard.
 * Authenticated; each event is filtered by the subscriber's permissions. The
 * session is re-checked periodically so revoked users are disconnected.
 */
export const GET = authed(async ({ req, actor }) => {
  if (!can(actor, "dashboard:read")) throw new AppError("FORBIDDEN", "Not allowed");
  const lastIdHeader = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("lastEventId");
  const lastId = lastIdHeader && /^\d{1,19}$/.test(lastIdHeader) ? BigInt(lastIdHeader) : null;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const timers: { heartbeat?: NodeJS.Timeout; reauth?: NodeJS.Timeout } = {};
      let unsubscribe = () => {};
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const deliver = (e: HubEvent) => {
        const scope = (e.payload.scope as Permission | undefined) ?? "employee:read";
        if (!can(actor, scope)) return;
        const data = {
          type: e.type,
          at: e.at,
          employeeId: e.payload.employeeId ?? null,
          credentialId: e.payload.credentialId ?? null,
        };
        send(`id: ${e.id}\nevent: change\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timers.heartbeat);
        clearInterval(timers.reauth);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      cleanup = close;

      send(`retry: 5000\n\n`);
      unsubscribe = hub().subscribe(deliver);
      if (lastId !== null) {
        const missed = await replaySince(lastId);
        if (missed.length >= 500) send(`event: resync\ndata: {}\n\n`);
        else missed.forEach(deliver);
      }
      send(`event: ready\ndata: {}\n\n`);

      timers.heartbeat = setInterval(() => send(`: keepalive ${Date.now()}\n\n`), HEARTBEAT_MS);
      timers.reauth = setInterval(async () => {
        const still = await getActorFromHeaders(req.headers).catch(() => null);
        if (!still) {
          send(`event: unauthorized\ndata: {}\n\n`);
          close();
        }
      }, REAUTH_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
