import { notFound } from "@/lib/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects non-UUID path ids early (also avoids database cast errors). */
export function uuidParam(id: string, what = "Employee"): string {
  if (!UUID.test(id)) throw notFound(what);
  return id;
}
