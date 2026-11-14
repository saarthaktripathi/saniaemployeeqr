/**
 * Detects unique/exclusion constraint violations however they surface (Prisma P2002, or the raw
 * PostgreSQL codes 23505 / 23P01 wrapped by the driver adapter), optionally for one constraint.
 */
export function isConstraintViolation(err: unknown, constraint?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  let text = "";
  try {
    text = `${String(e.message ?? "")} ${JSON.stringify(e.meta ?? null)} ${String(e.cause ?? "")}`;
  } catch {
    text = String(e.message ?? "");
  }
  const violation = e.code === "P2002" || /23505|23P01|duplicate key|unique constraint|exclusion constraint|conflicting key value/i.test(text);
  return violation && (!constraint || text.includes(constraint) || e.code === "P2002");
}
