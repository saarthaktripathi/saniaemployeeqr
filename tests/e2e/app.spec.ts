import { expect, test, type Browser, type Page } from "@playwright/test";
import { ACCOUNTS, login, stateFile } from "./helpers";

const year = new Date().getUTCFullYear();
const as = (browser: Browser, who: "owner" | "hradmin" | "hrstaff") => browser.newContext({ storageState: stateFile(who) });

async function createEmployee(page: Page, firstName: string, extra: Record<string, string> = {}) {
  await page.goto("/employees/new");
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill("Testcase");
  await page.getByLabel("Department").fill("Quality");
  await page.getByLabel("Approved job title").fill("QA Analyst");
  for (const [label, value] of Object.entries(extra)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Create employee" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${firstName} Testcase`);
  return page.url().split("/employees/")[1]!;
}

async function issueQr(page: Page) {
  await page.getByTestId("issue-qr").click();
  await page.getByRole("dialog").getByRole("button", { name: "Issue QR" }).click();
  await expect(page.getByTestId("qr-preview")).toBeVisible();
  return page.getByTestId("verify-url").inputValue();
}

test.describe("authentication and access control", () => {
  test("anonymous users are sent to login and APIs refuse them", async ({ page, request }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    expect((await request.get("/api/employees")).status()).toBe(401);
    expect((await request.get("/api/events")).status()).toBe(401);
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(ACCOUNTS.owner.email);
    await page.getByLabel("Password").fill("definitely-not-it");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toHaveText("Invalid email or password.");
  });

  test("owner sees the dashboard with database-backed totals", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Employee Directory" })).toBeVisible();
    await expect(page.getByTestId("stat-total-records").filter({ visible: true })).not.toHaveText("0");
    for (const nav of ["Add Employee", "Activity Log", "System Rules", "Users & Access"]) {
      await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: nav })).toBeVisible();
    }
    await ctx.close();
  });

  test("HR staff is read-only and blocked from restricted pages and APIs", async ({ browser }) => {
    const ctx = await as(browser, "hrstaff");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Add Employee" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.goto("/users");
    await expect(page).toHaveURL(/\/forbidden$/);
    // Direct API calls bypassing the UI are refused too.
    const res = await page.request.post("/api/employees", {
      data: { firstName: "X", department: "Y", jobTitle: "Z" },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(res.status()).toBe(403);
    await ctx.close();
  });

  test("HR admin can manage employees but not system rules", async ({ browser }) => {
    const ctx = await as(browser, "hradmin");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Add Employee" }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "System Rules" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/forbidden$/);
    await ctx.close();
  });
});

test.describe("employee lifecycle and QR verification", () => {
  test("create, edit, issue QR, verify, deactivate, reactivate and revoke", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    const id = await createEmployee(page, "Lifecycle");
    await expect(page.getByText(new RegExp(`SJB-${year}-\\d{3}`)).first()).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Approved job title").fill("Senior QA Analyst");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/employees/${id}$`));
    await expect(page.getByText("Senior QA Analyst").first()).toBeVisible();

    const url = await issueQr(page);
    expect(url).toMatch(/\/verify\/[A-Za-z0-9_-]{43}$/);

    const pub = await browser.newContext();
    const verifier = await pub.newPage();
    await verifier.goto(url);
    await expect(verifier.getByTestId("verification-status")).toHaveText("Verified — Active");
    await expect(verifier.getByTestId("employee-name")).toHaveText("Lifecycle Testcase");
    await expect(verifier.getByText("Senior QA Analyst")).toBeVisible();
    // The public page never links into the HR dashboard.
    await expect(verifier.locator('a[href^="/dashboard"], a[href^="/employees"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("Inactive employee");

    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("Verified — Active");

    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Card lost during e2e");
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("No active QR credential")).toBeVisible();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("Credential revoked");

    await pub.close();
    await ctx.close();
  });

  test("expired IDs never show as verified", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await createEmployee(page, "Expired", { "ID issue date": "2024-01-01", "ID valid until": "2025-01-01" });
    await expect(page.getByText("ID expired").first()).toBeVisible();
    const url = await issueQr(page);
    const verifier = await (await browser.newContext()).newPage();
    await verifier.goto(url);
    await expect(verifier.getByTestId("verification-status")).toHaveText("ID expired");
    await ctx.close();
  });

  test("unknown and malformed links show an invalid state", async ({ page }) => {
    await page.goto(`/verify/${"A".repeat(43)}`);
    await expect(page.getByTestId("verification-status")).toHaveText("Invalid or unknown credential");
    await page.goto("/verify/not-a-real-token");
    await expect(page.getByTestId("verification-status")).toHaveText("Invalid or unknown credential");
    await expect(page.getByTestId("employee-name")).toHaveCount(0);
  });
});

test.describe("directory", () => {
  test("searches by name and ID and paginates on the server", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByTestId("employee-row")).toHaveCount(20);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();

    await page.goto("/dashboard");
    await page.getByLabel("Search by name or employee ID").fill(`SJB-${year}-001`);
    await expect(page).toHaveURL(/q=SJB/);
    await expect(page.getByTestId("employee-row")).toHaveCount(1);

    await page.getByLabel("Search by name or employee ID").fill("zzz-no-such-person");
    await expect(page.getByText("No employees match")).toBeVisible();
    await ctx.close();
  });
});

test.describe("audit and real-time", () => {
  test("activity log shows sensitive actions to the owner", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/activity");
    const list = page.getByTestId("audit-list");
    await expect(list.getByText("QR credential revoked").first()).toBeVisible();
    await expect(list.getByText("Employee created").first()).toBeVisible();
    await page.getByRole("link", { name: "Sign-ins" }).click();
    await expect(list.getByText("Signed in").first()).toBeVisible();
    await ctx.close();
  });

  test("a change in one session appears live in another", async ({ browser }) => {
    const watcherCtx = await as(browser, "hradmin");
    const watcher = await watcherCtx.newPage();
    await watcher.goto("/dashboard");
    await expect(watcher.getByTestId("live-indicator")).toHaveAttribute("data-state", "live");
    const before = Number((await watcher.getByTestId("stat-total-records").filter({ visible: true }).textContent())!.replace(/\D/g, ""));

    const editorCtx = await as(browser, "owner");
    const editor = await editorCtx.newPage();
    await createEmployee(editor, "Realtime");

    // No reload in the watcher: the SSE event triggers a refresh of server data.
    await expect(watcher.getByTestId("stat-total-records").filter({ visible: true })).toHaveText(String(before + 1), { timeout: 15_000 });
    await expect(watcher.getByText("Realtime Testcase")).toBeVisible();
    await watcherCtx.close();
    await editorCtx.close();
  });
});

test.describe("session", () => {
  test("sign out invalidates the session server-side", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "hrstaff");
    const cookies = await ctx.cookies();
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Replaying the old cookie must not work.
    const replay = await browser.newContext();
    await replay.addCookies(cookies);
    expect((await replay.request.get("/api/employees")).status()).toBe(401);
    await replay.close();
    await ctx.close();
  });
});

test.describe("responsive and accessible", () => {
  test("mobile layout has no horizontal overflow", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: stateFile("owner"), viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    for (const path of ["/dashboard", "/employees/new", "/"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });

  test("keyboard users can skip to content and see focus", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test("security headers are present", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
