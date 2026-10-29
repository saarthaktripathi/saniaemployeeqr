"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fields: { path: string; message: string }[] = [],
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Same-origin JSON fetch. Errors surface as ApiError with the server's safe message. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET"),
    headers: init.raw !== undefined ? { "Content-Type": init.contentType ?? "text/plain" } : init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    // Full page load on purpose: discards all client-side state after the session ends.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && typeof window !== "undefined") window.location.assign("/login");
    throw new ApiError(e.message ?? "Request failed", res.status, e.code ?? "UNKNOWN", e.fields ?? [], e.details);
  }
  return data as T;
}
