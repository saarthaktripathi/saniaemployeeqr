/**
 * Sends due/overdue task reminders and missed punch-out alerts once (idempotent).
 * Safe to schedule daily or hourly (e.g. a Render cron job):  npm run maintenance:sweep
 */
import { db } from "@/server/db/client";
import { runSweeps } from "@/server/services/sweeps";

runSweeps(db)
  .then((r) => {
    console.log(r.ran ? `Sweeps done: ${r.tasks} task reminder(s), ${r.attendance} incomplete session(s).` : "Another instance is running the sweeps; skipped.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
