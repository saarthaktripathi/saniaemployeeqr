import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listAnnouncements } from "@/server/services/announcements";
import { listDirectoryOptions } from "@/server/services/employees";
import { formatDateTime } from "@/lib/cn";
import { AnnouncementForm } from "@/components/notifications/announcement-form";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Announcements" };

const audienceLabel = (a: unknown, companies: { id: string; name: string }[]) => {
  const x = a as { kind: string; companyId?: string; department?: string };
  if (x.kind === "company") return companies.find((c) => c.id === x.companyId)?.name ?? "One company";
  if (x.kind === "department") return `${x.department} department`;
  return "Everyone";
};

export default async function AnnouncementsPage() {
  const { actor, ctx } = await requirePageActor("announcement:send");
  const [items, options] = await Promise.all([listAnnouncements(db, actor, ctx), listDirectoryOptions(db, actor, ctx)]);
  const companies = options.companies.map((c) => ({ id: c.id, name: c.name }));
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader eyebrow="Workforce" title="Announcements" description="Send news to every employee, one company or one department." />
      <AnnouncementForm companies={companies} departments={options.departments} />
      <Card>
        <CardHeader title="Sent" />
        {items.length === 0 ? (
          <EmptyState title="No announcements yet" />
        ) : (
          <ul className="divide-y divide-border" data-testid="announcement-list">
            {items.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <p className="font-medium text-ink">{a.title}</p>
                <p className="text-sm whitespace-pre-line text-ink-muted">{a.body}</p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {audienceLabel(a.audience, companies)} · {a.recipientCount} recipient(s) · {a.createdBy} · {formatDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
