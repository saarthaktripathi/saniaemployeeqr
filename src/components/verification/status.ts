import type { VerificationView } from "@/server/services/verification";
import type { CardStatus } from "./id-card-svg";

export type ViewStatus = VerificationView["status"];

/** The five public verdicts; internal statuses stay granular for analytics. */
export type Verdict = "VALID" | "INACTIVE" | "EXPIRED" | "REVOKED" | "INVALID" | "UNAVAILABLE";

export const STATUS_COPY: Record<ViewStatus, { verdict: Verdict; label: string; tone: "success" | "danger" | "warning" | "neutral"; text: string }> = {
  VERIFIED: {
    verdict: "VALID",
    label: "Active employee · valid credential",
    tone: "success",
    text: "This credential is valid and the employee record is currently active.",
  },
  INACTIVE: {
    verdict: "INACTIVE",
    label: "Not a current employee",
    tone: "danger",
    text: "This person is not currently an active employee of the company.",
  },
  ID_EXPIRED: {
    verdict: "EXPIRED",
    label: "ID validity date has passed",
    tone: "warning",
    text: "The employee record is active, but this ID has passed its validity date.",
  },
  CREDENTIAL_EXPIRED: {
    verdict: "EXPIRED",
    label: "QR credential has expired",
    tone: "warning",
    text: "This QR credential has expired. The employee should request a new ID from HR.",
  },
  REVOKED: {
    verdict: "REVOKED",
    label: "Credential revoked — do not accept",
    tone: "danger",
    text: "This QR credential has been revoked and must not be accepted.",
  },
  UNKNOWN: {
    verdict: "INVALID",
    label: "Unknown QR code",
    tone: "danger",
    text: "This link does not match any credential issued by the company.",
  },
  MALFORMED: {
    verdict: "INVALID",
    label: "Not a valid verification link",
    tone: "danger",
    text: "This link is not a valid verification link.",
  },
  RATE_LIMITED: {
    verdict: "UNAVAILABLE",
    label: "Verification temporarily unavailable",
    tone: "neutral",
    text: "Too many checks from your network. Please wait a minute and try again.",
  },
  UNAVAILABLE: {
    verdict: "UNAVAILABLE",
    label: "Verification temporarily unavailable",
    tone: "neutral",
    text: "We could not complete the check right now. Please try again shortly.",
  },
};

/** Status shown on the ID card face for a verification result. */
export function cardStatusOf(status: ViewStatus): CardStatus {
  if (status === "VERIFIED") return "VALID";
  if (status === "ID_EXPIRED" || status === "CREDENTIAL_EXPIRED") return "EXPIRED";
  if (status === "REVOKED") return "REVOKED";
  return "INACTIVE";
}
