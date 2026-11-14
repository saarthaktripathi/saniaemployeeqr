import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyLeave } from "@/server/services/leave";
import { MyLeave } from "@/components/leave/my-leave";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My leave" };

export default async function MyLeavePage() {
  const { actor } = await requireWorkspaceActor();
  const data = await getMyLeave(db, actor);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Employee workspace" title="My Leave" description={`Your leave balances for ${data.year}, new applications and the status of every request.`} />
      <MyLeave data={data} />
    </div>
  );
}
