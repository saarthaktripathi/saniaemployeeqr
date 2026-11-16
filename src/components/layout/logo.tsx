import { cn } from "@/lib/cn";
import { SaniaLogo } from "@/components/brand/sania-logo";

/** App icon (brand book p.16): the bowl mark in white on a Royal Blue rounded square. */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn("logo-mark grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-600", className)}>
      <SaniaLogo variant="mark" title={label} className="w-[58%] text-white" />
    </span>
  );
}

/**
 * Primary horizontal logo (brand book p.13). "light" is the white version for dark backgrounds,
 * "dark" the Royal Blue primary. With showText={false} only the app-icon mark is shown.
 * The sidebar swaps to the mark when collapsed by hiding `.logo-full` and showing `.logo-mark`.
 */
export function Logo({ tone = "dark", showText = true, className }: { tone?: "dark" | "light"; showText?: boolean; className?: string }) {
  if (!showText) return <LogoMark className={className} label="Sania Job Bowl" />;
  return (
    <span className={cn("flex items-center", className)}>
      <SaniaLogo variant="horizontal" title="Sania Job Bowl" className={cn("logo-full h-9 w-auto", tone === "light" ? "text-white" : "text-primary-600")} />
      <LogoMark className="hidden" />
    </span>
  );
}
