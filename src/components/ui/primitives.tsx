import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] border border-white bg-surface shadow-[0_4px_20px_rgb(30_41_90/0.06)]", className)} {...props} />;
}

export function CardHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-bold tracking-wider text-primary-600 uppercase">{eyebrow}</p>}
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "success" | "danger" | "warning" | "neutral" | "info" | "teal" | "orange" | "violet";

const tones: Record<Tone, string> = {
  success: "bg-success-50 text-success-700 ring-success-700/20",
  danger: "bg-danger-50 text-danger-700 ring-danger-700/20",
  warning: "bg-warning-50 text-warning-700 ring-warning-700/20",
  neutral: "bg-navy-100/70 text-ink-muted ring-ink-muted/15",
  info: "bg-primary-50 text-primary-700 ring-primary-700/20",
  teal: "bg-teal-50 text-teal-700 ring-teal-700/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-700/20",
  violet: "bg-violet-50 text-violet-600 ring-violet-600/20",
};

export function Badge({ tone = "neutral", children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-md bg-navy-100/80", className)} aria-hidden>
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
  </div>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-navy-100 p-3 text-navy-700">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm ring-1 ring-inset", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
    </div>
  );
}

/** Splits a title so its last word can carry the brand gradient ("Employee **Directory**"). */
function GradientTitle({ title }: { title: string }) {
  const at = title.lastIndexOf(" ");
  if (at < 0) return <span className="bg-gradient-to-r from-primary-600 to-violet-600 bg-clip-text text-transparent">{title}</span>;
  return (
    <>
      {title.slice(0, at + 1)}
      <span className="bg-gradient-to-r from-primary-500 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">{title.slice(at + 1)}</span>
    </>
  );
}

/**
 * Page title block: a pastel gradient banner with soft colour blobs. `art` adds decorative
 * artwork on wide screens (the directory's team illustration).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  badges,
  art,
  plain,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  badges?: ReactNode;
  art?: ReactNode;
  /** Opt out of the banner (narrow utility pages). */
  plain?: boolean;
  /** @deprecated banner is now the default */
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        "animate-fade relative mb-6 flex flex-wrap items-center justify-between gap-4",
        !plain &&
          "overflow-hidden rounded-[22px] border border-white bg-[linear-gradient(110deg,#eef2ff_0%,#f5f0ff_35%,#fdf2f8_62%,#ecfeff_100%)] px-5 py-5 shadow-[0_4px_24px_rgb(79_70_229/0.08)] sm:px-7 sm:py-6",
      )}
    >
      {!plain && (
        <>
          <span className="pointer-events-none absolute -top-16 -left-10 size-48 rounded-full bg-primary-500/10 blur-2xl" aria-hidden />
          <span className="pointer-events-none absolute -right-10 -bottom-20 size-56 rounded-full bg-fuchsia-400/10 blur-2xl" aria-hidden />
        </>
      )}
      <div className="relative min-w-0">
        {eyebrow && (
          <p className="text-xs font-bold tracking-wider uppercase">
            <span className="text-cyan-600">{eyebrow.split(" ")[0]}</span> <span className="text-primary-600">{eyebrow.split(" ").slice(1).join(" ")}</span>
          </p>
        )}
        <h1 className="mt-1 text-[26px] leading-tight font-extrabold tracking-tight text-navy-900 sm:text-[34px]">
          <GradientTitle title={title} />
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>}
        {badges && <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>}
      </div>
      {art && <div className="pointer-events-none relative -my-6 ml-auto hidden min-[1600px]:block">{art}</div>}
      {actions && <div className="relative flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{it.label}</dt>
          <dd className="mt-1 text-sm text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
