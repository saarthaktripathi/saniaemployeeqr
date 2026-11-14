"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatLongDate } from "@/lib/time";
import { LOCATION_LABELS, LOCATIONS, LOGOUT_POLICIES, LOGOUT_POLICY_LABELS } from "@/features/attendance/schema";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface PolicyView {
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  earlyLeaveMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  allowMultipleSessions: boolean;
  allowedLocations: string[];
  weeklyOffDays: number[];
  logoutPolicy: string;
  maxSessionHours: number;
  correctionWindowDays: number;
}

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries([...err.fields.map((f) => [f.path, f.message]), ...(err.details?.field ? [[String(err.details.field), err.message]] : [])]));
        toast.error(err.fields[0]?.message ?? err.message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, save };
}

/** Organisation attendance rules (policy:manage). */
export function AttendancePolicyForm({ policy }: { policy: PolicyView }) {
  const [p, setP] = useState(policy);
  const { busy, errors, save } = useSave();
  const set = <K extends keyof PolicyView>(k: K, v: PolicyView[K]) => setP((x) => ({ ...x, [k]: v }));
  const hours = (m: number) => Math.round((m / 60) * 100) / 100;
  return (
    <Card>
      <CardHeader title="Attendance policy" description="Applies to every company in the group. Changes are audited and affect how days are classified from now on." />
      <form
        className="space-y-5 p-5"
        data-testid="policy-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(() => api("/api/attendance/policy", { method: "PATCH", body: p }), "Attendance policy saved");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Time zone" htmlFor="pol-tz" error={errors.timezone} hint="IANA name, e.g. Asia/Kolkata">
            <Input id="pol-tz" value={p.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
          <Field label="Shift starts" htmlFor="pol-start" error={errors.shiftStart}>
            <Input id="pol-start" type="time" value={p.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} />
          </Field>
          <Field label="Shift ends" htmlFor="pol-end" error={errors.shiftEnd}>
            <Input id="pol-end" type="time" value={p.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} />
          </Field>
          <Field label="Grace period (minutes)" htmlFor="pol-grace" error={errors.graceMinutes} hint="Later than start + grace = late">
            <Input id="pol-grace" type="number" min={0} max={240} value={p.graceMinutes} onChange={(e) => set("graceMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Early departure (minutes)" htmlFor="pol-early" error={errors.earlyLeaveMinutes} hint="Leaving earlier than end − this">
            <Input id="pol-early" type="number" min={0} max={240} value={p.earlyLeaveMinutes} onChange={(e) => set("earlyLeaveMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Max session (hours)" htmlFor="pol-max" error={errors.maxSessionHours} hint="Open longer = missed punch-out">
            <Input id="pol-max" type="number" min={1} max={48} value={p.maxSessionHours} onChange={(e) => set("maxSessionHours", Number(e.target.value))} />
          </Field>
          <Field label="Full day (minutes)" htmlFor="pol-full" error={errors.fullDayMinutes} hint={`${hours(p.fullDayMinutes)} hours`}>
            <Input id="pol-full" type="number" min={30} max={1440} value={p.fullDayMinutes} onChange={(e) => set("fullDayMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Half day (minutes)" htmlFor="pol-half" error={errors.halfDayMinutes} hint={`${hours(p.halfDayMinutes)} hours`}>
            <Input id="pol-half" type="number" min={0} max={1440} value={p.halfDayMinutes} onChange={(e) => set("halfDayMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Correction window (days)" htmlFor="pol-window" error={errors.correctionWindowDays} hint="How far back employees may request">
            <Input id="pol-window" type="number" min={0} max={90} value={p.correctionWindowDays} onChange={(e) => set("correctionWindowDays", Number(e.target.value))} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Weekly off days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
                <input type="checkbox" className="accent-primary-600" checked={p.weeklyOffDays.includes(i)} onChange={(e) => set("weeklyOffDays", e.target.checked ? [...p.weeklyOffDays, i] : p.weeklyOffDays.filter((x) => x !== i))} /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Allowed work locations</legend>
          {errors.allowedLocations && <p className="mb-2 text-xs font-medium text-danger-700">{errors.allowedLocations}</p>}
          <div className="flex flex-wrap gap-4">
            {LOCATIONS.map((l) => (
              <Checkbox key={l} label={LOCATION_LABELS[l]} checked={p.allowedLocations.includes(l)} onChange={(e) => set("allowedLocations", e.target.checked ? [...p.allowedLocations, l] : p.allowedLocations.filter((x) => x !== l))} />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signing out while punched in" htmlFor="pol-logout" hint="Signing out never punches anyone out.">
            <Select id="pol-logout" value={p.logoutPolicy} onChange={(e) => set("logoutPolicy", e.target.value)}>
              {LOGOUT_POLICIES.map((l) => (
                <option key={l} value={l}>
                  {LOGOUT_POLICY_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="pt-6">
            <Checkbox label="Allow several sessions per day" description="Breaks are the gaps between sessions." checked={p.allowMultipleSessions} onChange={(e) => set("allowMultipleSessions", e.target.checked)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Save policy
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Company holidays (group-wide or per company). */
export function HolidaysManager({ holidays, companies, year }: { holidays: { id: string; date: string; name: string; company: string | null }[]; companies: { id: string; name: string }[]; year: number }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const { busy, errors, save } = useSave();
  return (
    <Card>
      <CardHeader title={`Holidays ${year}`} description="Holidays are never counted as absence. Leave over a holiday doesn't use leave balance." />
      <form
        className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => api("/api/attendance/holidays", { body: { date, name, companyId: companyId || null } }), "Holiday added")) {
            setDate("");
            setName("");
          }
        }}
      >
        <Field label="Date" htmlFor="hol-date" error={errors.date}>
          <Input id="hol-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="sm:w-44" />
        </Field>
        <Field label="Name" htmlFor="hol-name" error={errors.name}>
          <Input id="hol-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className="sm:w-56" />
        </Field>
        {companies.length > 1 && (
          <Field label="Applies to" htmlFor="hol-company">
            <Select id="hol-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="sm:w-52">
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Button type="submit" loading={busy} disabled={!date || !name.trim()}>
          Add holiday
        </Button>
      </form>
      <ul className="divide-y divide-border" data-testid="holiday-list">
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span>
              <span className="font-medium text-ink">{h.name}</span> · {formatLongDate(h.date)}
              {h.company && (
                <Badge tone="violet" dot={false} className="ml-2">
                  {h.company}
                </Badge>
              )}
            </span>
            <button type="button" aria-label={`Remove ${h.name}`} onClick={() => save(() => api(`/api/attendance/holidays/${h.id}`, { method: "DELETE" }), "Holiday removed")} className="text-ink-subtle hover:text-danger-700">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        ))}
        {holidays.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-muted">No holidays added for this year.</li>}
      </ul>
    </Card>
  );
}

interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  allowHalfDay: boolean;
  isActive: boolean;
}

function LeaveTypeRowEditor({ t }: { t: LeaveTypeRow }) {
  const [quota, setQuota] = useState(t.annualQuota === null ? "" : String(t.annualQuota));
  const { busy, save } = useSave();
  const patch = (body: Record<string, unknown>, ok: string) => save(() => api(`/api/leave/types/${t.id}`, { method: "PATCH", body }), ok);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium text-ink">{t.name}</span> <span className="text-xs text-ink-subtle">{t.code}</span>
        <span className="ml-2 inline-flex gap-1">
          <Badge tone={t.isPaid ? "success" : "neutral"} dot={false}>
            {t.isPaid ? "Paid" : "Unpaid"}
          </Badge>
          {!t.isActive && <Badge tone="danger">Inactive</Badge>}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <label htmlFor={`quota-${t.id}`} className="text-xs text-ink-muted">
          Days / year
        </label>
        <Input id={`quota-${t.id}`} type="number" min={0} max={366} step={0.5} value={quota} placeholder="No limit" onChange={(e) => setQuota(e.target.value)} className="sm:w-24" />
        <Button size="sm" variant="secondary" loading={busy} disabled={quota === (t.annualQuota === null ? "" : String(t.annualQuota))} onClick={() => patch({ annualQuota: quota === "" ? null : Number(quota) }, "Quota updated")}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => patch({ isActive: !t.isActive }, t.isActive ? "Leave type disabled" : "Leave type enabled")}>
          {t.isActive ? "Disable" : "Enable"}
        </Button>
      </span>
    </li>
  );
}

/** Leave types and yearly quotas. */
export function LeaveTypesManager({ types }: { types: LeaveTypeRow[] }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("");
  const [isPaid, setPaid] = useState(true);
  const { busy, errors, save } = useSave();
  return (
    <Card>
      <CardHeader title="Leave types" description="Quotas are per calendar year. Approved and pending requests count against the balance." />
      <ul className="divide-y divide-border" data-testid="leave-types">
        {types.map((t) => (
          <LeaveTypeRowEditor key={t.id} t={t} />
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => api("/api/leave/types", { body: { code, name, isPaid, annualQuota: quota === "" ? null : Number(quota) } }), "Leave type added")) {
            setCode("");
            setName("");
            setQuota("");
          }
        }}
      >
        <Field label="Code" htmlFor="lt-code" error={errors.code}>
          <Input id="lt-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} required className="sm:w-24" />
        </Field>
        <Field label="Name" htmlFor="lt-name" error={errors.name}>
          <Input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="sm:w-56" />
        </Field>
        <Field label="Days / year" htmlFor="lt-quota" error={errors.annualQuota}>
          <Input id="lt-quota" type="number" min={0} max={366} step={0.5} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="No limit" className="sm:w-28" />
        </Field>
        <div className="pb-2">
          <Checkbox label="Paid" checked={isPaid} onChange={(e) => setPaid(e.target.checked)} />
        </div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!code || name.trim().length < 2}>
          Add leave type
        </Button>
      </form>
    </Card>
  );
}
