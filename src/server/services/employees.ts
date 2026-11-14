import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/lib/errors";
import {
  bulkStatusSchema,
  deleteEmployeesSchema,
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeUpdateSchema,
  exitSchema,
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
import { EMPLOYMENT_TYPE_LABELS, EXIT_TYPE_LABELS, WORK_MODE_LABELS, type EmploymentType, type WorkMode } from "@/features/employees/labels";
import { parseCsv, toCsv } from "@/lib/csv";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { getSettings } from "./settings";
import { authorize } from "./authorize";
import { appendHistory, type HistoryDraft } from "./history";

export { authorize };

const validation = (field: string, message: string) => new AppError("VALIDATION", message, { field });

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
// Companies and reporting lines
// ---------------------------------------------------------------------------

export interface CompanyRef {
  id: string;
  name: string;
}

/**
 * Resolves the company for a record. When none is given, the only active company is used;
 * with several active companies the caller must choose.
 */
async function resolveCompany(tx: Db | Tx, companyId: string | null | undefined): Promise<CompanyRef> {
  if (!companyId) {
    const active = await tx.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, take: 2 });
    if (active.length === 1) return active[0];
    throw validation("companyId", active.length ? "Choose the employee's company" : "Add a company first (Companies page)");
  }
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, isActive: true } });
  if (!company) throw validation("companyId", "Company not found");
  if (!company.isActive) throw validation("companyId", `${company.name} is inactive and can't receive employees`);
  return { id: company.id, name: company.name };
}

/** Longest reporting chain walked when checking for loops. */
const MAX_CHAIN = 200;

/** Validates a reporting manager: exists, not archived, not the employee, and no reporting loop. */
async function resolveManager(tx: Tx, managerId: string, employeeId: string | null): Promise<{ id: string; displayName: string }> {
  if (employeeId && managerId === employeeId) throw validation("reportingManagerId", "An employee can't report to themselves");
  const manager = await tx.employee.findUnique({ where: { id: managerId }, select: { id: true, displayName: true, archivedAt: true } });
  if (!manager) throw validation("reportingManagerId", "Reporting manager not found");
  if (manager.archivedAt) throw validation("reportingManagerId", "Archived employees can't be reporting managers");
  if (employeeId) {
    // Serialise reporting-line changes so two concurrent edits can't create a loop between them.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-reporting-lines'))`;
    const loop = await tx.$queryRaw<{ found: number }[]>`
      WITH RECURSIVE chain AS (
        SELECT "id", "reportingManagerId", 1 AS depth FROM "employee" WHERE "id" = ${managerId}::uuid
        UNION ALL
        SELECT e."id", e."reportingManagerId", c.depth + 1 FROM "employee" e
        JOIN chain c ON e."id" = c."reportingManagerId" WHERE c.depth < ${MAX_CHAIN}
      )
      SELECT 1 AS found FROM chain WHERE "id" = ${employeeId}::uuid LIMIT 1`;
    if (loop.length) throw validation("reportingManagerId", "This would create a reporting loop (the manager reports to this employee)");
  }
  return { id: manager.id, displayName: manager.displayName };
}

/** Exit dates are calendar dates; one day of tolerance covers time zones ahead of UTC (e.g. India). */
function assertExitDate(exitDate: Date, joiningDate: Date | null, now: Date) {
  if (exitDate > addDays(utcToday(now), 1)) {
    throw validation("exitDate", "The exit date can't be in the future. Record the exit on or after the last working day.");
  }
  if (joiningDate && exitDate < joiningDate) throw validation("exitDate", "The exit date is before the joining date");
}

