import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("response", async (r) => {
  if (r.status() >= 400) console.log("[http]", r.status(), r.url(), (await r.text()).slice(0, 200));
});
await page.goto("http://localhost:3141/");
await page.waitForTimeout(6000);
await browser.close();
