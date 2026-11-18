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
  let administrator = false;
  let initialSetup = false;
  let notificationRead = false;
  let nativeDevices = [],
    nativeRegistrations = 0,
    firebaseWrites = 0;
  let dailySaved = null;
  let notificationPreferences = {
    email: true,
    news: false,
    previews: false,
    email_default: true,
    email_content: "sender_subject",
    email_rules: []
  };
  let phoneHealth = {
    user_id: "qa",
    revision: 0,
    enabled: false,
    metrics: [],
    permissions: [],
    preferred: true
  };
  const defaultHomeWidgets = [
    "clock",
    "unread",
    "steps",
    "calendar",
    "weather",
    "transport",
    "news"
  ];
  let homePreferences = { widgets: [...defaultHomeWidgets] };
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
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser runtime error:", e.message);
  });
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
        source: "api.open-meteo.com",
        hours: Array.from({ length: 24 }, (_, i) => ({
          time: `${today}T${String(i).padStart(2, "0")}:00`,
          temperature: 10 + Math.sin(i / 4) * 4,
          rain: i % 4 === 0 ? 35 : 10,
          code: i % 4 === 0 ? 61 : 3
        })),
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
        is_admin: administrator,
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
      data = { oidc_configured: !initialSetup, setup_available: initialSetup };
    else if (p === "/products")
      data = [
        { id: "email", name: "Mail" },
        { id: "calendar", name: "Calendar" },
        { id: "health", name: "Health" },
        { id: "notes", name: "Notes & Projects" },
        { id: "daily", name: "Daily" },
        { id: "iot", name: "IoT" }
      ];
    else if (p === "/notifications")
      data = {
        items: [
          {
            id: "notification-qa",
            title: "A new message",
            body: "Sender",
            href: "/email?account=mail-qa&message=message-qa",
            read: notificationRead,
            created_at: "2026-11-05T09:00:00Z"
          }
        ],
        unread: notificationRead ? 0 : 1
      };
    else if (
      p === "/notifications/notification-qa/read" ||
      p === "/notifications/read"
    )
      notificationRead = true;
    else if (p === "/notifications/preferences") {
      if (req.method() === "PUT") notificationPreferences = req.postDataJSON();
      data = notificationPreferences;
    } else if (p === "/health/connect") {
      if (req.method() === "PUT")
        phoneHealth = {
          ...phoneHealth,
          ...req.postDataJSON(),
          revision: phoneHealth.revision + 1
        };
      if (req.method() === "DELETE")
        phoneHealth = {
          ...phoneHealth,
          enabled: false,
          metrics: [],
          permissions: [],
          revision: phoneHealth.revision + 1
        };
      data = phoneHealth;
    } else if (p === "/health/connect/sync") {
      const body = req.postDataJSON();
      assert(
        body.expected_revision === phoneHealth.revision,
        "Phone sync lost its revision"
      );
      assert(
        body.device_id === phoneHealth.device_id,
        "Phone sync changed device identity"
      );
      phoneHealth = {
        ...phoneHealth,
        permissions: body.permissions,
        captured_at: body.captured_at,
        last_sync: body.captured_at,
        revision: phoneHealth.revision + 1
      };
      data = phoneHealth;
    } else if (p === "/notifications/devices") {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        assert(
          body.kind === "fcm" &&
            body.endpoint.startsWith("firebase_native_token_"),
          "Native push did not use an FCM token"
        );
        nativeRegistrations++;
        data = { id: "native-device-" + nativeRegistrations };
        nativeDevices = [{ ...data, kind: "fcm" }];
      } else data = nativeDevices;
    } else if (p.startsWith("/notifications/devices/native-device-")) {
      nativeDevices = [];
      data = {};
    } else if (p === "/settings/firebase/client")
      data = {
        clients: ["com.bizbazboz.omnix", "com.bizbazboz.omnix.preview"].map(
          (packageName) => ({
            packageName,
            projectId: "omnix-qa",
            appId: "1:123456789012:android:abcdef",
            apiKey: "AIza" + "a".repeat(35),
            messagingSenderId: "123456789012"
          })
        )
      };
    else if (p === "/settings/firebase") {
      if (req.method() === "PUT") {
        firebaseWrites++;
        assert(
          typeof req.postDataJSON().service_account === "string",
          "Firebase key upload missing"
        );
      }
      data = {
        configured: true,
        key_configured: true,
        android_configured: true,
        project_id: "omnix-qa",
        packages: ["com.bizbazboz.omnix"]
      };
    } else if (p === "/settings/govee") data = { configured: true };
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
    } else if (p === "/daily")
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
    else if (p === "/settings/auth")
      data = {
        configured: true,
        issuer: "https://id.example.test",
        client_id: "test",
        allow_all: false,
        allowed_subjects: [],
        callback_url: origin + "/api/v1/auth/callback"
      };
    else if (p === "/settings/zoho")
      data = {
        region: "eu",
        client_id: "",
        configured: false,
        client_secret_configured: false
      };
    else if (p === "/settings/pipelines")
      data = {
        configuration: { sync_enabled: true, sync_interval: 300 },
        runs: []
      };
    else if (p === "/settings/system")
      data = {
        database: "Ready",
        redis: "Ready",
        scheduler: "Ready",
        worker: "Ready"
      };
    else if (p === "/settings/users")
      data = [
        {
          id: "qa",
          name: "Design QA",
          email: "qa@example.test",
          is_admin: true
        }
      ];
    else if (p.startsWith("/settings/home/widgets/") && p.endsWith("/frame")) {
      const widget = homePreferences.layout?.find((widget) =>
        p.includes("/" + widget.id + "/")
      );
      await route.fulfill({
        status: widget ? 200 : 404,
        contentType: "text/html",
        headers: {
          "Content-Security-Policy":
            "sandbox allow-scripts; frame-ancestors 'self'; form-action 'none'"
        },
        body:
          "<style>body{margin:0;background:#000;color:#e8e8e8;font:14px/1.5 system-ui}</style>" +
          (widget?.html || "Widget not found")
      });
      return;
    } else if (p === "/settings/home") {
      if (req.method() === "PUT") {
        const body = req.postDataJSON();
        if (
          body.expected_revision !== undefined &&
          body.expected_revision !== (homePreferences.revision ?? 0)
        ) {
          status = 409;
          data = { detail: "Layout changed" };
        } else
          homePreferences = {
            widgets: body.widgets,
            layout: body.layout,
            revision: (homePreferences.revision ?? 0) + 1
          };
      }
      if (status !== 409) data = homePreferences;
    } else if (p === "/settings/android-links")
      data = { fingerprints: [Array(32).fill("AB").join(":")] };
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
    else if (p === "/mobile/pairing")
      data = { origin: "https://omnix.example.test", version: 1 };
    else if (p === "/mobile/requests/mobile-qa/approve")
      data = {
        callback_url: "omnix://paired?request=mobile-qa&code=" + "a".repeat(54)
      };
    else if (p === "/mobile/requests/mobile-qa")
      data = { platform: "android", approved: false };
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
        data = {
          ...task,
          ...body,
          completed_at:
            body.status === "done" ? task.completed_at || stamp : null,
          archived_at: body.status === "done" ? task.archived_at || null : null,
          revision: task.revision + 1
        };
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
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page
    .getByRole("button", { name: "Clock and date", exact: true })
    .click();
  await page.locator(".dashboard .clock").waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "Customize", exact: true }).waitFor();
  assert(
    (await page.locator(".dashboard .clock").count()) === 0,
    "Hidden clock did not persist"
  );
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await page.locator(".dashboard .clock").waitFor();
  await page.setViewportSize({ width: 1280, height: 1400 });
  const grip = page.getByRole("button", {
    name: "Move Unread mail",
    exact: true
  });
  const target = page.getByRole("button", { name: "Move Steps", exact: true });
  await grip.scrollIntoViewIfNeeded();
  const a = await grip.boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("[data-home-widget]")).findIndex(
        (e) => e.dataset.homeWidget === "steps"
      ) <
      Array.from(document.querySelectorAll("[data-home-widget]")).findIndex(
        (e) => e.dataset.homeWidget === "unread"
      )
  );
  await page
    .getByRole("status")
    .filter({ hasText: /^SAVED$/ })
    .waitFor();
  assert(
    homePreferences.layout.findIndex((widget) => widget.kind === "steps") <
      homePreferences.layout.findIndex((widget) => widget.kind === "unread"),
    "Drag/drop did not save widget order"
  );
  await page
    .getByRole("button", { name: "Move Unread mail", exact: true })
    .press("ArrowLeft");
  await page
    .getByRole("status")
    .filter({ hasText: /^SAVED$/ })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  const touchGrip = page.getByRole("button", {
    name: "Move Unread mail",
    exact: true
  });
  const touchTarget = page.getByRole("button", {
    name: "Move Steps",
    exact: true
  });
  await touchGrip.scrollIntoViewIfNeeded();
  const ta = await touchGrip.boundingBox(),
    tb = await touchTarget.boundingBox();
  const touch = await page.context().newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: ta.x + ta.width / 2, y: ta.y + ta.height / 2 }]
  });
  for (let step = 1; step <= 12; step++)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: ta.x + ta.width / 2 + ((tb.x - ta.x) * step) / 12,
          y: ta.y + ta.height / 2 + ((tb.y - ta.y) * step) / 12
        }
      ]
    });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await page
    .getByRole("status")
    .filter({ hasText: /^SAVED$/ })
    .waitFor();
  assert(
    homePreferences.layout.findIndex((widget) => widget.kind === "steps") <
      homePreferences.layout.findIndex((widget) => widget.kind === "unread"),
    "Touch drag/drop did not save widget order"
  );
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await touch.detach();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.getByRole("button", { name: "Add widget", exact: true }).click();
  const widgetForm = page.getByRole("form", {
    name: "Widget settings",
    exact: true
  });
  await widgetForm
    .getByRole("textbox", { name: "Widget title", exact: true })
    .fill("Custom panel");
  await widgetForm
    .getByRole("textbox", { name: "Widget HTML", exact: true })
    .fill("<h2>My private panel</h2><script>window.widgetReady=true</script>");
  await widgetForm
    .getByRole("button", { name: "Add widget", exact: true })
    .click();
  await widgetForm.waitFor({ state: "detached" });
  const custom = page.frameLocator('iframe[title="Custom panel"]');
  await custom
    .getByRole("heading", { name: "My private panel", exact: true })
    .waitFor();
  const customFrame = page
    .frames()
    .find((frame) => frame.url().includes("/settings/home/widgets/"));
  assert(
    (await customFrame.evaluate(() => {
      try {
        return Boolean(parent.document.body);
      } catch {
        return false;
      }
    })) === false,
    "Custom widget accessed the workspace document"
  );
  assert(
    (await customFrame.evaluate(() => window.widgetReady)) === true,
    "Custom widget scripts did not run in isolation"
  );
  await capture("home-customize-desktop");
  await page.setViewportSize({ width: 390, height: 900 });
  await capture("home-customize-mobile");
  await page
    .getByRole("button", { name: "Remove Custom panel", exact: true })
    .click();
  await page
    .locator('iframe[title="Custom panel"]')
    .waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^SAVED$/ })
    .waitFor();
  assert(
    homePreferences.widgets.length === defaultHomeWidgets.length,
    "Reset did not restore home sections"
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("link", { name: /A new message/ }).click();
  await page.waitForURL("**/email?account=mail-qa&message=message-qa");
  await page.waitForFunction(() =>
    document.querySelector(".reader.reader-open")
  );
  assert(notificationRead, "Opening a notification did not mark it read");
  await page.goto(origin + "/");
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
    "/notes/projects/project-qa?view=backlog",
    "/notes/projects/project-qa?view=overview",
    "/notes/projects/project-qa?view=archive",
    "/notes/projects/project-qa?view=notes",
    "/notes/pages/page-qa",
    "/daily/news",
    "/daily/weather",
    "/daily/transport",
    "/health/walks",
    "/iot",
    "/iot/activity",
    "/settings/general",
    "/settings/companion",
    "/settings/notifications",
    "/settings/connections",
    "/settings/security",
    "/settings/api-access",
    "/settings/auth",
    "/settings/pipelines",
    "/settings/system",
    "/settings/administration",
    "/mobile/approve?request=mobile-qa"
  ];
  const overflows = [];
  for (const route of routes) {
    administrator = [
      "/settings/auth",
      "/settings/pipelines",
      "/settings/system",
      "/settings/administration",
      "/mobile/approve?request=mobile-qa"
    ].includes(route);
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
                      : route.startsWith("/mobile/")
                        ? ".settings-card h1"
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
      if ([390, 1280].includes(width) && process.env.OMNIX_UI_SCREENSHOTS)
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
  administrator = false;
  await page.goto(origin + "/daily/weather");
  await page
    .getByRole("heading", { name: "Hourly forecast", exact: true })
    .waitFor();
  const firstHours = await page
    .locator(".weather-hours time")
    .allTextContents();
  await page.getByRole("button", { name: "Later forecast hours" }).click();
  assert(
    JSON.stringify(
      await page.locator(".weather-hours time").allTextContents()
    ) !== JSON.stringify(firstHours),
    "Hourly navigation did not update the forecast"
  );
  await page.getByRole("button", { name: "Earlier forecast hours" }).click();
  assert(
    JSON.stringify(
      await page.locator(".weather-hours time").allTextContents()
    ) === JSON.stringify(firstHours),
    "Hourly navigation did not restore the first forecast"
  );
  const hours = dailyFixture.weather.data.hours;
  dailyFixture.weather.data.hours = [];
  await page.reload();
  await page
    .getByText("Hourly data is unavailable from this source.", { exact: true })
    .waitFor();
  dailyFixture.weather.data.hours = hours;
  const originalWeather = { ...dailyFixture.weather.data };
  Object.assign(dailyFixture.weather.data, {
    temperature: -100,
    unit: "°F",
    code: 95,
    label: "A very long weather location name for a small mobile screen"
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.reload();
  await page.getByText("Thunderstorms", { exact: true }).waitFor();
  assert(
    await page.evaluate(
      () =>
        document.querySelector("main.main").scrollWidth <=
        document.querySelector("main.main").clientWidth + 1
    ),
    "Weather extremes overflow on mobile"
  );
  Object.assign(dailyFixture.weather.data, originalWeather);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(origin + "/settings/general");
  await page
    .getByRole("combobox", { name: "Settings category", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Notifications", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Notifications", exact: true })
    .waitFor();
  await page.goto(origin + "/notes/projects/project-qa");
  assert(
    await page
      .getByRole("textbox", { name: "Project title", exact: true })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 32),
    "Mobile project title lost display hierarchy"
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
  const ownerId = await page.evaluate(
    async () => (await (await fetch("/api/v1/me")).json()).id
  );
  phoneHealth.user_id = ownerId;
  await page.evaluate(
    ({ dates }) => {
      window.nativeGpxExports = [];
      window.omnixNativeCapabilities = ["export-gpx", "health-connect"];
      window.ReactNativeWebView = { postMessage: () => {} };
      window.omnixNativeSend = (message) => {
        let result = null;
        if (message.type === "omnix-export-gpx") {
          window.nativeGpxExports.push(message.content);
          result = window.nativeExportResult ?? null;
        } else if (message.type === "omnix-health") {
          if (message.action === "status")
            result = {
              available: true,
              status: 3,
              permissions: ["steps", "distance", "workout_minutes", "sleep"],
              device_id: "test_phone_identifier_12345678901234567890",
              platform: "android",
              timezone: "Europe/London"
            };
          else if (message.action === "permissions") result = message.metrics;
          else if (message.action === "read")
            result = {
              unchanged: false,
              dates,
              permissions: message.metrics,
              timezone: "Europe/London",
              captured_at: new Date().toISOString(),
              changes_token: "test-cursor",
              points: Object.fromEntries(
                message.metrics.map((kind) => [
                  kind,
                  { [dates.at(-1)]: kind === "steps" ? 12345 : 5 }
                ])
              )
            };
        }
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("omnix-native-result", {
                detail: { request_id: message.request_id, result }
              })
            ),
          10
        );
      };
    },
    { dates }
  );
  await page.getByRole("button", { name: "Export GPX", exact: true }).click();
  await page
    .getByText("GPX export opened. Choose where to save or share the route.", {
      exact: true
    })
    .waitFor();
  assert(
    await page.evaluate(
      () =>
        window.nativeGpxExports.length === 1 &&
        window.nativeGpxExports[0].includes('<gpx version="1.1"')
    ),
    "Companion GPX did not reach the native export bridge"
  );
  await page.evaluate(() => {
    window.nativeExportResult = { saved: true };
  });
  await page.getByRole("button", { name: "Export GPX", exact: true }).click();
  await page.getByText("GPX saved.", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.nativeExportResult = { saved: false };
  });
  await page.getByRole("button", { name: "Export GPX", exact: true }).click();
  await page.getByText("GPX export cancelled.", { exact: true }).waitFor();
  await page.evaluate(() =>
    history.pushState({}, "", "/settings/connections#health-connect")
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PopStateEvent("popstate"))
  );
  const phoneForm = page.locator("#health-connect");
  await phoneForm
    .getByRole("button", { name: "Connect this phone", exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("omnix-native-ready"))
  );
  await phoneForm
    .getByRole("checkbox", { name: "Sync Sleep", exact: true })
    .uncheck();
  await phoneForm
    .getByRole("button", { name: "Connect this phone", exact: true })
    .click();
  await phoneForm
    .getByText("Phone readings synced.", { exact: true })
    .waitFor();
  assert(
    phoneHealth.enabled &&
      !phoneHealth.permissions.includes("sleep") &&
      phoneHealth.last_sync,
    "Phone settings did not persist selected permissions and sync status"
  );
  await page.evaluate(() => {
    delete window.ReactNativeWebView;
    delete window.omnixNativeSend;
    delete window.omnixNativeCapabilities;
  });
  await page.goto(origin + "/settings/notifications");
  const emailRules = page.locator(".email-notification-rules");
  await emailRules
    .getByRole("button", { name: "Add email rule", exact: true })
    .click();
  await emailRules
    .getByRole("textbox", { name: "Sender for rule 1", exact: true })
    .fill("@example.com");
  await emailRules
    .getByRole("button", { name: "Save email rules", exact: true })
    .click();
  await page.getByText("Email rules saved.", { exact: true }).waitFor();
  assert(
    notificationPreferences.email_rules[0].sender === "@example.com",
    "Notification rules did not persist"
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
    dailySaved.news.length === 2,
    "Custom Daily sources or widget choice did not save"
  );
  await page.goto(origin + "/");
  await page.locator(".home-widget-news .daily-summary").waitFor();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: "Weather", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /^SAVED$/ })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
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
  await page.goto(origin + "/settings/companion");
  await page
    .getByRole("img", { name: "Omnix companion pairing QR code", exact: true })
    .waitFor();
  assert(
    (await page
      .getByRole("textbox", { name: "Instance address", exact: true })
      .inputValue()) === "https://omnix.example.test",
    "Pairing QR did not use the configured instance origin"
  );
  await page.goto(origin + "/mobile/approve?request=mobile-qa");
  assert(
    (await page.getByText("123456", { exact: true }).count()) === 0,
    "Pairing should not display a numeric approval code"
  );
  await page
    .getByRole("button", { name: "Connect this device", exact: true })
    .click();
  const returnLink = page.getByRole("link", {
    name: "Return to Omnix app",
    exact: true
  });
  await returnLink.waitFor();
  assert(
    (await returnLink.getAttribute("href")) ===
      "omnix://paired?request=mobile-qa&code=" + "a".repeat(54),
    "Approval did not return an initiator-bound one-use grant"
  );
  const previousAdministrator = administrator;
  administrator = true;
  await page.goto(origin + "/settings/connections#firebase");
  const firebasePanel = page.locator("#firebase");
  await firebasePanel
    .getByLabel("Service-account JSON key", { exact: true })
    .setInputFiles({
      name: "firebase-key.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        '{"type":"service_account","private_key":"synthetic-test-key"}'
      )
    });
  await firebasePanel
    .getByRole("button", { name: "Save Firebase", exact: true })
    .click();
  await firebasePanel
    .getByText("Firebase settings saved.", { exact: true })
    .waitFor();
  assert(firebaseWrites === 1, "Firebase upload was not submitted");
  administrator = previousAdministrator;
  await page.goto(origin + "/settings/notifications");
  assert(
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .isDisabled(),
    "Browser push should not be available"
  );
  const nativePage = await context.newPage();
  await nativePage.bringToFront();
  nativePage.on("pageerror", (e) => errors.push(e.message));
  await nativePage.addInitScript(() => {
    let count = 0;
    window.ReactNativeWebView = {
      postMessage: (message) => {
        const data = JSON.parse(message);
        if (data.type !== "omnix-push-register") return;
        if (
          !Array.isArray(data.firebase?.clients) ||
          data.firebase.clients.length !== 2
        )
          throw new Error(
            "Companion did not receive server Firebase configuration"
          );
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("omnix-push", {
                detail: {
                  token:
                    "firebase_native_token_abcdefghijklmnopqrstuvwxyz123456_" +
                    ++count
                }
              })
            ),
          10
        );
      }
    };
  });
  await nativePage.goto(origin + "/settings/notifications");
  await nativePage
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await nativePage
    .getByRole("button", { name: "Disable on this device", exact: true })
    .waitFor();
  assert(nativeRegistrations === 1, "Native device was not registered");
  await nativePage.evaluate(() =>
    window.dispatchEvent(new Event("omnix-token-changed"))
  );
  await nativePage.waitForFunction(
    () => localStorage.getItem("omnix.push-device:qa") === "native-device-2"
  );
  assert(nativeRegistrations === 2, "Token rotation was not synchronized");
  await nativePage
    .getByRole("button", { name: "Send test", exact: true })
    .click();
  await nativePage
    .getByText("Test notification queued.", { exact: true })
    .waitFor();
  await nativePage
    .getByRole("button", { name: "Disable on this device", exact: true })
    .click();
  await nativePage
    .getByRole("button", { name: "Enable on this device", exact: true })
    .waitFor();
  assert(nativeDevices.length === 0, "Opting out left a registered token");
  await nativePage.close();
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
  initialSetup = true;
  await page.goto(origin + "/setup");
  await page
    .getByRole("heading", { name: "Connect Pocket ID.", exact: true })
    .waitFor();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      "Initial setup overflows at " + width
    );
    if ([390, 1280].includes(width)) await capture("setup-" + width);
  }
  initialSetup = false;
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
  tasks.push({
    ...baseTask,
    id: "archived-qa",
    issue_key: "OMN-99",
    issue_number: 99,
    title: "Archived ticket",
    status: "done",
    archived_at: stamp
  });
  await page.goto(origin + "/notes/projects/project-qa?view=board");
  assert(
    (await page.getByRole("button", { name: /OMN-99/ }).count()) === 0,
    "Board includes archived issues"
  );
  await page.goto(origin + "/notes/projects/project-qa?view=archive");
  await page.getByRole("button", { name: /OMN-99/ }).waitFor();
  await page.goto(origin + "/notes/projects/project-qa?issue=archived-qa");
  await page
    .getByRole("dialog", { name: "Issue details", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close issue", exact: true }).click();
  tasks = tasks.filter((task) => task.id !== "archived-qa");
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
      nativeGpxExport: true,
      phoneHealthPermissions: true,
      emailNotificationRules: true,
      runtimeErrors: errors.length
    })
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e.stack);
  if (browser) await browser.close();
  process.exit(1);
});
