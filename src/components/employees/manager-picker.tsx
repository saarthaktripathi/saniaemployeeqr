"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, UserRoundX } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EmployeeAvatar } from "./employee-avatar";

export interface PersonOption {
  id: string;
  displayName: string;
  employeeCode: string;
  jobTitle: string;
  department?: string;
  company?: string;
  photoUpdatedAt: string | null;
}

/**
 * Type-ahead picker for the reporting manager (an accessible combobox). Searches the
 * directory by name or employee ID; the server re-validates the choice (no loops, not archived).
 */
export function ManagerPicker({
  id,
  value,
  onChange,
  excludeId,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: PersonOption | null;
  onChange: (person: PersonOption | null) => void;
  /** The employee being edited (can't report to themselves). */
  excludeId?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PersonOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ q: query.trim(), ...(excludeId ? { exclude: excludeId } : {}) });
        const res = await api<{ options: PersonOption[] }>(`/api/employees/options?${qs}`);
        if (!cancelled) {
          setOptions(res.options);
          setActive(0);
        }
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, excludeId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (p: PersonOption) => {
    onChange(p);
    setOpen(false);
    setQuery("");
  };

  if (value && !open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-strong bg-white px-3 py-2 shadow-sm" data-testid="manager-selected">
        <span className="flex min-w-0 items-center gap-2.5">
          <EmployeeAvatar id={value.id} name={value.displayName} photoUpdatedAt={value.photoUpdatedAt} size="sm" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-ink">{value.displayName}</span>
            <span className="block truncate text-xs text-ink-subtle">
              {value.employeeCode} · {value.jobTitle}
            </span>
          </span>
        </span>
        <span className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Change
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)} aria-label="Remove reporting manager">
            <UserRoundX className="size-4" aria-hidden />
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
      <Input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder="Search by name or employee ID"
        className="pl-9"
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Employees" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-[var(--shadow-lift)]">
          {loading && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-subtle">Searching…</li>}
          {!loading && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-subtle">No matching employees</li>}
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2", i === active ? "bg-primary-50" : "hover:bg-navy-100/60")}
            >
              <EmployeeAvatar id={p.id} name={p.displayName} photoUpdatedAt={p.photoUpdatedAt} size="sm" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium text-ink">{p.displayName}</span>
                <span className="block truncate text-xs text-ink-subtle">
                  {p.employeeCode} · {p.jobTitle}
                  {p.company ? ` · ${p.company}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
