export const sections = [
  ["clock", "Clock and date"],
  ["unread", "Unread mail"],
  ["steps", "Steps"],
  ["calendar", "Upcoming events"],
  ["weather", "Weather"],
  ["transport", "Train issues"],
  ["news", "Headlines"]
] as const;
export type WidgetKind = (typeof sections)[number][0] | "html" | "webview";
export type HomeWidget = {
  id: string;
  kind: WidgetKind;
  columns: number;
  title: string;
  height: number;
  html: string;
  url: string;
};
export type HomeConfig = {
  widgets: string[];
  layout?: HomeWidget[];
  revision?: number;
};
const widths: Record<string, number> = {
  clock: 8,
  unread: 2,
  steps: 2,
  calendar: 6,
  weather: 3,
  transport: 3,
  news: 12
};
export function newWidget(kind: WidgetKind): HomeWidget {
  return {
    id:
      kind === "html" || kind === "webview"
        ? "custom-" + crypto.randomUUID()
        : kind,
    kind,
    columns: widths[kind] ?? 6,
    title: "",
    height: 260,
    html:
      kind === "html"
        ? '<div style="padding:24px"><h2>My widget</h2><p>Your HTML goes here.</p></div>'
        : "",
    url: ""
  };
}
export function defaultLayout(): HomeWidget[] {
  return sections.map(([kind]) => newWidget(kind));
}
export function readLayout(config?: HomeConfig): HomeWidget[] {
  return (
    config?.layout ??
    (config?.widgets ?? sections.map(([key]) => key))
      .filter((key) => sections.some(([kind]) => key === kind))
      .map((key) => newWidget(key as WidgetKind))
  );
}
export function widgetTitle(widget: HomeWidget): string {
  return (
    widget.title.trim() ||
    sections.find(([key]) => key === widget.kind)?.[1] ||
    (widget.kind === "html" ? "HTML widget" : "Website")
  );
}
export function moveWidget(
  layout: HomeWidget[],
  id: string,
  target: string
): HomeWidget[] {
  const from = layout.findIndex((widget) => widget.id === id),
    to = layout.findIndex((widget) => widget.id === target);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = [...layout];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// A cache tag for frame content, independent of layout order and dimensions.
export function frameContentKey(widget: HomeWidget): string {
  let hash = 2166136261;
  const content = JSON.stringify([
    widget.kind,
    widget.title,
    widget.html,
    widget.url
  ]);
  for (let index = 0; index < content.length; index++)
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
