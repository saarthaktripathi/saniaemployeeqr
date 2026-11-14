import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Link-based pagination for server-rendered lists: every page is a real URL (`hrefFor`), so it works
 * without client state and keeps filters in the query string.
 */
export function Pager({ page, pageSize, total, hrefFor, noun = "records" }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string; noun?: string }) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const box = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm font-medium transition-colors";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-ink-muted">
      <p>
        Showing <span className="font-semibold text-ink">{from.toLocaleString("en-IN")}</span>–<span className="font-semibold text-ink">{to.toLocaleString("en-IN")}</span> of{" "}
        <span className="font-semibold text-ink">{total.toLocaleString("en-IN")}</span> {noun}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link className={cn(box, "hover:bg-navy-100")} href={hrefFor(page - 1)} rel="prev" aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(box, "text-ink-subtle/50")} aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        )}
        <span className="px-2 text-ink">
          Page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link className={cn(box, "hover:bg-navy-100")} href={hrefFor(page + 1)} rel="next" aria-label="Next page">
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

/** Builds `path?query` from a params object, dropping empty values. */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
