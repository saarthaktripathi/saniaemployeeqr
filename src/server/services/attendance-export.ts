import "server-only";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { formatClock, formatDuration } from "@/lib/time";
import { LOCATION_LABELS } from "@/features/attendance/schema";
import { DAY_STATUS_LABELS } from "@/features/attendance/rules";
import type { Cell } from "@/lib/xlsx-writer";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { getAttendanceHistory, getAttendanceOverview, getMonthlyReport, type AttendanceRow } from "./attendance-hr";

export interface Table {
  title: string;
  filename: string;
  header: string[];
  rows: Cell[][];
}

const hours = (s: number) => Math.round((s / 3600) * 100) / 100;

function dayCells(r: AttendanceRow, tz: string): Cell[] {
  return [
    r.employeeCode,
    r.name,
    r.department,
    r.designation,
    r.company,
    formatClock(r.firstIn, tz),
    formatClock(r.lastOut, tz),
    formatDuration(r.workedSeconds),
    hours(r.workedSeconds),
    r.location ? LOCATION_LABELS[r.location] : "",
    DAY_STATUS_LABELS[r.status],
    r.late ? `Late by ${r.lateMinutes} min` : "",
    r.earlyLeave ? `Left ${r.earlyMinutes} min early` : "",
  ];
}

const DAY_HEADER = ["Employee ID", "Name", "Department", "Designation", "Company", "Punch in", "Punch out", "Worked", "Worked (hours)", "Location", "Status", "Late", "Early departure"];

/** Builds an attendance export (daily board, history range or monthly report) and audits it. */
export async function buildAttendanceExport(db: Db, actor: Actor, params: Record<string, string>, ctx: RequestContext): Promise<Table> {
  const kind = params.kind ?? "daily";
  let table: Table;
  if (kind === "daily") {
    const all: AttendanceRow[] = [];
    let date = "";
    let tz = "";
    for (let page = 1; page < 400; page++) {
      const o = await getAttendanceOverview(db, actor, { ...params, page }, ctx);
      all.push(...o.rows);
      date = o.date;
      tz = o.timezone;
      if (page * o.pageSize >= o.total) break;
    }
    table = { title: `Attendance ${date}`, filename: `attendance-${date}`, header: DAY_HEADER, rows: all.map((r) => dayCells(r, tz)) };
  } else if (kind === "history") {
    const h = await getAttendanceHistory(db, actor, params, ctx);
    table = {
      title: `Attendance ${h.from} to ${h.to}`,
      filename: `attendance-${h.from}-to-${h.to}`,
      header: ["Date", ...DAY_HEADER],
      rows: h.allRows.map((r) => [r.date, ...dayCells(r, h.timezone)]),
    };
  } else if (kind === "monthly") {
    const m = await getMonthlyReport(db, actor, params, ctx);
    table = {
      title: `Monthly attendance ${m.month}`,
      filename: `attendance-report-${m.month}`,
      header: ["Employee ID", "Name", "Department", "Designation", "Company", "Working days", "Present", "Half days", "Absent", "Leave days", "Late days", "Worked (hours)", "Attendance %"],
      rows: m.rows.map((r) => [r.employeeCode, r.name, r.department, r.designation, r.company, r.workingDays, r.present, r.halfDays, r.absent, r.leaveDays, r.lateDays, hours(r.workedSeconds), r.attendancePercent ?? ""]),
    };
  } else {
    throw new AppError("VALIDATION", "Unknown export");
  }
  await recordAudit(db, ctx, { actor, action: "attendance.exported", targetType: "attendance", metadata: { kind, rows: table.rows.length } });
  return table;
}
