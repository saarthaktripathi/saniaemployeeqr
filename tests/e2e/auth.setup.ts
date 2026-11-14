import { test as setup } from "@playwright/test";
import { login, stateFile, type AccountKey } from "./helpers";

// Sign in once per role and reuse the session. Each setup login uses its own client IP
// (the login rate limit is per IP), so the shared bucket stays free for the login tests.
const accounts: AccountKey[] = ["owner", "hradmin", "hrstaff", "management", "manager", "employee"];
accounts.forEach((who, i) => {
  setup(`sign in as ${who}`, async ({ browser }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${10 + i}` } });
    const page = await ctx.newPage();
    await login(page, who);
    await ctx.storageState({ path: stateFile(who) });
    await ctx.close();
  });
});
