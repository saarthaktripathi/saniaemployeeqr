import type { Metadata } from "next";
import { requireWorkspaceActor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { NotificationList } from "@/components/notifications/notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function MyNotificationsPage() {
  await requireWorkspaceActor();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Employee workspace" title="Notifications" description="Tasks, leave decisions, attendance updates and announcements." />
      <NotificationList />
    </div>
  );
}
