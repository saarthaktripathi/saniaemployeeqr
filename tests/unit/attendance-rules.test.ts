import { describe, expect, it } from "vitest";
import { addDays, eachDate, formatDuration, localDate, localMinutes, mergedSeconds, monthBounds, relativeTime, tzOffsetMinutes, weekdayOf, zonedTimeToUtc } from "@/lib/time";
import { periodStats, summarizeDay, type PolicyRules } from "@/features/attendance/rules";
import { correctionSchema, policyUpdateSchema, punchInSchema } from "@/features/attendance/schema";

const policy: PolicyRules = {
  timezone: "Asia/Kolkata",
  shiftStart: "09:30",
  shiftEnd: "18:30",
  graceMinutes: 15,
  earlyLeaveMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  weeklyOffDays: [0],
  maxSessionHours: 16,
};
const ist = (date: string, hhmm: string) => zonedTimeToUtc(date, hhmm, "Asia/Kolkata");
const MON = "2026-11-09"; // a Monday
const NOW = new Date("2026-11-20T12:00:00Z");

describe("time helpers", () => {
  it("converts between local wall-clock time and UTC", () => {
    expect(ist(MON, "09:30").toISOString()).toBe("2026-11-09T04:00:00.000Z");
    expect(localDate(new Date("2026-11-09T19:00:00Z"), "Asia/Kolkata")).toBe("2026-11-10"); // 00:30 IST next day
    expect(localMinutes(new Date("2026-11-09T04:00:00Z"), "Asia/Kolkata")).toBe(570);
    expect(tzOffsetMinutes(new Date(), "Asia/Kolkata")).toBe(330);
    // DST zone: 09:00 in New York in July is 13:00 UTC, in January 14:00 UTC.
    expect(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-05", "09:00", "America/New_York").toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });

  it("does calendar arithmetic on date strings", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(eachDate("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(weekdayOf(MON)).toBe(1);
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("merges overlapping intervals so time is counted once", () => {
    const a = new Date("2026-11-09T04:00:00Z");
    const h = (n: number) => new Date(a.getTime() + n * 3600_000);
    expect(mergedSeconds([{ start: a, end: h(4) }, { start: h(3), end: h(5) }, { start: h(6), end: h(7) }])).toBe(6 * 3600);
    expect(mergedSeconds([{ start: a, end: null }], h(2))).toBe(2 * 3600);
    expect(mergedSeconds([{ start: h(2), end: a }])).toBe(0);
  });

  it("formats durations and relative times", () => {
    expect(formatDuration(8 * 3600 + 5 * 60)).toBe("8h 05m");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(null)).toBe("—");
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe("5 min ago");
  });
});

describe("day rules", () => {
  const day = (sessions: { in: string; out: string | null; status?: "OPEN" | "CLOSED" | "VOIDED" }[], extra: Partial<Parameters<typeof summarizeDay>[0]> = {}) =>
    summarizeDay({
      date: MON,
      sessions: sessions.map((s) => ({ punchInAt: ist(MON, s.in), punchOutAt: s.out ? ist(MON, s.out) : null, status: s.status ?? (s.out ? "CLOSED" : "OPEN") })),
      holiday: null,
      leave: null,
      policy,
      now: NOW,
      ...extra,
    });

  it("classifies full, half and short days", () => {
    expect(day([{ in: "09:30", out: "18:00" }]).status).toBe("PRESENT");
    expect(day([{ in: "09:30", out: "14:00" }]).status).toBe("HALF_DAY");
    expect(day([{ in: "09:30", out: "11:00" }]).status).toBe("SHORT");
    expect(day([]).status).toBe("ABSENT");
  });

  it("applies the grace period and early-departure threshold", () => {
    expect(day([{ in: "09:45", out: "18:30" }])).toMatchObject({ late: false, lateMinutes: 15 });
    expect(day([{ in: "09:46", out: "18:30" }])).toMatchObject({ late: true, lateMinutes: 16 });
    expect(day([{ in: "09:30", out: "18:15" }]).earlyLeave).toBe(false);
    expect(day([{ in: "09:30", out: "18:14" }])).toMatchObject({ earlyLeave: true, earlyMinutes: 16 });
  });

  it("adds multiple sessions (breaks are the gaps) and ignores voided ones", () => {
    const d = day([
      { in: "09:30", out: "13:30" },
      { in: "14:00", out: "18:30" },
      { in: "19:00", out: "23:00", status: "VOIDED" },
    ]);
    expect(d.workedSeconds).toBe(8.5 * 3600);
    expect(d.status).toBe("PRESENT");
  });

  it("never marks approved leave, holidays or weekly offs as absent", () => {
    expect(day([], { leave: { half: false } }).status).toBe("ON_LEAVE");
    expect(day([], { holiday: "Diwali" }).status).toBe("HOLIDAY");
    expect(summarizeDay({ date: "2026-11-08", sessions: [], holiday: null, leave: null, policy, now: NOW }).status).toBe("WEEKLY_OFF");
    // Half-day leave plus half a day's work counts as present.
    expect(day([{ in: "09:30", out: "14:00" }], { leave: { half: true } }).status).toBe("PRESENT");
    expect(day([], { joiningDate: "2026-11-10" }).status).toBe("NOT_EMPLOYED");
  });

  it("treats an open session older than the policy limit as incomplete, not as hours worked", () => {
    const d = day([{ in: "09:30", out: null }]);
    expect(d.incomplete).toBe(true);
    expect(d.workedSeconds).toBe(0);
  });

  it("computes attendance % excluding leave and future days", () => {
    const days = [
      day([{ in: "09:30", out: "18:00" }]),
      day([{ in: "09:30", out: "14:00" }]),
      day([], { leave: { half: false } }),
      day([]),
    ];
    const s = periodStats(days);
    expect(s).toMatchObject({ workingDays: 4, present: 1, halfDays: 1, absent: 1, leaveDays: 1 });
    expect(s.attendancePercent).toBe(50); // (1 + 0.5) / (4 - 1)
  });
});

describe("attendance input validation", () => {
  it("accepts only known locations and no client timestamps", () => {
    expect(punchInSchema.parse({ location: "OFFICE" })).toEqual({ location: "OFFICE" });
    expect(() => punchInSchema.parse({ location: "OFFICE", at: "2020-01-01" })).toThrow();
    expect(() => punchInSchema.parse({ location: "BEACH" })).toThrow();
  });

  it("requires the right fields per correction kind", () => {
    expect(() => correctionSchema.parse({ kind: "ADD_SESSION", workDate: MON, punchIn: "09:30", reason: "missed" })).toThrow();
    expect(() => correctionSchema.parse({ kind: "CLOSE_SESSION", workDate: MON, punchOut: "18:00", reason: "missed" })).toThrow();
    expect(() => correctionSchema.parse({ kind: "ADD_SESSION", workDate: "2026-02-30", punchIn: "09:30", punchOut: "10:00", reason: "x y z" })).toThrow();
    expect(correctionSchema.parse({ kind: "ADD_SESSION", workDate: MON, punchIn: "09:30", punchOut: "18:00", reason: "Biometric down" }).kind).toBe("ADD_SESSION");
  });

  it("validates policy updates", () => {
    expect(() => policyUpdateSchema.parse({ shiftStart: "25:00" })).toThrow();
    expect(() => policyUpdateSchema.parse({ allowedLocations: [] })).toThrow();
    expect(() => policyUpdateSchema.parse({ fullDayMinutes: 300, halfDayMinutes: 400 })).toThrow();
    expect(policyUpdateSchema.parse({ timezone: "Asia/Dubai", logoutPolicy: "BLOCK" })).toEqual({ timezone: "Asia/Dubai", logoutPolicy: "BLOCK" });
  });
});
