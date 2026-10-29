import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

declare global {
  var __prisma: PrismaClient | undefined;
}

function create() {
  const adapter = new PrismaPg({
    connectionString: env().DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    statement_timeout: 15_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}

function client(): PrismaClient {
  globalThis.__prisma ??= create();
  return globalThis.__prisma;
}

/**
 * Process-wide Prisma client, created on first use so that importing this module
 * (e.g. during `next build`) never requires runtime secrets.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
