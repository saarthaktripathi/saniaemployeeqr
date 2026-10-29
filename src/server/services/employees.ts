import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { can, type Permission } from "@/server/authorization/permissions";
import {
  bulkStatusSchema,
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeUpdateSchema,
  statusActionSchema,
  type EmployeeListQuery,
  type StatusAction,
} from "@/features/employees/schema";
import {
  ACTION_PERMISSION,
  addDays,
  applyTransition,
  displayNameOf,
  formatEmployeeCode,
  utcToday,
} from "@/features/employees/rules";
import { parseCsv, toCsv } from "@/lib/csv";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { getSettings } from "./settings";

export async function authorize(db: Db | Tx, actor: Actor, permission: Permission, ctx: RequestContext, target?: { type: string; id?: string }) {
  if (can(actor, permission)) return;
  await recordAudit(db, ctx, {
    actor,
    action: "authz.denied",
    targetType: target?.type,
    targetId: target?.id,
    outcome: "DENIED",
    metadata: { permission },
  });
  throw forbidden();
}

// ---------------------------------------------------------------------------
// Employee code allocation
// ---------------------------------------------------------------------------

/**
 * Atomically allocates the next sequence number for (prefix, year).
 * The UPSERT takes a row lock, so concurrent transactions serialize on the counter;
 * a rolled-back transaction never issued its code, so codes are never reused once committed.
 * Sequences reset each calendar year (UTC) — see docs/DATA_MODEL.md.
 */
export async function nextEmployeeSequence(tx: Tx, prefix: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "employee_code_counter" ("prefix", "year", "lastValue") VALUES (${prefix}, ${year}, 1)
    ON CONFLICT ("prefix", "year") DO UPDATE SET "lastValue" = "employee_code_counter"."lastValue" + 1
    RETURNING "lastValue"`;
  return Number(rows[0].lastValue);
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function violationMentions(e: Prisma.PrismaClientKnownRequestError, needle: string): boolean {
  return JSON.stringify(e.meta ?? {}).toLowerCase().includes(needle.toLowerCase());
}

async function assertEmailFree(tx: Tx | Db, email: string | null, exceptId?: string) {
  if (!email) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"::text FROM "employee" WHERE lower("workEmail") = lower(${email}) LIMIT 1`;
  if (rows[0] && rows[0].id !== exceptId) {
    throw conflict("Another employee already uses this work email", { field: "workEmail" });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  employeeCode: true,
  displayName: true,
  department: true,
  jobTitle: true,
  employmentStatus: true,
  idExpiresAt: true,
  archivedAt: true,
  updatedAt: true,
  credentials: {
    where: { revokedAt: null },
    select: { id: true, expiresAt: true, revokedAt: true },
    take: 1,
  },
} satisfies Prisma.EmployeeSelect;

export type EmployeeListRow = Prisma.EmployeeGetPayload<{ select: typeof listSelect }>;

export function buildListWhere(q: EmployeeListQuery, warnDays: number, now = new Date()): Prisma.EmployeeWhereInput {
  const and: Prisma.EmployeeWhereInput[] = [];
  const today = utcToday(now);

  if (q.status === "ARCHIVED") and.push({ archivedAt: { not: null } });
  else {
    and.push({ archivedAt: null });
    if (q.status !== "ALL") and.push({ employmentStatus: q.status });
  }
  if (q.q) {
    // Prisma passes LIKE wildcards through; escape them so input is matched literally.
    const term = q.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    and.push({
      OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { employeeCode: { startsWith: term, mode: "insensitive" } },
      ],
    });
  }
  if (q.department) and.push({ department: { equals: q.department, mode: "insensitive" } });

  const live = { revokedAt: null };
  if (q.credential === "VALID") and.push({ credentials: { some: { ...live, expiresAt: { gt: now } } } });
  if (q.credential === "EXPIRED") and.push({ credentials: { some: { ...live, expiresAt: { lte: now } } } });
  if (q.credential === "NONE") and.push({ credentials: { none: live } });

  if (q.expiry === "EXPIRED") and.push({ idExpiresAt: { lt: today } });
  if (q.expiry === "EXPIRING_SOON") and.push({ idExpiresAt: { gte: today, lte: addDays(today, warnDays) } });
  if (q.expiry === "VALID") and.push({ idExpiresAt: { gt: addDays(today, warnDays) } });

  return { AND: and };
}

