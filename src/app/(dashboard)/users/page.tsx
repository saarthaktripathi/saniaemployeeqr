import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listUsers } from "@/server/services/users";
import { GRANTABLE, ROLE_PERMISSIONS } from "@/server/authorization/permissions";
import { PageHeader } from "@/components/ui/primitives";
import { UsersManager } from "@/components/users/users-manager";
import { mfaEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Users & access" };

export default async function UsersPage() {
  const { actor, ctx } = await requirePageActor("users:manage");
  const users = await listUsers(db, actor, ctx);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Owner controls" title="Users & Access" description="Create HR accounts, assign roles and grant individual permissions. Employee logins are created by invitation from Employee Access. Changes revoke the user's active sessions." />
      <UsersManager
        currentUserId={actor.id}
        mfaAvailable={mfaEnabled()}
        grantable={GRANTABLE}
        rolePermissions={{
          OWNER: [...ROLE_PERMISSIONS.OWNER],
          HR_ADMIN: [...ROLE_PERMISSIONS.HR_ADMIN],
          HR_STAFF: [...ROLE_PERMISSIONS.HR_STAFF],
          MANAGEMENT: [...ROLE_PERMISSIONS.MANAGEMENT],
          TEAM_MANAGER: [],
          EMPLOYEE: [],
        }}
        users={users.map((u) => ({ ...u, twoFactorEnabled: Boolean(u.twoFactorEnabled), createdAt: u.createdAt.toISOString() }))}
      />
    </div>
  );
}
