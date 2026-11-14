import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyProfile } from "@/server/services/me";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { Badge, Card, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS } from "@/features/employees/labels";
import { formatDate } from "@/lib/cn";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const { actor } = await requireWorkspaceActor();
  const p = await getMyProfile(db, actor);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader eyebrow="Employee workspace" title="My Profile" description="Your employee record as HR keeps it. To change anything here, contact your HR team." />
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <EmployeeAvatar id={p.id} name={p.displayName} photoUpdatedAt={p.photoUpdatedAt} size="lg" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink">{p.displayName}</h2>
          <p className="text-sm text-ink-muted">
            {p.jobTitle} · {p.department}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="info" dot={false}>
              {p.employeeCode}
            </Badge>
            <Badge tone={p.employmentStatus === "ACTIVE" ? "success" : "danger"}>{p.employmentStatus === "ACTIVE" ? "Active" : "Inactive"}</Badge>
            <Badge tone="violet" dot={false}>
              {p.company}
            </Badge>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Work details" />
        <div className="p-5">
          <DescriptionList
            items={[
              { label: "Reporting manager", value: p.reportingManager ? `${p.reportingManager.displayName} (${p.reportingManager.jobTitle})` : "—" },
              { label: "Team", value: p.team ?? "—" },
              { label: "Business vertical", value: p.businessVertical ?? "—" },
              { label: "Employment type", value: p.employmentType ? EMPLOYMENT_TYPE_LABELS[p.employmentType] : "—" },
              { label: "Work mode", value: p.workMode ? WORK_MODE_LABELS[p.workMode] : "—" },
              { label: "Work location", value: p.workLocation ?? "—" },
              { label: "Date of joining", value: formatDate(p.joiningDate) },
              { label: "Direct reports", value: actor.role === "TEAM_MANAGER" ? String(p.directReports) : "—" },
            ]}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Contact and ID" />
        <div className="p-5">
          <DescriptionList
            items={[
              { label: "Official email", value: p.workEmail ?? "—" },
              { label: "Contact number", value: p.phone ?? "—" },
              { label: "Login email", value: actor.email },
              { label: "ID card valid", value: `${formatDate(p.idIssueDate)} – ${formatDate(p.idExpiresAt)}` },
              { label: "Attendance reference", value: p.attendanceRef ?? "—" },
              { label: "Leave policy", value: p.leavePolicy ?? "—" },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
