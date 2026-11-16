import Link from "next/link";
import { ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "@/components/layout/logo";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print bg-navy-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-md">
            <Logo tone="light" />
          </Link>
          <nav aria-label="Public" className="flex flex-wrap items-center gap-1.5 text-sm">
            <Link href="/" className="hidden rounded-md px-3 py-2 font-medium text-white/85 hover:bg-white/10 hover:text-white sm:block">
              Verify an Employee
            </Link>
            <Link
              href="/login?portal=employee"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 font-semibold text-white hover:bg-primary-500"
            >
              <UserRound className="size-4" aria-hidden /> Employee Login
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/25 px-3 py-2 font-medium text-white hover:bg-white/10"
            >
              <ShieldCheck className="size-4" aria-hidden /> Authorized HR Login
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="no-print border-t border-border bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-subtle sm:px-6">
          © {new Date().getFullYear()} Sania Job Bowl · Connecting Talent. Creating the Future.
        </div>
      </footer>
    </div>
  );
}
