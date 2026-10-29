import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import type { Permission } from "@/server/authorization/permissions";

/**
 * Real-time event schema. Payloads are deliberately minimal (identifiers only):
 * clients refetch authorized data from the API instead of trusting the event.
 */
export type RealtimeEventType =
  | "employee.created"
  | "employee.updated"
  | "employee.status_changed"
  | "credential.issued"
  | "credential.revoked"
  | "dashboard.changed"
  | "audit.created";

export interface RealtimeEventPayload {
  employeeId?: string;
  credentialId?: string;
  auditId?: string;
  /** Permission a subscriber must hold to receive this event. */
  scope?: Permission;
}

/** Writes an outbox row inside the caller's transaction; NOTIFY fires on commit. */
export async function emitEvent(client: Db | Tx, type: RealtimeEventType, payload: RealtimeEventPayload): Promise<void> {
  await client.outboxEvent.create({
    data: { type, payload: { scope: "employee:read", ...payload } as Prisma.InputJsonValue },
  });
}
