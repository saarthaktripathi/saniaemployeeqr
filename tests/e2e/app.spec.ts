import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
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
    await expect(verifier.getByTestId("verification-status")).toHaveText("VALID");
    await expect(verifier.getByTestId("employee-name")).toHaveText("Lifecycle Testcase");
    await expect(verifier.getByText("Senior QA Analyst").first()).toBeVisible();
    // The public page never links into the HR dashboard.
    await expect(verifier.locator('a[href^="/dashboard"], a[href^="/employees"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("INACTIVE");

    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("VALID");

    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Card lost during e2e");
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("No active QR credential")).toBeVisible();
    await verifier.reload();
    await expect(verifier.getByTestId("verification-status")).toHaveText("REVOKED");

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
    await expect(verifier.getByTestId("verification-status")).toHaveText("EXPIRED");
    await expect(verifier.getByTestId("verification-label")).toHaveText("ID validity date has passed");
    await ctx.close();
  });

  test("unknown and malformed links show an invalid state", async ({ page }) => {
    await page.goto(`/verify/${"A".repeat(43)}`);
    await expect(page.getByTestId("verification-status")).toHaveText("INVALID");
    await page.goto("/verify/not-a-real-token");
    await expect(page.getByTestId("verification-status")).toHaveText("INVALID");
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
    await expect(watcher.getByTestId("employee-row").getByText("Realtime Testcase")).toBeVisible();
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
    for (const path of ["/dashboard", "/employees/new", "/employees/import", "/activity", "/"]) {
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

const photoFile = async (name = "portrait.png", w = 600, h = 800) => ({
  name,
  mimeType: "image/png",
  buffer: await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 110, b: 190 } } }).png().toBuffer(),
});

test.describe("employee photo and digital ID card", () => {
  test("add with photo → QR → scan shows the card with the photo; remove on edit", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/employees/new");
    await page.getByLabel("First name").fill("Photo");
    await page.getByLabel("Last name").fill("Testcase");
    await page.getByLabel("Department").fill("Quality");
    await page.getByLabel("Approved job title").fill("Photo Analyst");
    await page.locator("#photo-file").filter({ visible: true }).setInputFiles(await photoFile());
    await expect(page.getByRole("slider", { name: /Photo position/ })).toBeVisible();
    await page.getByRole("slider", { name: "Zoom", exact: true }).fill("1.5");
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Photo Testcase");
    // Profile header shows the stored photo (served by the authenticated photo API).
    const avatar = page.locator('img[src*="/photo?size=full"]').first();
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);

    const url = await issueQr(page);
    const verifierCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const verifier = await verifierCtx.newPage();
    await verifier.goto(url);
    await expect(verifier.getByTestId("verification-status")).toHaveText("VALID");
    await expect(verifier.getByTestId("employee-name")).toHaveText("Photo Testcase");
    await expect(verifier.locator('[data-testid="id-card-svg"] image[href^="data:image/webp"]')).toHaveCount(1);
    const overflow = await verifier.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // ID card page: card with photo, PNG and PDF downloads.
    await page.getByRole("link", { name: "ID card" }).click();
    await expect(page.locator('[data-testid="id-card-svg"] image[href^="data:image/webp"]')).toHaveCount(1);
    const png = page.waitForEvent("download");
    await page.getByRole("button", { name: "PNG" }).click();
    expect((await png).suggestedFilename()).toMatch(/-id-card\.png$/);
    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF" }).click();
    const pdfFile = await pdf;
    expect(pdfFile.suggestedFilename()).toMatch(/-id-card\.pdf$/);
    const bytes = await (await import("node:fs/promises")).readFile((await pdfFile.path())!);
    expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");

    // Edit: existing photo is shown; remove it and the card falls back to initials.
    await page.goto(page.url().replace(/\/id-card$/, "/edit"));
    await expect(page.getByRole("img", { name: /Current photo of/ })).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Photo Testcase");
    await expect(page.locator('img[src*="/photo?size=full"]')).toHaveCount(0);
    await verifier.reload();
    await expect(verifier.locator('[data-testid="id-card-svg"] image[href^="data:"]')).toHaveCount(0);
    await verifierCtx.close();
    await ctx.close();
  });

  test("rejects unsupported and too-small images", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/employees/new");
    await page.locator("#photo-file").filter({ visible: true }).setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByTestId("photo-error")).toHaveText(/JPEG, PNG or WebP/);
    await page.locator("#photo-file").filter({ visible: true }).setInputFiles(await photoFile("tiny.png", 60, 60));
    await expect(page.getByTestId("photo-error")).toHaveText(/too small/);
    // The server enforces its own rules even if the browser checks are bypassed.
    const origin = new URL(page.url()).origin;
    const created = await page.request.post("/api/employees", { data: { firstName: "Upload", department: "Ops", jobTitle: "Lead" }, headers: { Origin: origin } });
    const { employee } = await created.json();
    const bad = await page.request.put(`/api/employees/${employee.id}/photo`, { data: Buffer.from("not an image"), headers: { "Content-Type": "image/png", Origin: origin } });
    expect(bad.status()).toBe(422);
    const gif = await page.request.put(`/api/employees/${employee.id}/photo`, { data: Buffer.from("GIF89a"), headers: { "Content-Type": "image/gif", Origin: origin } });
    expect(gif.status()).toBe(422);
    await ctx.close();
  });

  test("read-only HR staff cannot upload photos", async ({ browser }) => {
    const owner = await as(browser, "owner");
    const op = await owner.newPage();
    const id = await createEmployee(op, "Noupload");
    const ctx = await as(browser, "hrstaff");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    const res = await page.request.put(`/api/employees/${id}/photo`, {
      data: (await photoFile()).buffer,
      headers: { "Content-Type": "image/png", Origin: new URL(page.url()).origin },
    });
    expect(res.status()).toBe(403);
    await ctx.close();
    await owner.close();
  });
});

