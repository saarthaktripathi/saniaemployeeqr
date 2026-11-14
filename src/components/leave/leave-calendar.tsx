import { cn } from "@/lib/cn";
import { eachDate, weekdayOf } from "@/lib/time";
import type { LeaveRequestView } from "@/server/services/leave";

/** Month grid listing who is on leave each day (approved solid, pending outlined), with holidays and weekly offs. */
export function LeaveCalendar({ start, end, today, items, holidays, weeklyOffDays }: { start: string; end: string; today: string; items: LeaveRequestView[]; holidays: { date: string; name: string }[]; weeklyOffDays: number[] }) {
  const days = eachDate(start, end);
  const lead = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const holidayOn = new Map(holidays.map((h) => [h.date, h.name]));
  return (
    <div data-testid="leave-calendar">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-subtle uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={i} />
        ))}
        {days.map((d) => {
          const off = weeklyOffDays.includes(weekdayOf(d));
          const on = items.filter((r) => r.startDate <= d && r.endDate >= d);
          return (
            <div key={d} className={cn("min-h-24 rounded-lg border border-border p-1.5 text-xs", off || holidayOn.has(d) ? "bg-navy-100/50" : "bg-white", d === today && "border-primary-500 ring-1 ring-primary-500")}>
              <p className="flex items-center justify-between font-semibold text-ink-muted">
                {Number(d.slice(8))}
                {holidayOn.has(d) && <span className="truncate pl-1 text-[10px] font-medium text-primary-700">{holidayOn.get(d)}</span>}
              </p>
              {!off && (
                <ul className="mt-1 space-y-0.5">
                  {on.slice(0, 4).map((r) => (
                    <li
                      key={r.id}
                      title={`${r.employeeName} · ${r.leaveType.name} (${r.status.toLowerCase()})`}
                      className={cn("truncate rounded px-1 py-0.5 text-[11px]", r.status === "APPROVED" ? "bg-violet-100 font-medium text-violet-700" : "border border-dashed border-warning-700/40 text-warning-700")}
                    >
                      {r.employeeName.split(" ")[0]} · {r.leaveType.code}
                      {r.halfDay !== "NONE" ? " ½" : ""}
                    </li>
                  ))}
                  {on.length > 4 && <li className="text-[10px] text-ink-subtle">+{on.length - 4} more</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-violet-100" /> Approved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded border border-dashed border-warning-700/50" /> Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-navy-100" /> Weekly off / holiday
        </span>
      </p>
    </div>
  );
}
