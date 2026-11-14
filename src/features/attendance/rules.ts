/**
 * Pure attendance rules: how a day's sessions, leave and holidays turn into a status.
 * Shared by the employee workspace, HR dashboards and reports (and unit tested on their own).
 */
import { localDate, localMinutes, mergedSeconds, timeToMinutes, weekdayOf } from "@/lib/time";

export interface PolicyRules {
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  earlyLeaveMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  weeklyOffDays: number[];
  maxSessionHours: number;
}

export interface SessionLike {
  punchInAt: Date;
  punchOutAt: Date | null;
  status: "OPEN" | "CLOSED" | "CORRECTED" | "VOIDED";
}

export type DayStatus =
  | "PRESENT"
  | "HALF_DAY"
  | "SHORT"
  | "WORKING"
  | "ABSENT"
  | "NOT_STARTED"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "UPCOMING"
  | "NOT_EMPLOYED";

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  PRESENT: "Present",
  HALF_DAY: "Half day",
  SHORT: "Short hours",
  WORKING: "Working now",
  ABSENT: "Absent",
  NOT_STARTED: "Not punched in",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  UPCOMING: "Upcoming",
  NOT_EMPLOYED: "—",
};

export interface DayInput {
  date: string;
  /** Sessions whose workDate is `date` (any status; voided ones are ignored). */
  sessions: SessionLike[];
  holiday: string | null;
  /** Approved leave covering the date, if any. */
  leave: { half: boolean } | null;
  /** Joining date (YYYY-MM-DD); days before it are NOT_EMPLOYED. */
  joiningDate?: string | null;
  policy: PolicyRules;
  now: Date;
}

export interface DaySummary {
  date: string;
  status: DayStatus;
  workedSeconds: number;
  firstIn: Date | null;
  lastOut: Date | null;
  /** An open session exists (counted until now only while it is not stale). */
  open: boolean;
  /** An open session has run longer than maxSessionHours (missed punch-out). */
  incomplete: boolean;
  late: boolean;
  lateMinutes: number;
  earlyLeave: boolean;
  earlyMinutes: number;
  /** Working day per policy (not a weekly off or holiday). */
  workingDay: boolean;
  onLeave: boolean;
  /** Credit towards attendance %: 1 present, 0.5 half day, 0 otherwise. */
  credit: number;
}

export function isStale(s: SessionLike, policy: Pick<PolicyRules, "maxSessionHours">, now: Date): boolean {
  return s.status === "OPEN" && now.getTime() - s.punchInAt.getTime() > policy.maxSessionHours * 3_600_000;
}

/** Applies the attendance policy to one employee-day. */
export function summarizeDay(input: DayInput): DaySummary {
  const { date, policy, now } = input;
  const today = localDate(now, policy.timezone);
  const sessions = input.sessions.filter((s) => s.status !== "VOIDED").sort((a, b) => a.punchInAt.getTime() - b.punchInAt.getTime());
  const counted = sessions.filter((s) => !isStale(s, policy, now));
  const workedSeconds = mergedSeconds(counted.map((s) => ({ start: s.punchInAt, end: s.punchOutAt })), now);
  const open = sessions.some((s) => s.status === "OPEN");
  const incomplete = sessions.some((s) => isStale(s, policy, now));
  const firstIn = sessions[0]?.punchInAt ?? null;
  const closed = sessions.filter((s) => s.punchOutAt);
  const lastOut = !open && closed.length ? closed.reduce((m, s) => (s.punchOutAt! > m ? s.punchOutAt! : m), closed[0]!.punchOutAt!) : null;
  const weeklyOff = policy.weeklyOffDays.includes(weekdayOf(date));
  const workingDay = !weeklyOff && !input.holiday;

  const start = timeToMinutes(policy.shiftStart);
  const end = timeToMinutes(policy.shiftEnd);
  const lateMinutes = firstIn && workingDay ? Math.max(0, localMinutes(firstIn, policy.timezone) - start) : 0;
  const late = lateMinutes > policy.graceMinutes;
  // Early only when the day's last punch-out is on the same local day (not overnight work).
  const sameDayOut = lastOut && localDate(lastOut, policy.timezone) === date;
  const earlyMinutes = sameDayOut && workingDay ? Math.max(0, end - localMinutes(lastOut, policy.timezone)) : 0;
  const earlyLeave = earlyMinutes > policy.earlyLeaveMinutes;

  const minutes = workedSeconds / 60;
  let status: DayStatus;
  if (input.joiningDate && date < input.joiningDate) status = "NOT_EMPLOYED";
  else if (open && date === today && !incomplete) status = "WORKING";
  else if (input.leave && workingDay && !(input.leave.half && minutes >= policy.halfDayMinutes)) status = "ON_LEAVE";
  else if (minutes >= policy.fullDayMinutes || (input.leave?.half && minutes >= policy.halfDayMinutes)) status = "PRESENT";
  else if (minutes >= policy.halfDayMinutes && minutes > 0) status = "HALF_DAY";
  else if (minutes > 0) status = "SHORT";
  else if (input.holiday) status = "HOLIDAY";
  else if (weeklyOff) status = "WEEKLY_OFF";
  else if (date > today) status = "UPCOMING";
  else if (date === today) status = "NOT_STARTED";
  else status = "ABSENT";

  const credit = status === "PRESENT" || status === "WORKING" ? 1 : status === "HALF_DAY" ? 0.5 : 0;
  return {
    date,
    status,
    workedSeconds,
    firstIn,
    lastOut,
    open,
    incomplete,
    late,
    lateMinutes,
    earlyLeave,
    earlyMinutes,
    workingDay,
    onLeave: Boolean(input.leave) && workingDay,
    credit,
  };
}

export interface PeriodStats {
  workingDays: number;
  present: number;
  halfDays: number;
  absent: number;
  leaveDays: number;
  lateDays: number;
  workedSeconds: number;
  /** (present + 0.5 × half days) ÷ (working days elapsed − leave days), as a whole percent; null if no working days yet. */
  attendancePercent: number | null;
}

/** Aggregates day summaries (days after today and before joining are ignored). */
export function periodStats(days: DaySummary[]): PeriodStats {
  const elapsed = days.filter((d) => d.status !== "UPCOMING" && d.status !== "NOT_EMPLOYED");
  const working = elapsed.filter((d) => d.workingDay);
  const leaveDays = working.filter((d) => d.status === "ON_LEAVE").length;
  const present = elapsed.filter((d) => d.status === "PRESENT" || d.status === "WORKING").length;
  const halfDays = elapsed.filter((d) => d.status === "HALF_DAY").length;
  const credit = working.reduce((s, d) => s + d.credit, 0);
  const denominator = working.filter((d) => d.status !== "NOT_STARTED").length - leaveDays;
  return {
    workingDays: working.length,
    present,
    halfDays,
    absent: working.filter((d) => d.status === "ABSENT").length,
    leaveDays,
    lateDays: elapsed.filter((d) => d.late).length,
    workedSeconds: elapsed.reduce((s, d) => s + d.workedSeconds, 0),
    attendancePercent: denominator > 0 ? Math.round((Math.min(credit, denominator) / denominator) * 100) : null,
  };
}
