import { Badge } from "@/components/ui/primitives";
import type { CredentialState, IdValidity } from "@/features/employees/rules";

export function EmploymentBadge({ status, archived }: { status: "ACTIVE" | "INACTIVE"; archived?: boolean }) {
  if (archived) return <Badge tone="neutral">Archived</Badge>;
  return status === "ACTIVE" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>;
}

export function IdValidityBadge({ validity }: { validity: IdValidity }) {
  if (validity === "EXPIRED") return <Badge tone="danger">ID expired</Badge>;
  if (validity === "EXPIRING_SOON") return <Badge tone="warning">Expiring soon</Badge>;
  return <Badge tone="success">Valid</Badge>;
}

export function CredentialBadge({ state }: { state: CredentialState }) {
  switch (state) {
    case "VALID":
      return <Badge tone="teal">QR active</Badge>;
    case "EXPIRED":
      return <Badge tone="warning">QR expired</Badge>;
    case "REVOKED":
      return <Badge tone="danger">QR revoked</Badge>;
    default:
      return <Badge tone="neutral">No QR</Badge>;
  }
}
