import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4">
      <Card className="max-w-md p-8 text-center">
        <p className="text-sm font-semibold text-teal-700">404</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">The page you were looking for doesn&apos;t exist or has moved.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-primary-600 hover:underline">
          Go to the home page
        </Link>
      </Card>
    </main>
  );
}
