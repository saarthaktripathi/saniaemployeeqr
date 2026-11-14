import { expect, test, type Browser, type Page } from "@playwright/test";
import { stateFile, type AccountKey } from "./helpers";

const as = (browser: Browser, who: AccountKey, opts: Parameters<Browser["newContext"]>[0] = {}) => browser.newContext({ storageState: stateFile(who), ...opts });
const origin = (page: Page) => ({ Origin: new URL(page.url()).origin });

/** A future date (YYYY-MM-DD) that is not a Sunday (the default weekly off). */
function futureWorkday(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function myName(page: Page): Promise<string> {
  await page.goto("/me/profile");
  return (await page.getByRole("heading", { level: 2 }).first().textContent())!.trim();
}

test.describe("employee workspace and role-based access", () => {
  test("employees land on their own workspace and cannot reach the HR console or HR APIs", async ({ browser }) => {
    const ctx = await as(browser, "employee");
    const page = await ctx.newPage();
    await page.goto("/home");
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
    await expect(page.getByTestId("attendance-card")).toBeVisible();
    await expect(page.getByTestId("my-profile-card")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dashboard" }).first().getByRole("link", { name: "Employee Directory" })).toHaveCount(0);
    for (const path of ["/dashboard", "/attendance", "/tasks", "/leave", "/accounts", "/users", "/employees/new"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/me$/);
    }
    for (const api of ["/api/employees", "/api/tasks", "/api/leave", "/api/attendance/corrections", "/api/accounts", "/api/announcements"]) {
      expect((await page.request.get(api)).status(), api).toBe(403);
    }
    // Cannot act as HR through the API either.
    expect((await page.request.post("/api/attendance/corrections", { data: { employeeId: "00000000-0000-0000-0000-000000000000", kind: "ADD_SESSION", workDate: "2026-01-05", punchIn: "09:00", punchOut: "10:00", reason: "hack" }, headers: origin(page) })).status()).toBe(403);
    await ctx.close();
  });

  test("HR console users are kept out of other people's private data in the workspace", async ({ browser }) => {
    // The owner account has no linked employee record, so /me sends them back to the console.
    const ctx = await as(browser, "owner");
    const page = await ctx.newPage();
    await page.goto("/me");
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.post("/api/me/attendance/punch-in", { data: { location: "OFFICE" }, headers: origin(page) })).status()).toBe(403);
    await ctx.close();
  });
});

