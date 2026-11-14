import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { formatClock, formatLongDate } from "@/lib/time";
import { logger } from "@/server/logging/logger";
import { getAttendancePolicy } from "./attendance-policy";
import { notify, usersWithPermission } from "./notifications";
import { sweepTaskDeadlines } from "./tasks";

const MIN_INTERVAL_MS = 10 * 60_000;
let lastRun = 0;
let running: Promise<void> | null = null;

/**
 * Alerts for open attendance sessions that ran past the policy limit (missed punch-outs): to HR
 * attendance managers and to the employee. Idempotent via notification dedupe keys.
 */
export async function sweepIncompleteAttendance(db: Db | Tx): Promise<number> {
  const policy = await getAttendancePolicy(db);
  const cutoff = new Date(Date.now() - policy.maxSessionHours * 3_600_000);
  const stale = await db.attendanceSession.findMany({
    where: { status: "OPEN", punchInAt: { lt: cutoff } },
    select: { id: true, employeeId: true, punchInAt: true, workDate: true, employee: { select: { displayName: true } } },
    take: 500,
  });
  if (stale.length === 0) return 0;
  const hr = await usersWithPermission(db, "attendance:manage");
  const users = await db.user.findMany({ where: { employeeId: { in: stale.map((s) => s.employeeId) }, isActive: true }, select: { id: true, employeeId: true } });
  for (const s of stale) {
    const date = s.workDate.toISOString().slice(0, 10);
    await notify(db, hr, {
      type: "attendance.incomplete",
      title: `Incomplete attendance: ${s.employee.displayName}`,
      body: `Punched in ${formatLongDate(date)} at ${formatClock(s.punchInAt, policy.timezone)} and never punched out.`,
      link: "/attendance?tab=incomplete",
      entityType: "attendance_session",
      entityId: s.id,
      dedupeKey: `incomplete:${s.id}`,
    });
    const own = users.filter((u) => u.employeeId === s.employeeId).map((u) => u.id);
    await notify(db, own, {
      type: "attendance.incomplete_self",
      title: "You are still punched in",
      body: `Since ${formatLongDate(date)} ${formatClock(s.punchInAt, policy.timezone)}. Punch out and request a correction with your real time.`,
      link: "/me",
      entityType: "attendance_session",
      entityId: s.id,
      dedupeKey: `incomplete-self:${s.id}`,
    });
  }
  return stale.length;
}

/** Runs every sweep once, under a cross-instance advisory lock (another instance running = skip). */
export async function runSweeps(db: Db): Promise<{ ran: boolean; tasks: number; attendance: number }> {
  return db.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('sania-sweeps')) AS ok`;
      if (!ok) return { ran: false, tasks: 0, attendance: 0 };
      const tasks = await sweepTaskDeadlines(tx);
      const attendance = await sweepIncompleteAttendance(tx);
      return { ran: true, tasks, attendance };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Opportunistic scheduler: called while people use the app (e.g. when the notification bell loads),
 * at most every 10 minutes per instance. No background timer, so an idle free-tier database can sleep.
 */
export function maybeRunSweeps(db: Db): void {
  if (running || Date.now() - lastRun < MIN_INTERVAL_MS) return;
  lastRun = Date.now();
  running = runSweeps(db)
    .then((r) => {
      if (r.ran && r.tasks + r.attendance > 0) logger.info("sweeps.ran", r);
    })
    .catch((err) => logger.warn("sweeps.failed", { err }))
    .finally(() => {
      running = null;
    });
}
