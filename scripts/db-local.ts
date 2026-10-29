/**
 * Runs a local PostgreSQL server for development without Docker, using the
 * `embedded-postgres` binaries. Data persists in ./.data/postgres.
 *
 *   npm run db:start   (leave running in its own terminal; Ctrl+C to stop)
 *
 * Development only — never use this for production data.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const databaseDir = path.resolve(".data/postgres");
const dbNames = (process.env.LOCAL_PG_DATABASES ?? "sania_local,sania_test").split(",");

async function main() {
  const fresh = !fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: true,
    onLog: () => {},
  });
  if (fresh) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  for (const name of dbNames) {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await pg.createDatabase(name);
  }
  await client.end();
  console.log(`Local PostgreSQL running on port ${port} (databases: ${dbNames.join(", ")}). Ctrl+C to stop.`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