const typeLabel = (v: EmploymentType | null | undefined) => (v ? EMPLOYMENT_TYPE_LABELS[v] : null);
const modeLabel = (v: WorkMode | null | undefined) => (v ? WORK_MODE_LABELS[v] : null);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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
  employmentType: true,
  workMode: true,
  team: true,
  exitDate: true,
  idExpiresAt: true,
  archivedAt: true,
  updatedAt: true,
  photoKey: true,
  photoUpdatedAt: true,
  company: { select: { id: true, name: true, code: true } },
  credentials: {
    where: { revokedAt: null },
    select: { id: true, expiresAt: true, revokedAt: true },
    take: 1,
  },
} satisfies Prisma.EmployeeSelect;

export type EmployeeListRow = Prisma.EmployeeGetPayload<{ select: typeof listSelect }>;

/** Escapes LIKE wildcards: Prisma passes them through, so input must be matched literally. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function buildListWhere(q: EmployeeListQuery, warnDays: number, now = new Date()): Prisma.EmployeeWhereInput {
  const and: Prisma.EmployeeWhereInput[] = [];
  const today = utcToday(now);

  if (q.status === "ARCHIVED") and.push({ archivedAt: { not: null } });
  else {
    and.push({ archivedAt: null });
    if (q.status === "EXITED") and.push({ exitDate: { not: null } });
    else if (q.status !== "ALL") and.push({ employmentStatus: q.status });
  }
  if (q.q) {
    const term = likeLiteral(q.q);
    and.push({
      OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { employeeCode: { startsWith: term, mode: "insensitive" } },
        { workEmail: { startsWith: term, mode: "insensitive" } },
      ],
    });
  }
  if (q.company) and.push({ companyId: q.company });
  if (q.department) and.push({ department: { equals: q.department, mode: "insensitive" } });
  if (q.designation) and.push({ jobTitle: { equals: q.designation, mode: "insensitive" } });
  if (q.type !== "ANY") and.push({ employmentType: q.type });
  if (q.mode !== "ANY") and.push({ workMode: q.mode });
  if (q.manager) and.push({ reportingManagerId: q.manager });

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
  // Tie-break on id so pagination is deterministic.
  if (q.sort === "joiningDate") return [{ joiningDate: { sort: q.dir, nulls: "last" } }, { id: q.dir }];
  const field = {
    name: "displayName",
    code: "employeeCode",
    department: "department",
    idExpiresAt: "idExpiresAt",
    createdAt: "createdAt",
  }[q.sort] as keyof Prisma.EmployeeOrderByWithRelationInput;
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

export interface DirectoryOptions {
  companies: { id: string; name: string; code: string | null; isActive: boolean }[];
  departments: string[];
  designations: string[];
  teams: string[];
  verticals: string[];
  locations: string[];
}

/** Columns offered as suggestions/filters. Fixed allow-list: interpolated into SQL as identifiers. */
const OPTION_COLUMNS = { departments: "department", designations: "jobTitle", teams: "team", verticals: "businessVertical", locations: "workLocation" } as const;

/** Values for filter dropdowns and form suggestions (non-archived records only). */
export async function listDirectoryOptions(db: Db, actor: Actor, ctx: RequestContext): Promise<DirectoryOptions> {
  await authorize(db, actor, "employee:read", ctx);
  const distinct = async (column: string) => {
    const col = Prisma.raw(`"${column}"`);
    const rows = await db.$queryRaw<{ v: string }[]>`
      SELECT DISTINCT ${col} AS v FROM "employee"
      WHERE "archivedAt" IS NULL AND ${col} IS NOT NULL AND btrim(${col}) <> ''
      ORDER BY 1 LIMIT 300`;
    return rows.map((r) => r.v);
  };
  const [companies, departments, designations, teams, verticals, locations] = await Promise.all([
    db.company.findMany({ select: { id: true, name: true, code: true, isActive: true }, orderBy: { name: "asc" } }),
    distinct(OPTION_COLUMNS.departments),
    distinct(OPTION_COLUMNS.designations),
    distinct(OPTION_COLUMNS.teams),
    distinct(OPTION_COLUMNS.verticals),
    distinct(OPTION_COLUMNS.locations),
  ]);
  return { companies, departments, designations, teams, verticals, locations };
}

