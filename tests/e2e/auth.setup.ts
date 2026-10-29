import { test as setup } from "@playwright/test";
import { login, stateFile, type AccountKey } from "./helpers";

// Sign in once per role and reuse the session, keeping well under the login rate limit.
for (const who of ["owner", "hradmin", "hrstaff"] as AccountKey[]) {
  setup(`sign in as ${who}`, async ({ page }) => {
    await login(page, who);
    await page.context().storageState({ path: stateFile(who) });
  });
}
