"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/cn";
import { employeePhotoUrl } from "@/features/employees/photo";

const SIZES = { sm: "size-9 text-xs", md: "size-12 text-sm", lg: "size-20 text-xl" } as const;

/**
 * Employee photo (96 px thumbnail, lazy-loaded, fixed size so nothing shifts) with an
 * initials fallback when there is no photo or it fails to load.
 */
export function EmployeeAvatar({
  id,
  name,
  photoUpdatedAt,
  size = "sm",
  className,
}: {
  id: string;
  name: string;
  /** null/undefined = no photo */
  photoUpdatedAt: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = photoUpdatedAt ? employeePhotoUrl(id, photoUpdatedAt, size === "lg" ? "full" : "thumb") : null;
  const showPhoto = src && failed !== src;
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-navy-100 to-primary-100 font-semibold text-navy-800 ring-2 ring-white", SIZES[size], className)} aria-hidden>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated API image; next/image optimisation would bypass the session check
        <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