const personSelect = { id: true, displayName: true, employeeCode: true, jobTitle: true, photoKey: true, photoUpdatedAt: true } as const;

export async function getEmployee(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx, { type: "employee", id });
  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, code: true, isActive: true } },
      reportingManager: { select: { ...personSelect, archivedAt: true } },
      directReports: {
        where: { archivedAt: null },
        orderBy: { displayName: "asc" },
        take: 50,
        select: { ...personSelect, employmentStatus: true },
      },
      _count: { select: { directReports: { where: { archivedAt: null } } } },
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

const optionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  exclude: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
});

/** Small type-ahead list (e.g. the reporting-manager picker). Non-archived employees only. */
export async function searchEmployeeOptions(db: Db, actor: Actor, rawQuery: unknown, ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx);
  const { q, exclude } = optionsQuerySchema.parse(rawQuery ?? {});
  const term = likeLiteral(q);
  const rows = await db.employee.findMany({
    where: {
      archivedAt: null,
      ...(exclude ? { id: { not: exclude } } : {}),
      ...(q ? { OR: [{ displayName: { contains: term, mode: "insensitive" } }, { employeeCode: { startsWith: term, mode: "insensitive" } }] } : {}),
    },
    select: { ...personSelect, department: true, company: { select: { name: true } } },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: 10,
  });
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    employeeCode: r.employeeCode,
    jobTitle: r.jobTitle,
    department: r.department,
    company: r.company.name,
    photoUpdatedAt: r.photoKey && r.photoUpdatedAt ? r.photoUpdatedAt.toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type EmployeeCreate = ReturnType<typeof employeeCreateSchema.parse>;

