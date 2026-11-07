// Synthetic API fixtures only; this audit never writes to the running workspace.
const path = require("path");
const fs = require("fs");
const { walkingFixture } = require("./walking_fixture.cjs");
const { chromium } = require(
  require.resolve("playwright", { paths: [path.join(__dirname, "../web")] })
);
let browser;
(async () => {
  browser = await chromium.launch({
    ...(process.env.OMNIX_UI_BROWSER_CHANNEL
      ? { channel: process.env.OMNIX_UI_BROWSER_CHANNEL }
      : {}),
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 }
  });
  const page = await context.newPage();
  const errors = [];
  const scripts = [];
  const requestCounts = new Map();
  let signedIn = true;
  let dailySaved = null;
  page.on("request", (request) => {
    if (request.resourceType() === "script")
      scripts.push(new URL(request.url()).pathname);
  });
  async function capture(name) {
    if (!process.env.OMNIX_UI_SCREENSHOTS) return;
    fs.mkdirSync(process.env.OMNIX_UI_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.OMNIX_UI_SCREENSHOTS, name + ".png")
    });
  }
  page.on("pageerror", (e) => errors.push(e.message));
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  const origin = process.env.OMNIX_UI_URL || "http://127.0.0.1:8080";
  const stamp = "2026-11-04T15:12:00Z";
  const account = {
    id: "mail-qa",
    label: "QA mailbox",
    address: "qa@example.test",
    provider: "imap",
    status: "ready",
    can_read: true,
    can_send: true,
    last_sync: stamp,
    error: ""
  };
  const html =
    '<table id="newsletter" width="720" style="width:720px!important;min-width:720px;table-layout:fixed"><tr><td style="padding:20px"><h1>Fixed-width newsletter</h1><p>' +
    "Newsletter content. ".repeat(220) +
    '</p><img src="https://images.example.test/pixel.png" width="16" height="16"><span id="email-bottom">End of email</span></td></tr></table><script>parent.postMessage({type:"unsafe-email"},"*")</script>';
  const message = {
    id: "message-qa",
    mailbox: account.id,
    account: account.label,
    address: account.address,
    sender: "sender@example.test",
    sender_name: "Newsletter sender",
    recipients: account.address,
    cc: "",
    reply_to: "",
    subject: "Mobile newsletter",
    preview: "Read the full newsletter",
    date: stamp,
    unread: false,
    starred: false,
    folder: "inbox",
    body: "Text version",
    html,
    attachments: []
  };
  const project = {
    id: "project-qa",
    title: "Omnix QA",
    issue_prefix: "OMN",
    revision: 1,
    updated_at: stamp,
    deleted_at: null
  };
  const baseTask = {
    id: "task-qa",
    project_id: project.id,
    title: "Existing ticket",
    description: "",
    issue_number: 1,
    issue_key: "OMN-1",
    issue_type: "task",
    labels: [],
    sprint: "",
    estimate: null,
    parent_id: null,
    page_id: null,
    status: "todo",
    priority: "normal",
    start: null,
    end: null,
    progress: 0,
    milestone: false,
    position: 0,
    dependencies: [],
    revision: 1
  };
  let tasks = [baseTask],
    badCreate = false,
    badUpdate = false,
    createDelay = 0,
    created = [],
    updates = [];
  let failedMail = false,
    remoteRequests = 0;
  const note = {
    id: "page-qa",
    title: "QA page",
    parent_id: null,
    project_id: null,
    is_folder: false,
    position: 0,
    favorite: false,
    revision: 1,
    updated_at: stamp,
    deleted_at: null,
    document: [
      {
        id: "qa-block",
        type: "paragraph",
        content: [
          { type: "text", text: "A note for mobile testing.", styles: {} }
        ],
        children: []
      }
    ]
  };
  const today = new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: 14 }, (_, i) =>
    new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10)
  );
  const metrics = Object.fromEntries(
    [
      "steps",
      "distance",
      "calories",
      "active_minutes",
      "sleep",
      "heart_rate",
      "weight",
      "water"
    ].map((id) => [
      id,
      {
        label: id.replaceAll("_", " "),
        unit: id === "steps" ? "steps" : "",
        group: "activity",
        status: "ready",
        points: Object.fromEntries(
          dates.map((day, i) => [
            day,
            id === "steps" ? 5500 + i * 280 : 6.5 + (i % 3)
          ])
        )
      }
    ])
  );
  const nestedPages = [
    { ...note, id: "folder-qa", title: "Research", is_folder: true },
    {
      ...note,
      id: "nested-qa",
      title: "Deeply nested reference",
      parent_id: "folder-qa"
    }
  ];
  const dailySettings = {
    news: [
      {
        id: "daily-feed",
        name: "Daily source",
        url: "https://news.example.test/feed.xml"
      }
    ],
    weather: {
      enabled: true,
      label: "London",
      latitude: 51.5,
      longitude: -0.12,
      endpoint: "https://api.open-meteo.com/v1/forecast",
      temperature_unit: "celsius",
      key_configured: false
    },
    transport: {
      enabled: true,
      all_lines: true,
      lines: [],
      endpoint: "https://api.tfl.gov.uk/Line/Mode/tube/Status",
      key_configured: false
    },
    widgets: ["news", "weather", "transport"]
  };
  const iotFixture = {
    id: "curtain-qa",
    name: "Curtain lights",
    sku: "H70B1",
    capabilities: [
      {
        type: "devices.capabilities.on_off",
        instance: "powerSwitch",
        parameters: {
          dataType: "ENUM",
          options: [
            { name: "On", value: 1 },
            { name: "Off", value: 0 }
          ]
        }
      },
      {
        type: "devices.capabilities.range",
        instance: "brightness",
        parameters: { dataType: "INTEGER", range: { min: 1, max: 100 } }
      },
      {
        type: "devices.capabilities.dynamic_scene",
        instance: "lightScene",
        parameters: {
          dataType: "ENUM",
          options: [{ name: "Aurora", value: { id: 2, paramId: 4 } }]
        }
      }
    ]
  };
  let iotRules = [];
  const iotCommands = [];
  const dailyFixture = {
    configured: true,
    widgets: dailySettings.widgets,
    news: {
      enabled: true,
      error: "",
      last_sync: stamp,
      data: {
        feeds: [
          {
            id: "daily-feed",
            name: "Daily source",
            error: "",
            items: [
              {
                id: "headline-qa",
                source_id: "daily-feed",
                source: "Daily source",
                title: "A useful daily headline",
                summary: "Read the latest from your selected source.",
                url: "https://news.example.test/article",
                published: stamp
              }
            ]
          }
        ]
      }
    },
    weather: {
      enabled: true,
      error: "",
      last_sync: stamp,
      data: {
        label: "London",
        unit: "°C",
        temperature: 12,
        feels_like: 10,
        wind: 15,
        code: 3,
        days: dates
          .slice(-7)
          .map((date) => ({ date, high: 13, low: 6, rain: 20, code: 3 }))
      }
    },
    transport: {
      enabled: true,
      error: "",
      last_sync: stamp,
      data: {
        attribution: "Transport for London",
        available_lines: [
          { id: "central", name: "Central" },
          { id: "victoria", name: "Victoria" }
        ],
        lines: [
          {
            id: "central",
            name: "Central",
            mode: "tube",
            statuses: [
              {
                severity: 9,
                description: "Minor delays",
                reason: "An earlier incident"
              }
            ]
          },
          {
            id: "victoria",
            name: "Victoria",
            mode: "tube",
            statuses: [
              { severity: 10, description: "Good service", reason: "" },
              {
                severity: 20,
                description: "Service closed",
                reason: "Closed for the night"
              }
            ]
          }
        ]
      }
    }
  };
  await context.addInitScript(() => {
    window.__unsafeMail = false;
    addEventListener("message", (e) => {
      if (e.data?.type === "unsafe-email") window.__unsafeMail = true;
    });
  });
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
  await context.route("https://overpass-api.de/api/interpreter", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(walkingFixture())
    })
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
  await context.route("https://images.example.test/**", async (route) => {
    remoteRequests++;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>'
    });
  });
  await context.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname.replace("/api/v1", "");
    requestCounts.set(p, (requestCounts.get(p) || 0) + 1);
    let data = {},
      status = 200;
    if (p === "/me")
      data = {
        id: "qa",
        name: "Design QA",
        email: "qa@example.test",
        is_admin: false,
        csrf: "qa-only"
      };
    if (p === "/me" && !signedIn) {
      status = 401;
      data = { detail: "Not authenticated" };
    } else if (p === "/onboarding")
      data = {
        signed_in: true,
        database: "connected",
        authentication: "configured",
        completed: false
      };
    else if (p === "/settings/workspace")
      data = { name: "Omnix", private_mail_hosts: [] };
    else if (p === "/config")
      data = { oidc_configured: true, setup_available: false };
    else if (p === "/products")
      data = [
        { id: "email", name: "Mail" },
        { id: "calendar", name: "Calendar" },
        { id: "health", name: "Health" },
        { id: "notes", name: "Notes & Projects" },
        { id: "daily", name: "Daily" },
        { id: "iot", name: "IoT" }
      ];
    else if (p === "/settings/govee") data = { configured: true };
    else if (p === "/iot/devices")
      data = { configured: true, items: [iotFixture] };
    else if (p === "/iot/devices/discover") data = [iotFixture];
    else if (p === "/iot/devices/curtain-qa/control") {
      iotCommands.push(req.postDataJSON());
      data = {
        accepted: true,
        message: "Govee accepted the command. Refresh to confirm device state."
      };
    } else if (p === "/iot/devices/curtain-qa/scenes") data = iotFixture;
    else if (p === "/iot/devices/curtain-qa/state")
      data = {
        capabilities: [{ instance: "powerSwitch", state: { value: 1 } }]
      };
    else if (p === "/iot/history") data = [];
    else if (p === "/iot/rules") {
      if (req.method() === "POST")
        iotRules.push({ ...req.postDataJSON(), id: "rule-qa" });
      data = req.method() === "POST" ? iotRules.at(-1) : iotRules;
    } else if (p === "/iot/rules/rule-qa") {
      if (req.method() === "DELETE") {
        iotRules = [];
        data = { deleted: true };
      } else {
        iotRules = [{ ...req.postDataJSON(), id: "rule-qa" }];
        data = iotRules[0];
      }
    } else if (p === "/assistant/context")
      data = {
        as_of: new Date().toISOString(),
        notes_partial: false,
        items: [
          {
            kind: "note",
            title: "Planning note",
            text: "The planning meeting is on Monday at noon.",
            href: "/notes/pages/page-qa"
          }
        ]
      };
    else if (p === "/daily")
      data = { ...dailyFixture, widgets: dailySettings.widgets };
    else if (p === "/settings/daily") {
      if (req.method() === "PUT") {
        dailySaved = req.postDataJSON();
        Object.assign(dailySettings, dailySaved);
      }
      data = dailySettings;
    } else if (p === "/daily/refresh") {
      status = 202;
      data = { queued: true };
    } else if (p === "/daily/locations")
      data = {
        items: [
          {
            id: "london",
            name: "London",
            label: "London, England, United Kingdom",
            detail: "United Kingdom",
            latitude: 51.5074,
            longitude: -0.1278
          }
        ]
      };
    else if (p === "/daily/transport/catalog")
      data = {
        items: [
          { id: "central", name: "Central" },
          { id: "victoria", name: "Victoria" }
        ]
      };
    else if (p === "/connections") data = [account];
    else if (p === "/overview")
      data = {
        unread: 0,
        messages: 1,
        drafts: 0,
        queued: 0,
        unknown: 0,
        accounts: 1,
        healthy: 1,
        recent: [message]
      };
    else if (p === "/settings/preferences")
      data = {
        display_name: "Design QA",
        timezone: "Europe/London",
        time_format: "24",
        onboarding_completed: true
      };
    else if (
      p === "/settings/sessions" ||
      p === "/settings/api-tokens" ||
      p === "/connectors"
    )
      data = [];
    else if (p === "/email/messages") {
      if (failedMail) {
        status = 503;
        data = { detail: "Mail fetch failed" };
      } else
        data = {
          items: [message],
          next_cursor: null,
          search_scope: "All mail"
        };
    } else if (p.endsWith("/profile"))
      data = {
        provider: "imap",
        needs_reconnect: false,
        identities: [{ address: account.address, name: "QA", primary: true }],
        folders: []
      };
    else if (p.includes("/email/mailboxes/") && p.includes("/messages/"))
      data = message;
    else if (p === "/email/drafts" || p === "/email/send-attempts") data = [];
    else if (p === "/calendar/feeds")
      data = [
        {
          id: "feed-qa",
          label: "QA calendar",
          url: "https://calendar.example.test/calendar.ics",
          status: "ready",
          error: "",
          last_sync: stamp,
          event_count: 0
        }
      ];
    else if (p === "/calendar/events")
      data = [
        {
          id: "event-qa",
          feed_id: "feed-qa",
          calendar: "QA calendar",
          title: "Design review",
          location: "Studio",
          start: today + "T14:00:00Z",
          end: today + "T15:00:00Z",
          all_day: false,
          start_ts: Date.parse(today + "T14:00:00Z") / 1000,
          end_ts: Date.parse(today + "T15:00:00Z") / 1000
        }
      ];
    else if (p === "/health/status")
      data = {
        configured: true,
        can_configure: false,
        connected: true,
        status: "ready",
        last_sync: stamp,
        error: "",
        groups: []
      };
    else if (p === "/health/statistics")
      data = { dates, timezone: "Europe/London", metrics };
    else if (p === "/health/google/registration")
      data = { configured: true, can_configure: false };
    else if (p === "/notes/overview") data = { recent: [note], tasks: [] };
    else if (p === "/notes/pages")
      data = { items: [note, ...nestedPages], next_offset: null };
    else if (p === "/notes/pages/" + note.id) data = note;
    else if (p.endsWith("/backlinks")) data = { items: [] };
    else if (p.startsWith("/notes/pages/")) data = [];
    else if (p === "/notes/projects") data = [project];
    else if (p === "/notes/projects/" + project.id) data = project;
    else if (p === "/notes/projects/" + project.id + "/tasks") {
      if (req.method() === "POST") {
        if (createDelay)
          await new Promise((resolve) => setTimeout(resolve, createDelay));
        if (badCreate) {
          status = 400;
          data = { detail: "Creation failed" };
        } else {
          const body = req.postDataJSON();
          created.push(body);
          const t = {
            ...baseTask,
            ...body,
            id: "task-new-" + created.length,
            issue_key: "OMN-" + (created.length + 1),
            issue_number: created.length + 1
          };
          tasks = [...tasks, t];
          project.updated_at = new Date().toISOString();
          data = t;
          status = 201;
        }
      } else data = tasks;
    } else if (p.endsWith("/discussion")) data = { comments: [], activity: [] };
    else if (p.includes("/notes/projects/") && p.includes("/tasks/")) {
      const task = tasks.find((t) => p.endsWith("/" + t.id));
      const { expected_revision, ...body } = req.postDataJSON();
      if (badUpdate || expected_revision !== task.revision) {
        status = 409;
        data = { detail: "Update conflict" };
      } else {
        updates.push({ ...body, expected_revision });
        data = { ...task, ...body, revision: task.revision + 1 };
        tasks = tasks.map((t) => (t.id === task.id ? data : t));
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data)
    });
  });
  await page.clock.install({ time: new Date("2026-11-05T09:10:10Z") });
  await page.goto(origin + "/");
  await page.locator(".dashboard .clock").waitFor();
  await page.clock.pauseAt(new Date("2026-11-05T09:10:40Z"));
  const clockStamp = await page
    .locator(".dashboard .clock")
    .getAttribute("datetime");
  await page.clock.fastForward(10000);
  assert(
    (await page.locator(".dashboard .clock").getAttribute("datetime")) ===
      clockStamp,
    "Minute clock rerendered during the same minute"
  );
  await page.clock.fastForward(11000);
  await page.clock.resume();
  await page.waitForFunction(() =>
    document.querySelector(".dashboard .clock")?.textContent.includes("09:11")
  );
  assert(
    requestCounts.get("/settings/preferences") === 1,
    "Shared preferences fetched more than once"
  );
  assert(
    !scripts.some((url) => /NotePage-|Settings-|Notes-/.test(url)),
    "Home eagerly loaded another product"
  );
  assert(
    (await page
      .locator(
        ".dashboard .metric-strip, .dashboard .dashboard-connections, .dashboard .dashboard-notes, .dashboard .health-overview-readings"
      )
      .count()) === 0,
    "Home includes secondary account, notes or health details"
  );
  assert(!requestCounts.has("/notes/overview"), "Home fetched unused notes");
  await page
    .getByRole("link", { name: "Open unread mail", exact: true })
    .click();
  await page.waitForURL("**/email?unread=true");
  const messageView = page.getByRole("group", {
    name: "Message view",
    exact: true
  });
  assert(
    (await messageView
      .getByRole("button", { name: /^Unread/ })
      .getAttribute("aria-pressed")) === "true",
    "Home did not open unread mail"
  );
  await messageView
    .getByRole("button", { name: "All messages", exact: true })
    .click();
  assert(
    !new URL(page.url()).searchParams.has("unread"),
    "Clearing unread filter left its URL active"
  );
  await page.goto(origin + "/");
  await page.locator(".dashboard .clock").waitFor();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.locator(".sidebar.mobile-open").waitFor();
  await page
    .getByRole("navigation", { name: "Applications", exact: true })
    .getByRole("link", { name: "Mail", exact: true })
    .click();
  await page.waitForURL("**/email");
  assert(
    await page.locator(".sidebar.mobile-open").isVisible(),
    "Selecting an app closed the mobile subpage navigation"
  );
  await page
    .getByRole("button", { name: "Back to applications", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Applications", exact: true })
    .getByRole("link", { name: "Mail", exact: true })
    .click();
  assert(
    await page.locator(".sidebar.mobile-open").isVisible(),
    "Reopening the current app hid its subpages"
  );
  await page
    .locator(".sidebar")
    .getByRole("link", { name: /^Inbox/ })
    .click();
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to applications", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Applications", exact: true })
    .getByRole("link", { name: "Health", exact: true })
    .click();
  await page.waitForURL("**/health");
  assert(
    await page.locator(".sidebar.mobile-open").isVisible(),
    "Health subpages disappeared"
  );
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Sleep", exact: true })
    .click();
  await page.waitForURL("**/health/sleep");
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to applications", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Applications", exact: true })
    .getByRole("link", { name: "Daily", exact: true })
    .click();
  await page.waitForURL("**/daily/news");
  assert(
    await page.locator(".sidebar.mobile-open").isVisible(),
    "Daily landing redirect closed the drawer"
  );
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Weather", exact: true })
    .click();
  await page.waitForURL("**/daily/weather");
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  assert(
    !(await page.locator("main.main").evaluate((e) => e.inert)),
    "Main stayed inert after navigation"
  );
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  assert(
    !(await page.locator("main.main").evaluate((e) => e.inert)),
    "Resize left desktop content inert"
  );
  await page.goto(origin + "/email?account=mail-qa&message=message-qa");
  await page
    .frameLocator('iframe[title="Email content"]')
    .locator("#newsletter")
    .waitFor();
  await page.locator(".view-data-status time").waitFor();
  assert(
    Date.parse(
      await page.locator(".view-data-status time").getAttribute("datetime")
    ) === Date.parse(stamp),
    "Mailbox sync timestamp fabricated"
  );
  const widths = [320, 390, 768, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const frame = await (
      await page.locator('iframe[title="Email content"]').elementHandle()
    ).contentFrame();
    await frame.waitForFunction(() => {
      const root = document.querySelector("#omnix-email-root"),
        newsletter = document.querySelector("#newsletter"),
        bottom = document.querySelector("#email-bottom");
      if (!root || !newsletter || !bottom || document.readyState !== "complete")
        return false;
      const expected = Math.min(
        1,
        innerWidth / Math.max(root.scrollWidth, root.offsetWidth)
      );
      return (
        Math.abs(new DOMMatrix(getComputedStyle(root).transform).a - expected) <
          0.005 &&
        newsletter.getBoundingClientRect().right <= innerWidth + 1 &&
        bottom.getBoundingClientRect().bottom <= innerHeight + 2
      );
    });
    const dimensions = await frame.evaluate(() => ({
      right: document.querySelector("#newsletter").getBoundingClientRect()
        .right,
      width: innerWidth,
      bottom: document.querySelector("#email-bottom").getBoundingClientRect()
        .bottom,
      height: innerHeight
    }));
    assert(
      dimensions.right <= dimensions.width + 1,
      "Newsletter clipped at " + width
    );
    assert(
      dimensions.bottom <= dimensions.height + 2,
      "Email not full height at " + width
    );
  }
  assert(remoteRequests === 0, "Remote images loaded without consent");
  assert(
    !(await page.evaluate(() => window.__unsafeMail)),
    "Email script executed"
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.locator(".sidebar.mobile-open").waitFor({ state: "hidden" });
  assert(
    new URL(page.url()).searchParams.get("message") === "message-qa",
    "Drawer Escape also closed the email"
  );
  await page
    .getByRole("group", { name: "Email sizing" })
    .getByRole("button", { name: "Actual size", exact: true })
    .click();
  let frame = await (
    await page.locator('iframe[title="Email content"]').elementHandle()
  ).contentFrame();
  await frame.waitForFunction(() => {
    const scrolling = document.scrollingElement;
    return Boolean(
      document.readyState === "complete" &&
        document.querySelector('script[data-fit="false"]') &&
        scrolling &&
        scrolling.scrollWidth > innerWidth
    );
  });
  await page
    .getByRole("group", { name: "Email sizing" })
    .getByRole("button", { name: "Fit width", exact: true })
    .click();
  await frame.waitForFunction(
    () =>
      document.readyState === "complete" &&
      Boolean(document.querySelector('script[data-fit="true"]'))
  );
  const remoteImage = page.waitForResponse((r) =>
    r.url().startsWith("https://images.example.test/")
  );
  await page
    .getByRole("button", { name: "Load remote images", exact: true })
    .click();
  await remoteImage;
  assert(remoteRequests === 1, "Remote image consent failed");
  const routes = [
    "/",
    "/email",
    "/email/drafts",
    "/email/outbox",
    "/calendar?view=month",
    "/calendar?view=agenda",
    ...[
      "",
      "/activity",
      "/sleep",
      "/vitals",
      "/body",
      "/nutrition",
      "/workouts"
    ].map((v) => "/health" + v),
    "/notes",
    "/notes/favorites",
    "/notes/trash",
    "/notes/projects",
    "/notes/projects/project-qa?view=board",
    "/notes/projects/project-qa?view=issues",
    "/notes/pages/page-qa",
    "/daily/news",
    "/daily/weather",
    "/daily/transport",
    "/health/walks",
    "/iot",
    "/iot/activity",
    "/settings/general",
    "/settings/connections",
    "/settings/security",
    "/settings/api-access"
  ];
  const overflows = [];
  for (const route of routes) {
    await page.goto(origin + route);
    await page.locator("main.main").waitFor();
    const content = route.startsWith("/iot")
      ? ".iot-page"
      : route === "/health/walks"
        ? ".walking-page .daily-walk-form"
        : route.startsWith("/daily")
          ? {
              "/daily/news": ".daily-news-list",
              "/daily/weather": ".daily-weather-current",
              "/daily/transport": ".daily-transport-list",
              "/health/walks": ".daily-walk-form"
            }[route]
          : route.startsWith("/health")
            ? ".health-product .health-metrics"
            : route.startsWith("/calendar")
              ? ".calendar-layout"
              : route.startsWith("/notes/pages/")
                ? ".note-editor-surface [contenteditable=true]"
                : route.startsWith("/notes/projects/project-")
                  ? ".notes-view-bar"
                  : route.startsWith("/notes")
                    ? ".notes-page"
                    : route.startsWith("/settings")
                      ? ".settings-content > *"
                      : route === "/"
                        ? ".dashboard .clock"
                        : route === "/email/outbox"
                          ? ".outbox-heading"
                          : ".email-heading";
    await page.locator(content).first().waitFor();
    if (route === "/settings/connections")
      await page.locator(".daily-integration form").waitFor();
    const badContrast = await page
      .locator('.segmented-control > button[aria-pressed="true"]')
      .evaluateAll((buttons) =>
        buttons.some((button) => {
          const style = getComputedStyle(button);
          return style.color === style.backgroundColor;
        })
      );
    assert(!badContrast, "Selected view label is invisible on " + route);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      if (
        [390, 1280].includes(width) &&
        [
          "/",
          "/email",
          "/calendar?view=month",
          "/health",
          "/daily/news",
          "/daily/weather",
          "/daily/transport",
          "/health/walks",
          "/iot",
          "/notes",
          "/notes/projects/project-qa?view=board",
          "/settings/general"
        ].includes(route)
      )
        await capture(route.replaceAll(/[^a-z0-9]/gi, "_") + "-" + width);
      const size = await page.evaluate(() => ({
        view: innerWidth,
        scroll: document.documentElement.scrollWidth,
        main: document.querySelector("main.main")?.clientWidth,
        mainScroll: document.querySelector("main.main")?.scrollWidth
      }));
      if (size.scroll > size.view + 1 || size.mainScroll > size.main + 1)
        overflows.push({ route, width, ...size });
    }
  }
  assert(
    !overflows.length,
    "Responsive overflow: " + JSON.stringify(overflows)
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(origin + "/daily/transport");
  await page
    .locator(".daily-transport-title")
    .getByText("Service closed", { exact: true })
    .waitFor();
  await page.goto(origin + "/health/walks");
  await page
    .getByRole("combobox", { name: "Start location", exact: true })
    .fill("Test Park");
  await page
    .getByRole("button", { name: "Search start location", exact: true })
    .click();
  await page.getByRole("option", { name: /Test Park/ }).click();
  await page
    .getByRole("button", { name: "Generate loop", exact: true })
    .click();
  await page.locator(".daily-walk-result").waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GPX", exact: true }).click();
  assert(
    (await downloadEvent).suggestedFilename() === "omnix-walking-loop.gpx",
    "Browser walking export missing"
  );
  await page.goto(origin + "/settings/connections#daily");
  const dailyForm = page.locator(".daily-integration");
  await dailyForm
    .getByRole("button", { name: "Add feed", exact: true })
    .click();
  await dailyForm
    .getByRole("textbox", { name: "Source name", exact: true })
    .last()
    .fill("Custom headlines");
  await dailyForm
    .getByRole("textbox", { name: "Feed URL", exact: true })
    .last()
    .fill("https://custom.example.test/rss");
  await dailyForm
    .getByRole("combobox", { name: "Weather location", exact: true })
    .fill("Lon");
  await page.getByRole("option", { name: /London, England/ }).click();
  await dailyForm
    .getByRole("combobox", { name: "TfL line selection", exact: true })
    .click();
  await page.getByRole("option", { name: "Choose lines", exact: true }).click();
  await dailyForm
    .getByRole("button", { name: "Train lines", exact: true })
    .click();
  await dailyForm
    .getByRole("textbox", { name: "Search train lines", exact: true })
    .fill("Vic");
  await dailyForm
    .getByRole("checkbox", { name: "Victoria", exact: true })
    .check();
  await page.keyboard.press("Escape");
  await dailyForm
    .getByRole("group", { name: "Home screen", exact: true })
    .getByRole("checkbox", { name: "Weather", exact: true })
    .uncheck();
  await dailyForm
    .getByRole("button", { name: "Save daily sources", exact: true })
    .click();
  await dailyForm
    .getByRole("status")
    .filter({ hasText: "Sources saved" })
    .waitFor();
  assert(
    dailySaved.weather.latitude === 51.5074 &&
      dailySaved.weather.longitude === -0.1278,
    "Weather autocomplete did not save selected coordinates"
  );
  assert(
    dailySaved.transport.lines.length === 1 &&
      dailySaved.transport.lines[0] === "victoria",
    "Train-line dropdown selection did not save"
  );
  assert(
    dailySaved.news.length === 2 && !dailySaved.widgets.includes("weather"),
    "Custom Daily sources or widget choice did not save"
  );
  await page.goto(origin + "/");
  await page.locator(".daily-summary").waitFor();
  await page
    .locator(".daily-summary")
    .getByRole("link", { name: /A useful daily headline/ })
    .waitFor();
  assert(
    (await page
      .locator(".daily-summary")
      .getByRole("heading", { name: "Weather", exact: true })
      .count()) === 0,
    "Hidden weather widget remained on Home"
  );
  assert(
    await page
      .locator(".daily-summary")
      .getByRole("link", { name: /A useful daily headline/ })
      .isVisible(),
    "News missing from Home"
  );
  assert(
    (await page
      .locator(".daily-summary")
      .getByRole("heading", { name: /Walking/i })
      .count()) === 0,
    "Walking loops must not appear on Home"
  );
  dailySettings.widgets = ["news", "weather", "transport"];
  // Notes lists and issue boards should never download the rich editor bundle.
  await page.setViewportSize({ width: 1280, height: 900 });
  scripts.length = 0;
  const pageReadsBefore = requestCounts.get("/notes/pages") || 0;
  await page.goto(origin + "/notes");
  await page
    .locator(".notes-list")
    .getByRole("link", { name: /QA page/ })
    .waitFor();
  assert(
    requestCounts.get("/notes/pages") - pageReadsBefore === 1,
    "Sidebar and notes list fetched duplicate page metadata"
  );
  assert(requestCounts.get("/notes/pages") >= 1, "Notes metadata did not load");
  assert(
    !scripts.some((url) => /NotePage-|native-/.test(url)),
    "Notes list downloaded the editor"
  );
  await page
    .getByRole("textbox", { name: "Find a page", exact: true })
    .fill("Deeply nested");
  await page
    .getByRole("link", { name: "Deeply nested reference", exact: true })
    .waitFor();
  assert(
    await page.getByRole("link", { name: "Research", exact: true }).isVisible(),
    "Search hid the matching page's ancestor"
  );
  await page
    .getByRole("textbox", { name: "Find a page", exact: true })
    .fill("No matching fixture");
  await page.getByText("No matching pages.", { exact: true }).waitFor();
  const readsBeforeFavorites = requestCounts.get("/notes/pages");
  await page
    .getByRole("navigation", { name: "Notes navigation" })
    .getByRole("link", { name: "Favorites", exact: true })
    .click();
  await page.getByRole("heading", { name: "Favorites", exact: true }).waitFor();
  await page.locator(".view-data-status time").waitFor();
  assert(
    requestCounts.get("/notes/pages") === readsBeforeFavorites,
    "Cached Favorites refetched the shared page list"
  );
  await page.goto(origin + "/notes/projects/project-qa?view=board");
  await page.locator(".issue-board").waitFor();
  assert(
    !scripts.some((url) => /NotePage-|native-/.test(url)),
    "Issue board downloaded the editor"
  );
  await page.goto(origin + "/iot");
  const light = page.getByRole("region", {
    name: "Curtain lights",
    exact: true
  });
  await light.getByRole("button", { name: "Apply", exact: true }).click();
  await light
    .getByRole("status")
    .filter({ hasText: "Govee accepted" })
    .waitFor();
  assert(
    iotCommands.at(-1).instance === "powerSwitch" &&
      iotCommands.at(-1).value === 1,
    "IoT power command missing"
  );
  await light.getByRole("combobox", { name: "Control", exact: true }).click();
  await page.getByRole("option", { name: "Scene", exact: true }).click();
  await light.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".iot-feedback")
      ?.textContent.includes("Govee accepted")
  );
  assert(
    iotCommands.at(-1).instance === "lightScene" &&
      iotCommands.at(-1).value.paramId === 4,
    "IoT scene payload was not preserved"
  );
  await page.goto(origin + "/settings/connections#govee");
  const govee = page.locator(".govee-integration");
  await govee
    .getByRole("textbox", { name: "Rule name", exact: true })
    .fill("Meeting curtain lights");
  await govee.getByRole("combobox", { name: "Light", exact: true }).click();
  await page
    .getByRole("option", { name: "Curtain lights", exact: true })
    .click();
  await govee.getByRole("combobox", { name: "Calendar", exact: true }).click();
  await page.getByRole("option", { name: "QA calendar", exact: true }).click();
  await govee
    .getByRole("textbox", { name: "Event title contains", exact: true })
    .fill("meeting");
  await govee
    .getByRole("button", { name: "Save calendar rule", exact: true })
    .click();
  await govee.getByText("Meeting curtain lights", { exact: true }).waitFor();
  assert(
    iotRules[0].feed_id === "feed-qa" &&
      iotRules[0].device_id === "curtain-qa" &&
      iotRules[0].command.instance === "powerSwitch",
    "Calendar rule did not preserve owned device, feed and action"
  );
  await govee.getByRole("button", { name: "Pause", exact: true }).click();
  await govee.getByRole("button", { name: "Enable", exact: true }).waitFor();
  assert(!iotRules[0].enabled, "Calendar rule did not pause");
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await page.getByRole("dialog", { name: /AI/ }).waitFor();
  await page
    .getByRole("button", { name: "Load local model", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Ask AI", exact: true })
      .isDisabled(),
    "AI allows requests before model loading"
  );
  await page
    .getByRole("button", {
      name: "What is on my calendar this week?",
      exact: true
    })
    .click();
  await page
    .getByRole("button", { name: "Minimise AI chat", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  assert(
    (await page
      .getByRole("textbox", { name: "ASK OMNIX", exact: true })
      .inputValue()) === "What is on my calendar this week?",
    "Chat input did not survive navigation"
  );
  await page.keyboard.press("Escape");
  assert(
    !(await page.getByRole("dialog", { name: /AI/ }).isVisible()),
    "Escape did not minimise chat"
  );
  await page.goto(origin + "/onboarding");
  await page
    .getByRole("heading", { name: "You're connected.", exact: true })
    .waitFor();
  await capture("onboarding");
  await page
    .getByRole("button", { name: "Make it yours", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Make it yours.", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Display name", exact: true })
    .waitFor();
  await capture("onboarding-preferences");
  signedIn = false;
  scripts.length = 0;
  await page.goto(origin + "/");
  await page.getByRole("link", { name: /Continue with Pocket ID/ }).waitFor();
  assert(
    !scripts.some((url) => /Dashboard-|Settings-|NotePage-|Notes-/.test(url)),
    "Login eagerly loaded workspace screens"
  );
  await capture("login");
  signedIn = true;
  failedMail = true;
  await page.goto(origin + "/email?account=mail-qa");
  await page
    .locator(".email-content .error")
    .filter({ hasText: "Mail fetch failed" })
    .waitFor();
  await page
    .locator(".view-data-status")
    .filter({ hasText: "Update failed" })
    .waitFor();
  assert(
    (await page.locator(".view-data-status").innerText())
      .toLowerCase()
      .includes("update failed"),
    "Fetch failure lost from data status"
  );
  failedMail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.locator(".view-data-status time").waitFor();
  assert(
    Date.parse(
      await page.locator(".view-data-status time").getAttribute("datetime")
    ) === Date.parse(stamp),
    "Retry fabricated a provider timestamp"
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(origin + "/notes/projects/project-qa?view=board");
  await page
    .getByRole("button", { name: "Create issue", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: "Create issue", exact: true });
  await modal.waitFor();
  assert(
    (await modal
      .getByRole("button", { name: /^(Save changes|Create issue)$/ })
      .count()) === 0,
    "Task editor still requires an explicit save button"
  );
  createDelay = 1000;
  await modal
    .getByRole("textbox", { name: "Issue summary", exact: true })
    .fill("Created issue");
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/tasks") &&
      response.request().method() === "POST"
  );
  const savedModal = page.getByRole("dialog", {
    name: "Issue details",
    exact: true
  });
  await savedModal.waitFor();
  await savedModal
    .getByRole("status")
    .filter({ hasText: /^Saved$/ })
    .waitFor();
  assert(
    created.length === 1 && created[0].status !== "done",
    "Creation changed issue to Done or duplicated it"
  );
  await savedModal
    .getByRole("textbox", { name: "Issue description", exact: true })
    .fill("First change");
  await savedModal
    .getByRole("textbox", { name: "Issue description", exact: true })
    .fill("Latest change");
  await savedModal
    .getByRole("status")
    .filter({ hasText: /^Saved$/ })
    .waitFor();
  assert(
    updates.length === 1 &&
      updates[0].description === "Latest change" &&
      updates[0].expected_revision === 1,
    "Rapid edits were not coalesced into a revision-aware update"
  );
  // Closing before the debounce expires must flush the final change.
  await savedModal
    .getByRole("textbox", { name: "Issue summary", exact: true })
    .fill("Final title");
  await savedModal
    .getByRole("button", { name: "Close issue", exact: true })
    .click();
  await savedModal.waitFor({ state: "hidden" });
  assert(
    updates.length === 2 &&
      updates[1].title === "Final title" &&
      updates[1].expected_revision === 2,
    "Closing lost the pending edit or reused a stale revision"
  );
  assert(
    !new URL(page.url()).searchParams.has("issue"),
    "Closed issue stayed open in URL"
  );
  await page
    .getByRole("group", { name: "Project view", exact: true })
    .getByRole("button", { name: "issues", exact: true })
    .click();
  await page.waitForURL("**view=issues");
  assert(
    !(await page.locator(".view-data-status").innerText())
      .toLowerCase()
      .includes("waiting"),
    "Cached project view lost sync status"
  );
  await page
    .getByRole("button", { name: "Create issue", exact: true })
    .first()
    .click();
  await modal.waitFor();
  badCreate = true;
  createDelay = 0;
  await modal
    .getByRole("textbox", { name: "Issue summary", exact: true })
    .fill("Failure stays open");
  await modal.getByText("Creation failed", { exact: true }).waitFor();
  assert(await modal.isVisible(), "Failed issue creation closed the form");
  assert(
    (await modal
      .getByRole("textbox", { name: "Issue summary", exact: true })
      .inputValue()) === "Failure stays open",
    "Failed save discarded the draft"
  );
  badCreate = false;
  createDelay = 1000;
  await modal.getByRole("button", { name: "Retry sync", exact: true }).click();
  // Change a field while POST is pending. It must become a PUT, not another POST.
  await modal.getByRole("status").filter({ hasText: "Saving" }).waitFor();
  await modal
    .getByRole("textbox", { name: "Issue description", exact: true })
    .fill("Typed during creation");
  await savedModal
    .getByRole("status")
    .filter({ hasText: /^Saved$/ })
    .waitFor();
  assert(
    created.length === 2 &&
      updates.at(-1).description === "Typed during creation" &&
      updates.at(-1).expected_revision === 1,
    "Changes during creation were lost or duplicated the task"
  );
  badUpdate = true;
  await savedModal
    .getByRole("textbox", { name: "Issue description", exact: true })
    .fill("Keep on conflict");
  await savedModal.getByText("Update conflict", { exact: true }).waitFor();
  await savedModal
    .getByRole("button", { name: "Close issue", exact: true })
    .click();
  await savedModal.getByText("Update conflict", { exact: true }).waitFor();
  assert(
    await savedModal.isVisible(),
    "Failed close discarded an unsaved change"
  );
  badUpdate = false;
  await savedModal
    .getByRole("button", { name: "Retry sync", exact: true })
    .click();
  await savedModal
    .getByRole("status")
    .filter({ hasText: /^Saved$/ })
    .waitFor();
  assert(
    updates.at(-1).description === "Keep on conflict" &&
      updates.at(-1).expected_revision === 2,
    "Retry lost input or failed to use the latest revision"
  );
  await capture("issue-autosave");
  await savedModal
    .getByRole("button", { name: "Close issue", exact: true })
    .click();
  await savedModal.waitFor({ state: "hidden" });
  await page.goto(origin + "/notes/projects/project-qa?issue=task-qa");
  await savedModal.waitFor();
  const previousUpdates = updates.length;
  await savedModal
    .getByRole("textbox", { name: "Issue description", exact: true })
    .fill("Existing issue autosaves too");
  await savedModal
    .getByRole("status")
    .filter({ hasText: /^Saved$/ })
    .waitFor();
  assert(
    updates.length === previousUpdates + 1 &&
      updates.at(-1).expected_revision === 1 &&
      created.length === 2,
    "Editing an existing issue created a duplicate or skipped its revision"
  );
  await savedModal
    .getByRole("button", { name: "Close issue", exact: true })
    .click();
  await savedModal.waitFor({ state: "hidden" });
  assert(errors.length === 0, "Runtime errors: " + errors.join("; "));
  console.log(
    JSON.stringify({
      mobileNavigation: true,
      escape: true,
      desktopResize: true,
      emailFitWidths: widths,
      emailFullHeight: true,
      remoteImagePrivacy: true,
      emailScriptsBlocked: true,
      actualSize: true,
      routesAudited: routes.length,
      responsiveWidths: widths,
      issueAutosave: true,
      serialRevisionWrites: true,
      closeFlushesEdits: true,
      failedCreateStaysOpen: true,
      syncStatus: true,
      lazyEditor: true,
      minuteClock: true,
      selectedControlContrast: true,
      nestedPageSearch: true,
      onboarding: true,
      loginIsolation: true,
      dailySources: true,
      walkingLoop: true,
      homeWidgets: true,
      runtimeErrors: errors.length
    })
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e.stack);
  if (browser) await browser.close();
  process.exit(1);
});
