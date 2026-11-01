import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/cn";
import type { AuditRow } from "@/server/services/audit-read";

export const AUDIT_LABELS: Record<string, string> = {
  "employee.created": "Employee created",
  "employee.updated": "Employee updated",
  "employee.photo_updated": "Employee photo updated",
  "employee.photo_removed": "Employee photo removed",
  "employee.deactivated": "Employee deactivated",
  "employee.reactivated": "Employee reactivated",
  "employee.archived": "Employee archived",
  "employee.unarchived": "Employee unarchived",
  "employee.bulk_status": "Bulk status change",
  "employee.deleted": "Employee deleted",
  "employee.bulk_deleted": "Bulk delete",
  "employee.imported": "Bulk import",
  "employee.exported": "Directory exported",
  "credential.issued": "QR credential issued",
  "credential.reissued": "QR credential reissued",
  "credential.revoked": "QR credential revoked",
  "auth.login.success": "Signed in",
  "auth.login.failure": "Failed sign-in",
  "auth.mfa.success": "MFA verified",
  "auth.mfa.failure": "Failed MFA code",
  "users.created": "User created",
  "users.updated": "User updated",
  "settings.updated": "System rules updated",
  "authz.denied": "Access denied",
};

function summarize(r: AuditRow): string | null {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  if (Array.isArray(m.changed) && m.changed.length) return `Fields: ${m.changed.join(", ")}`;
  if (typeof m.reason === "string" && m.reason) return `Reason: ${m.reason}`;
  if (typeof m.count === "number") return `${m.count} records`;
  if (typeof m.permission === "string") return `Missing permission: ${m.permission}`;
  if (typeof m.employeeCode === "string") return m.employeeCode;
  return null;
}

export function AuditList({ rows, compact }: { rows: AuditRow[]; compact?: boolean }) {
  if (!rows.length) return <p className="px-5 py-8 text-center text-sm text-ink-subtle">No activity recorded yet.</p>;
  return (
    <ol className="divide-y divide-border" data-testid="audit-list">
      {rows.map((r) => {
        const detail = summarize(r);
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {AUDIT_LABELS[r.action] ?? r.action}
                {r.outcome !== "SUCCESS" && (
                  <Badge tone={r.outcome === "DENIED" ? "warning" : "danger"} className="ml-2 align-middle">
                    {r.outcome.toLowerCase()}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-ink-muted">
                {r.actorName ?? "Unknown / system"}
                {r.actorRole ? ` · ${r.actorRole.replace("_", " ").toLowerCase()}` : ""}
                {detail ? ` · ${detail}` : ""}
                {!compact && r.targetType === "employee" && r.targetId && (
                  <>
                    {" · "}
                    <Link href={`/employees/${r.targetId}`} className="font-medium text-primary-600 hover:underline">
                      View employee
                    </Link>
                  </>
                )}
              </p>
            </div>
            <time dateTime={r.createdAt} className="shrink-0 text-xs text-ink-subtle tabular-nums">
              {formatDateTime(r.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
