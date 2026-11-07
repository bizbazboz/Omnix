// Real browser inference with public pinned weights and synthetic private context.
const fs = require("fs");
const path = require("path");
const { chromium, expect } = require(
  require.resolve("@playwright/test", {
    paths: [path.join(__dirname, "../web")]
  })
);
const origin = process.env.OMNIX_UI_URL || "http://127.0.0.1:8080";
let browser;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OMNIX_UI_BROWSER_CHANNEL
      ? { channel: process.env.OMNIX_UI_BROWSER_CHANNEL }
      : {})
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    remote = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== origin)
      remote.push({ url: request.url(), method: request.method() });
  });
  await context.route(origin + "/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname.replace("/api/v1", "");
    let data = {};
    if (p === "/me")
      data = {
        id: "browser-ai-qa",
        name: "Browser QA",
        email: "qa@example.test",
        csrf: "test-only",
        is_admin: false
      };
    else if (p === "/config")
      data = { oidc_configured: true, setup_available: false };
    else if (p === "/products") data = [{ id: "iot", name: "IoT" }];
    else if (p === "/connections") data = [];
    else if (p === "/iot/devices") data = { configured: false, items: [] };
    else if (p === "/settings/workspace")
      data = { name: "Omnix", private_mail_hosts: [] };
    else if (p === "/settings/preferences")
      data = {
        display_name: "Browser QA",
        timezone: "Europe/London",
        time_format: "24",
        start_page: "overview",
        onboarding_completed: true
      };
    else if (p === "/assistant/context") {
      expect(url.searchParams.get("question")).toBe(
        "At what time is the planning meeting?"
      );
      data = {
        as_of: new Date().toISOString(),
        notes_partial: false,
        items: [
          {
            kind: "note",
            title: "Planning note",
            text: "The planning meeting is on Monday at noon.",
            href: "/notes/pages/browser-ai-qa"
          }
        ]
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data)
    });
  });
  await page.goto(origin + "/iot");
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ask AI", exact: true })
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Load local model", exact: true })
    .click();
  await page
    .getByText("MODEL READY / LOCAL CPU", { exact: true })
    .waitFor({ timeout: 300000 });
  await page
    .getByRole("textbox", { name: "ASK YOUR WORKSPACE", exact: true })
    .fill("At what time is the planning meeting?");
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Ask AI", exact: true })
    .waitFor({ timeout: 180000 });
  const answer = await page.locator(".assistant-answer").innerText();
  expect(answer).toMatch(/noon|12/i);
  await page.locator(".assistant-answers summary").click();
  await expect(
    page.getByRole("link", { name: /Planning note/ })
  ).toHaveAttribute("href", "/notes/pages/browser-ai-qa");
  expect(remote.every((r) => ["GET", "HEAD"].includes(r.method))).toBe(true);
  expect(remote.every((r) => !r.url.includes("planning"))).toBe(true);
  if (process.env.OMNIX_UI_SCREENSHOTS) {
    fs.mkdirSync(process.env.OMNIX_UI_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(
        process.env.OMNIX_UI_SCREENSHOTS,
        "browser-ai-inference.png"
      )
    });
  }
  await page
    .getByRole("button", { name: "Minimise AI chat", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await expect(page.locator(".assistant-answer")).toContainText(/noon|12/i);
  await expect(
    page.getByText("MODEL READY / LOCAL CPU", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Context and storage", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove downloaded model", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Load local model", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () => !(await caches.keys()).includes("omnix-smollm2-v1")
    )
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      localModelInference: true,
      sourceTimeRecovered: true,
      sourceLinks: true,
      externalInferenceRequests: 0,
      modelCacheRemoval: true,
      runtimeErrors: 0
    })
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
