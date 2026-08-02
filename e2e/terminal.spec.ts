import { test, expect } from "@playwright/test";

// Authenticated by global setup (e2e/auth.setup.ts) — session cookie is reused.

test.beforeEach(async ({ page }) => {
  await page.goto("/terminal");
  await expect(page.getByLabel("Terminal command bar")).toBeVisible();
});

test("terminal boots with default workspace and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await expect(page.getByLabel("Market overview")).toBeVisible();
  await expect(page.getByText("NEXUS TERMINAL")).toBeVisible();
  // provenance is always visible: SAMPLE banner in demo mode, LIVE label in provider mode
  await expect(page.getByText(/SAMPLE DATA|LIVE · YAHOO/).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test("command bar: type a symbol, autocomplete, enter to open security", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("MSFT");
  const option = page.getByRole("option", { name: /MSFT/ }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole("tab", { name: /MSFT DES/ })).toBeVisible();
});

test("command bar: OPTIONS command opens options chain for the symbol", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("OPTIONS SPY");
  await bar.press("Enter");
  await expect(page.getByText(/Expected move/).first()).toBeVisible({ timeout: 10_000 });
});

test("command history navigates with arrow keys", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("MARKETS");
  await bar.press("Enter");
  await bar.click();
  await bar.press("ArrowUp");
  await expect(bar).toHaveValue("MARKETS");
});

test("escape clears the command bar", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("AAPL");
  await bar.press("Escape");
  await expect(bar).toHaveValue("");
});

test("HELP lists every command and shortcuts", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("HELP");
  await bar.press("Enter");
  await expect(page.getByLabel("Help", { exact: true })).toBeVisible();
  await expect(page.getByText("QUOTE <SYM>")).toBeVisible();
  await expect(page.getByText(/Focus the command bar/)).toBeVisible();
});

test("backtick focuses the command bar", async ({ page }) => {
  await page.locator("body").click();
  await page.keyboard.press("`");
  await expect(page.getByLabel("Terminal command bar")).toBeFocused();
});

test("workspace persists across reload", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("SCREENER");
  await bar.press("Enter");
  await expect(page.getByRole("tab", { name: "SCREENER" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "SCREENER" })).toBeVisible({ timeout: 10_000 });
});

test("watchlist streams quotes and allows adding a symbol", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("WATCHLIST");
  await bar.press("Enter");
  await expect(page.getByLabel(/Watchlist Core/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("AAPL").first()).toBeVisible();
  const input = page.getByLabel("Add symbol to watchlist");
  await input.fill("TSLA");
  await input.press("Enter");
  await expect(page.getByText("TSLA")).toBeVisible();
});

test("portfolio shows seeded positions with live marks", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("PORTFOLIO");
  await bar.press("Enter");
  await expect(page.getByText("Demo Portfolio")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Unrealized|Total value/i).first()).toBeVisible();
});

test("chart screen has working drawing tools", async ({ page }) => {
  const bar = page.getByLabel("Terminal command bar");
  await bar.click();
  await bar.fill("CHART SPY");
  await bar.press("Enter");
  const trend = page.getByRole("button", { name: /^trend/i }).first();
  await expect(trend).toBeVisible({ timeout: 15_000 });
  await trend.click();
  await expect(trend).toHaveAttribute("aria-pressed", "true");
  // draw a trendline with two clicks on the chart canvas
  const chart = page.locator("canvas").first();
  await chart.waitFor({ state: "visible" });
  // wait until bars are loaded (legend shows O/H/L/C values)
  await page.waitForTimeout(2500);
  const box = (await chart.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.waitForTimeout(500);
  // clear all drawings via the Clear control
  page.on("dialog", (d) => void d.accept());
  const clear = page.getByRole("button", { name: /clear/i }).first();
  await expect(clear).toBeEnabled();
  await clear.click();
});
