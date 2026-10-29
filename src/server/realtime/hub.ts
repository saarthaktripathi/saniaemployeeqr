import "server-only";
import { Client } from "pg";
import { db } from "@/server/db/client";
import { env } from "@/lib/env";
import { logger } from "@/server/logging/logger";

export interface HubEvent {
  id: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

type Subscriber = (event: HubEvent) => void;

const POLL_MS = 5_000;
/** Look-back so rows from transactions that committed out of id order are not missed. */
const LOOKBACK_IDS = 500n;
const SEEN_CAP = 5_000;
/** Release the database connection this long after the last dashboard disconnects. */
const idleStopMs = () => Number(process.env.REALTIME_IDLE_STOP_MS ?? 30_000);

/**
 * Per-process fan-out of outbox events to SSE subscribers.
 * Cross-instance delivery comes from PostgreSQL itself: every instance LISTENs on the
 * same channel and reads the same outbox table, so no in-memory bus is shared between
 * processes. Polling is a safety net when LISTEN is unavailable (e.g. behind a
 * transaction-mode pooler).
 */
class RealtimeHub {
  private subscribers = new Set<Subscriber>();
  private started = false;
  private listener: Client | null = null;
  private highWater = 0n;
  /** Events at or below this id predate the hub; clients get those via Last-Event-ID replay instead. */
  private baseline = 0n;
  private seen = new Set<string>();
  private draining: Promise<void> | null = null;
  private pendingDrain = false;
  private poll: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  listening = false;

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    void this.start();
    return () => {
      this.subscribers.delete(fn);
      if (this.subscribers.size === 0 && !this.idleTimer) {
        this.idleTimer = setTimeout(() => this.stop(), idleStopMs());
        this.idleTimer.unref?.();
      }
    };
  }

  get subscriberCount() {
    return this.subscribers.size;
  }

  private async start() {
    if (this.started) return;
    this.started = true;
    const max = await db.outboxEvent.aggregate({ _max: { id: true } });
    this.highWater = max._max.id ?? 0n;
    this.baseline = this.highWater;
    void this.connect();
    this.poll = setInterval(() => this.drain(), POLL_MS);
    this.poll.unref?.();
  }

  /**
   * With nobody watching, close LISTEN and stop polling so the database can idle
   * (serverless Postgres such as Neon bills/limits compute while connections are active).
   * The next subscriber starts again from the current outbox position.
   */
  private stop() {
    this.idleTimer = null;
    if (this.subscribers.size > 0 || !this.started) return;
    this.started = false;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    const l = this.listener;
    this.listener = null;
    this.listening = false;
    if (l) {
      l.removeAllListeners();
      l.on("error", () => {});
      l.end().catch(() => {});
    }
    this.seen.clear();
  }

  private async connect() {
    if (!this.started) return;
    const client = new Client({ connectionString: env().DATABASE_DIRECT_URL ?? env().DATABASE_URL });
    const retry = () => {
      this.listening = false;
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      client.on("error", () => {}); // late socket errors must not crash the process
      client.end().catch(() => {});
      if (this.started) setTimeout(() => void this.connect(), 5_000).unref?.();
    };
    try {
      client.on("error", (err) => {
        logger.warn("realtime.listener_error", { err });
        retry();
      });
      client.on("notification", (msg) => {
        this.detectSequenceReset(msg.payload);
        this.drain();
      });
      await client.connect();
      await client.query("LISTEN outbox_event");
      if (!this.started) {
        // Stopped while connecting.
        client.removeAllListeners();
        client.on("error", () => {});
        await client.end().catch(() => {});
        return;
      }
      this.listener = client;
      this.listening = true;
      this.drain(); // catch anything committed while disconnected
    } catch (err) {
      logger.warn("realtime.listen_failed", { err });
      retry();
    }
  }

  /**
   * An id far below what we've already seen means the outbox sequence was reset
   * (e.g. database restored from backup); start tracking again from that point.
   */
  private detectSequenceReset(payload: string | undefined) {
    if (!payload || !/^\d{1,19}$/.test(payload)) return;
    const id = BigInt(payload);
    if (id + LOOKBACK_IDS < this.highWater) {
      logger.warn("realtime.sequence_reset", { id: payload, highWater: this.highWater.toString() });
      this.baseline = id - 1n;
      this.highWater = id - 1n;
      this.seen.clear();
    }
  }

  /** Serialized: at most one drain query in flight, with one coalesced follow-up. */
  private drain() {
    if (this.draining) {
      this.pendingDrain = true;
      return;
    }
    this.draining = this.drainOnce()
      .catch((err) => logger.warn("realtime.drain_failed", { err }))
      .finally(() => {
        this.draining = null;
        if (this.pendingDrain) {
          this.pendingDrain = false;
          this.drain();
        }
      });
  }

  private async drainOnce() {
    const from = this.highWater > LOOKBACK_IDS ? this.highWater - LOOKBACK_IDS : 0n;
    const rows = await db.outboxEvent.findMany({
      where: { id: { gt: from }, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      orderBy: { id: "asc" },
      take: 1_000,
    });
    for (const row of rows) {
      const id = row.id.toString();
      // Key on id + commit time: ids can repeat if the sequence is ever reset.
      const key = `${id}@${row.createdAt.getTime()}`;
      if (row.id <= this.baseline || this.seen.has(key)) continue;
      this.remember(key);
      if (row.id > this.highWater) this.highWater = row.id;
      const event: HubEvent = { id, type: row.type, at: row.createdAt.toISOString(), payload: row.payload as Record<string, unknown> };
      for (const fn of this.subscribers) {
        try {
          fn(event);
        } catch (err) {
          logger.warn("realtime.subscriber_failed", { err });
        }
      }
    }
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > SEEN_CAP) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }
  }
}

declare global {
  var __realtimeHub: RealtimeHub | undefined;
}

export function hub(): RealtimeHub {
  if (!globalThis.__realtimeHub) globalThis.__realtimeHub = new RealtimeHub();
  return globalThis.__realtimeHub;
}

/** Events after `afterId` from the last hour, for reconnecting clients (Last-Event-ID). */
export async function replaySince(afterId: bigint, limit = 500): Promise<HubEvent[]> {
  const rows = await db.outboxEvent.findMany({
    where: { id: { gt: afterId }, createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { id: "asc" },
    take: limit,
  });
  return rows.map((r) => ({ id: r.id.toString(), type: r.type, at: r.createdAt.toISOString(), payload: r.payload as Record<string, unknown> }));
}
