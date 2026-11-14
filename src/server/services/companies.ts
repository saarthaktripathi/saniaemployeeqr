import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/lib/errors";
import { companyCreateSchema, companyUpdateSchema } from "@/features/directory/schema";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./authorize";

export interface CompanyRow {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: string;
  /** Non-archived employees. */
  employees: number;
  activeEmployees: number;
  /** All records including archived (a company can only be deleted when this is 0). */
  totalRecords: number;
}

/** Companies of the group with head counts. Names are visible to everyone who can read the directory. */
export async function listCompanies(db: Db, actor: Actor, ctx: RequestContext): Promise<CompanyRow[]> {
  await authorize(db, actor, "employee:read", ctx);
  const [companies, counts] = await Promise.all([
    db.company.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    db.$queryRaw<{ companyId: string; total: bigint; current: bigint; active: bigint }[]>`
      SELECT "companyId"::text AS "companyId",
        count(*) AS total,
        count(*) FILTER (WHERE "archivedAt" IS NULL) AS current,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "employmentStatus" = 'ACTIVE') AS active
      FROM "employee" GROUP BY "companyId"`,
  ]);
  const byId = new Map(counts.map((c) => [c.companyId, c]));
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    employees: Number(byId.get(c.id)?.current ?? 0),
    activeEmployees: Number(byId.get(c.id)?.active ?? 0),
    totalRecords: Number(byId.get(c.id)?.total ?? 0),
  }));
}

async function assertNameFree(tx: Db | Tx, name: string, exceptId?: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id"::text FROM "company" WHERE lower("name") = lower(${name}) LIMIT 1`;
  if (rows[0] && rows[0].id !== exceptId) throw conflict("A company with this name already exists", { field: "name" });
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function createCompany(db: Db, actor: Actor, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "company:manage", ctx);
  const input = companyCreateSchema.parse(rawInput);
  try {
    return await db.$transaction(async (tx) => {
      await assertNameFree(tx, input.name);
      const company = await tx.company.create({ data: { name: input.name, code: input.code ?? null } });
      await recordAudit(tx, ctx, { actor, action: "company.created", targetType: "company", targetId: company.id, metadata: { name: company.name } });
      await emitEvent(tx, "dashboard.changed", {});
      return company;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A company with this name already exists", { field: "name" });
    throw e;
  }
}

export async function updateCompany(db: Db, actor: Actor, id: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "company:manage", ctx, { type: "company", id });
  const input = companyUpdateSchema.parse(rawInput);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.company.findUnique({ where: { id } });
      if (!current) throw notFound("Company");
      if (input.name && input.name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(tx, input.name, id);
      if (input.isActive === false && current.isActive) {
        const active = await tx.company.count({ where: { isActive: true } });
        if (active <= 1) throw new AppError("INVALID_STATE", "At least one company must stay active");
      }
      const company = await tx.company.update({ where: { id }, data: { name: input.name, code: input.code, isActive: input.isActive } });
      const changed = (["name", "code", "isActive"] as const).filter((k) => input[k] !== undefined && input[k] !== current[k]);
      await recordAudit(tx, ctx, { actor, action: "company.updated", targetType: "company", targetId: id, metadata: { changed, name: company.name } });
      await emitEvent(tx, "dashboard.changed", {});
      return company;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A company with this name already exists", { field: "name" });
    throw e;
  }
}

/** Only companies without any employee records (including archived) can be deleted. */
export async function deleteCompany(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  await authorize(db, actor, "company:manage", ctx, { type: "company", id });
  await db.$transaction(async (tx) => {
    const company = await tx.company.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
    if (!company) throw notFound("Company");
    if (company._count.employees > 0) {
      throw new AppError("INVALID_STATE", `${company.name} still has ${company._count.employees} employee records. Move or delete them first, or mark the company inactive.`);
    }
    if ((await tx.company.count()) <= 1) throw new AppError("INVALID_STATE", "The group needs at least one company");
    if (company.isActive && (await tx.company.count({ where: { isActive: true } })) <= 1) {
      throw new AppError("INVALID_STATE", "At least one company must stay active");
    }
    await tx.company.delete({ where: { id } });
    await recordAudit(tx, ctx, { actor, action: "company.deleted", targetType: "company", targetId: id, metadata: { name: company.name } });
    await emitEvent(tx, "dashboard.changed", {});
  });
  return { deleted: true };
}
