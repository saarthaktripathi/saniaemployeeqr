import { Briefcase, Building2, Code2, Headset, HeartHandshake, Landmark, Megaphone, Palette, UserRoundSearch, Users, Workflow } from "lucide-react";

/** Stable accent per department (same name → same colour everywhere). */
const ACCENTS = ["#4c6ef5", "#f59f00", "#7950f2", "#12b886", "#e64980", "#15aabf", "#fd7e14", "#40c057"] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function departmentAccent(department: string): string {
  return ACCENTS[hash(department.trim().toLowerCase()) % ACCENTS.length];
}

const ICON_RULES: [RegExp, typeof Users][] = [
  [/talent|recruit|acquisition|hiring/i, UserRoundSearch],
  [/human|hr\b|people/i, HeartHandshake],
  [/financ|account|payroll/i, Landmark],
  [/business|sales|bd\b|development/i, Building2],
  [/market|brand|community|engagement/i, Megaphone],
  [/client|customer|support|relation/i, Headset],
  [/tech|engineer|it\b|software|data/i, Code2],
  [/design|creative/i, Palette],
  [/operation|workforce|ops\b|logistic/i, Workflow],
];

export function DepartmentIcon({ department, className }: { department: string; className?: string }) {
  const Icon = ICON_RULES.find(([re]) => re.test(department))?.[1] ?? Briefcase;
  return <Icon className={className} style={{ color: departmentAccent(department) }} aria-hidden />;
}
