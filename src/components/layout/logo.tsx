import fs from "node:fs";
import path from "node:path";
import { cn } from "@/lib/cn";

// Drop the official logo at public/branding/sania-job-bowl-logo.png and it is used
// automatically; until then a neutral placeholder mark is shown.
const OFFICIAL = "/branding/sania-job-bowl-logo.png";
const PLACEHOLDER = "/branding/logo-placeholder.svg";

let resolved: string | null = null;
function logoSrc(): string {
  if (resolved) return resolved;
  const exists = fs.existsSync(path.join(process.cwd(), "public", OFFICIAL));
  resolved = exists ? OFFICIAL : PLACEHOLDER;
  return resolved;
}

export function Logo({ tone = "dark", showText = true, className }: { tone?: "dark" | "light"; showText?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimisation needed */}
      <img src={logoSrc()} alt={showText ? "" : "Sania Job Bowl"} width={36} height={36} className="size-9 rounded-lg object-contain" />
      {showText && (
        <span className="leading-tight">
          <span className={cn("block text-[15px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-navy-900")}>
            Sania Job Bowl
          </span>
          <span className={cn("block text-[11px] font-medium", tone === "light" ? "text-teal-50/80" : "text-teal-700")}>
            Connecting Talent. Creating the Future.
          </span>
        </span>
      )}
    </span>
  );
}
