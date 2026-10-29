import { expect, type Page } from "@playwright/test";

export const ACCOUNTS = {
  owner: { email: "owner@sania.local", password: () => process.env.SEED_OWNER_PASSWORD! },
  hradmin: { email: "hradmin@sania.local", password: () => process.env.SEED_HRADMIN_PASSWORD! },
  hrstaff: { email: "hrstaff@sania.local", password: () => process.env.SEED_HRSTAFF_PASSWORD! },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
export const stateFile = (k: AccountKey) => `tests/e2e/.auth/${k}.json`;

export async function login(page: Page, who: AccountKey) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(ACCOUNTS[who].email);
  await page.getByLabel("Password").fill(ACCOUNTS[who].password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