function orderBy(q: EmployeeListQuery): Prisma.EmployeeOrderByWithRelationInput[] {
  const field = {
    name: "displayName",
    code: "employeeCode",
    department: "department",
    idExpiresAt: "idExpiresAt",
    createdAt: "createdAt",
  }[q.sort] as keyof Prisma.EmployeeOrderByWithRelationInput;
  // Tie-break on id so pagination is deterministic.
  return [{ [field]: q.dir }, { id: q.dir }];
}

export async function listEmployees(db: Db, actor: Actor, rawQuery: unknown, ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx);
  const q = employeeListQuerySchema.parse(rawQuery ?? {});
  const settings = await getSettings(db);
  const where = buildListWhere(q, settings.expiryWarningDays);
  const [total, rows] = await db.$transaction([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      select: listSelect,
      orderBy: orderBy(q),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    rows,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    query: q,
    warnDays: settings.expiryWarningDays,
  };
}

export async function listDepartments(db: Db, actor: Actor, ctx: RequestContext): Promise<string[]> {
  await authorize(db, actor, "employee:read", ctx);
  const rows = await db.employee.findMany({
    where: { archivedAt: null },
    distinct: ["department"],
    select: { department: true },
    orderBy: { department: "asc" },
    take: 200,
  });
  return rows.map((r) => r.department);
}

export async function getEmployee(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx, { type: "employee", id });
  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      credentials: {
        orderBy: { issuedAt: "desc" },
        take: 20,
        select: {
          id: true,
          issuedAt: true,
          expiresAt: true,
          revokedAt: true,
          revokeReason: true,
          issuedBy: { select: { name: true } },
          revokedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!employee) throw notFound("Employee");
  return employee;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function createInTx(tx: Tx, actor: Actor, input: ReturnType<typeof employeeCreateSchema.parse>, ctx: RequestContext, settings: { employeeIdPrefix: string; defaultIdValidityDays: number }, now: Date) {
  const issue = input.idIssueDate ?? utcToday(now);
  const expires = input.idExpiresAt ?? addDays(issue, settings.defaultIdValidityDays);
  if (expires < issue) throw new AppError("VALIDATION", "Expiry must be on or after the issue date");
  const year = now.getUTCFullYear();
  const seq = await nextEmployeeSequence(tx, settings.employeeIdPrefix, year);
  const employee = await tx.employee.create({
    data: {
      employeeCode: formatEmployeeCode(settings.employeeIdPrefix, year, seq),
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: displayNameOf(input.firstName, input.lastName, input.displayName),
      workEmail: input.workEmail,
      phone: input.phone,
      department: input.department,
      jobTitle: input.jobTitle,
      businessVertical: input.businessVertical,
      workLocation: input.workLocation,
      joiningDate: input.joiningDate,
      idIssueDate: issue,
      idExpiresAt: expires,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });
  await recordAudit(tx, ctx, {
    actor,
    action: "employee.created",
    targetType: "employee",
    targetId: employee.id,
    metadata: { employeeCode: employee.employeeCode },
  });
  await emitEvent(tx, "employee.created", { employeeId: employee.id });
  return employee;
}

export async function createEmployee(db: Db, actor: Actor, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "employee:create", ctx);
  const input = employeeCreateSchema.parse(rawInput);
  const settings = await getSettings(db);

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await assertEmailFree(tx, input.workEmail);
        return createInTx(tx, actor, input, ctx, settings, new Date());
      });
    } catch (e) {
      // A code collision can only happen if codes were inserted outside the counter; retry safely.
      if (isUniqueViolation(e) && violationMentions(e, "employeeCode") && attempt < 3) continue;
      if (isUniqueViolation(e)) throw conflict("Another employee already uses this work email", { field: "workEmail" });
      throw e;
    }
  }
}

