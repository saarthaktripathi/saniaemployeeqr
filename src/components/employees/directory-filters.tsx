"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { EmployeeListQuery } from "@/features/employees/schema";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, WORK_MODE_LABELS, WORK_MODES } from "@/features/employees/labels";
import { useDirectory } from "./directory-context";

const LABELS: Record<string, Record<string, string>> = {
  status: { ACTIVE: "Active", INACTIVE: "Inactive", EXITED: "Exited", ARCHIVED: "Archived" },
  credential: { VALID: "Valid QR", EXPIRED: "Expired QR", NONE: "No QR" },
  expiry: { VALID: "ID valid", EXPIRING_SOON: "Expiring soon", EXPIRED: "ID expired" },
};

export interface FilterOptions {
  companies: { id: string; name: string; isActive: boolean }[];
  departments: string[];
  designations: string[];
}

export function DirectoryFilters({ options, query, managerName }: { options: FilterOptions; query: EmployeeListQuery; managerName?: string | null }) {
  const { navigate } = useDirectory();
  const params = useSearchParams();
  const [q, setQ] = useState(query.q);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync when the query changes elsewhere (KPI card, clear, back button).
  const [lastQuery, setLastQuery] = useState(query.q);
  if (query.q !== lastQuery) {
    setLastQuery(query.q);
    setQ(query.q);
  }

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  const companyName = options.companies.find((c) => c.id === query.company)?.name;
  const chips: { key: string; label: string }[] = [];
  if (query.q) chips.push({ key: "q", label: `“${query.q}”` });
  if (query.company) chips.push({ key: "company", label: companyName ?? "Company" });
  if (query.department) chips.push({ key: "department", label: query.department });
  if (query.designation) chips.push({ key: "designation", label: query.designation });
  if (query.status !== "ALL") chips.push({ key: "status", label: LABELS.status[query.status] ?? query.status });
  if (query.type !== "ANY") chips.push({ key: "type", label: EMPLOYMENT_TYPE_LABELS[query.type] });
  if (query.mode !== "ANY") chips.push({ key: "mode", label: WORK_MODE_LABELS[query.mode] });
  if (query.manager) chips.push({ key: "manager", label: `Reports to ${managerName ?? "manager"}` });
  if (query.credential !== "ANY") chips.push({ key: "credential", label: LABELS.credential[query.credential] });
  if (query.expiry !== "ANY") chips.push({ key: "expiry", label: LABELS.expiry[query.expiry] });
  const anyFilter = params.size > 0 || q.length > 0;
  // Keep a filtered value selectable even if it no longer appears in the suggestion list.
  const withCurrent = (list: string[], current: string) => (current && !list.some((v) => v.toLowerCase() === current.toLowerCase()) ? [current, ...list] : list);

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-60 flex-1">
          <label htmlFor="dir-search" className="sr-only">
            Search by name, employee ID or email
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
            id="dir-search"
            type="search"
            placeholder="Search by name, employee ID (e.g. SJB-2026-001) or email"
            className="h-12 rounded-xl border-white pl-10 shadow-[0_2px_10px_rgb(30_41_90/0.06)]"
            value={q}
            maxLength={100}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              if (debounce.current) clearTimeout(debounce.current);
              debounce.current = setTimeout(() => navigate({ q: v.trim() }), 300);
            }}
          />
        </div>
        <FilterSelect
          label="Sort"
          value={`${query.sort}:${query.dir}`}
          onChange={(v) => {
            const [sort, dir] = v.split(":");
            const isDefault = sort === "createdAt" && dir === "desc";
            navigate({ sort: isDefault ? "" : sort!, dir: isDefault ? "" : dir! });
          }}
          options={[
            ["createdAt:desc", "Newest first"],
            ["createdAt:asc", "Oldest first"],
            ["name:asc", "Name A–Z"],
            ["name:desc", "Name Z–A"],
            ["code:asc", "Employee ID"],
            ["department:asc", "Department"],
            ["joiningDate:desc", "Recently joined"],
            ["joiningDate:asc", "Longest serving"],
            ["idExpiresAt:asc", "Expiring first"],
            ["idExpiresAt:desc", "Expiring last"],
          ]}
          className="h-12"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8" role="group" aria-label="Filters">
        <FilterSelect
          label="Company"
          value={query.company}
          onChange={(v) => navigate({ company: v })}
          options={[["", "All companies"], ...options.companies.map((c) => [c.id, c.isActive ? c.name : `${c.name} (inactive)`] as [string, string])]}
        />
        <FilterSelect label="Department" value={query.department} onChange={(v) => navigate({ department: v })} options={[["", "All departments"], ...withCurrent(options.departments, query.department).map((d) => [d, d] as [string, string])]} />
        <FilterSelect label="Designation" value={query.designation} onChange={(v) => navigate({ designation: v })} options={[["", "All designations"], ...withCurrent(options.designations, query.designation).map((d) => [d, d] as [string, string])]} />
        <FilterSelect label="Status" value={query.status} onChange={(v) => navigate({ status: v })} options={[["ALL", "All statuses"], ["ACTIVE", "Active"], ["INACTIVE", "Inactive"], ["EXITED", "Exited"], ["ARCHIVED", "Archived"]]} />
        <FilterSelect label="Employment type" value={query.type} onChange={(v) => navigate({ type: v })} options={[["ANY", "All types"], ...EMPLOYMENT_TYPES.map((t) => [t, EMPLOYMENT_TYPE_LABELS[t]] as [string, string])]} />
        <FilterSelect label="Work mode" value={query.mode} onChange={(v) => navigate({ mode: v })} options={[["ANY", "Any work mode"], ...WORK_MODES.map((m) => [m, WORK_MODE_LABELS[m]] as [string, string])]} />
        <FilterSelect label="QR credential" value={query.credential} onChange={(v) => navigate({ credential: v })} options={[["ANY", "Any QR status"], ["VALID", "Valid QR"], ["EXPIRED", "Expired QR"], ["NONE", "No QR"]]} />
        <FilterSelect label="ID validity" value={query.expiry} onChange={(v) => navigate({ expiry: v })} options={[["ANY", "Any validity"], ["VALID", "Valid"], ["EXPIRING_SOON", "Expiring soon"], ["EXPIRED", "Expired"]]} />
      </div>
      {anyFilter && (
        <div className="animate-fade flex flex-wrap items-center gap-1.5 text-xs">
          <SlidersHorizontal className="size-3.5 text-ink-subtle" aria-hidden />
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                if (c.key === "q") setQ("");
                navigate({ [c.key]: "" });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-primary-100 bg-primary-50 py-0.5 pr-1.5 pl-2.5 font-medium text-primary-700 transition-colors hover:bg-primary-100"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label} <X className="size-3" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setQ("");
              navigate({}, { reset: true });
            }}
            className={cn("ml-1 rounded-full px-2 py-0.5 font-medium text-ink-muted hover:bg-navy-100 hover:text-ink")}
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; className?: string }) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const changed = value !== options[0]?.[0];
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 w-full min-w-0 truncate rounded-xl border-white shadow-[0_2px_10px_rgb(30_41_90/0.06)] transition-colors",
          label === "Sort" && "w-auto min-w-44",
          changed && label !== "Sort" && "border-primary-500/60 bg-primary-50 text-primary-700",
          className,
        )}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );
}
