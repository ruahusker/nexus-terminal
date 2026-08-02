import { test, expect } from "@playwright/test";

// Unauthenticated flows — explicitly clear any stored session.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/terminal");
  await expect(page).toHaveURL(/\/terminal\/login/);
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("wrong password shows an error and stays on login", async ({ page }) => {
  await page.goto("/terminal/login", { waitUntil: "networkidle" });
  await page.getByLabel(/username/i).fill("steve");
  await page.getByLabel(/password/i).fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/invalid username or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/terminal\/login/);
});

test("API rejects unauthenticated calls", async ({ request }) => {
  const res = await request.get("http://localhost:3141/terminal/api/markets");
  expect(res.status()).toBe(401);
  const json = await res.json();
  expect(json.ok).toBe(false);
});

test("sign in lands on the terminal and sign out returns to login", async ({ page }) => {
  await page.goto("/terminal/login", { waitUntil: "networkidle" });
  await page.getByLabel(/username/i).fill(process.env.NEXUS_E2E_USER ?? "steve");
  await page.getByLabel(/password/i).fill(process.env.NEXUS_E2E_PASSWORD ?? "local-dev-only");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByLabel("Terminal command bar")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Sign out").click();
  await expect(page).toHaveURL(/\/terminal\/login/);
});
