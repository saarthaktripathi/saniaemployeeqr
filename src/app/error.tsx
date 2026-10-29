"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-[60vh] place-items-center px-4">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted">
          The error has been logged. Please try again.
          {error.digest && <span className="mt-1 block font-mono text-xs text-ink-subtle">Reference: {error.digest}</span>}
        </p>
        <Button className="mt-5" onClick={reset}>
          Try again
        </Button>
      </Card>
    </main>
  );
}