export async function updateEmployee(db: Db, actor: Actor, id: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "employee:update", ctx, { type: "employee", id });
  const input = employeeUpdateSchema.parse(rawInput);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.employee.findUnique({ where: { id } });
      if (!current) throw notFound("Employee");
      if (current.archivedAt) throw new AppError("INVALID_STATE", "Archived employees cannot be edited. Unarchive first.");
      await assertEmailFree(tx, input.workEmail, id);

      const data = {
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: displayNameOf(input.firstName, input.lastName, input.displayName),
        workEmail: input.workEmail,
        phone: input.phone,
        department: input.department,
        jobTitle: input.jobTitle,
        businessVertical: input.businessVertical,
        workLocation: input.workLocation,
        joiningDate: input.joiningDate,
        idIssueDate: input.idIssueDate,
        idExpiresAt: input.idExpiresAt,
      };
      const res = await tx.employee.updateMany({
        where: { id, version: input.version },
        data: { ...data, updatedById: actor.id, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw conflict("This record was changed by someone else. Reload and try again.", { reason: "version" });
      }
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => {
        const a = current[k];
        const b = data[k];
        return a instanceof Date || b instanceof Date ? a?.valueOf() !== b?.valueOf() : a !== b;
      });
      // Field names only — values may contain personal data.
      await recordAudit(tx, ctx, { actor, action: "employee.updated", targetType: "employee", targetId: id, metadata: { changed } });
      await emitEvent(tx, "employee.updated", { employeeId: id });
      return tx.employee.findUniqueOrThrow({ where: { id } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("Another employee already uses this work email", { field: "workEmail" });
    throw e;
  }
}

async function transitionInTx(tx: Tx, actor: Actor, id: string, action: StatusAction, reason: string | null, ctx: RequestContext, now: Date) {
  const current = await tx.employee.findUnique({ where: { id }, select: { id: true, employmentStatus: true, archivedAt: true } });
  if (!current) throw notFound("Employee");
  const next = applyTransition(current, action, now);
  if (!next) throw new AppError("INVALID_STATE", `Cannot ${action} an employee in the current state`);

  await tx.employee.update({
    where: { id },
    data: {
      employmentStatus: next.employmentStatus,
      archivedAt: next.archivedAt,
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
  if (next.revokeCredential) {
    const revoked = await tx.employeeCredential.updateMany({
      where: { employeeId: id, revokedAt: null },
      data: { revokedAt: now, revokedById: actor.id, revokeReason: "Employee archived", tokenCiphertext: null },
    });
    if (revoked.count) {
      await recordAudit(tx, ctx, { actor, action: "credential.revoked", targetType: "employee", targetId: id, metadata: { reason: "archived" } });
    }
  }
  await recordAudit(tx, ctx, {
    actor,
    action: `employee.${action}d`, // deactivated | reactivated | archived | unarchived
    targetType: "employee",
    targetId: id,
    metadata: { from: current.employmentStatus, to: next.employmentStatus, reason },
  });
  await emitEvent(tx, "employee.status_changed", { employeeId: id });
}

export async function changeEmployeeStatus(db: Db, actor: Actor, id: string, rawInput: unknown, ctx: RequestContext) {
  const { action, reason } = statusActionSchema.parse(rawInput);
  await authorize(db, actor, ACTION_PERMISSION[action], ctx, { type: "employee", id });
  await db.$transaction((tx) => transitionInTx(tx, actor, id, action, reason, ctx, new Date()));
  return db.employee.findUniqueOrThrow({ where: { id } });
}

/** Applies one status action to many employees atomically (all or nothing). */
export async function bulkChangeStatus(db: Db, actor: Actor, rawInput: unknown, ctx: RequestContext) {
  const { ids, action, reason } = bulkStatusSchema.parse(rawInput);
  await authorize(db, actor, ACTION_PERMISSION[action], ctx);
  const unique = [...new Set(ids)];
  const now = new Date();
  await db.$transaction(
    async (tx) => {
      for (const id of unique) await transitionInTx(tx, actor, id, action, reason, ctx, now);
      await recordAudit(tx, ctx, { actor, action: "employee.bulk_status", metadata: { action, count: unique.length } });
    },
    { timeout: 60_000 },
  );
  return { updated: unique.length };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const EXPORT_COLUMNS = [
  "employeeCode",
  "displayName",
  "department",
  "jobTitle",
  "businessVertical",
  "workLocation",
  "employmentStatus",
  "archived",
  "idIssueDate",
  "idExpiresAt",
  "workEmail",
] as const;

export const EXPORT_ROW_LIMIT = 50_000;

export async function exportEmployeesCsv(db: Db, actor: Actor, rawQuery: unknown, ctx: RequestContext): Promise<string> {
  await authorize(db, actor, "employee:export", ctx);
  const q = employeeListQuerySchema.parse(rawQuery ?? {});
  const settings = await getSettings(db);
  const rows = await db.employee.findMany({
    where: buildListWhere(q, settings.expiryWarningDays),
    orderBy: orderBy(q),
    take: EXPORT_ROW_LIMIT,
    select: {
      employeeCode: true,
      displayName: true,
      department: true,
      jobTitle: true,
      businessVertical: true,
      workLocation: true,
      employmentStatus: true,
      archivedAt: true,
      idIssueDate: true,
      idExpiresAt: true,
      workEmail: true,
    },
  });
  await recordAudit(db, ctx, { actor, action: "employee.exported", metadata: { count: rows.length, filters: q } });
  return toCsv(
    [...EXPORT_COLUMNS],
    rows.map((r) => [
      r.employeeCode,
      r.displayName,
      r.department,
      r.jobTitle,
      r.businessVertical ?? "",
      r.workLocation ?? "",
      r.employmentStatus,
      r.archivedAt ? "yes" : "no",
      r.idIssueDate.toISOString().slice(0, 10),
      r.idExpiresAt.toISOString().slice(0, 10),
      r.workEmail ?? "",
    ]),
  );
}

export const IMPORT_ROW_LIMIT = 500;
const IMPORT_COLUMNS = [
  "firstName",
  "lastName",
  "displayName",
  "workEmail",
  "phone",
  "department",
  "jobTitle",
  "businessVertical",
  "workLocation",
  "joiningDate",
  "idIssueDate",
  "idExpiresAt",
] as const;

export interface ImportRowError {
  row: number;
  messages: string[];
}

/**
 * Bulk-creates employees from CSV. All rows are validated first; if any row is
 * invalid nothing is written. Valid batches are inserted in a single transaction.
 */
export async function importEmployeesCsv(db: Db, actor: Actor, csv: string, ctx: RequestContext) {
  await authorize(db, actor, "employee:create", ctx);
  const records = parseCsv(csv);
  if (records.length < 2) throw new AppError("VALIDATION", "The CSV must contain a header row and at least one employee");
  const [header, ...body] = records;
  if (body.length > IMPORT_ROW_LIMIT) throw new AppError("VALIDATION", `At most ${IMPORT_ROW_LIMIT} rows per import`);
  const cols = header.map((h) => h.trim());
  const unknownCols = cols.filter((c) => !(IMPORT_COLUMNS as readonly string[]).includes(c));
  if (unknownCols.length) throw new AppError("VALIDATION", `Unknown columns: ${unknownCols.join(", ")}`);

  const errors: ImportRowError[] = [];
  const parsed: ReturnType<typeof employeeCreateSchema.parse>[] = [];
  const emails = new Set<string>();
  body.forEach((cells, i) => {
    const obj: Record<string, string> = {};
    cols.forEach((c, j) => {
      if (cells[j] !== undefined && cells[j] !== "") obj[c] = cells[j];
    });
    const res = employeeCreateSchema.safeParse(obj);
    if (!res.success) {
      errors.push({ row: i + 2, messages: res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) });
      return;
    }
    if (res.data.workEmail) {
      if (emails.has(res.data.workEmail)) errors.push({ row: i + 2, messages: ["workEmail: duplicated in file"] });
      emails.add(res.data.workEmail);
    }
    parsed.push(res.data);
  });
  if (errors.length) throw new AppError("VALIDATION", "Some rows are invalid; nothing was imported", { rows: errors.slice(0, 50) });

  const settings = await getSettings(db);
  try {
    const created = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const out: string[] = [];
        for (const input of parsed) {
          await assertEmailFree(tx, input.workEmail);
          out.push((await createInTx(tx, actor, input, ctx, settings, now)).employeeCode);
        }
        await recordAudit(tx, ctx, { actor, action: "employee.imported", metadata: { count: out.length } });
        return out;
      },
      { timeout: 120_000 },
    );
    return { created: created.length, codes: created };
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An employee in the file uses a work email that already exists");
    throw e;
  }
}
