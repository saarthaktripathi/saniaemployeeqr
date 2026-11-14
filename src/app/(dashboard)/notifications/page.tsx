import type { Metadata } from "next";
import { requirePageActor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { NotificationList } from "@/components/notifications/notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePageActor();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Your inbox" title="Notifications" description="Leave requests, attendance corrections, incomplete sessions, task submissions and missed deadlines." />
      <NotificationList />
    </div>
  );
}
