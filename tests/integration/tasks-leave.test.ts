import { beforeEach, describe, expect, it } from "vitest";
import { actOnAssignment, addTaskComment, cancelTask, createTask, getMyTasks, getMyTaskStats, getTaskDetail, listTasks, reviewAssignment, updateTask } from "@/server/services/tasks";
import { deleteTaskFile, getTaskFile, uploadTaskFile } from "@/server/services/task-files";
import { getMyProfile } from "@/server/services/me";
import { listAnnouncements } from "@/server/services/announcements";
import { applyLeave, cancelLeave, createLeaveType, decideLeave, getLeaveCalendar, getMyLeave, listLeaveRequests, respondToLeaveClarification, updateLeaveType } from "@/server/services/leave";
import { getMyAttendanceMonth } from "@/server/services/attendance";
import { listMyNotifications, markNotificationsRead, unreadNotificationCount } from "@/server/services/notifications";
import { runSweeps } from "@/server/services/sweeps";
import { sendAnnouncement } from "@/server/services/announcements";
import { withRls } from "@/server/db/rls";
import { addDays, localDate, weekdayOf } from "@/lib/time";
import { ctx, db, makeEmployee, makeEmployeeUser, makeUser, resetDb } from "../support/db";

const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);
/** Next date on or after `from` that is not a Sunday (default weekly off). */
const workday = (from: string) => (weekdayOf(from) === 0 ? addDays(from, 1) : from);

beforeEach(async () => {
  await resetDb();
  await db.attendancePolicy.update({ where: { id: 1 }, data: { timezone: TZ, weeklyOffDays: [0], allowMultipleSessions: true, maxSessionHours: 16 } });
});

const employee = async (role: "EMPLOYEE" | "TEAM_MANAGER" = "EMPLOYEE", overrides: Record<string, unknown> = {}) => makeEmployeeUser(role, await makeEmployee(overrides));
const PDF = Buffer.from("%PDF-1.4\n%test\n");

