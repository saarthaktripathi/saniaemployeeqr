"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import type { EmployeeListQuery } from "@/features/employees/schema";

export function DirectoryFilters({ departments, query }: { departments: string[]; query: EmployeeListQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(query.q);
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== "ALL" && v !== "ANY") next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2" aria-busy={pending}>
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
            debounce.current = setTimeout(() => update({ q: v.trim() }), 300);
          }}
        />
      </div>
      <FilterSelect label="Status" value={query.status} onChange={(v) => update({ status: v })} options={[["ALL", "All statuses"], ["ACTIVE", "Active"], ["INACTIVE", "Inactive"], ["ARCHIVED", "Archived"]]} />
      <FilterSelect label="Department" value={query.department} onChange={(v) => update({ department: v })} options={[["", "All departments"], ...departments.map((d) => [d, d] as [string, string])]} />
      <FilterSelect label="QR credential" value={query.credential} onChange={(v) => update({ credential: v })} options={[["ANY", "Any credential"], ["VALID", "Valid QR"], ["EXPIRED", "Expired QR"], ["NONE", "No QR"]]} />
      <FilterSelect label="ID validity" value={query.expiry} onChange={(v) => update({ expiry: v })} options={[["ANY", "Any validity"], ["VALID", "Valid"], ["EXPIRING_SOON", "Expiring soon"], ["EXPIRED", "Expired"]]} />
      <FilterSelect
        label="Sort"
        value={`${query.sort}:${query.dir}`}
        onChange={(v) => {
          const [sort, dir] = v.split(":");
          update({ sort: sort === "createdAt" && dir === "desc" ? "" : sort!, dir: sort === "createdAt" && dir === "desc" ? "" : dir! });
        }}
        options={[
          ["createdAt:desc", "Newest first"],
          ["createdAt:asc", "Oldest first"],
          ["name:asc", "Name A–Z"],
          ["name:desc", "Name Z–A"],
          ["code:asc", "Employee ID"],
          ["department:asc", "Department"],
          ["idExpiresAt:asc", "Expiring first"],
        ]}
      />
      {(params.size > 0 || q) && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
          className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-navy-100/70"
        >
          <X className="size-4" aria-hidden /> Clear
        </button>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-36">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );
}
