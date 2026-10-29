import { BadgeCheck, ShieldAlert, ShieldX, CircleSlash, Clock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { cn, formatDate, initials } from "@/lib/cn";
import type { PublicEmployeeView } from "@/server/services/verification";
import { STATUS_COPY, type ViewStatus } from "./status";

const toneClasses = {
  success: "bg-success-50 text-success-700 ring-success-700/25",
  danger: "bg-danger-50 text-danger-700 ring-danger-700/25",
  warning: "bg-warning-50 text-warning-700 ring-warning-700/25",
  neutral: "bg-navy-100 text-ink-muted ring-ink-muted/20",
};

function StatusIcon({ status }: { status: ViewStatus }) {
  const cls = "size-6 shrink-0";
  if (status === "VERIFIED") return <BadgeCheck className={cls} aria-hidden />;
  if (status === "ID_EXPIRED" || status === "CREDENTIAL_EXPIRED") return <Clock className={cls} aria-hidden />;
  if (status === "REVOKED") return <ShieldX className={cls} aria-hidden />;
  if (status === "INACTIVE") return <CircleSlash className={cls} aria-hidden />;
  return <ShieldAlert className={cls} aria-hidden />;
}

export function StatusBanner({ status, checkedAt }: { status: ViewStatus; checkedAt?: string }) {
  const copy = STATUS_COPY[status];
  return (
    <div role="status" aria-live="polite" className={cn("flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-inset", toneClasses[copy.tone])}>
      <StatusIcon status={status} />
      <div>
        <p className="text-base font-semibold" data-testid="verification-status">
          {copy.label}
        </p>
        <p className="text-sm opacity-90">{copy.text}</p>
        {checkedAt && <p className="mt-1 text-xs opacity-75">Checked {new Date(checkedAt).toUTCString()}</p>}
      </div>
    </div>
  );
}

/** Employee identity card face (public fields only). */
export function IdCard({ employee, status, qrSvg }: { employee: PublicEmployeeView; status?: ViewStatus; qrSvg?: string | null }) {
  const active = status ? status === "VERIFIED" : employee.employmentStatus === "ACTIVE";
  const rows: [string, string | null][] = [
    ["Employee ID", employee.employeeCode],
    ["Department", employee.department],
    ["Job title", employee.jobTitle],
    ["Business vertical", employee.businessVertical],
    ["Work location", employee.workLocation],
    ["Valid until", formatDate(employee.idExpiresAt)],
  ];
  return (
    <article
      aria-label={`Employee ID card for ${employee.displayName}`}
      className="overflow-hidden rounded-2xl border border-border bg-white shadow-[var(--shadow-card)] print:shadow-none"
    >
      <div className="flex items-center justify-between bg-navy-900 px-5 py-3">
        <Logo tone="light" />
        <span className="text-[11px] font-semibold tracking-wider text-teal-50/80 uppercase">Employee ID</span>
      </div>
      <div className="h-1 bg-teal-600" />
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center rounded-full bg-navy-100 text-lg font-semibold text-navy-800" aria-hidden>
              {initials(employee.displayName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold text-ink" data-testid="employee-name">
                {employee.displayName}
              </p>
              <span
                className={cn(
                  "mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                  active ? toneClasses.success : toneClasses.danger,
                )}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {employee.employmentStatus === "ACTIVE" ? "Active employee" : "Inactive"}
              </span>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">{label}</dt>
                  <dd className={cn("text-sm text-ink", label === "Employee ID" && "font-mono font-semibold")}>{value}</dd>
                </div>
              ))}
          </dl>
        </div>
        {qrSvg && (
          <div className="flex flex-col items-center gap-1 sm:pl-2">
            <div
              className="size-36 rounded-lg border border-border bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full"
              role="img"
              aria-label="Verification QR code"
              // SVG is generated server-side by the qrcode library from our own URL — not user input.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <span className="text-[10px] text-ink-subtle">Scan to verify</span>
          </div>
        )}
      </div>
    </article>
  );
}