async function createInTx(
  tx: Tx,
  actor: Actor,
  input: EmployeeCreate,
  ctx: RequestContext,
  settings: { employeeIdPrefix: string; defaultIdValidityDays: number },
  now: Date,
  company: CompanyRef,
) {
  const issue = input.idIssueDate ?? utcToday(now);
  const expires = input.idExpiresAt ?? addDays(issue, settings.defaultIdValidityDays);
  if (expires < issue) throw new AppError("VALIDATION", "Expiry must be on or after the issue date");
  if (input.reportingManagerId) await resolveManager(tx, input.reportingManagerId, null);
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
      companyId: company.id,
      department: input.department,
      jobTitle: input.jobTitle,
      businessVertical: input.businessVertical,
      employmentType: input.employmentType,
      workMode: input.workMode,
      workLocation: input.workLocation,
      team: input.team,
      reportingManagerId: input.reportingManagerId,
      attendanceRef: input.attendanceRef,
      leavePolicy: input.leavePolicy,
      leaveSystemUrl: input.leaveSystemUrl,
      joiningDate: input.joiningDate,
      employmentStatus: input.employmentStatus,
      idIssueDate: issue,
      idExpiresAt: expires,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });
  await appendHistory(tx, employee.id, actor, [
    { kind: "JOINED", effectiveDate: input.joiningDate ?? utcToday(now), toValue: `${employee.jobTitle} · ${employee.department} · ${company.name}` },
  ]);
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
        const company = await resolveCompany(tx, input.companyId);
        return createInTx(tx, actor, input, ctx, settings, new Date(), company);
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
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.employee.findUnique({
        where: { id },
        include: { company: { select: { id: true, name: true } }, reportingManager: { select: { id: true, displayName: true } } },
      });
      if (!current) throw notFound("Employee");
      if (current.archivedAt) throw new AppError("INVALID_STATE", "Archived employees cannot be edited. Unarchive first.");
      await assertEmailFree(tx, input.workEmail, id);

      // Company: absent = unchanged; moving to another company requires an active one.
      if (input.companyId === null) throw validation("companyId", "Choose the employee's company");
      const company = input.companyId && input.companyId !== current.companyId ? await resolveCompany(tx, input.companyId) : current.company;

      // Reporting manager: absent = unchanged, null/"" = none.
      let manager = current.reportingManager;
      if (input.reportingManagerId !== undefined && input.reportingManagerId !== current.reportingManagerId) {
        manager = input.reportingManagerId ? await resolveManager(tx, input.reportingManagerId, id) : null;
      }

      // Exit details are set by "Record exit"; here they can only be corrected afterwards.
      const exitTouched = [input.exitDate, input.exitType, input.exitReason].some((v) => v !== undefined);
      if (exitTouched && !current.exitDate && (input.exitDate || input.exitType || input.exitReason)) {
        throw new AppError("INVALID_STATE", "Use “Record exit” to record an exit");
      }
      if (exitTouched && current.exitDate) {
        if (input.exitDate === null) throw validation("exitDate", "Exit date is required. To undo an exit, reactivate the employee.");
        if (input.exitType === null) throw validation("exitType", "Choose the exit type");
        if (input.exitDate) assertExitDate(input.exitDate, input.joiningDate ?? null, now);
      }
      const exitEditable = Boolean(current.exitDate);

      const data = {
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: displayNameOf(input.firstName, input.lastName, input.displayName),
        workEmail: input.workEmail,
        phone: input.phone,
        companyId: company.id,
        department: input.department,
        jobTitle: input.jobTitle,
        businessVertical: input.businessVertical,
        employmentType: input.employmentType,
        workMode: input.workMode,
        workLocation: input.workLocation,
        team: input.team,
        reportingManagerId: input.reportingManagerId,
        attendanceRef: input.attendanceRef,
        leavePolicy: input.leavePolicy,
        leaveSystemUrl: input.leaveSystemUrl,
        joiningDate: input.joiningDate,
        exitDate: exitEditable ? (input.exitDate ?? undefined) : undefined,
        exitType: exitEditable ? (input.exitType ?? undefined) : undefined,
        exitReason: exitEditable ? input.exitReason : undefined,
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
      // `undefined` means "left unchanged".
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => {
        const b = data[k];
        if (b === undefined) return false;
        const a = current[k];
        return a instanceof Date || b instanceof Date ? a?.valueOf() !== b?.valueOf() : a !== b;
      });

      // Employment history: job changes take effect today.
      const today = utcToday(now);
      const drafts: HistoryDraft[] = [];
      const track = (kind: HistoryDraft["kind"], from: string | null | undefined, to: string | null | undefined) => {
        if ((from ?? null) !== (to ?? null)) drafts.push({ kind, effectiveDate: today, fromValue: from ?? null, toValue: to ?? null });
      };
      track("DESIGNATION", current.jobTitle, input.jobTitle);
      track("DEPARTMENT", current.department, input.department);
      if (company.id !== current.companyId) track("COMPANY", current.company.name, company.name);
      if ((manager?.id ?? null) !== current.reportingManagerId) {
        drafts.push({ kind: "MANAGER", effectiveDate: today, fromValue: current.reportingManager?.displayName ?? null, toValue: manager?.displayName ?? null });
      }
      if (input.employmentType !== undefined) track("EMPLOYMENT_TYPE", typeLabel(current.employmentType), typeLabel(input.employmentType));
      if (input.workMode !== undefined) track("WORK_MODE", modeLabel(current.workMode), modeLabel(input.workMode));
      track("LOCATION", current.workLocation, input.workLocation);
      await appendHistory(tx, id, actor, drafts);

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
  const current = await tx.employee.findUnique({ where: { id }, select: { id: true, employmentStatus: true, archivedAt: true, exitDate: true } });
  if (!current) throw notFound("Employee");
  const next = applyTransition(current, action, now);
  if (!next) throw new AppError("INVALID_STATE", `Cannot ${action} an employee in the current state`);
  // Reactivating someone who exited means they rejoined: the exit details are cleared.
  const rejoin = action === "reactivate" && current.exitDate !== null;

  await tx.employee.update({
    where: { id },
    data: {
      employmentStatus: next.employmentStatus,
      archivedAt: next.archivedAt,
      ...(rejoin ? { exitDate: null, exitType: null, exitReason: null } : {}),
      updatedById: actor.id,
      version: { increment: 1 },
    },
  });
  if (rejoin) {
    await appendHistory(tx, id, actor, [{ kind: "REJOINED", effectiveDate: utcToday(now), fromValue: `Exited ${isoDay(current.exitDate!)}`, note: reason }]);
  }
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
    metadata: { from: current.employmentStatus, to: next.employmentStatus, reason, ...(rejoin ? { rejoined: true } : {}) },
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

