"use client";

import { Button } from "@/components/ui/button";
import { useStatusAction } from "./use-status-action";

export function EmployeeStatusActions({
  id,
  name,
  status,
  archived,
  perms,
}: {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  archived: boolean;
  perms: { deactivate: boolean; reactivate: boolean; archive: boolean };
}) {
  const { request, dialog } = useStatusAction();
  return (
    <div className="flex flex-wrap gap-2">
      {dialog}
      {!archived && status === "ACTIVE" && perms.deactivate && (
        <Button size="sm" variant="danger" onClick={() => request("deactivate", [id], name)}>
          Deactivate
        </Button>
      )}
      {!archived && status === "INACTIVE" && perms.reactivate && (
        <Button size="sm" variant="success" onClick={() => request("reactivate", [id], name)}>
          Reactivate
        </Button>
      )}
      {!archived && perms.archive && (
        <Button size="sm" variant="ghost" onClick={() => request("archive", [id], name)}>
          Archive
        </Button>
      )}
      {archived && perms.archive && (
        <Button size="sm" variant="secondary" onClick={() => request("unarchive", [id], name)}>
          Unarchive
        </Button>
      )}
    </div>
  );
}
