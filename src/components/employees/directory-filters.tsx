"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { EmployeeListQuery } from "@/features/employees/schema";
import { useDirectory } from "./directory-context";

const LABELS: Record<string, Record<string, string>> = {
  status: { ACTIVE: "Active", INACTIVE: "Inactive", ARCHIVED: "Archived" },
  credential: { VALID: "Valid QR", EXPIRED: "Expired QR", NONE: "No QR" },
  expiry: { VALID: "ID valid", EXPIRING_SOON: "Expiring soon", EXPIRED: "ID expired" },
};

export function DirectoryFilters({ departments, query }: { departments: string[]; query: EmployeeListQuery }) {
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

  const chips: { key: string; label: string }[] = [];
  if (query.q) chips.push({ key: "q", label: `“${query.q}”` });
  if (query.status !== "ALL") chips.push({ key: "status", label: LABELS.status[query.status] ?? query.status });
  if (query.department) chips.push({ key: "department", label: query.department });
  if (query.credential !== "ANY") chips.push({ key: "credential", label: LABELS.credential[query.credential] });
  if (query.expiry !== "ANY") chips.push({ key: "expiry", label: LABELS.expiry[query.expiry] });
  const anyFilter = params.size > 0 || q.length > 0;

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-60 flex-1">
          <label htmlFor="dir-search" className="sr-only">
            Search by name or employee ID
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <Input
            id="dir-search"
            type="search"
            placeholder="Search by employee name or ID (e.g. SJB-2026-001)"
            className="pl-9"
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
        <FilterSelect label="Status" value={query.status} onChange={(v) => navigate({ status: v })} options={[["ALL", "All statuses"], ["ACTIVE", "Active"], ["INACTIVE", "Inactive"], ["ARCHIVED", "Archived"]]} />
        <FilterSelect label="Department" value={query.department} onChange={(v) => navigate({ department: v })} options={[["", "All departments"], ...departments.map((d) => [d, d] as [string, string])]} />
        <FilterSelect label="QR credential" value={query.credential} onChange={(v) => navigate({ credential: v })} options={[["ANY", "Any QR status"], ["VALID", "Valid QR"], ["EXPIRED", "Expired QR"], ["NONE", "No QR"]]} />
        <FilterSelect label="ID validity" value={query.expiry} onChange={(v) => navigate({ expiry: v })} options={[["ANY", "Any validity"], ["VALID", "Valid"], ["EXPIRING_SOON", "Expiring soon"], ["EXPIRED", "Expired"]]} />
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
            ["idExpiresAt:asc", "Expiring first"],
            ["idExpiresAt:desc", "Expiring last"],
          ]}
        />
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const changed = value !== options[0]?.[0];
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn("w-auto min-w-36 transition-colors", changed && label !== "Sort" && "border-primary-500/60 bg-primary-50/60 text-primary-700")}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );
}
