import type { VerificationView } from "@/server/services/verification";

export type ViewStatus = VerificationView["status"];

export const STATUS_COPY: Record<ViewStatus, { label: string; tone: "success" | "danger" | "warning" | "neutral"; text: string }> = {
  VERIFIED: {
    label: "Verified — Active",
    tone: "success",
    text: "This credential is valid and the employee record is currently active.",
  },
  INACTIVE: {
    label: "Inactive employee",
    tone: "danger",
    text: "This person is not currently an active employee of the company.",
  },
  ID_EXPIRED: {
    label: "ID expired",
    tone: "warning",
    text: "The employee record is active, but this ID has passed its validity date.",
  },
  CREDENTIAL_EXPIRED: {
    label: "Credential expired",
    tone: "warning",
    text: "This QR credential has expired. The employee should request a new ID from HR.",
  },
  REVOKED: {
    label: "Credential revoked",
    tone: "danger",
    text: "This QR credential has been revoked and must not be accepted.",
  },
  UNKNOWN: {
    label: "Invalid or unknown credential",
    tone: "danger",
    text: "This link does not match any credential issued by the company.",
  },
  MALFORMED: {
    label: "Invalid or unknown credential",
    tone: "danger",
    text: "This link is not a valid verification link.",
  },
  RATE_LIMITED: {
    label: "Verification temporarily unavailable",
    tone: "neutral",
    text: "Too many checks from your network. Please wait a minute and try again.",
  },
  UNAVAILABLE: {
    label: "Verification temporarily unavailable",
    tone: "neutral",
    text: "We could not complete the check right now. Please try again shortly.",
  },
};
