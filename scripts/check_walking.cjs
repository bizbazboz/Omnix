// Browser-only routing and GPX: no Omnix walking API or stored map is used.
const fs = require("fs"),
  path = require("path"),
  { walkingFixture } = require("./walking_fixture.cjs");
const { chromium, expect } = require(
  require.resolve("@playwright/test", {
    paths: [path.join(__dirname, "../web")]
  })
);
const origin = process.env.OMNIX_UI_URL || "http://127.0.0.1:8080",
  live = process.env.OMNIX_WALKING_LIVE === "1";
let browser, debugPage;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OMNIX_UI_BROWSER_CHANNEL
      ? { channel: process.env.OMNIX_UI_BROWSER_CHANNEL }
      : {})
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    permissions: ["geolocation"],
    geolocation: { latitude: 51.503, longitude: -0.127 }
  });
  const page = await context.newPage();
  debugPage = page;
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && /photon|overpass/.test(url.hostname))
      console.log("MAP_SERVICE", url.hostname, response.status());
  });
  page.on("console", (message) => {
    if (live && message.type() === "error")
      console.log("BROWSER_ERROR", message.text().slice(0, 240));
  });
  page.setDefaultTimeout(60000);
  const errors = [],
    backend = [],
    osm = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === origin &&
      /\/api\/v1\/(health\/walks|settings\/walking-map)/.test(url.pathname)
    )
      backend.push(url.pathname);
    if (/overpass|photon/.test(url.hostname)) osm.push(url.hostname);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(origin + "/api/v1/**", async (route) => {
    const p = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let data = {};
    if (p === "/me")
      data = {
        id: "walk-qa",
        name: "Walker",
        email: "walk@example.test",
        csrf: "test-only",
        is_admin: false
      };
    if (p === "/config")
      data = { oidc_configured: true, setup_available: false };
    if (p === "/products") data = [{ id: "health", name: "Health" }];
    if (p === "/connections") data = [];
    if (p === "/settings/workspace")
      data = { name: "Omnix", private_mail_hosts: [] };
    if (p === "/settings/preferences")
      data = {
        display_name: "Walker",
        timezone: "Europe/London",
        time_format: "24",
        onboarding_completed: true
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data)
    });
  });
  if (!live) {
    await context.route("https://photon.komoot.io/api/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          features: [
            {
              geometry: { coordinates: [-0.127, 51.503] },
              properties: { osm_id: 1, name: "Test Park", city: "London" }
            }
          ]
        })
      })
    );
    await context.route(
      "https://overpass-api.de/api/interpreter",
      async (route) => {
        await new Promise((r) => setTimeout(r, 150));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(walkingFixture())
        });
      }
    );
    await context.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      })
    );
  }
  await page.goto(origin + "/health/walks");
  const generate = page.getByRole("button", {
      name: "Generate loop",
      exact: true
    }),
    start = page.getByRole("combobox", { name: "Start location", exact: true });
  await expect(generate).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Walking street map", exact: true })
  ).toBeVisible();
  await start.fill(live ? "Parliament Square London" : "Test Park");
  expect(osm.filter((x) => x.includes("photon")).length).toBe(0);
  await page
    .getByRole("button", { name: "Search start location", exact: true })
    .click();
  await page.getByRole("option").first().waitFor();
  await start.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByRole("spinbutton", { name: /Target distance/ }).fill("3.2");
  await generate.click();
  await page.locator(".daily-walk-result").waitFor();
  await expect(page.locator(".leaflet-overlay-pane path").last()).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GPX", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("omnix-walking-loop.gpx");
  const xml = fs.readFileSync(await download.path(), "utf8");
  const parsed = await page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    return {
      valid: !xml.querySelector("parsererror"),
      points: Array.from(xml.getElementsByTagName("trkpt"), (p) => [
        Number(p.getAttribute("lon")),
        Number(p.getAttribute("lat"))
      ]),
      name: xml.querySelector("metadata>name")?.textContent
    };
  }, xml);
  expect(parsed.valid).toBe(true);
  expect(parsed.points.length).toBeGreaterThan(4);
  expect(parsed.points[0]).toEqual(parsed.points.at(-1));
  await page.locator(".walking-directions summary").click();
  expect(await page.locator(".walking-directions li").count()).toBeGreaterThan(
    1
  );
  const oldCount = osm.filter((x) => x.includes("overpass")).length;
  await page
    .getByRole("group", { name: "Walking target", exact: true })
    .getByRole("button", { name: "Speed / time", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: /Walking speed/ }).fill("12");
  await page.getByRole("spinbutton", { name: /Walking time/ }).fill("360");
  await expect(generate).toBeDisabled();
  await page.getByRole("spinbutton", { name: /Walking speed/ }).fill("4");
  await page.getByRole("spinbutton", { name: /Walking time/ }).fill("45");
  await generate.click();
  await expect(
    page.getByRole("button", { name: "Calculating…", exact: true })
  ).toBeHidden();
  await expect(page.locator(".walking-route-meta")).toContainText(
    "Target 3.0 km"
  );
  expect(osm.filter((x) => x.includes("overpass")).length).toBe(oldCount);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    expect(
      await page.evaluate(() => {
        const main = document.querySelector("main.main");
        return (
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          main.scrollWidth <= main.clientWidth + 1
        );
      })
    ).toBe(true);
    if (process.env.OMNIX_UI_SCREENSHOTS) {
      fs.mkdirSync(process.env.OMNIX_UI_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.OMNIX_UI_SCREENSHOTS,
          `walking-client-${width}.png`
        )
      });
    }
  }
  if (!live) {
    await context.setGeolocation({ latitude: 0, longitude: 0 });
    await page
      .getByRole("button", { name: "Use current location", exact: true })
      .click();
    await expect(start).toHaveValue("Current location");
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(page.getByRole("alert")).toContainText("closer");
    await expect(page.locator(".daily-walk-result")).toBeVisible();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate loop", exact: true })
  ).toBeDisabled();
  expect(await page.locator(".daily-walk-result").count()).toBe(0);
  expect(backend).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      browserOnlyWalking: true,
      onlineMap: true,
      liveOSM: live,
      explicitSearch: true,
      closedLoop: true,
      gpxPoints: parsed.points.length,
      graphReused: true,
      speedTime: true,
      responsiveWidths: [320, 390, 768, 1440],
      backendWalkingRequests: 0,
      runtimeErrors: 0
    })
  );
})()
  .catch(async (error) => {
    console.error(error);
    if (debugPage) {
      console.error(
        "UI_ALERTS",
        await debugPage.getByRole("alert").allTextContents()
      );
      if (process.env.OMNIX_UI_SCREENSHOTS)
        await debugPage.screenshot({
          path: path.join(
            process.env.OMNIX_UI_SCREENSHOTS,
            "walking-failure.png"
          )
        });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
