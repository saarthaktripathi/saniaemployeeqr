"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface DirectoryNav {
  /** Applies a patch to the URL query (empty/ALL/ANY values are removed). Resets to page 1 unless `page` is in the patch. */
  navigate: (patch: Record<string, string | null>, opts?: { reset?: boolean }) => void;
  pending: boolean;
}

const Ctx = createContext<DirectoryNav | null>(null);

export function useDirectory(): DirectoryNav {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDirectory must be used inside <DirectoryProvider>");
  return v;
}

/**
 * Single source of truth for the directory's filters: the URL. Every control (KPI cards,
 * search, dropdowns, pagination) updates it through one transition, so the server
 * re-renders only the page segment (no full reload) and all controls share one loading state.
 */
export function DirectoryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const navigate = useCallback<DirectoryNav["navigate"]>(
    (patch, opts) => {
      const next = new URLSearchParams(opts?.reset ? "" : params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v && v !== "ALL" && v !== "ANY") next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  return <Ctx.Provider value={{ navigate, pending }}>{children}</Ctx.Provider>;
}

/** Dims its content and shows a thin progress bar while the directory is updating. */
export function DirectoryBusy({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useDirectory();
  return (
    <div className={cn("relative", className)} aria-busy={pending}>
      <div className={cn("pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 overflow-hidden rounded-full transition-opacity", pending ? "opacity-100" : "opacity-0")} aria-hidden>
        <div className="h-full w-1/3 animate-[progress_1s_ease-in-out_infinite] bg-gradient-to-r from-cyan-500 via-primary-500 to-violet-600" />
      </div>
      <div className={cn("transition-opacity duration-200", pending && "opacity-60")}>{children}</div>
    </div>
  );
}
