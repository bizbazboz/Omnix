// Real API/browser contract. Use only disposable users provisioned by the isolated runner.
const fs = require("fs");
const path = require("path");
const { chromium, expect } = require(
  require.resolve("@playwright/test", {
    paths: [path.join(__dirname, "../web")]
  })
);
const origin = process.env.OMNIX_WALKING_URL;
if (
  process.env.OMNIX_WALKING_E2E !== "1" ||
  !origin ||
  !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)
)
  throw new Error(
    "Run with an isolated local walking test stack, never production users."
  );
const sessions = JSON.parse(
  fs
    .readFileSync(process.env.OMNIX_WALKING_SESSIONS, "utf8")
    .replace(/^\uFEFF/, "")
);
let browser;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OMNIX_UI_BROWSER_CHANNEL
      ? { channel: process.env.OMNIX_UI_BROWSER_CHANNEL }
      : {})
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    permissions: ["geolocation"],
    geolocation: { latitude: 51.503, longitude: -0.127 }
  });
  await context.addCookies([sessions[0]]);
  // No geocoding, routing or map services outside Omnix may be used.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  // Keep a short response latency so even a tiny local graph exercises busy UI.
  // The request still reaches the real API and its unmodified response is used.
  await page.route("**/api/v1/health/walks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ response });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/health/walks");
  const generate = page.getByRole("button", {
    name: "Generate loop",
    exact: true
  });
  const start = page.getByRole("combobox", {
    name: "Start location",
    exact: true
  });
  await expect(generate).toBeDisabled();
  await start.fill(process.env.OMNIX_WALKING_SEARCH || "Parliament Square");
  const option = page.getByRole("option").first();
  await expect(option).toBeVisible();
  await start.press("ArrowDown");
  await start.press("Enter");
  const label = await start.inputValue();
  const distance = page.getByRole("spinbutton", { name: /Target distance/ });
  await distance.fill("3.2");
  await expect(generate).toBeEnabled();
  let lastStarted = Date.now();
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/health/walks") &&
      response.request().method() === "POST"
  );
  await generate.click();
  await expect(
    page.getByRole("button", { name: "Calculating…", exact: true })
  ).toBeDisabled();
  await expect(start).toBeDisabled();
  const first = await generated;
  expect(first.status(), await first.text()).toBe(200);
  const route = await first.json();
  expect(route.coordinates.length).toBeGreaterThan(4);
  expect(route.coordinates[0]).toEqual(route.coordinates.at(-1));
  expect(route.distance_m).toBeGreaterThanOrEqual(2240);
  expect(route.distance_m).toBeLessThanOrEqual(4160);
  expect(route.repeated_fraction).toBeLessThanOrEqual(0.35);
  await expect(
    page.getByRole("img", { name: "Saved walking loop route outline" })
  ).toBeVisible();
  await page.locator(".daily-walk-result summary").click();
  await expect(page.locator(".daily-walk-result ol li")).toHaveCount(
    route.steps.length
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export GPX", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("omnix-walking-loop.gpx");
  const xml = fs.readFileSync(await download.path(), "utf8");
  const parsed = await page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    return {
      error: !!xml.querySelector("parsererror"),
      version: xml.documentElement.getAttribute("version"),
      points: Array.from(xml.getElementsByTagName("trkpt"), (node) => [
        Number(node.getAttribute("lon")),
        Number(node.getAttribute("lat"))
      ]),
      name: xml.querySelector("metadata > name")?.textContent,
      start: xml.querySelector("wpt > name")?.textContent
    };
  }, xml);
  expect(parsed.error).toBe(false);
  expect(parsed.version).toBe("1.1");
  expect(parsed.points).toEqual(route.coordinates);
  expect(parsed.name).toContain(label);
  expect(parsed.start).toBe("Start / finish");
  await page.reload();
  await expect(start).toHaveValue(label);
  await expect(distance).toHaveValue("3.2");
  await expect(generate).toBeEnabled();
  // An invalid hidden distance must not prevent a valid speed/time route.
  await distance.fill("");
  const stale = await context.request.get(
    origin + "/api/v1/health/walks/gpx?created_at=old"
  );
  expect(stale.status()).toBe(409);
  await page.route("**/health/walks/gpx?*", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "The saved route changed. Reload before downloading."
      })
    })
  );
  await page.getByRole("link", { name: "Export GPX", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("saved route changed");
  expect(new URL(page.url()).pathname).toBe("/health/walks");
  await page.unroute("**/health/walks/gpx?*");
  await page
    .getByRole("group", { name: "Walking target", exact: true })
    .getByRole("button", { name: "Speed / time", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: /Walking speed/ }).fill("12");
  await page.getByRole("spinbutton", { name: /Walking time/ }).fill("360");
  await expect(generate).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose a speed" })
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: /Walking speed/ }).fill("4");
  await page.getByRole("spinbutton", { name: /Walking time/ }).fill("45");
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await expect(start).toHaveValue("Current location");
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 15500 - (Date.now() - lastStarted)))
  );
  lastStarted = Date.now();
  const next = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/health/walks") &&
      response.request().method() === "POST"
  );
  await generate.click();
  const second = await next;
  expect(second.status(), await second.text()).toBe(200);
  const timed = await second.json();
  expect(timed.requested_km).toBe(3);
  expect(timed.duration_s).toBe(Math.round(timed.distance_m / (4 / 3.6)));
  await page.reload();
  await expect(start).toHaveValue("Current location");
  await expect(
    page.getByRole("spinbutton", { name: /Walking time/ })
  ).toHaveValue("45");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main.main");
      return (
        document.documentElement.scrollWidth > innerWidth + 1 ||
        main.scrollWidth > main.clientWidth + 1
      );
    });
    expect(overflow, "Walking page overflows at " + width).toBe(false);
    if (process.env.OMNIX_UI_SCREENSHOTS) {
      fs.mkdirSync(process.env.OMNIX_UI_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.OMNIX_UI_SCREENSHOTS,
          "walking-real-" + width + ".png"
        )
      });
    }
  }
  await context.setGeolocation({ latitude: 0, longitude: 0 });
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 15500 - (Date.now() - lastStarted)))
  );
  const failed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/health/walks") &&
      response.request().method() === "POST"
  );
  await generate.click();
  expect((await failed).status()).toBe(422);
  await expect(page.getByRole("alert")).toContainText("No walking paths");
  await expect(
    page.getByRole("img", { name: "Saved walking loop route outline" })
  ).toBeVisible();
  const saved = await (
    await context.request.get(origin + "/api/v1/health/walks")
  ).json();
  expect(saved.route.created_at).toBe(timed.created_at);
  const other = await browser.newContext();
  await other.addCookies([sessions[1]]);
  expect(
    (await (await other.request.get(origin + "/api/v1/health/walks")).json())
      .route
  ).toBeNull();
  expect(
    (await other.request.get(origin + "/api/v1/health/walks/gpx")).status()
  ).toBe(404);
  const anonymous = await browser.newContext();
  expect(
    (await anonymous.request.get(origin + "/api/v1/health/walks/gpx")).status()
  ).toBe(401);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      realWalkingApi: true,
      locationKeyboardSearch: true,
      distanceKm: route.distance_m / 1000,
      speedTime: true,
      closedLoop: true,
      gpxPoints: parsed.points.length,
      reloadRestoresPlanner: true,
      failedRoutePreservesSaved: true,
      exportErrorsInline: true,
      ownership: true,
      responsiveWidths: [320, 390, 768, 1440],
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
