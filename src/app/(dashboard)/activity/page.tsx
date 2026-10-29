import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { listAudit } from "@/server/services/audit-read";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { AuditList } from "@/components/audit/audit-list";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Activity log" };

const FILTERS: [string, string][] = [
  ["", "All"],
  ["employee.", "Employees"],
  ["credential.", "Credentials"],
  ["auth.", "Sign-ins"],
  ["users.", "Users"],
  ["settings.", "Settings"],
  ["authz.", "Denied access"],
];

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("audit:read");
  const sp = await searchParams;
  const security = can(actor, "audit:read:security");
  const filters = FILTERS.filter(([p]) => security || !["auth.", "users.", "settings.", "authz."].includes(p));
  const action = filters.some(([p]) => p === sp.action) ? sp.action ?? "" : "";
  const result = await listAudit(db, actor, { action, cursor: sp.cursor }, ctx).catch(() => listAudit(db, actor, {}, ctx));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Compliance"
        title="Activity Log"
        description={`Append-only record of sensitive actions.${security ? "" : " Security events (sign-ins, users, settings) are visible to the owner only."}`}
      />
      <nav aria-label="Filter activity" className="mb-4 flex flex-wrap gap-2">
        {filters.map(([p, label]) => (
          <Link key={label} href={p ? `/activity?action=${p}` : "/activity"} aria-current={p === action ? "page" : undefined} className={buttonClass(p === action ? "primary" : "secondary", "sm")}>
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader title="Events" description="Newest first. Personal data values are not stored in event details — only field names." />
        <AuditList rows={result.rows} />
        <div className="flex justify-between border-t border-border px-5 py-3">
          {sp.cursor ? (
            <Link href={action ? `/activity?action=${action}` : "/activity"} className={buttonClass("ghost", "sm")}>
              ← Newest
            </Link>
          ) : (
            <span />
          )}
          {result.nextCursor && (
            <Link href={`/activity?${new URLSearchParams({ ...(action ? { action } : {}), cursor: result.nextCursor })}`} className={buttonClass("secondary", "sm")}>
              Older events →
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
