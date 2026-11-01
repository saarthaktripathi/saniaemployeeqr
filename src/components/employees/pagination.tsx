"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDirectory } from "./directory-context";

export function Pagination({ page, pageCount, total, pageSize, params }: { page: number; pageCount: number; total: number; pageSize: number; params: Record<string, string> }) {
  const { navigate } = useDirectory();
  if (total === 0) return null;
  const href = (p: number) => {
    const qs = new URLSearchParams(params);
    if (p > 1) qs.set("page", String(p));
    else qs.delete("page");
    const s = qs.toString();
    return `/dashboard${s ? `?${s}` : ""}`;
  };
  const go = (p: number) => (e: React.MouseEvent) => {
    // Real links (open in new tab still works); a plain click updates in place.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate({ page: p > 1 ? String(p) : "" });
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = "inline-flex h-9 items-center gap-1 rounded-lg border border-border-strong bg-white px-3 text-sm font-medium transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
      <p>
        Showing <span className="font-medium text-ink">{from.toLocaleString("en-IN")}</span>–<span className="font-medium text-ink">{to.toLocaleString("en-IN")}</span> of{" "}
        <span className="font-medium text-ink">{total.toLocaleString("en-IN")}</span> employees
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={cn(link, "hover:bg-navy-100/60")} href={href(page - 1)} onClick={go(page - 1)} rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : (
          <span className={cn(link, "opacity-50")} aria-disabled>
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </span>
        )}
        <span className="tabular-nums">
          Page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link className={cn(link, "hover:bg-navy-100/60")} href={href(page + 1)} onClick={go(page + 1)} rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(link, "opacity-50")} aria-disabled>
            Next <ChevronRight className="size-4" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
