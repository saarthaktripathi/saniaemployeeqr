import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMyAttendanceMonth, getMyAttendanceToday, punchIn, punchOut } from "@/server/services/attendance";
import { cancelCorrection, correctAttendance, listCorrections, requestCorrection, reviewCorrection } from "@/server/services/attendance-corrections";
import { getAttendanceHistory, getAttendanceOverview, getEmployeeAttendance, getMonthlyReport } from "@/server/services/attendance-hr";
import { addHoliday, deleteHoliday, getAttendancePolicy, updateAttendancePolicy } from "@/server/services/attendance-policy";
import { buildAttendanceExport } from "@/server/services/attendance-export";
import { listMyNotifications } from "@/server/services/notifications";
import { withRls } from "@/server/db/rls";
import { addDays, localDate } from "@/lib/time";
import { toXlsx } from "@/lib/xlsx-writer";
import { ctx, db, makeEmployee, makeEmployeeUser, makeUser, resetDb } from "../support/db";

const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);

async function resetAttendance() {
  await resetDb();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.audit_purge = 'on'`;
    await tx.$executeRawUnsafe(`TRUNCATE "attendance_event", "attendance_correction", "attendance_session", "holiday" CASCADE`);
  });
  await db.attendancePolicy.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      timezone: TZ,
      shiftStart: "09:30",
      shiftEnd: "18:30",
      graceMinutes: 15,
      earlyLeaveMinutes: 15,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      allowMultipleSessions: true,
      allowedLocations: ["OFFICE", "WORK_FROM_HOME", "CLIENT_VISIT"],
      weeklyOffDays: [0],
      logoutPolicy: "WARN",
      maxSessionHours: 16,
      correctionWindowDays: 7,
    },
  });
}

beforeEach(resetAttendance);
afterEach(() => vi.useRealTimers());

async function employee(role: "EMPLOYEE" | "TEAM_MANAGER" = "EMPLOYEE", overrides: Record<string, unknown> = {}) {
  const id = await makeEmployee(overrides);
  return makeEmployeeUser(role, id);
}

/** Inserts a closed session directly (as if worked earlier). */
async function pastSession(employeeId: string, startIso: string, endIso: string | null, location: "OFFICE" | "WORK_FROM_HOME" = "OFFICE") {
  const start = new Date(startIso);
  return db.attendanceSession.create({
    data: {
      employeeId,
      workDate: new Date(`${localDate(start, TZ)}T00:00:00Z`),
      punchInAt: start,
      punchOutAt: endIso ? new Date(endIso) : null,
      status: endIso ? "CLOSED" : "OPEN",
      durationSeconds: endIso ? Math.floor((Date.parse(endIso) - start.getTime()) / 1000) : null,
      location,
    },
  });
}

describe("punch in / punch out", () => {
  it("records server-side timestamps, an immutable event trail and audit entries", async () => {
    const emp = await employee();
    const before = Date.now();
    const session = await punchIn(db, emp, { location: "WORK_FROM_HOME" }, ctx);
    expect(Date.parse(session.punchInAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(session).toMatchObject({ status: "OPEN", location: "WORK_FROM_HOME", workDate: today() });

    const state = await getMyAttendanceToday(db, emp);
    expect(state.open?.id).toBe(session.id);
    expect(state.summary.status).toBe("WORKING");

    const closed = await punchOut(db, emp, {}, ctx);
    expect(closed.status).toBe("CLOSED");
    expect(closed.durationSeconds).toBeGreaterThanOrEqual(0);
    expect((await getMyAttendanceToday(db, emp)).open).toBeNull();

    const events = await db.attendanceEvent.findMany({ where: { employeeId: emp.employeeId! }, orderBy: { id: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["PUNCH_IN", "PUNCH_OUT"]);
    // Append-only: updates and direct deletes are rejected by the database.
    await expect(db.attendanceEvent.update({ where: { id: events[0]!.id }, data: { actorId: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.attendanceEvent.delete({ where: { id: events[0]!.id } })).rejects.toThrow(/append-only/);

    const audits = await db.auditLog.findMany({ where: { action: { startsWith: "attendance.punched" } } });
    expect(audits.map((a) => a.action).sort()).toEqual(["attendance.punched_in", "attendance.punched_out"]);
    expect(await db.outboxEvent.count({ where: { type: "attendance.changed" } })).toBe(2);
  });

  it("ignores client-supplied timestamps and unknown fields", async () => {
    const emp = await employee();
    await expect(punchIn(db, emp, { location: "OFFICE", punchInAt: "2020-01-01T00:00:00Z" }, ctx)).rejects.toThrow();
    await expect(punchIn(db, emp, { location: "MOON" }, ctx)).rejects.toThrow();
  });

  it("prevents duplicate punch-ins, including concurrent ones", async () => {
    const emp = await employee();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => punchIn(db, emp, { location: "OFFICE" }, ctx)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    expect(await db.attendanceSession.count({ where: { employeeId: emp.employeeId!, status: "OPEN" } })).toBe(1);
    await expect(punchIn(db, emp, { location: "OFFICE" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces one open session in the database itself", async () => {
    const emp = await employee();
    await pastSession(emp.employeeId!, new Date(Date.now() - 3600_000).toISOString(), null);
    await expect(pastSession(emp.employeeId!, new Date(Date.now() - 60_000).toISOString(), null)).rejects.toThrow();
  });

  it("rejects punch-out without punch-in, and concurrent punch-outs close once", async () => {
    const emp = await employee();
    await expect(punchOut(db, emp, {}, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await punchIn(db, emp, { location: "OFFICE" }, ctx);
    const results = await Promise.allSettled([punchOut(db, emp, {}, ctx), punchOut(db, emp, {}, ctx)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.attendanceEvent.count({ where: { type: "PUNCH_OUT" } })).toBe(1);
  });

  it("supports multiple sessions per day, or one when the policy says so", async () => {
    const emp = await employee();
    await punchIn(db, emp, { location: "OFFICE" }, ctx);
    await punchOut(db, emp, {}, ctx);
    await punchIn(db, emp, { location: "CLIENT_VISIT" }, ctx);
    await punchOut(db, emp, {}, ctx);
    expect(await db.attendanceSession.count({ where: { employeeId: emp.employeeId! } })).toBe(2);

    const owner = await makeUser("OWNER");
    await updateAttendancePolicy(db, owner, { allowMultipleSessions: false }, ctx);
    await expect(punchIn(db, emp, { location: "OFFICE" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses work locations the policy does not allow, and inactive or unlinked logins", async () => {
    const owner = await makeUser("OWNER");
    const emp = await employee();
    await updateAttendancePolicy(db, owner, { allowedLocations: ["OFFICE"] }, ctx);
    await expect(punchIn(db, emp, { location: "WORK_FROM_HOME" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const hr = await makeUser("HR_ADMIN");
    await expect(punchIn(db, hr, { location: "OFFICE" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.employee.update({ where: { id: emp.employeeId! }, data: { employmentStatus: "INACTIVE" } });
    await expect(punchIn(db, emp, { location: "OFFICE" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("flags sessions longer than the policy limit as needing review and notifies attendance managers", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    await pastSession(emp.employeeId!, new Date(Date.now() - 20 * 3600_000).toISOString(), null);
    const state = await getMyAttendanceToday(db, emp);
    expect(state.open?.stale).toBe(true);
    const overview = await getAttendanceOverview(db, hr, {}, ctx);
    expect(overview.kpis.incomplete).toBe(1);
    expect(overview.incomplete[0]).toMatchObject({ reason: "MISSED_PUNCH_OUT" });

    const closed = await punchOut(db, emp, {}, ctx);
    expect(closed.needsReview).toBe(true);
    const n = await listMyNotifications(db, hr, {});
    expect(n.items.some((i) => i.title.includes("session"))).toBe(true);
  });
});

describe("attendance rules and HR board", () => {
  it("summarises the day board: present, absent, late, leave-free roster of employees with logins", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await employee("EMPLOYEE", { firstName: "Asha", department: "Sales" });
    await employee("EMPLOYEE", { firstName: "Bala", department: "Ops" });
    await makeEmployee({ firstName: "NoLogin" }); // not on the attendance roster
    const day = addDays(today(), -1);
    // Yesterday: Asha late (10:30 IST) for 8h; Bala absent.
    await pastSession(a.employeeId!, `${day}T05:00:00Z`, `${day}T13:30:00Z`);
    const o = await getAttendanceOverview(db, hr, { date: day }, ctx);
    expect(o.kpis.totalEmployees).toBe(2);
    const asha = o.rows.find((r) => r.name.startsWith("Asha"))!;
    const bala = o.rows.find((r) => r.name.startsWith("Bala"))!;
    const yesterdayIsWorking = new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;
    if (yesterdayIsWorking) {
      expect(asha).toMatchObject({ status: "PRESENT", late: true, lateMinutes: 60 });
      expect(bala.status).toBe("ABSENT");
      expect(o.kpis).toMatchObject({ present: 1, absent: 1, late: 1 });
    }
    expect(asha.workedSeconds).toBe(8.5 * 3600);
    const late = await getAttendanceOverview(db, hr, { date: day, tab: "late" }, ctx);
    expect(late.rows.every((r) => r.late)).toBe(true);
    expect((await getAttendanceOverview(db, hr, { date: day, q: "bala" }, ctx)).rows.map((r) => r.name)).toEqual([bala.name]);
    expect((await getAttendanceOverview(db, hr, { date: day, department: "Sales" }, ctx)).total).toBe(1);
  });

  it("counts overlapping time once and shows holidays and weekly offs", async () => {
    const owner = await makeUser("OWNER");
    const emp = await employee();
    const day = addDays(today(), -2);
    await pastSession(emp.employeeId!, `${day}T03:30:00Z`, `${day}T07:30:00Z`);
    await pastSession(emp.employeeId!, `${day}T08:00:00Z`, `${day}T12:00:00Z`, "WORK_FROM_HOME");
    // Overlap is rejected by the database (exclusion constraint) so time can't be double-counted.
    await expect(pastSession(emp.employeeId!, `${day}T07:00:00Z`, `${day}T09:00:00Z`)).rejects.toThrow();
    const hol = addDays(today(), -3);
    await addHoliday(db, owner, { date: hol, name: "Founders Day" }, ctx);
    const month = await getEmployeeAttendance(db, owner, emp.employeeId!, day.slice(0, 7), ctx);
    const d = month.days.find((x) => x.date === day)!;
    expect(d.workedSeconds).toBe(8 * 3600);
    if (hol.slice(0, 7) === day.slice(0, 7)) expect(month.days.find((x) => x.date === hol)!.status).toBe("HOLIDAY");
    await expect(addHoliday(db, owner, { date: hol, name: "Again" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    const h = await db.holiday.findFirstOrThrow();
    await deleteHoliday(db, owner, h.id, ctx);
  });

  it("validates and audits policy changes; only policy managers may change them", async () => {
    const hr = await makeUser("HR_ADMIN");
    const staff = await makeUser("HR_STAFF");
    const emp = await employee();
    await expect(updateAttendancePolicy(db, staff, { graceMinutes: 5 }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateAttendancePolicy(db, emp, { graceMinutes: 5 }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateAttendancePolicy(db, hr, { timezone: "Mars/Base" }, ctx)).rejects.toThrow();
    await expect(updateAttendancePolicy(db, hr, { halfDayMinutes: 600 }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await updateAttendancePolicy(db, hr, { shiftStart: "10:00", weeklyOffDays: [6, 0, 0] }, ctx);
    const p = await getAttendancePolicy(db);
    expect(p).toMatchObject({ shiftStart: "10:00", weeklyOffDays: [0, 6] });
    expect(await db.auditLog.count({ where: { action: "attendance.policy_updated" } })).toBe(1);
  });

  it("builds monthly reports, history and CSV/XLSX exports", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const day = addDays(today(), -1);
    await pastSession(emp.employeeId!, `${day}T04:00:00Z`, `${day}T12:30:00Z`);
    const report = await getMonthlyReport(db, hr, { month: day.slice(0, 7) }, ctx);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.workedSeconds).toBe(8.5 * 3600);
    const history = await getAttendanceHistory(db, hr, { from: addDays(day, -2), to: day }, ctx);
    expect(history.rows.length).toBeGreaterThan(0);
    const table = await buildAttendanceExport(db, hr, { kind: "monthly", month: day.slice(0, 7) }, ctx);
    expect(table.header).toContain("Attendance %");
    const file = toXlsx(table.title, table.header, table.rows);
    expect(file.subarray(0, 2).toString()).toBe("PK"); // a ZIP container
    expect(await db.auditLog.count({ where: { action: "attendance.exported" } })).toBe(1);
  });
});

describe("corrections", () => {
  it("lets an employee request a missed punch-out and HR apply it with before/after history", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const day = addDays(today(), -1);
    const s = await pastSession(emp.employeeId!, `${day}T04:00:00Z`, null);
    const req = await requestCorrection(db, emp, { kind: "CLOSE_SESSION", sessionId: s.id, workDate: day, punchOut: "18:30", reason: "Forgot to punch out" }, ctx);
    await expect(requestCorrection(db, emp, { kind: "CLOSE_SESSION", sessionId: s.id, workDate: day, punchOut: "18:00", reason: "again" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

    const queue = await listCorrections(db, hr, { status: "PENDING" }, ctx);
    expect(queue.items.map((i) => i.id)).toEqual([req.id]);
    await reviewCorrection(db, hr, req.id, { decision: "APPLY" }, ctx);

    const after = await db.attendanceSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("CORRECTED");
    expect(after.punchOutAt!.toISOString()).toBe(`${day}T13:00:00.000Z`); // 18:30 IST
    expect(after.durationSeconds).toBe(9 * 3600);
    const c = await db.attendanceCorrection.findUniqueOrThrow({ where: { id: req.id } });
    expect(c).toMatchObject({ status: "APPLIED", reviewedById: hr.id });
    expect(c.before).toMatchObject({ status: "OPEN", punchOutAt: null });
    expect(await db.attendanceEvent.count({ where: { sessionId: s.id, type: "SESSION_RESOLVED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "attendance.corrected", targetId: emp.employeeId! } })).toBe(1);
    expect((await listMyNotifications(db, emp, {})).items[0]!.title).toMatch(/approved/);
    await expect(reviewCorrection(db, hr, req.id, { decision: "REJECT", note: "late" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("enforces the correction window, ownership and HR-only review", async () => {
    const staff = await makeUser("HR_STAFF");
    const emp = await employee();
    const other = await employee();
    const old = addDays(today(), -30);
    await expect(requestCorrection(db, emp, { kind: "ADD_SESSION", workDate: old, punchIn: "09:30", punchOut: "18:00", reason: "missed" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const day = addDays(today(), -1);
    const theirs = await pastSession(other.employeeId!, `${day}T04:00:00Z`, `${day}T12:00:00Z`);
    await expect(requestCorrection(db, emp, { kind: "VOID_SESSION", sessionId: theirs.id, workDate: day, reason: "not mine" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await requestCorrection(db, emp, { kind: "ADD_SESSION", workDate: day, punchIn: "09:30", punchOut: "13:00", reason: "Forgot both punches" }, ctx);
    await expect(reviewCorrection(db, staff, mine.id, { decision: "APPLY" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewCorrection(db, emp, mine.id, { decision: "APPLY" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewCorrection(db, staff, mine.id, { decision: "REJECT" }, ctx)).rejects.toThrow();
    await cancelCorrection(db, emp, mine.id, ctx);
    await expect(cancelCorrection(db, other, mine.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets HR correct directly; overlapping corrections are rejected", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const day = addDays(today(), -1);
    const added = await correctAttendance(db, hr, { employeeId: emp.employeeId!, kind: "ADD_SESSION", workDate: day, punchIn: "09:30", punchOut: "13:30", reason: "Biometric outage" }, ctx);
    expect(added.sessionId).toBeTruthy();
    await expect(
      correctAttendance(db, hr, { employeeId: emp.employeeId!, kind: "ADD_SESSION", workDate: day, punchIn: "12:00", punchOut: "15:00", reason: "dup" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      correctAttendance(db, hr, { employeeId: emp.employeeId!, kind: "ADD_SESSION", workDate: addDays(today(), 1), punchIn: "09:30", punchOut: "10:00", reason: "future" }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await correctAttendance(db, hr, { employeeId: emp.employeeId!, kind: "VOID_SESSION", sessionId: added.sessionId!, workDate: day, reason: "Entered twice" }, ctx);
    expect((await db.attendanceSession.findUniqueOrThrow({ where: { id: added.sessionId! } })).status).toBe("VOIDED");
    const month = await getMyAttendanceMonth(db, emp, day.slice(0, 7));
    expect(month.days.find((d) => d.date === day)!.workedSeconds).toBe(0);
  });
});

describe("access control (service and database)", () => {
  it("employees only ever see their own attendance; managers their team; HR everyone", async () => {
    const hr = await makeUser("HR_STAFF");
    const bossEmp = await makeEmployee({ firstName: "Boss" });
    const boss = await makeEmployeeUser("TEAM_MANAGER", bossEmp);
    const report = await employee("EMPLOYEE", { firstName: "Report", reportingManagerId: bossEmp });
    const stranger = await employee("EMPLOYEE", { firstName: "Stranger" });
    for (const u of [report, stranger, boss]) {
      await punchIn(db, u, { location: "OFFICE" }, ctx);
    }
    const ids = (u: Parameters<typeof withRls>[1]) => withRls(db, u, async (tx) => (await tx.attendanceSession.findMany({ select: { employeeId: true } })).map((s) => s.employeeId).sort());
    expect(await ids(report)).toEqual([report.employeeId]);
    expect(await ids(boss)).toEqual([bossEmp, report.employeeId].sort());
    expect((await ids(hr)).length).toBe(3);

    // A raw query cannot reach other employees' rows either (RLS, not just service filters).
    const leaked = await withRls(db, report, (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "attendance_session" WHERE "employeeId" = ${stranger.employeeId}::uuid`);
    expect(Number(leaked[0]!.n)).toBe(0);
    // Writing a session for someone else is rejected by the policy.
    await expect(
      withRls(db, report, (tx) => tx.attendanceSession.createMany({ data: [{ employeeId: stranger.employeeId!, workDate: new Date(), punchInAt: new Date(Date.now() - 10 * 86400_000), punchOutAt: new Date(Date.now() - 10 * 86400_000 + 1000), status: "CLOSED", location: "OFFICE" }] })),
    ).rejects.toThrow(/row-level security/);

    await expect(getAttendanceOverview(db, report, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getEmployeeAttendance(db, report, stranger.employeeId!, undefined, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getEmployeeAttendance(db, boss, stranger.employeeId!, undefined, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const team = await getAttendanceOverview(db, boss, {}, ctx);
    expect(team.rows.map((r) => r.employeeId)).toEqual([report.employeeId]);
    expect((await getEmployeeAttendance(db, boss, report.employeeId!, undefined, ctx)).employee.name).toMatch(/Report/);
    expect(await db.auditLog.count({ where: { action: "authz.denied" } })).toBeGreaterThan(0);
  });

  it("delivers attendance events to the employee, their managers and HR only", async () => {
    const bossEmp = await makeEmployee({ firstName: "Boss" });
    const boss = await makeEmployeeUser("TEAM_MANAGER", bossEmp);
    const report = await employee("EMPLOYEE", { reportingManagerId: bossEmp });
    await punchIn(db, report, { location: "OFFICE" }, ctx);
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { type: "attendance.changed" } });
    const payload = ev.payload as { audience: string[]; scope: string };
    expect(payload.audience.sort()).toEqual([boss.id, report.id].sort());
    expect(payload.scope).toBe("attendance:read");
  });
});
