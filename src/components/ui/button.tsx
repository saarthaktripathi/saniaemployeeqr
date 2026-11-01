import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-primary-500 to-primary-600 text-white shadow-sm shadow-primary-600/25 hover:from-primary-600 hover:to-primary-700 hover:shadow-md hover:shadow-primary-600/25",
  secondary: "bg-white text-ink border border-border-strong shadow-xs hover:bg-navy-100/50 hover:border-navy-700/25",
  ghost: "text-ink-muted hover:bg-navy-100/70 hover:text-ink",
  danger: "bg-white text-danger-700 border border-danger-600/40 hover:bg-danger-50",
  success: "bg-white text-success-700 border border-success-700/40 hover:bg-success-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
