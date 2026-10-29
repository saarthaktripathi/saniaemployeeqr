/**
 * Bootstraps the first Owner account on a fresh (e.g. production) database.
 * The password is read from the environment so it never appears in shell history
 * or source control.
 *
 *   OWNER_EMAIL=you@company.com OWNER_NAME="Full Name" OWNER_PASSWORD=... npm run owner:create
 *
 * `--if-missing` (used in the hosting start command on platforms without a shell):
 * does nothing — successfully — when an owner already exists or the OWNER_* variables
 * are not set, so it never blocks startup. Remove OWNER_PASSWORD from the host's
 * environment after the first sign-in, and change the password in Account Security.
 */
import "dotenv/config";

const ifMissing = process.argv.includes("--if-missing");

function stop(message: string): never {
  if (ifMissing) {
    console.log(`[owner:ensure] ${message}`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const name = process.env.OWNER_NAME?.trim();
  const password = process.env.OWNER_PASSWORD;

  const { db } = await import("@/server/db/client");
  if ((await db.user.count({ where: { role: "OWNER" } })) > 0) {
    await db.$disconnect();
    stop("An owner already exists. Manage users from the dashboard instead.");
  }
  if (!email || !name || !password) {
    await db.$disconnect();
    stop("No owner exists yet. Set OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD (min 12 chars) to create one.");
  }

  const { createUser } = await import("@/server/services/users");
  const { systemContext, systemActor } = await import("@/server/services/context");
  const user = await createUser(db, systemActor(), { name, email, password, role: "OWNER", extraPermissions: [] }, systemContext("owner-bootstrap"));
  console.log(`Owner created: ${user.email}. Sign in, enrol MFA, then remove OWNER_PASSWORD from the environment.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
