import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";

const STORAGE = "e2e/.auth-state.json";

// Log in once via the UI and reuse the session cookie across all tests.
// Credentials come from env; defaults match the local single-user dev account.
setup("authenticate", async ({ page }) => {
  setup.setTimeout(120_000); // dev-mode cold compile of the full terminal can be slow
  const username = process.env.NEXUS_E2E_USER ?? "steve";
  const password = process.env.NEXUS_E2E_PASSWORD;
  if (!password) throw new Error("Set NEXUS_E2E_PASSWORD (and optionally NEXUS_E2E_USER) to run e2e tests");
  await page.goto("/terminal/login", { waitUntil: "networkidle" });
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByLabel("Terminal command bar")).toBeVisible({ timeout: 60_000 });

  // Reset workspace to a deterministic single-panel baseline (server + local),
  // so tests don't inherit layouts accumulated by previous runs.
  const baseline = JSON.stringify({
    type: "tabs",
    id: "g-e2e-baseline",
    tabs: [{ id: "p-e2e-baseline", screen: "markets" }],
    active: "p-e2e-baseline",
  });
  await page.request.put("/terminal/api/workspace", { data: { layout: baseline } });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByLabel("Market overview")).toBeVisible({ timeout: 15_000 });

  fs.mkdirSync("e2e", { recursive: true });
  await page.context().storageState({ path: STORAGE });
});
