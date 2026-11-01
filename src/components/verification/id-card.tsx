import { BadgeCheck, CircleSlash, Clock, ShieldAlert, ShieldX } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATUS_COPY, type ViewStatus } from "./status";

const toneClasses = {
  success: "from-success-600 to-teal-600 text-white",
  danger: "from-danger-700 to-danger-600 text-white",
  warning: "from-warning-600 to-amber-500 text-white",
  neutral: "from-navy-700 to-navy-800 text-white",
};

function StatusIcon({ status }: { status: ViewStatus }) {
  const cls = "size-9 shrink-0";
  if (status === "VERIFIED") return <BadgeCheck className={cls} aria-hidden />;
  if (status === "ID_EXPIRED" || status === "CREDENTIAL_EXPIRED") return <Clock className={cls} aria-hidden />;
  if (status === "REVOKED") return <ShieldX className={cls} aria-hidden />;
  if (status === "INACTIVE") return <CircleSlash className={cls} aria-hidden />;
  return <ShieldAlert className={cls} aria-hidden />;
}

/** Large, colour-coded verdict shown at the top of the public verification page. */
export function StatusBanner({ status, checkedAt }: { status: ViewStatus; checkedAt?: string }) {
  const copy = STATUS_COPY[status];
  return (
    <div role="status" aria-live="polite" className={cn("animate-rise flex items-center gap-4 rounded-2xl bg-gradient-to-br px-5 py-4 shadow-lg", toneClasses[copy.tone])}>
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white/15">
        <StatusIcon status={status} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl leading-tight font-bold tracking-wide" data-testid="verification-status">
          {copy.verdict}
        </p>
        <p className="text-sm font-semibold opacity-95" data-testid="verification-label">
          {copy.label}
        </p>
        <p className="mt-0.5 text-xs opacity-85">{copy.text}</p>
        {checkedAt && (
          <p className="mt-1 text-[11px] opacity-75">
            Checked live <time dateTime={checkedAt}>{new Date(checkedAt).toUTCString()}</time>
          </p>
        )}
      </div>
    </div>
  );
}