describe("tasks", () => {
  it("runs the full lifecycle: assign → accept → progress → submit → reject → rework → approve", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const task = await createTask(db, hr, { title: "Prepare onboarding deck", description: "For the new batch", priority: "HIGH", target: "INDIVIDUAL", employeeIds: [emp.employeeId], dueDate: addDays(today(), 3) }, ctx);
    expect(task.code).toMatch(/^TSK-\d{5}$/);

    const mine = await getMyTasks(db, emp);
    expect(mine.items).toHaveLength(1);
    const a = mine.items[0]!.assignmentId;
    expect((await listMyNotifications(db, emp, {})).items[0]!.title).toContain("Prepare onboarding deck");

    await actOnAssignment(db, emp, a, { action: "ACCEPT" }, ctx);
    expect((await actOnAssignment(db, emp, a, { action: "PROGRESS", progress: 40 }, ctx)).status).toBe("IN_PROGRESS");
    await expect(actOnAssignment(db, emp, a, { action: "ACCEPT" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await uploadTaskFile(db, emp, { taskId: task.id, assignmentId: a }, { fileName: "deck.pdf" }, PDF, ctx);
    await actOnAssignment(db, emp, a, { action: "SUBMIT", note: "First draft attached" }, ctx);
    expect((await listMyNotifications(db, hr, {})).items.some((n) => n.title.includes("submitted"))).toBe(true);

    await expect(reviewAssignment(db, hr, a, { decision: "REJECT" }, ctx)).rejects.toThrow(); // needs a note
    await reviewAssignment(db, hr, a, { decision: "REJECT", note: "Add the payroll slide" }, ctx);
    await actOnAssignment(db, emp, a, { action: "SUBMIT" }, ctx);
    await reviewAssignment(db, hr, a, { decision: "APPROVE" }, ctx);
    await expect(reviewAssignment(db, hr, a, { decision: "APPROVE" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const detail = await getTaskDetail(db, emp, task.id);
    expect(detail.assignments[0]).toMatchObject({ status: "APPROVED", progress: 100 });
    expect(detail.assignments[0]!.comments.map((c) => c.body)).toEqual(["First draft attached", "Add the payroll slide"]);
    expect(detail.history.map((h) => h.action)).toEqual(expect.arrayContaining(["created", "accept", "progress", "submit", "rejected", "approved", "uploaded"]));
    expect(await getMyTaskStats(db, emp)).toEqual({ pending: 0, completed: 1, overdue: 0 });
    // History is append-only.
    const h = await db.taskHistory.findFirstOrThrow();
    await expect(db.taskHistory.update({ where: { id: h.id }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    expect(await db.auditLog.count({ where: { action: { in: ["task.created", "task.status_changed", "task.approved", "task.rejected"] } } })).toBeGreaterThanOrEqual(4);
  });

  it("assigns to several people and to a whole department; each assignee sees only their own thread", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await employee("EMPLOYEE", { department: "Finance", firstName: "A" });
    const b = await employee("EMPLOYEE", { department: "Finance", firstName: "B" });
    const c = await employee("EMPLOYEE", { department: "Sales", firstName: "C" });
    const dept = await createTask(db, hr, { title: "Close the books", target: "DEPARTMENT", department: "finance" }, ctx);
    expect(dept.assignees).toBe(2);
    const multi = await createTask(db, hr, { title: "Fire drill", target: "MULTIPLE", employeeIds: [a.employeeId, c.employeeId] }, ctx);

    const aAssign = (await getMyTasks(db, a)).items.find((i) => i.taskId === multi.id)!.assignmentId;
    await addTaskComment(db, a, aAssign, { body: "private note from A" });
    const seenByC = await getTaskDetail(db, c, multi.id);
    expect(seenByC.assignments).toHaveLength(1); // only C's own assignment
    expect(seenByC.assignments[0]!.comments).toHaveLength(0);
    await expect(getTaskDetail(db, b, multi.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned at all
    // HR sees everyone.
    expect((await getTaskDetail(db, hr, multi.id)).assignments).toHaveLength(2);
    // Another employee cannot act on, comment on or review someone else's assignment.
    await expect(actOnAssignment(db, c, aAssign, { action: "ACCEPT" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addTaskComment(db, c, aAssign, { body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reviewAssignment(db, c, aAssign, { decision: "APPROVE" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets team managers assign only within their reporting tree and review their own tasks", async () => {
    const bossEmp = await makeEmployee({ firstName: "Boss" });
    const boss = await makeEmployeeUser("TEAM_MANAGER", bossEmp);
    const report = await employee("EMPLOYEE", { reportingManagerId: bossEmp });
    const stranger = await employee();
    await expect(createTask(db, boss, { title: "Not my team", target: "INDIVIDUAL", employeeIds: [stranger.employeeId] }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createTask(db, boss, { title: "Whole dept", target: "DEPARTMENT", department: "Recruitment" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const t = await createTask(db, boss, { title: "Team sync notes", target: "INDIVIDUAL", employeeIds: [report.employeeId] }, ctx);
    const assign = (await getMyTasks(db, report)).items[0]!.assignmentId;
    await actOnAssignment(db, report, assign, { action: "SUBMIT" }, ctx).catch(() => actOnAssignment(db, report, assign, { action: "START" }, ctx));
    await actOnAssignment(db, report, assign, { action: "SUBMIT" }, ctx);
    await reviewAssignment(db, boss, assign, { decision: "APPROVE" }, ctx);
    const list = await listTasks(db, boss, {}, ctx);
    expect(list.items.map((i) => i.id)).toEqual([t.id]);
    // Plain employees cannot create tasks or list everyone's.
    await expect(createTask(db, report, { title: "Self-assigned", target: "INDIVIDUAL", employeeIds: [report.employeeId] }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listTasks(db, report, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("computes overdue work, sends idempotent reminders and supports edits/cancellation", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const late = await createTask(db, hr, { title: "Quarterly filing", priority: "CRITICAL", target: "INDIVIDUAL", employeeIds: [emp.employeeId], startDate: addDays(today(), -10), dueDate: addDays(today(), -2) }, ctx);
    await createTask(db, hr, { title: "Due tomorrow", target: "INDIVIDUAL", employeeIds: [emp.employeeId], dueDate: addDays(today(), 1) }, ctx);
    const board = await getMyTasks(db, emp, "overdue");
    expect(board.items.map((i) => i.title)).toEqual(["Quarterly filing"]);
    expect((await listTasks(db, hr, { view: "overdue" }, ctx)).items.map((i) => i.id)).toEqual([late.id]);

    const first = await runSweeps(db);
    expect(first.ran).toBe(true);
    const count = await db.notification.count();
    await runSweeps(db);
    expect(await db.notification.count()).toBe(count); // dedupe keys: no duplicate reminders
    const titles = (await listMyNotifications(db, emp, {})).items.map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["Overdue: Quarterly filing", "Due tomorrow: Due tomorrow"]));

    const detail = await getTaskDetail(db, hr, late.id);
    await updateTask(db, hr, late.id, { dueDate: addDays(today(), 5), version: detail.version }, ctx);
    await expect(updateTask(db, hr, late.id, { title: "stale", version: detail.version }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    await cancelTask(db, hr, late.id, { reason: "No longer needed" }, ctx);
    expect((await getMyTasks(db, emp)).items.find((i) => i.taskId === late.id)!.status).toBe("CANCELLED");
  });

  it("checks file types by content and keeps deliverables private to the assignee thread", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await employee();
    const b = await employee();
    const t = await createTask(db, hr, { title: "Upload IDs", target: "MULTIPLE", employeeIds: [a.employeeId, b.employeeId] }, ctx);
    const brief = await uploadTaskFile(db, hr, { taskId: t.id }, { fileName: "../../instructions.pdf" }, PDF, ctx);
    await expect(uploadTaskFile(db, hr, { taskId: t.id }, { fileName: "x.pdf" }, Buffer.from("MZ\x90\x00not a pdf"), ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const aAssign = (await getMyTasks(db, a)).items[0]!.assignmentId;
    const bAssign = (await getMyTasks(db, b)).items[0]!.assignmentId;
    await expect(uploadTaskFile(db, b, { taskId: t.id, assignmentId: aAssign }, { fileName: "x.pdf" }, PDF, ctx)).rejects.toThrow();
    const del = await uploadTaskFile(db, a, { taskId: t.id, assignmentId: aAssign }, { fileName: "id.pdf" }, PDF, ctx);
    expect((await getTaskFile(db, b, t.id, brief.id)).fileName).toBe("instructions.pdf");
    await expect(getTaskFile(db, b, t.id, del.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getTaskFile(db, hr, t.id, del.id)).data.equals(PDF)).toBe(true);
    void bAssign;
  });
});

describe("leave", () => {
  it("applies, counts working days, notifies HR, approves and shows on attendance", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const types = (await getMyLeave(db, emp)).types;
    const casual = types.find((t) => t.code === "CL")!;
    const start = workday(addDays(today(), -3));
    const r = await applyLeave(db, emp, { leaveTypeId: casual.id, startDate: start, endDate: start, reason: "Family function" }, ctx);
    expect(r.days).toBe(1);
    expect((await listMyNotifications(db, hr, {})).items[0]!.title).toContain("applied for casual leave");
    await expect(applyLeave(db, emp, { leaveTypeId: casual.id, startDate: start, endDate: start, reason: "dup" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

    const queue = await listLeaveRequests(db, hr, { status: "PENDING" }, ctx);
    expect(queue.items.map((i) => i.id)).toEqual([r.id]);
    await decideLeave(db, hr, r.id, { decision: "APPROVE" }, ctx);
    const mine = await getMyLeave(db, emp);
    expect(mine.balances.find((b) => b.code === "CL")).toMatchObject({ used: 1, remaining: 11 });
    expect((await listMyNotifications(db, emp, {})).items[0]!.title).toMatch(/approved/);
    const month = await getMyAttendanceMonth(db, emp, start.slice(0, 7));
    expect(month.days.find((d) => d.date === start)!.status).toBe("ON_LEAVE");
    expect(await db.auditLog.count({ where: { action: "leave.approved" } })).toBe(1);
    const cal = await getLeaveCalendar(db, hr, start.slice(0, 7), ctx);
    expect(cal.items.map((i) => i.id)).toEqual([r.id]);
  });

  it("supports clarification, cancellation, half days and quota limits", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    const { types } = await getMyLeave(db, emp);
    const earned = types.find((t) => t.code === "EL")!;
    const sick = types.find((t) => t.code === "SL")!;
    const day = workday(addDays(today(), 7));
    await expect(applyLeave(db, emp, { leaveTypeId: earned.id, startDate: day, endDate: day, halfDay: "FIRST_HALF", reason: "half" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const half = await applyLeave(db, emp, { leaveTypeId: sick.id, startDate: day, endDate: day, halfDay: "FIRST_HALF", reason: "Doctor visit" }, ctx);
    expect(half.days).toBe(0.5);
    await decideLeave(db, hr, half.id, { decision: "CLARIFY", note: "Morning or afternoon?" }, ctx);
    await respondToLeaveClarification(db, emp, half.id, { note: "Morning, 9 to 1" }, ctx);
    expect((await listLeaveRequests(db, hr, { status: "PENDING" }, ctx)).items[0]).toMatchObject({ employeeNote: "Morning, 9 to 1" });
    await cancelLeave(db, emp, half.id, ctx);
    await expect(cancelLeave(db, emp, half.id, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Quota: 15 earned leave days a year.
    const owner = await makeUser("OWNER");
    await updateLeaveType(db, owner, earned.id, { annualQuota: 1 }, ctx);
    const d1 = workday(addDays(today(), 10));
    await applyLeave(db, emp, { leaveTypeId: earned.id, startDate: d1, endDate: d1, reason: "Trip" }, ctx);
    const d2 = workday(addDays(d1, 1));
    await expect(applyLeave(db, emp, { leaveTypeId: earned.id, startDate: d2, endDate: d2, reason: "Trip 2" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("restricts leave data and decisions", async () => {
    const staff = await makeUser("HR_STAFF");
    const a = await employee();
    const b = await employee();
    const { types } = await getMyLeave(db, a);
    const day = workday(addDays(today(), 5));
    const r = await applyLeave(db, a, { leaveTypeId: types[0]!.id, startDate: day, endDate: day, reason: "Personal work" }, ctx);
    await expect(decideLeave(db, staff, r.id, { decision: "APPROVE" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideLeave(db, a, r.id, { decision: "APPROVE" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelLeave(db, b, r.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getMyLeave(db, b)).requests).toHaveLength(0);
    await expect(listLeaveRequests(db, b, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listLeaveRequests(db, staff, {}, ctx)).items).toHaveLength(1); // read-only HR can see
    const seen = await withRls(db, b, (tx) => tx.leaveRequest.count());
    expect(seen).toBe(0);
    await expect(createLeaveType(db, staff, { code: "ML", name: "Marriage leave" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("profile, file removal and reminder sweeps", () => {
  it("shows employees their own record and their manager, nothing sensitive", async () => {
    const boss = await makeEmployee({ firstName: "Priya", jobTitle: "Ops Lead" });
    const emp = await employee("EMPLOYEE", { firstName: "Kiran", reportingManagerId: boss });
    const p = await getMyProfile(db, emp);
    expect(p).toMatchObject({ firstName: "Kiran", reportingManager: { displayName: "Priya Verma", jobTitle: "Ops Lead" }, directReports: 0 });
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["compensation", "documents", "credentials"]));
    await expect(getMyProfile(db, await makeUser("HR_ADMIN"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets uploaders (or HR) remove task files", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await employee();
    const t = await createTask(db, hr, { title: "Upload a photo", target: "INDIVIDUAL", employeeIds: [a.employeeId] }, ctx);
    const assign = (await getMyTasks(db, a)).items[0]!.assignmentId;
    const f = await uploadTaskFile(db, a, { taskId: t.id, assignmentId: assign }, { fileName: "me.pdf" }, PDF, ctx);
    const brief = await uploadTaskFile(db, hr, { taskId: t.id }, { fileName: "brief.pdf" }, PDF, ctx);
    await expect(deleteTaskFile(db, a, t.id, brief.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteTaskFile(db, a, t.id, f.id, ctx);
    await expect(getTaskFile(db, hr, t.id, f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.taskFileBlob.count({ where: { fileId: f.id } })).toBe(0);
  });

  it("alerts HR and the employee once about a missed punch-out", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await employee();
    await db.attendanceSession.create({ data: { employeeId: emp.employeeId!, workDate: new Date(`${addDays(today(), -2)}T00:00:00Z`), punchInAt: new Date(Date.now() - 40 * 3600_000), status: "OPEN", location: "OFFICE" } });
    const r = await runSweeps(db);
    expect(r).toMatchObject({ ran: true, attendance: 1 });
    await runSweeps(db);
    expect((await listMyNotifications(db, hr, {})).items.filter((n) => n.title.startsWith("Incomplete attendance"))).toHaveLength(1);
    expect((await listMyNotifications(db, emp, {})).items.filter((n) => n.title === "You are still punched in")).toHaveLength(1);
  });
});

describe("notifications and announcements", () => {
  it("tracks unread counts, marks only the caller's own notifications, and broadcasts announcements", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await employee("EMPLOYEE", { department: "Ops" });
    const b = await employee("EMPLOYEE", { department: "Sales" });
    const sent = await sendAnnouncement(db, hr, { title: "Office closed Friday", body: "Maintenance work in the building.", audience: { kind: "department", department: "ops" } }, ctx);
    expect(sent.recipients).toBe(1);
    expect(await unreadNotificationCount(db, a)).toBe(1);
    expect(await unreadNotificationCount(db, b)).toBe(0);
    const all = await sendAnnouncement(db, hr, { title: "Holiday list published", body: "See the calendar.", audience: { kind: "all" } }, ctx);
    expect(all.recipients).toBeGreaterThanOrEqual(2);
    const aItems = (await listMyNotifications(db, a, {})).items;
    expect(aItems).toHaveLength(2);
    // b cannot mark a's notifications read.
    expect(await markNotificationsRead(db, b, { ids: aItems.map((n) => n.id) })).toBe(0);
    expect(await markNotificationsRead(db, a, { all: true })).toBe(2);
    expect(await unreadNotificationCount(db, a)).toBe(0);
    await expect(sendAnnouncement(db, a, { title: "Hi all", body: "Spam", audience: { kind: "all" } }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listAnnouncements(db, hr, ctx)).map((x) => x.title)).toEqual(["Holiday list published", "Office closed Friday"]);
    await expect(listAnnouncements(db, a, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