/**
 * Records that an employee has left: sets the exit details and makes the record INACTIVE,
 * so their QR immediately verifies as "Not a current employee". The QR is not revoked and the
 * record stays in the directory (archive it separately to hide it). Reactivating = rejoining.
 */
export async function recordExit(db: Db, actor: Actor, id: string, rawInput: unknown, ctx: RequestContext) {
  const input = exitSchema.parse(rawInput);
  await authorize(db, actor, "employee:deactivate", ctx, { type: "employee", id });
  const now = new Date();
  await db.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id }, select: { id: true, employmentStatus: true, archivedAt: true, exitDate: true, joiningDate: true } });
    if (!current) throw notFound("Employee");
    if (current.archivedAt) throw new AppError("INVALID_STATE", "Archived employees can't be changed. Unarchive first.");
    if (current.exitDate) throw new AppError("INVALID_STATE", "An exit is already recorded. Edit the exit details instead.");
    assertExitDate(input.exitDate, current.joiningDate, now);
    await tx.employee.update({
      where: { id },
      data: {
        employmentStatus: "INACTIVE",
        exitDate: input.exitDate,
        exitType: input.exitType,
        exitReason: input.reason,
        updatedById: actor.id,
        version: { increment: 1 },
      },
    });
    await appendHistory(tx, id, actor, [{ kind: "EXITED", effectiveDate: input.exitDate, toValue: EXIT_TYPE_LABELS[input.exitType] }]);
    // The reason stays on the record only (it may be sensitive); the audit keeps the type.
    await recordAudit(tx, ctx, {
      actor,
      action: "employee.exited",
      targetType: "employee",
      targetId: id,
      metadata: { from: current.employmentStatus, to: "INACTIVE", exitType: input.exitType },
    });
    await emitEvent(tx, "employee.status_changed", { employeeId: id });
  });
  return db.employee.findUniqueOrThrow({ where: { id } });
}

/**
 * Permanently deletes employees (one or many) atomically. Their QR credentials are
 * deleted too, so any printed QR verifies as "Invalid". Photos, documents, compensation and
 * history are removed with the record; direct reports lose their manager link. Verification
 * analytics keep their counts (the link is set to null). The audit log is append-only and keeps
 * a record of each deletion with the employee code; codes are never reused.
 */
export async function deleteEmployees(db: Db, actor: Actor, rawInput: unknown, ctx: RequestContext) {
  const { ids, reason } = deleteEmployeesSchema.parse(rawInput);
  await authorize(db, actor, "employee:delete", ctx);
  const unique = [...new Set(ids)];
  const deleted = await db.$transaction(
    async (tx) => {
      const found = await tx.employee.findMany({ where: { id: { in: unique } }, select: { id: true, employeeCode: true } });
      if (found.length !== unique.length) throw notFound("Employee");
      await tx.employeeCredential.deleteMany({ where: { employeeId: { in: unique } } });
      await tx.employee.deleteMany({ where: { id: { in: unique } } });
      for (const e of found) {
        await recordAudit(tx, ctx, { actor, action: "employee.deleted", targetType: "employee", targetId: e.id, metadata: { employeeCode: e.employeeCode, reason } });
      }
      if (found.length > 1) await recordAudit(tx, ctx, { actor, action: "employee.bulk_deleted", metadata: { count: found.length, reason } });
      await emitEvent(tx, "employee.deleted", {});
      return found.length;
    },
    { timeout: 120_000 },
  );
  return { deleted };
}