test.describe("attendance", () => {
  test("employee punches in and out with server time; HR sees it live; sign-out warns while punched in", async ({ browser }) => {
    const hr = await as(browser, "hradmin");
    const hrPage = await hr.newPage();
    await hrPage.goto("/attendance");
    await expect(hrPage.getByTestId("live-indicator")).toHaveAttribute("data-state", "live", { timeout: 15_000 });
    const working = hrPage.getByTestId("kpi-working").locator("[data-kpi-value]").filter({ visible: true });
    const before = Number(await working.textContent());

    const ctx = await as(browser, "employee");
    const page = await ctx.newPage();
    await page.goto("/me");
    await page.getByLabel("Where are you working today?").selectOption("WORK_FROM_HOME");
    await page.getByTestId("punch-in").click();
    await expect(page.getByTestId("attendance-status")).toHaveText("Punched in");
    await expect(page.getByTestId("running-duration")).toBeVisible();
    await expect(page.getByTestId("punch-in")).toHaveCount(0);

    // HR's board updates without a reload.
    await expect(working).toHaveText(String(before + 1), { timeout: 20_000 });

    // A second punch-in (another tab or a replayed request) is rejected; client timestamps are not accepted.
    expect((await page.request.post("/api/me/attendance/punch-in", { data: { location: "OFFICE" }, headers: origin(page) })).status()).toBe(409);
    expect((await page.request.post("/api/me/attendance/punch-out", { data: { punchOutAt: "2020-01-01T00:00:00Z" }, headers: origin(page) })).status()).toBe(422);

    // Signing out is not punching out: the guard explains and offers to punch out first.
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    const guard = page.getByTestId("logout-guard");
    await expect(guard).toBeVisible();
    await expect(guard).toContainText("does not punch you out");
    await guard.getByRole("button", { name: "Cancel" }).click();

    await page.getByTestId("punch-out").click();
    await expect(page.getByTestId("punch-in")).toBeVisible();
    await expect(page.getByTestId("attendance-status")).not.toHaveText("Punched in");
    await expect(working).toHaveText(String(before), { timeout: 20_000 });

    // The employee's own history shows today's session.
    await page.goto("/me/attendance");
    await expect(page.getByTestId("my-days").locator("li").first()).toContainText("Work from home");
    await ctx.close();
    await hr.close();
  });

  test("HR resolves a missed punch-out with an audited correction", async ({ browser }) => {
    const ctx = await as(browser, "hradmin");
    const page = await ctx.newPage();
    await page.goto("/attendance?tab=incomplete");
    const row = page.getByTestId("incomplete-list").locator("li").first();
    await expect(row).toContainText("Missed punch-out");
    await row.getByRole("button", { name: "Resolve" }).click();
    const form = page.locator("dialog[open]").getByTestId("correction-form");
    await form.getByLabel("Punch out").fill("18:00");
    await form.getByLabel("Reason").fill("Confirmed with the employee: left at 6 pm");
    await form.getByRole("button", { name: "Apply correction" }).click();
    await expect(page.getByTestId("incomplete-list")).toHaveCount(0);
    await page.goto("/attendance/corrections?status=APPLIED");
    await expect(page.getByTestId("correction-row").first()).toContainText("Add a missed punch-out");
    await expect(page.getByTestId("correction-row").first()).toContainText("Before");
    await ctx.close();
  });

  test("employee requests a correction and HR applies it", async ({ browser }) => {
    const ctx = await as(browser, "employee");
    const page = await ctx.newPage();
    await page.goto("/me/attendance");
    // The seed leaves the demo employee's day three days ago without punches.
    const day = page.getByTestId("my-days").locator("li").filter({ hasText: "No punches" }).filter({ has: page.getByRole("button", { name: "Request correction" }) }).first();
    await day.getByRole("button", { name: "Request correction" }).click();
    const form = page.locator("dialog[open]").getByTestId("correction-form");
    await form.getByLabel("Punch in").fill("09:30");
    await form.getByLabel("Punch out").fill("13:30");
    await form.getByLabel("Reason").fill("Biometric device was down");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("my-corrections")).toContainText("Pending");

    const hr = await as(browser, "hradmin");
    const hrPage = await hr.newPage();
    await hrPage.goto("/attendance/corrections");
    const pending = hrPage.getByTestId("correction-row").filter({ hasText: "Biometric device was down" });
    await pending.getByTestId("apply-correction").click();
    await expect(hrPage.getByTestId("correction-row").filter({ hasText: "Biometric device was down" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("my-corrections")).toContainText("Approved");
    await hr.close();
    await ctx.close();
  });
});

test.describe("tasks and leave", () => {
  test("HR assigns a task, the employee works on it and submits, HR approves", async ({ browser }) => {
    const emp = await as(browser, "employee");
    const page = await emp.newPage();
    const name = await myName(page);

    const hr = await as(browser, "hradmin");
    const hrPage = await hr.newPage();
    await hrPage.goto("/tasks/new");
    await hrPage.getByLabel("Title").fill("E2E: submit the monthly timesheet");
    await hrPage.getByLabel("Instructions").fill("Upload your timesheet for the month.");
    await hrPage.getByLabel("Priority").selectOption("HIGH");
    await hrPage.getByLabel("Due date").fill(futureWorkday(3));
    await hrPage.getByRole("combobox", { name: "Search employees to assign" }).fill(name.split(" ")[0]!);
    await hrPage.getByRole("listbox", { name: "Employees" }).getByRole("option", { name: new RegExp(name) }).first().click();
    await expect(hrPage.getByTestId("selected-assignees")).toContainText(name);
    await hrPage.getByRole("button", { name: "Assign task" }).click();
    await expect(hrPage.getByRole("heading", { level: 1 })).toHaveText("E2E: submit the monthly timesheet");

    await page.goto("/me/tasks");
    await page.getByTestId("task-row").filter({ hasText: "E2E: submit the monthly timesheet" }).click();
    await expect(page.getByTestId("task-description")).toContainText("Upload your timesheet");
    await page.getByRole("button", { name: "Start working" }).click();
    await expect(page.getByTestId("my-assignment")).toContainText("In progress");
    await page.getByLabel("Note for the reviewer (optional)").fill("Done. Timesheet sent to finance as well.");
    await page.getByTestId("submit-task").click();
    await expect(page.getByTestId("my-assignment")).toContainText("Waiting for review");

    await hrPage.reload();
    await hrPage.getByTestId("review-panel").getByRole("button", { name: "Approve" }).click();
    await expect(hrPage.getByTestId("assignment-row").first()).toHaveAttribute("data-status", "APPROVED");

    await page.goto("/me/tasks?view=completed");
    await expect(page.getByTestId("task-row").filter({ hasText: "E2E: submit the monthly timesheet" })).toBeVisible();
    await expect(page.getByTestId("unread-count")).toBeVisible();
    await hr.close();
    await emp.close();
  });

  test("employee applies for leave and HR approves it", async ({ browser }) => {
    const emp = await as(browser, "employee");
    const page = await emp.newPage();
    const name = await myName(page);
    await page.goto("/me/leave");
    const date = futureWorkday(20);
    const form = page.getByTestId("leave-form");
    const casual = await form.getByLabel("Leave type").locator("option", { hasText: "Casual leave" }).getAttribute("value");
    await form.getByLabel("Leave type").selectOption(casual!);
    await form.getByLabel("From").fill(date);
    await form.getByLabel("To").fill(date);
    await form.getByLabel("Reason").fill("E2E personal errand");
    await form.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByTestId("my-leave-requests")).toContainText("E2E personal errand");

    const hr = await as(browser, "hradmin");
    const hrPage = await hr.newPage();
    await hrPage.goto("/leave");
    const row = hrPage.getByTestId("leave-row").filter({ hasText: "E2E personal errand" });
    await expect(row).toContainText(name);
    await row.getByTestId("approve-leave").click();
    await expect(hrPage.getByTestId("leave-row").filter({ hasText: "E2E personal errand" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("my-leave-requests").locator("li").filter({ hasText: "E2E personal errand" })).toContainText("Approved");
    await hr.close();
    await emp.close();
  });

  test("team managers see their team and can assign only to it", async ({ browser }) => {
    const ctx = await as(browser, "manager");
    const page = await ctx.newPage();
    await page.goto("/me/team");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team Attendance");
    await expect(page.getByTestId("attendance-table").or(page.getByText("Nobody reports to you yet")).first()).toBeVisible();
    await page.goto("/me/team/tasks");
    await expect(page.getByTestId("task-admin-row").filter({ hasText: "weekly client report" })).toBeVisible();
    await page.goto("/me/team/tasks/new");
    await expect(page.getByTestId("task-form")).toBeVisible();
    // The HR attendance board is not available to managers.
    await page.goto("/attendance");
    await expect(page).toHaveURL(/\/me$/);
    expect((await page.request.post("/api/tasks", { data: { title: "Whole department", target: "DEPARTMENT", department: "Finance" }, headers: origin(page) })).status()).toBe(403);
    await ctx.close();
  });
});

test.describe("employee accounts", () => {
  test("HR invites an employee, who sets a password and lands in the workspace", async ({ browser }) => {
    const hr = await as(browser, "hradmin");
    const page = await hr.newPage();
    await page.goto("/accounts?state=none");
    const row = page.getByTestId("access-row").first();
    await row.getByRole("button", { name: "Invite" }).click();
    const email = `invitee-${Date.now()}@example.com`;
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Login email").fill(email);
    await dialog.getByRole("button", { name: "Create invitation link" }).click();
    const link = await page.locator("dialog[open]").getByTestId("one-time-link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    const fresh = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.77" } });
    const p = await fresh.newPage();
    await p.goto(link);
    await p.getByLabel("New password").fill("a long and memorable passphrase");
    await p.getByLabel("Confirm password").fill("a long and memorable passphrase");
    await p.getByRole("button", { name: "Activate my account" }).click();
    await expect(p.getByTestId("password-set")).toBeVisible();
    // Single use.
    await p.goto(link);
    await expect(p.getByTestId("invite-invalid")).toBeVisible();
    await p.goto("/login");
    await p.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await p.getByLabel("Password").fill("a long and memorable passphrase");
    await p.getByRole("button", { name: "Sign in" }).click();
    await expect(p).toHaveURL(/\/me$/);
    await fresh.close();
    await hr.close();
  });
});

test.describe("workforce pages on phones", () => {
  test("HR and employee pages have no horizontal overflow at 375 px", async ({ browser }) => {
    for (const [who, paths] of [
      ["hradmin", ["/attendance", "/attendance/history", "/attendance/corrections", "/attendance/reports", "/attendance/policy", "/tasks", "/tasks/new", "/leave", "/leave?view=calendar", "/accounts", "/announcements", "/notifications"]],
      ["employee", ["/me", "/me/attendance", "/me/tasks", "/me/calendar", "/me/leave", "/me/profile", "/me/notifications", "/me/settings"]],
      ["manager", ["/me/team", "/me/team/tasks"]],
    ] as const) {
      const ctx = await as(browser, who, { viewport: { width: 375, height: 812 } });
      const page = await ctx.newPage();
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${who} ${path}`).toBeLessThanOrEqual(0);
      }
      await ctx.close();
    }
  });
});
