/**
 * Data-retention maintenance. Run daily (cron / scheduled job):
 *   npm run maintenance:retention
 *
 * - verification events older than settings.verificationRetentionDays
 * - audit entries older than settings.auditRetentionDays (explicit purge opt-in
 *   through the append-only trigger)
 * - outbox events older than 7 days, expired sessions/verifications, stale rate-limit rows
 */
import "dotenv/config";

async function main() {
  const { db } = await import("@/server/db/client");
  const { getSettings } = await import("@/server/services/settings");
  const s = await getSettings(db);
  const day = 86_400_000;
  const now = Date.now();

  const verification = await db.verificationEvent.deleteMany({ where: { createdAt: { lt: new Date(now - s.verificationRetentionDays * day) } } });
  const audit = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.audit_purge = 'on'`;
    return tx.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now - s.auditRetentionDays * day) } } });
  });
  const outbox = await db.outboxEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 7 * day) } } });
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const verifications = await db.verification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const rate = await db.appRateLimit.deleteMany({ where: { windowStart: { lt: BigInt(now - day) } } });

  console.log(
    JSON.stringify({
      msg: "retention.complete",
      verificationEvents: verification.count,
      auditLogs: audit.count,
      outboxEvents: outbox.count,
      expiredSessions: sessions.count,
      expiredVerifications: verifications.count,
      rateLimitRows: rate.count,
    }),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