export interface DuplicateMember {
  id: string;
  employeeCode: string;
  createdAt: Date;
  hasCredential: boolean;
  archived: boolean;
}

export interface DuplicateGroup {
  displayName: string;
  department: string;
  jobTitle: string;
  /** Oldest record (or the one with a live QR credential) — suggested to keep. */
  keep: DuplicateMember;
  /** The other copies — suggested for removal. */
  extras: DuplicateMember[];
}

export const DUPLICATE_GROUP_LIMIT = 500;

/** Identity key for duplicate detection. Must stay in step with duplicateKeyOf(). */
const DUPLICATE_KEY_SQL = Prisma.sql`concat_ws('|', e."companyId"::text,
  lower(btrim(e."displayName")), lower(btrim(e."department")), lower(btrim(e."jobTitle")),
  coalesce(lower(btrim(e."businessVertical")), ''), coalesce(lower(btrim(e."workLocation")), ''),
  coalesce(e."joiningDate"::text, ''), coalesce(btrim(e."phone"), ''), coalesce(lower(btrim(e."workEmail")), ''))`;

function duplicateKeyOf(input: EmployeeCreate, companyId: string): string {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return [
    companyId,
    norm(displayNameOf(input.firstName, input.lastName, input.displayName)),
    norm(input.department),
    norm(input.jobTitle),
    norm(input.businessVertical),
    norm(input.workLocation),
    input.joiningDate ? isoDay(input.joiningDate) : "",
    (input.phone ?? "").trim(),
    norm(input.workEmail),
  ].join("|");
}

/**
 * Finds employee records that look like the same person entered more than once
 * (typically the same CSV imported twice). Records match when company, name, department,
 * job title, vertical, location, joining date, phone and work email are equal
 * (case- and whitespace-insensitive). Within each group the record with a live QR
 * credential is kept, otherwise the oldest.
 */
export async function findDuplicateEmployees(db: Db, actor: Actor, ctx: RequestContext) {
  await authorize(db, actor, "employee:read", ctx);
  const rows = await db.$queryRaw<
    { id: string; employeeCode: string; displayName: string; department: string; jobTitle: string; createdAt: Date; archived: boolean; hasCredential: boolean; key: string }[]
  >`
    WITH keyed AS (
      SELECT e."id", e."employeeCode", e."displayName", e."department", e."jobTitle", e."createdAt",
        e."archivedAt" IS NOT NULL AS "archived",
        EXISTS (SELECT 1 FROM "employee_credential" c WHERE c."employeeId" = e."id" AND c."revokedAt" IS NULL) AS "hasCredential",
        ${DUPLICATE_KEY_SQL} AS "key"
      FROM "employee" e
    ),
    grouped AS (
      SELECT *, count(*) OVER (PARTITION BY "key") AS "n" FROM keyed
    )
    SELECT "id"::text, "employeeCode", "displayName", "department", "jobTitle", "createdAt", "archived", "hasCredential", "key"
    FROM grouped WHERE "n" > 1
    ORDER BY "key", "hasCredential" DESC, "archived" ASC, "createdAt" ASC, "employeeCode" ASC`;

  // Rows arrive sorted by key with the record to keep first in each group.
  const byKey = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const member: DuplicateMember = { id: r.id, employeeCode: r.employeeCode, createdAt: r.createdAt, hasCredential: r.hasCredential, archived: r.archived };
    const group = byKey.get(r.key);
    if (group) group.extras.push(member);
    else if (byKey.size < DUPLICATE_GROUP_LIMIT) byKey.set(r.key, { displayName: r.displayName, department: r.department, jobTitle: r.jobTitle, keep: member, extras: [] });
  }
  const groups = [...byKey.values()];
  return { groups, extraCount: groups.reduce((n, g) => n + g.extras.length, 0) };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const EXPORT_COLUMNS = [
  "employeeCode",
  "displayName",
  "company",
  "department",
  "jobTitle",
  "businessVertical",
  "employmentType",
  "workMode",
  "workLocation",
  "team",
  "reportingManager",
  "employmentStatus",
  "archived",
  "joiningDate",
  "exitDate",
  "idIssueDate",
  "idExpiresAt",
  "workEmail",
] as const;