test.describe("interactive dashboard", () => {
  test("KPI cards filter the directory in place and highlight the selection", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    const activeCard = page.getByRole("button", { name: /^Active/ });
    const activeCount = Number((await page.getByTestId("stat-active").filter({ visible: true }).textContent())!.replace(/\D/g, ""));
    await activeCard.click();
    await expect(page).toHaveURL(/status=ACTIVE/);
    await expect(activeCard).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(`of ${activeCount.toLocaleString("en-IN")} employees`)).toBeVisible();
    const badges = await page.getByTestId("employee-row").getByText(/^(Active|Inactive)$/).allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set(["Active"]));

    // Another card replaces the filter instead of stacking with it.
    await page.getByRole("button", { name: /^Expiring Soon/ }).click();
    await expect(page).toHaveURL(/expiry=EXPIRING_SOON/);
    await expect(page).not.toHaveURL(/status=/);
    // Combine with search, then clear everything.
    await page.getByLabel("Search by name or employee ID").fill("Testcase");
    await expect(page).toHaveURL(/q=Testcase/);
    await expect(page).toHaveURL(/expiry=EXPIRING_SOON/);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /^Total Employees/ })).toHaveAttribute("aria-pressed", "true");
    await ctx.close();
  });

  test("bulk import accepts a CSV and skips rows already imported", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/employees/import");
    const csv = { name: "staff.csv", mimeType: "text/csv", buffer: Buffer.from("firstName,lastName,department,jobTitle\r\nImport,Onecase,Ops,Lead\r\nImport,Twocase,Ops,Lead\r\n") };
    await page.locator("#csv").filter({ visible: true }).setInputFiles(csv);
    await page.getByRole("button", { name: "Validate and import" }).click();
    const result = page.getByRole("status").filter({ hasText: "Import complete" });
    await expect(result).toContainText("2 created");
    await page.locator("#csv").filter({ visible: true }).setInputFiles(csv);
    await page.getByRole("button", { name: "Validate and import" }).click();
    await expect(result).toContainText("0 created · 2 skipped");
    await ctx.close();
  });

  test("collapsible sidebar remembers its state; notifications show real activity", async ({ browser }) => {
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-state", "live"); // hydrated
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Recent activity")).toBeVisible();
    await expect(menu.locator("li").first()).not.toHaveText(/Loading|No activity yet/);
    await ctx.close();
  });
});
