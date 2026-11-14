"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useStatusAction } from "./use-status-action";
import { useDeleteAction } from "./use-delete-action";
import { ExitDialog } from "./exit-dialog";

export function EmployeeStatusActions({
  id,
  name,
  status,
  archived,
  exited = false,
  perms,
}: {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  archived: boolean;
  /** An exit has been recorded (reactivating = rejoining). */
  exited?: boolean;
  perms: { deactivate: boolean; reactivate: boolean; archive: boolean; delete: boolean };
}) {
  const { request, dialog } = useStatusAction();
  const del = useDeleteAction({ redirectTo: "/dashboard" });
  const [exitOpen, setExitOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {dialog}
      {del.dialog}
      {perms.deactivate && !archived && !exited && <ExitDialog employeeId={id} name={name} open={exitOpen} onClose={() => setExitOpen(false)} />}
      {!archived && status === "ACTIVE" && perms.deactivate && (
        <Button size="sm" variant="danger" onClick={() => request("deactivate", [id], name)}>
          Deactivate
        </Button>
      )}
      {!archived && status === "INACTIVE" && perms.reactivate && (
        <Button size="sm" variant="success" onClick={() => request("reactivate", [id], name)}>
          {exited ? "Reactivate (rejoined)" : "Reactivate"}
        </Button>
      )}
      {!archived && !exited && perms.deactivate && (
        <Button size="sm" variant="secondary" onClick={() => setExitOpen(true)}>
          Record exit
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
      {perms.delete && (
        <Button size="sm" variant="ghost" className="text-danger-700" onClick={() => del.request([id], name)}>
          Delete
        </Button>
      )}
    </div>
  );
}
