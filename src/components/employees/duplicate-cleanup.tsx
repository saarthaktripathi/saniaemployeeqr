"use client";

import Link from "next/link";
import { CopyX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/cn";
import { useDeleteAction } from "./use-delete-action";

export interface DuplicateMemberView {
  id: string;
  employeeCode: string;
  createdAt: string;
  hasCredential: boolean;
  archived: boolean;
}

export interface DuplicateGroupView {
  displayName: string;
  department: string;
  jobTitle: string;
  keep: DuplicateMemberView;
  extras: DuplicateMemberView[];
}

const MAX_PER_REQUEST = 1000;

function Member({ m, keep }: { m: DuplicateMemberView; keep?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link href={`/employees/${m.id}`} className="font-mono text-[13px] font-medium text-ink hover:text-primary-600 hover:underline">
        {m.employeeCode}
      </Link>
      <span className="text-xs text-ink-subtle">added {formatDateTime(m.createdAt)}</span>
      {keep ? <Badge tone="success">Keep</Badge> : <Badge tone="danger">Remove</Badge>}
      {m.hasCredential && <Badge tone="info">Has QR</Badge>}
      {m.archived && <Badge>Archived</Badge>}
    </li>
  );
}

/**
 * Lists records that look like the same employee added more than once (e.g. the same
 * CSV imported twice) and removes the extra copies in one step, keeping one per group.
 */
export function DuplicateCleanup({ groups, extraCount }: { groups: DuplicateGroupView[]; extraCount: number }) {
  const del = useDeleteAction();
  const extraIds = groups.flatMap((g) => g.extras.map((m) => m.id)).slice(0, MAX_PER_REQUEST);

  return (
    <Card>
      {del.dialog}
      <CardHeader
        eyebrow="Step 3 · Clean up"
        title="Duplicate employees"
        description="Records with the same name, department, job title, location, joining date, phone and email. In each group the record with a QR credential (or the oldest) is kept."
        actions={
          extraCount > 0 ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                del.request(
                  extraIds,
                  `${extraIds.length} duplicate ${extraIds.length === 1 ? "record" : "records"}`,
                  `One record is kept in each of ${groups.length} groups; the ${extraIds.length} extra copies and their QR credentials are permanently deleted. This cannot be undone.`,
                )
              }
            >
              <CopyX className="size-4" aria-hidden /> Remove {extraIds.length} duplicates
            </Button>
          ) : undefined
        }
      />
      {groups.length === 0 ? (
        <EmptyState icon={<CopyX className="size-5" />} title="No duplicates found" description="Every employee record is unique." />
      ) : (
        <ul className="divide-y divide-border" data-testid="duplicate-groups">
          {groups.map((g) => (
            <li key={g.keep.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium text-ink">{g.displayName}</p>
                <p className="text-xs text-ink-subtle">
                  {g.jobTitle} · {g.department}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <Member m={g.keep} keep />
                  {g.extras.map((m) => (
                    <Member key={m.id} m={m} />
                  ))}
                </ul>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => del.request(g.extras.map((m) => m.id), `${g.extras.length} ${g.extras.length === 1 ? "copy" : "copies"} of ${g.displayName}`)}
              >
                Remove {g.extras.length === 1 ? "copy" : `${g.extras.length} copies`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
