"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { extractToken } from "@/features/verification/token";

export function VerifyLookupForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const token = extractToken(value);
        if (!token) {
          setError("That doesn't look like a Sania Job Bowl verification link.");
          return;
        }
        router.push(`/verify/${token}`);
      }}
    >
      <label htmlFor="verify-link" className="sr-only">
        Verification link
      </label>
      <Input
        id="verify-link"
        placeholder="https://…/verify/…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "verify-link-error" : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <p id="verify-link-error" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full">
        Verify
      </Button>
    </form>
  );
}
