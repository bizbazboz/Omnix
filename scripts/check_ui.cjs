// Synthetic API fixtures only; this audit never writes to the running workspace.
const path = require("path");
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
    created = [];
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
  await context.addInitScript(() => {
    window.__unsafeMail = false;
    addEventListener("message", (e) => {
      if (e.data?.type === "unsafe-email") window.__unsafeMail = true;
    });
  });
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
    else if (p === "/config")
      data = { oidc_configured: true, setup_available: false };
    else if (p === "/products")
      data = [
        { id: "email", name: "Mail" },
        { id: "calendar", name: "Calendar" },
        { id: "health", name: "Health" },
        { id: "notes", name: "Notes & Projects" }
      ];
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
    else if (p === "/calendar/events") data = [];
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
      data = { dates: [], timezone: "Europe/London", metrics: {} };
    else if (p === "/health/google/registration")
      data = { configured: true, can_configure: false };
    else if (p === "/notes/overview") data = { recent: [note], tasks: [] };
    else if (p === "/notes/pages") data = { items: [note], next_offset: null };
    else if (p === "/notes/pages/" + note.id) data = note;
    else if (p.startsWith("/notes/pages/")) data = [];
    else if (p === "/notes/projects") data = [project];
    else if (p === "/notes/projects/" + project.id) data = project;
    else if (p === "/notes/projects/" + project.id + "/tasks") {
      if (req.method() === "POST") {
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
    else if (p.includes("/notes/projects/") && p.includes("/tasks/"))
      data = {
        ...tasks.find((t) => p.endsWith("/" + t.id)),
        ...req.postDataJSON()
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data)
    });
  });
  await page.goto(origin + "/");
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
        expected = Math.min(
          1,
          innerWidth / Math.max(root.scrollWidth, root.offsetWidth)
        );
      return (
        Math.abs(new DOMMatrix(getComputedStyle(root).transform).a - expected) <
          0.005 &&
        document.querySelector("#newsletter").getBoundingClientRect().right <=
          innerWidth + 1 &&
        document.querySelector("#email-bottom").getBoundingClientRect()
          .bottom <=
          innerHeight + 2
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
  await frame.waitForFunction(
    () => document.scrollingElement.scrollWidth > innerWidth
  );
  await page
    .getByRole("group", { name: "Email sizing" })
    .getByRole("button", { name: "Fit width", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load remote images", exact: true })
    .click();
  await page.waitForResponse((r) =>
    r.url().startsWith("https://images.example.test/")
  );
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
    "/settings/general",
    "/settings/connections",
    "/settings/security",
    "/settings/api-access"
  ];
  const overflows = [];
  for (const route of routes) {
    await page.goto(origin + route);
    await page.locator("main.main").waitFor();
    await page.waitForTimeout(120);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
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
  await modal
    .getByRole("textbox", { name: "Issue summary", exact: true })
    .fill("Created issue");
  await modal
    .getByRole("button", { name: "Create issue", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  assert(
    created.length === 1 && created[0].status !== "done",
    "Creation changed issue to Done or duplicated it"
  );
  assert(
    !new URL(page.url()).searchParams.has("issue"),
    "Created issue stayed open in URL"
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
  await modal
    .getByRole("textbox", { name: "Issue summary", exact: true })
    .fill("Failure stays open");
  badCreate = true;
  await modal
    .getByRole("button", { name: "Create issue", exact: true })
    .click();
  await modal.getByText("Creation failed", { exact: true }).waitFor();
  assert(await modal.isVisible(), "Failed issue creation closed the form");
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
      issueAutoClose: true,
      failedCreateStaysOpen: true,
      syncStatus: true,
      runtimeErrors: errors.length
    })
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e.message);
  if (browser) await browser.close();
  process.exit(1);
});
