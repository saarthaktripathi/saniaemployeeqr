import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getAttendancePolicy, listHolidays } from "@/server/services/attendance-policy";
import { listLeaveTypes } from "@/server/services/leave";
import { listCompanies } from "@/server/services/companies";
import { localDate } from "@/lib/time";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { AttendancePolicyForm, HolidaysManager, LeaveTypesManager } from "@/components/attendance/policy-forms";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Attendance & leave rules" };

export default async function PolicyPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { actor, ctx } = await requirePageActor("policy:manage");
  const sp = await searchParams;
  const policy = await getAttendancePolicy(db);
  const thisYear = Number(localDate(new Date(), policy.timezone).slice(0, 4));
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear;
  const [holidays, types, companies] = await Promise.all([listHolidays(db, `${year}-01-01`, `${year}-12-31`), listLeaveTypes(db, true), listCompanies(db, actor, ctx)]);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow="Attendance Management" title="Rules & Holidays" description="Working hours, grace periods, half and full days, weekly offs, holidays and leave types. Nothing is hard-coded." />
      <AttendanceNav current="/attendance/policy" canPolicy />
      <AttendancePolicyForm
        policy={{
          timezone: policy.timezone,
          shiftStart: policy.shiftStart,
          shiftEnd: policy.shiftEnd,
          graceMinutes: policy.graceMinutes,
          earlyLeaveMinutes: policy.earlyLeaveMinutes,
          fullDayMinutes: policy.fullDayMinutes,
          halfDayMinutes: policy.halfDayMinutes,
          allowMultipleSessions: policy.allowMultipleSessions,
          allowedLocations: policy.allowedLocations,
          weeklyOffDays: policy.weeklyOffDays,
          logoutPolicy: policy.logoutPolicy,
          maxSessionHours: policy.maxSessionHours,
          correctionWindowDays: policy.correctionWindowDays,
        }}
      />
      <HolidaysManager holidays={holidays} companies={companies.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} year={year} />
      <LeaveTypesManager types={types} />
    </div>
  );
}
