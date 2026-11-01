"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDirectory } from "./directory-context";

/** Page numbers to show: first, last, current ±1, with gaps marked as null. */
function pageWindow(page: number, count: number): (number | null)[] {
  const keep = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  if (page <= 3) [2, 3, 4].forEach((p) => p <= count && keep.add(p));
  if (page >= count - 2) [count - 1, count - 2, count - 3].forEach((p) => p >= 1 && keep.add(p));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

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
  const box = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm font-medium transition-colors";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-ink-muted">
      <p>
        Showing <span className="font-semibold text-ink">{from.toLocaleString("en-IN")}</span>–<span className="font-semibold text-ink">{to.toLocaleString("en-IN")}</span> of{" "}
        <span className="font-semibold text-ink">{total.toLocaleString("en-IN")}</span> employees
        <span className="sr-only">
          {" "}
          · Page {page} of {pageCount}
        </span>
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link className={cn(box, "text-ink-muted hover:bg-navy-100")} href={href(page - 1)} onClick={go(page - 1)} rel="prev" aria-label="Previous">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(box, "text-ink-subtle/50")} aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        )}
        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-ink-subtle" aria-hidden>
              …
            </span>
          ) : (
            <Link
              key={p}
              href={href(p)}
              onClick={go(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              className={cn(box, p === page ? "bg-gradient-to-b from-primary-500 to-primary-600 text-white shadow-sm shadow-primary-600/30" : "text-ink hover:bg-navy-100")}
            >
              {p}
            </Link>
          ),
        )}
        {page < pageCount ? (
          <Link className={cn(box, "text-ink-muted hover:bg-navy-100")} href={href(page + 1)} onClick={go(page + 1)} rel="next" aria-label="Next">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(box, "text-ink-subtle/50")} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
