/** Directory value sets and their display labels. Pure module, shared by server and UI. */

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "CONSULTANT", "INTERN"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  CONSULTANT: "Consultant",
  INTERN: "Intern",
};

export const WORK_MODES = ["OFFICE", "REMOTE", "HYBRID"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = { OFFICE: "Office", REMOTE: "Remote", HYBRID: "Hybrid" };

export const EXIT_TYPES = ["RESIGNATION", "TERMINATION", "CONTRACT_END", "RETIREMENT", "OTHER"] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  RESIGNATION: "Resignation",
  TERMINATION: "Termination",
  CONTRACT_END: "End of contract / internship",
  RETIREMENT: "Retirement",
  OTHER: "Other",
};

export const HISTORY_KINDS = [
  "JOINED",
  "DESIGNATION",
  "DEPARTMENT",
  "COMPANY",
  "MANAGER",
  "EMPLOYMENT_TYPE",
  "WORK_MODE",
  "LOCATION",
  "EXITED",
  "REJOINED",
  "NOTE",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  JOINED: "Joined",
  DESIGNATION: "Designation change",
  DEPARTMENT: "Department change",
  COMPANY: "Company transfer",
  MANAGER: "Reporting manager change",
  EMPLOYMENT_TYPE: "Employment type change",
  WORK_MODE: "Work mode change",
  LOCATION: "Work location change",
  EXITED: "Exited",
  REJOINED: "Rejoined",
  NOTE: "Note",
};

export const DOCUMENT_CATEGORIES = [
  "OFFER_LETTER",
  "APPOINTMENT_LETTER",
  "CONTRACT",
  "ID_PROOF",
  "ADDRESS_PROOF",
  "EDUCATION",
  "EXPERIENCE",
  "RELIEVING_LETTER",
  "PAYSLIP",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  OFFER_LETTER: "Offer letter",
  APPOINTMENT_LETTER: "Appointment letter",
  CONTRACT: "Contract / agreement",
  ID_PROOF: "ID proof",
  ADDRESS_PROOF: "Address proof",
  EDUCATION: "Education certificate",
  EXPERIENCE: "Experience / previous employment",
  RELIEVING_LETTER: "Relieving / exit letter",
  PAYSLIP: "Payslip",
  OTHER: "Other",
};

export const COMPENSATION_TYPES = ["SALARY", "STIPEND", "FEE"] as const;
export type CompensationType = (typeof COMPENSATION_TYPES)[number];
export const COMPENSATION_TYPE_LABELS: Record<CompensationType, string> = { SALARY: "Salary", STIPEND: "Stipend", FEE: "Consulting fee" };

export const PAY_FREQUENCIES = ["ANNUAL", "MONTHLY", "HOURLY"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = { ANNUAL: "per year", MONTHLY: "per month", HOURLY: "per hour" };
