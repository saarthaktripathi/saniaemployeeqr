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
  | "employee.deleted"
  | "credential.issued"
  | "credential.revoked"
  | "dashboard.changed"
  | "audit.created"
  | "attendance.changed"
  | "task.changed"
  | "leave.changed"
  | "notification.created";

export interface RealtimeEventPayload {
  employeeId?: string;
  credentialId?: string;
  auditId?: string;
  taskId?: string;
  leaveId?: string;
  /** Permission a subscriber must hold to receive this event. */
  scope?: Permission;
  /**
   * User ids that receive the event regardless of permissions (the employee themselves, their
   * team managers, a notification's recipient). Ids only; no other personal data.
   */
  audience?: string[];
}

/** Writes an outbox row inside the caller's transaction; NOTIFY fires on commit. */
export async function emitEvent(client: Db | Tx, type: RealtimeEventType, payload: RealtimeEventPayload): Promise<void> {
  await client.outboxEvent.create({
    // Events without an audience default to directory readers, as before.
    data: { type, payload: { ...(payload.audience ? {} : { scope: "employee:read" }), ...payload } as Prisma.InputJsonValue },
  });
}