export const EXPORT_ROW_LIMIT = 50_000;

/** Directory export. Never includes phone numbers, compensation, documents or attendance references. */
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
      company: { select: { name: true } },
      department: true,
      jobTitle: true,
      businessVertical: true,
      employmentType: true,
      workMode: true,
      workLocation: true,
      team: true,
      reportingManager: { select: { employeeCode: true } },
      employmentStatus: true,
      archivedAt: true,
      joiningDate: true,
      exitDate: true,
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
      r.company.name,
      r.department,
      r.jobTitle,
      r.businessVertical ?? "",
      r.employmentType ?? "",
      r.workMode ?? "",
      r.workLocation ?? "",
      r.team ?? "",
      r.reportingManager?.employeeCode ?? "",
      r.employmentStatus,
      r.archivedAt ? "yes" : "no",
      r.joiningDate ? isoDay(r.joiningDate) : "",
      r.exitDate ? isoDay(r.exitDate) : "",
      isoDay(r.idIssueDate),
      isoDay(r.idExpiresAt),
      r.workEmail ?? "",
    ]),
  );
}

export const IMPORT_ROW_LIMIT = 500;
export const IMPORT_COLUMNS = [
  "firstName",
  "lastName",
  "displayName",
  "workEmail",
  "phone",
  "company",
  "department",
  "jobTitle",
  "businessVertical",
  "employmentType",
  "workMode",
  "workLocation",
  "team",
  "reportingManager",
  "attendanceRef",
  "leavePolicy",
  "joiningDate",
  "idIssueDate",
  "idExpiresAt",
  "employmentStatus",
] as const;

export interface ImportRowError {
  row: number;
  messages: string[];
}

/**
 * Bulk-creates employees from CSV. All rows are validated first; if any row is
 * invalid nothing is written. Valid batches are inserted in a single transaction.
 * `company` is a company name or code (optional while the group has one active company);
 * `reportingManager` is an existing employee ID such as SJB-2026-001.
 * With `skipDuplicates`, rows matching an existing employee (or an earlier row in
 * the same file) are skipped, so uploading the same file twice creates nothing new.
 */
