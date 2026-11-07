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
  const launch = {
    headless: true,
    ...(process.env.OMNIX_UI_BROWSER_CHANNEL
      ? { channel: process.env.OMNIX_UI_BROWSER_CHANNEL }
      : {})
  };
  const contextOptions = {
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: "block"
  };
  const context = process.env.OMNIX_AI_PROFILE
    ? await chromium.launchPersistentContext(process.env.OMNIX_AI_PROFILE, {
        ...launch,
        ...contextOptions
      })
    : await (async () => {
        browser = await chromium.launch(launch);
        return browser.newContext(contextOptions);
      })();
  if (!browser) browser = { close: () => context.close() };
  const page = await context.newPage();
  if (process.env.OMNIX_AI_TEST_GPU_FAILURE)
    await context.route(
      "**/assistant/ort/ort-wasm-simd-threaded.jspi.mjs",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: 'throw new Error("Synthetic GPU startup failure");'
        })
    );
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
      const workspace = /planning|meeting/i.test(
        url.searchParams.get("question")
      );
      data = {
        as_of: new Date().toISOString(),
        notes_partial: false,
        items: workspace
          ? [
              {
                kind: "note",
                title: "Planning note",
                text: "The planning meeting is on Monday at noon.",
                href: "/notes/pages/browser-ai-qa"
              }
            ]
          : []
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
    .getByText(/MODEL READY \/ LOCAL (CPU|GPU)/)
    .waitFor({ timeout: 300000 });
  console.log(
    await page.getByText(/MODEL READY \/ LOCAL (CPU|GPU)/).innerText()
  );
  await page
    .getByRole("textbox", { name: "ASK OMNIX", exact: true })
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
  const evaluations = [];
  async function ask(question, expected) {
    const started = Date.now();
    const count = await page.locator(".assistant-answer").count();
    await page
      .getByRole("textbox", { name: "ASK OMNIX", exact: true })
      .fill(question);
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(page.locator(".assistant-answer")).toHaveCount(count + 1);
    await expect(page.locator(".assistant-answer").last()).toContainText(
      expected,
      { timeout: 180000 }
    );
    await expect(
      page.locator(".assistant-prompt > .assistant-progress")
    ).toHaveText("READY", { timeout: 180000 });
    const text = await page.locator(".assistant-answer").last().innerText();
    expect(text).toMatch(expected);
    expect(text).not.toMatch(/<think>|<\/think>/);
    evaluations.push({
      question,
      answer: text,
      elapsedMs: Date.now() - started
    });
    console.log(JSON.stringify(evaluations.at(-1)));
    return text;
  }
  if (process.env.OMNIX_AI_TEST_GPU_FAILURE) {
    await ask("What is the capital of France? Answer briefly.", /Paris/i);
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
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        gpuStartupFailureRecovered: true,
        cpuContextInference: true,
        cpuGeneralInference: true,
        evaluations
      })
    );
    return;
  }
  await ask("What time was that meeting again?", /noon|12/i);
  // Clear history so unrelated workspace facts cannot mask the empty-search bug.
  await page
    .getByRole("button", { name: "Context and storage", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear conversation", exact: true })
    .click();
  await ask("What is the capital of France? Answer briefly.", /Paris/i);
  await ask("What is 17 multiplied by 23? Give the number.", /391/);
  await ask(
    "Explain photosynthesis in one sentence.",
    /sunlight|light energy/i
  );
  await page
    .getByRole("button", { name: "Clear conversation", exact: true })
    .click();
  await ask(
    "What is my door access code?",
    /not have|don.t have|not know|don.t know|no information|not provided|not available|cannot access/i
  );
  // All context sources may be unchecked: general chat must still generate.
  for (const source of ["Notes", "Calendar", "Projects"])
    await page.getByRole("checkbox", { name: source, exact: true }).uncheck();
  await ask("What is the capital of Japan?", /Tokyo/i);
  await ask("Which country is that city in?", /Japan/i);
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
  await expect(page.locator(".assistant-answer").last()).toContainText(
    /Japan/i
  );
  await expect(page.getByText(/MODEL READY \/ LOCAL (CPU|GPU)/)).toBeVisible();
  const runtime = await page
    .getByText(/MODEL READY \/ LOCAL (CPU|GPU)/)
    .innerText();
  if (process.env.OMNIX_AI_TEST_GPU_FAILURE) expect(runtime).toContain("CPU");
  const countBeforeStop = await page.locator(".assistant-answer").count();
  await page
    .getByRole("textbox", { name: "ASK OMNIX", exact: true })
    .fill("Write a long, detailed story about a robot exploring a forest.");
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await expect(page.locator(".assistant-answer")).toHaveCount(
    countBeforeStop + 1
  );
  await expect(page.locator(".assistant-answer").last()).not.toHaveText(
    "Thinking locally…",
    { timeout: 180000 }
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.locator(".assistant-prompt > .assistant-progress")
  ).toHaveText("READY", { timeout: 15000 });
  await expect(page.getByText(/MODEL READY \/ LOCAL (CPU|GPU)/)).toBeVisible();
  await page
    .getByRole("button", { name: "Remove downloaded model", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Load local model", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        !(await caches.keys()).some((name) =>
          ["omnix-smollm2-v1", "omnix-ai-qwen3-06b-v1"].includes(name)
        )
    )
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      localModelInference: true,
      sourceTimeRecovered: true,
      generalKnowledge: true,
      emptyRetrievalGenerates: true,
      followUpConversation: true,
      noContextSources: true,
      runtime,
      stopKeepsModelLoaded: true,
      evaluations,
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
