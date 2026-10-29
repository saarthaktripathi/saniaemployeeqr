import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4">
      <Card className="max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-danger-700" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-ink-muted">Your role doesn&apos;t include this permission. Ask the company owner if you need it.</p>
        <Link href="/dashboard" className="mt-5 inline-block text-sm font-medium text-primary-600 hover:underline">
          Back to the directory
        </Link>
      </Card>
    </main>
  );
}