export async function importEmployeesCsv(db: Db, actor: Actor, csv: string, ctx: RequestContext, opts: { skipDuplicates?: boolean } = {}) {
  await authorize(db, actor, "employee:create", ctx);
  const records = parseCsv(csv);
  if (records.length < 2) throw new AppError("VALIDATION", "The CSV must contain a header row and at least one employee");
  const [header, ...body] = records;
  if (body.length > IMPORT_ROW_LIMIT) throw new AppError("VALIDATION", `At most ${IMPORT_ROW_LIMIT} rows per import`);
  const cols = header.map((h) => h.trim());
  const unknownCols = cols.filter((c) => !(IMPORT_COLUMNS as readonly string[]).includes(c));
  if (unknownCols.length) throw new AppError("VALIDATION", `Unknown columns: ${unknownCols.join(", ")}`);

  // Look-ups for company names/codes and manager employee IDs.
  const companies = await db.company.findMany({ select: { id: true, name: true, code: true, isActive: true } });
  const companyByKey = new Map<string, (typeof companies)[number]>();
  for (const c of companies) {
    companyByKey.set(c.name.trim().toLowerCase(), c);
    if (c.code) companyByKey.set(c.code.toLowerCase(), c);
  }
  const activeCompanies = companies.filter((c) => c.isActive);
  const defaultCompany = activeCompanies.length === 1 ? activeCompanies[0] : null;
  const managerCol = cols.indexOf("reportingManager");
  const managerCodes = managerCol < 0 ? [] : [...new Set(body.map((r) => (r[managerCol] ?? "").trim().toUpperCase()).filter(Boolean))];
  const managers = managerCodes.length
    ? await db.employee.findMany({ where: { employeeCode: { in: managerCodes }, archivedAt: null }, select: { id: true, employeeCode: true } })
    : [];
  const managerByCode = new Map(managers.map((m) => [m.employeeCode.toUpperCase(), m.id]));

  const errors: ImportRowError[] = [];
  const parsed: { input: EmployeeCreate; company: CompanyRef }[] = [];
  const emails = new Set<string>();
  const fileKeys = new Set<string>();
  let skippedInFile = 0;
  body.forEach((cells, i) => {
    const obj: Record<string, string> = {};
    cols.forEach((c, j) => {
      if (cells[j] !== undefined && cells[j].trim() !== "") obj[c] = cells[j];
    });
    const messages: string[] = [];
    const { company: companyCell, reportingManager: managerCell, ...fields } = obj;
    let company: (typeof companies)[number] | null = null;
    if (companyCell) {
      company = companyByKey.get(companyCell.trim().toLowerCase()) ?? null;
      if (!company) messages.push(`company: no company named “${companyCell.trim()}”`);
      else if (!company.isActive) messages.push(`company: ${company.name} is inactive`);
    } else if (defaultCompany) company = defaultCompany;
    else messages.push("company: required (the group has several companies)");
    let reportingManagerId: string | undefined;
    if (managerCell) {
      reportingManagerId = managerByCode.get(managerCell.trim().toUpperCase());
      if (!reportingManagerId) messages.push(`reportingManager: no current employee with ID ${managerCell.trim()}`);
    }
    const res = employeeCreateSchema.safeParse({ ...fields, ...(reportingManagerId ? { reportingManagerId } : {}) });
    if (!res.success) messages.push(...res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
    if (messages.length || !res.success || !company) {
      errors.push({ row: i + 2, messages });
      return;
    }
    // A row repeated in the same file is a duplicate, not an email clash.
    if (opts.skipDuplicates) {
      const key = duplicateKeyOf(res.data, company.id);
      if (fileKeys.has(key)) {
        skippedInFile++;
        return;
      }
      fileKeys.add(key);
    }
    if (res.data.workEmail) {
      if (emails.has(res.data.workEmail)) errors.push({ row: i + 2, messages: ["workEmail: duplicated in file"] });
      emails.add(res.data.workEmail);
    }
    parsed.push({ input: res.data, company: { id: company.id, name: company.name } });
  });
  if (errors.length) throw new AppError("VALIDATION", "Some rows are invalid; nothing was imported", { rows: errors.slice(0, 50) });

  let toCreate = parsed;
  if (opts.skipDuplicates) {
    const names = [...new Set(parsed.map((p) => displayNameOf(p.input.firstName, p.input.lastName, p.input.displayName).trim().toLowerCase()))];
    const existing = await db.$queryRaw<{ key: string }[]>`
      SELECT ${DUPLICATE_KEY_SQL} AS "key" FROM "employee" e WHERE lower(btrim(e."displayName")) = ANY(${names})`;
    const seen = new Set(existing.map((r) => r.key));
    toCreate = parsed.filter((p) => !seen.has(duplicateKeyOf(p.input, p.company.id)));
  }
  const skipped = parsed.length - toCreate.length + skippedInFile;

  const settings = await getSettings(db);
  try {
    const created = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const out: string[] = [];
        for (const { input, company } of toCreate) {
          await assertEmailFree(tx, input.workEmail);
          out.push((await createInTx(tx, actor, input, ctx, settings, now, company)).employeeCode);
        }
        await recordAudit(tx, ctx, { actor, action: "employee.imported", metadata: { count: out.length, skipped } });
        return out;
      },
      { timeout: 120_000 },
    );
    return { created: created.length, skipped, codes: created };
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An employee in the file uses a work email that already exists");
    throw e;
  }
}
