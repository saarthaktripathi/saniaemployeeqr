// Refuses to continue when pointed at something that looks like production.
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
if (process.env.NODE_ENV === "production" || !isLocal) {
  console.error("Refusing: this command is restricted to local development/test databases.");
  process.exit(1);
}
