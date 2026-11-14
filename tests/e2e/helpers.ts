import { expect, type Page } from "@playwright/test";

export const ACCOUNTS = {
  owner: { email: "owner@sania.local", password: () => process.env.SEED_OWNER_PASSWORD! },
  hradmin: { email: "hradmin@sania.local", password: () => process.env.SEED_HRADMIN_PASSWORD! },
  hrstaff: { email: "hrstaff@sania.local", password: () => process.env.SEED_HRSTAFF_PASSWORD! },
  management: { email: "management@sania.local", password: () => process.env.SEED_MANAGEMENT_PASSWORD! },
  manager: { email: "manager@sania.local", password: () => process.env.SEED_MANAGER_PASSWORD! },
  employee: { email: "employee@sania.local", password: () => process.env.SEED_EMPLOYEE_PASSWORD! },
} as const;

/** Workspace-only logins land on /me; HR and owner logins on the directory. */
export const WORKSPACE_ACCOUNTS: readonly AccountKey[] = ["manager", "employee"];

export type AccountKey = keyof typeof ACCOUNTS;
export const stateFile = (k: AccountKey) => `tests/e2e/.auth/${k}.json`;

export async function login(page: Page, who: AccountKey) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ACCOUNTS[who].email);
  await page.getByLabel("Password").fill(ACCOUNTS[who].password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(WORKSPACE_ACCOUNTS.includes(who) ? /\/me$/ : /\/dashboard/);
}
