import "server-only";
import type { Db } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { AppError } from "@/lib/errors";
import type { Actor } from "./context";
import { requireEmployee } from "./attendance";

/**
 * The signed-in employee's own profile (read under RLS: their row and their managers' names only).
 * No salary, documents or credential tokens: those are HR-only.
 */
export async function getMyProfile(db: Db, actor: Actor) {
  const employeeId = requireEmployee(actor);
  return withRls(db, actor, async (tx) => {
    const e = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        displayName: true,
        workEmail: true,
        phone: true,
        department: true,
        jobTitle: true,
        businessVertical: true,
        employmentType: true,
        workMode: true,
        workLocation: true,
        team: true,
        joiningDate: true,
        employmentStatus: true,
        idIssueDate: true,
        idExpiresAt: true,
        photoKey: true,
        photoUpdatedAt: true,
        attendanceRef: true,
        leavePolicy: true,
        company: { select: { name: true } },
        reportingManager: { select: { id: true, displayName: true, jobTitle: true, employeeCode: true } },
      },
    });
    if (!e) throw new AppError("FORBIDDEN", "Employee record not found");
    const reports = actor.role === "TEAM_MANAGER" ? await tx.employee.count({ where: { reportingManagerId: employeeId, archivedAt: null } }) : 0;
    return {
      ...e,
      photoUpdatedAt: e.photoKey ? (e.photoUpdatedAt?.toISOString() ?? null) : null,
      joiningDate: e.joiningDate?.toISOString().slice(0, 10) ?? null,
      idIssueDate: e.idIssueDate.toISOString().slice(0, 10),
      idExpiresAt: e.idExpiresAt.toISOString().slice(0, 10),
      company: e.company.name,
      directReports: reports,
    };
  });
}
export type MyProfile = Awaited<ReturnType<typeof getMyProfile>>;
