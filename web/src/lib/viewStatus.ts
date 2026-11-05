export type ViewStatus = {
  updatedAt: number;
  sourceAt: number | null;
  kind: "updated" | "synced" | "saved";
  connected: boolean | null;
  pending: number;
  writing: number;
  failed: boolean;
};
const empty: ViewStatus = {
  updatedAt: 0,
  sourceAt: null,
  kind: "updated",
  connected: null,
  pending: 0,
  writing: 0,
  failed: false
};
const snapshots = new Map<string, ViewStatus>();
const failures = new Map<string, Set<string>>();
const providers = new Map<string, unknown>();
const lastReads = new Map<string, number>();
const listeners = new Set<() => void>();
export const subscribeViewStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function readViewStatus(view: string) {
  const existing = snapshots.get(view);
  if (existing) return existing;
  const current = new URL(view, window.location.origin);
  const related = [...snapshots.entries()]
    .filter(
      ([key]) =>
        new URL(key, window.location.origin).pathname === current.pathname
    )
    .map(([, value]) => value)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  let initial = {
    ...(related || empty),
    updatedAt:
      related?.updatedAt || lastReads.get(current.pathname.split("/")[1]) || 0,
    pending: 0,
    writing: 0,
    failed: false
  };
  for (const [path, data] of providers)
    initial = {
      ...initial,
      ...source(new URL(view, window.location.origin), path, data)
    };
  snapshots.set(view, initial);
  return initial;
}
function update(view: string, patch: Partial<ViewStatus>) {
  snapshots.set(view, { ...readViewStatus(view), ...patch });
  if (snapshots.size > 100) {
    const oldest = snapshots.keys().next().value!;
    snapshots.delete(oldest);
    failures.delete(oldest);
  }
  listeners.forEach((listener) => listener());
}
function stamp(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function newest(rows: Record<string, unknown>[]) {
  const values = rows
    .map((row) => stamp(row.last_sync))
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}
function source(view: URL, path: string, data: unknown): Partial<ViewStatus> {
  const page = view.pathname;
  if (
    page.startsWith("/health/walks") &&
    path === "/health/walks" &&
    data &&
    typeof data === "object"
  ) {
    const row = data as any;
    return {
      kind: row.route ? "saved" : "updated",
      sourceAt: stamp(row.route?.created_at || row.map?.updated_at),
      connected: Boolean(row.map?.ready)
    };
  }
  if (
    page.startsWith("/daily") &&
    path === "/daily" &&
    data &&
    typeof data === "object"
  ) {
    const row = data as Record<string, any>,
      section = page.split("/")[2] || "news";
    return {kind:"synced",sourceAt:stamp(row[section]?.last_sync),connected:row[section]?.enabled ?? false};
  }
  if (
    page.startsWith("/email") &&
    !/^\/email\/(drafts|outbox)(?:\/|$)/.test(page) &&
    path === "/connections" &&
    Array.isArray(data)
  ) {
    const account = view.searchParams.get("account");
    const rows = data.filter(
      (row) =>
        row.can_read &&
        row.status !== "disconnected" &&
        (!account || row.id === account)
    );
    return {
      kind: "synced",
      sourceAt: newest(rows),
      connected: rows.length > 0
    };
  }
  if (
    page.startsWith("/calendar") &&
    path === "/calendar/feeds" &&
    Array.isArray(data)
  )
    return {
      kind: "synced",
      sourceAt: newest(data),
      connected: data.length > 0
    };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    if (
      page.startsWith("/health") &&
      !page.startsWith("/health/walks") &&
      path === "/health/status"
    )
      return {
        kind: "synced",
        sourceAt: stamp(row.last_sync),
        connected: Boolean(row.connected)
      };
    if (
      page.startsWith("/notes/pages/") &&
      path === "/notes/pages/" + page.split("/")[3]
    )
      return {
        kind: "saved",
        sourceAt: stamp(row.updated_at),
        connected: true
      };
    if (
      page.startsWith("/notes/projects/") &&
      path === "/notes/projects/" + page.split("/")[3]
    )
      return {
        kind: "updated",
        sourceAt: stamp(row.updated_at),
        connected: true
      };
  }
  return {};
}
function rememberProvider(path: string, data: unknown) {
  if (
    !["/connections", "/calendar/feeds", "/health/status", "/daily"].includes(
      path
    )
  )
    return;
  // Keep only sync metadata, never provider URLs, addresses or credentials.
  const compact =
    path === "/daily" && data && typeof data === "object"
      ? Object.fromEntries(
          Object.entries(data)
            .filter(([key]) =>
              [
                "news",
                "weather",
                "transport",
                "walks",
                "walks_configured"
              ].includes(key)
            )
            .map(([key, value]) => [
              key,
              key === "walks_configured"
                ? value
                : key === "walks"
                  ? { created_at: (value as any)?.created_at }
                  : {
                      last_sync: (value as any)?.last_sync,
                      enabled: (value as any)?.enabled
                    }
            ])
        )
      : Array.isArray(data)
        ? data.map((row) => ({
            id: row.id,
            can_read: row.can_read,
            status: row.status,
            last_sync: row.last_sync
          }))
        : data && typeof data === "object"
          ? {
              connected: (data as Record<string, unknown>).connected,
              last_sync: (data as Record<string, unknown>).last_sync
            }
          : null;
  providers.set(path, compact);
  for (const [view, current] of snapshots)
    snapshots.set(view, {
      ...current,
      ...source(new URL(view, window.location.origin), path, compact)
    });
  listeners.forEach((listener) => listener());
}
export function trackViewRequest(path: string, method = "GET") {
  const viewKey = window.location.pathname + window.location.search;
  const view = new URL(viewKey, window.location.origin);
  const resource = path.split("?")[0];
  const section = view.pathname.split("/")[1];
  const relevant =
    section === ""
      ? resource === "/overview"
      : section === "settings" || section === "onboarding"
        ? resource.startsWith("/settings/") ||
          resource === "/connectors" ||
          resource === "/onboarding"
        : resource.startsWith("/" + section + "/") ||
          (section === "daily" && resource === "/daily") ||
          (section === "email" && resource === "/connections");
  if (!relevant)
    return (success: boolean, data?: unknown) => {
      if (success) {
        lastReads.set(resource.split("/")[1], Date.now());
        rememberProvider(resource, data);
      }
    };
  const writing = !["GET", "HEAD"].includes(method.toUpperCase());
  const before = readViewStatus(viewKey);
  update(viewKey, {
    pending: before.pending + 1,
    writing: before.writing + Number(writing)
  });
  let finished = false;
  return (success: boolean, data?: unknown) => {
    if (finished) return;
    finished = true;
    if (success) {
      lastReads.set(resource.split("/")[1], Date.now());
      rememberProvider(resource, data);
    }
    const current = readViewStatus(viewKey);
    const failed = failures.get(viewKey) || new Set<string>();
    if (success) failed.delete(resource);
    else failed.add(resource);
    failures.set(viewKey, failed);
    update(viewKey, {
      pending: Math.max(0, current.pending - 1),
      writing: Math.max(0, current.writing - Number(writing)),
      failed: failed.size > 0,
      ...(success
        ? { updatedAt: Date.now(), ...source(view, resource, data) }
        : {})
    });
  };
}
