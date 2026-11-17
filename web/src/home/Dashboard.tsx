import DailySummary from "../products/daily/DailySummary";
import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent
} from "react";
import {
  ArrowUpRight,
  SlidersHorizontal,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  Code2
} from "lucide-react";
import { useMinuteClock } from "../lib/useMinuteClock";
import { NavLink } from "react-router-dom";
import { api, qc, ApiError, type User } from "../lib/api";
import Select from "../components/Select";
import Upcoming from "../products/calendar/Upcoming";
import HealthSummary from "../products/health/HealthSummary";
import WidgetEditor from "./WidgetEditor";
import {
  sections,
  defaultLayout,
  readLayout,
  moveWidget,
  widgetTitle,
  frameContentKey,
  type HomeWidget,
  type HomeConfig
} from "./layout";
import "./dashboard.css";

type Overview = { unread: number };
export default function Dashboard({ user }: { user: User }) {
  const now = useMinuteClock();
  const [customFramesReady, setCustomFramesReady] = useState(
    !window.ReactNativeWebView || Boolean(window.omnixNativeSend)
  );
  useEffect(() => {
    const ready = () => setCustomFramesReady(true);
    window.addEventListener("omnix-native-ready", ready);
    return () => window.removeEventListener("omnix-native-ready", ready);
  }, []);

  const [customizing, setCustomizing] = useState(false),
    [saving, setSaving] = useState(false),
    [homeError, setHomeError] = useState("");
  const [editor, setEditor] = useState<HomeWidget | "new" | null>(null),
    [conflict, setConflict] = useState<HomeWidget[] | null>(null);
  const [removed, setRemoved] = useState<{
    widget: HomeWidget;
    index: number;
  } | null>(null);
  const [dragging, setDragging] = useState(""),
    [over, setOver] = useState("");
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    target: string;
    moved: boolean;
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const home = useQuery<HomeConfig>({
    queryKey: ["home-preferences", user.id],
    queryFn: () => api("/settings/home"),
    refetchOnWindowFocus: !saving
  });
  const layout = readLayout(home.data);
  const visible = (kind: string) =>
    layout.some((widget) => widget.kind === kind);
  async function saveLayout(
    next: HomeWidget[],
    replace = false
  ): Promise<boolean> {
    if (saving || qc.getQueryData<User>(["me"])?.id !== user.id) return false;
    setSaving(true);
    setHomeError("");
    setConflict(null);
    await qc.cancelQueries({ queryKey: ["home-preferences", user.id] });
    const previous = home.data;
    try {
      let revision = previous?.revision ?? 0;
      if (replace)
        revision = (await api<HomeConfig>("/settings/home")).revision ?? 0;
      if (qc.getQueryData<User>(["me"])?.id !== user.id) return false;
      const body = {
        layout: next,
        widgets: next
          .filter((widget) => sections.some(([kind]) => kind === widget.kind))
          .map((widget) => widget.kind),
        expected_revision: revision
      };
      qc.setQueryData(["home-preferences", user.id], { ...body, revision });
      const saved = await api<HomeConfig>("/settings/home", {
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (qc.getQueryData<User>(["me"])?.id !== user.id) return false;
      qc.setQueryData(["home-preferences", user.id], saved);
      return true;
    } catch (error) {
      if (qc.getQueryData<User>(["me"])?.id === user.id)
        qc.setQueryData(["home-preferences", user.id], previous);
      setHomeError((error as Error).message);
      if (error instanceof ApiError && error.status === 409) setConflict(next);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function reorder(id: string, target: string) {
    const next = moveWidget(layout, id, target);
    if (next !== layout) void saveLayout(next);
  }
  function pointerStart(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (saving || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      target: id,
      moved: false
    };
    setDragging(id);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    if (
      Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6 &&
      !current.moved
    )
      return;
    current.moved = true;
    for (const element of grid.current?.querySelectorAll<HTMLElement>(
      "[data-home-widget]"
    ) ?? []) {
      const rect = element.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        current.target = element.dataset.homeWidget!;
        setOver(current.target);
        break;
      }
    }
    let scroll: HTMLElement | null = grid.current;
    while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY))
      scroll = scroll.parentElement;
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      if (event.clientY < rect.top + 40) scroll.scrollBy(0, -18);
      else if (event.clientY > rect.bottom - 40) scroll.scrollBy(0, 18);
    }
  }
  function pointerEnd() {
    const current = drag.current;
    drag.current = null;
    setDragging("");
    setOver("");
    if (current?.moved) reorder(current.id, current.target);
  }
  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api("/overview"),
    enabled: !home.isPending && visible("unread"),
    refetchInterval: 15000
  });
  const data = overview.data;
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const zone =
    preferences.data?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      hourCycle: "h23"
    }).format(now)
  );
  const date = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: zone
  });
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: preferences.data?.time_format === "12",
    timeZone: zone
  });
  const clockParts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: preferences.data?.time_format === "12",
    timeZone: zone
  }).formatToParts(now);
  const clockTime = clockParts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const dayPeriod = clockParts.find((part) => part.type === "dayPeriod")?.value;

  function content(widget: HomeWidget) {
    switch (widget.kind) {
      case "clock":
        return (
          <section className="clock-section" aria-label="Date and time">
            <h1 className="dashboard-greeting">
              {hour < 12
                ? "Good morning"
                : hour < 18
                  ? "Good afternoon"
                  : "Good evening"}
              , {user.name.split(" ")[0]}.
            </h1>
            <time
              className="clock"
              dateTime={now.toISOString()}
              aria-label={"Current time " + time}
            >
              {clockTime}
              {dayPeriod && <span className="clock-period">{dayPeriod}</span>}
            </time>
            <time className="clock-date" dateTime={now.toISOString()}>
              {date}
            </time>
          </section>
        );
      case "unread":
        return (
          <section className="dashboard-unread" aria-label="Unread mail">
            <div className="section-title">
              <h2>Unread mail</h2>
              <NavLink to="/email?unread=true" aria-label="Open unread mail">
                <ArrowUpRight size={16} />
              </NavLink>
            </div>
            <NavLink
              className="dashboard-stat-value"
              to="/email?unread=true"
              aria-label="View unread emails"
            >
              {overview.isLoading || overview.error || !data
                ? "—"
                : data.unread.toLocaleString()}
            </NavLink>
            {overview.error ? (
              <p className="error" role="alert">
                Mail unavailable.{" "}
                <button
                  className="text-button"
                  onClick={() => overview.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : (
              <span className="eyebrow">
                {overview.isLoading
                  ? "LOADING"
                  : data?.unread === 0
                    ? "ALL CAUGHT UP"
                    : "IN YOUR INBOXES"}
              </span>
            )}
          </section>
        );
      case "steps":
        return <HealthSummary zone={zone} />;
      case "calendar":
        return (
          <Upcoming
            zone={zone}
            hour12={preferences.data?.time_format === "12"}
          />
        );
      case "weather":
      case "transport":
      case "news":
        return (
          <DailySummary
            widgets={[widget.kind]}
            respectIntegrationVisibility={false}
          />
        );
      default:
        if (!customFramesReady)
          return (
            <p className="muted">
              Update the companion app to display custom widgets.
            </p>
          );
        return (
          <section className="home-custom-widget">
            <h2>{widgetTitle(widget)}</h2>
            <iframe
              title={widgetTitle(widget)}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              loading="lazy"
              style={{ height: widget.height }}
              src={
                "/api/v1/settings/home/widgets/" +
                encodeURIComponent(widget.id) +
                "/frame?v=" +
                frameContentKey(widget)
              }
            />
          </section>
        );
    }
  }
  if (home.isPending)
    return (
      <div className="dashboard dashboard-focus">
        <p className="muted" role="status">
          Loading homepage...
        </p>
      </div>
    );
  return (
    <div
      className={
        "dashboard dashboard-focus" + (customizing ? " is-customizing" : "")
      }
    >
      {!visible("clock") && <h1 className="sr-only">Overview</h1>}
      <div className="home-controls">
        <button
          className="text-button"
          aria-expanded={customizing}
          aria-controls="home-customize"
          onClick={() => {
            setCustomizing(!customizing);
            setEditor(null);
          }}
        >
          <SlidersHorizontal size={16} />
          {customizing ? "Done" : "Customize"}
        </button>
      </div>
      {customizing && (
        <section
          id="home-customize"
          className="home-customize"
          aria-label="Customize homepage"
        >
          <div className="section-title">
            <h2>Your layout</h2>
            <div className="home-customize-actions">
              <button
                disabled={saving || Boolean(home.error) || layout.length >= 20}
                onClick={() => setEditor("new")}
              >
                <Plus size={16} />
                Add widget
              </button>
              <button
                className="text-button"
                disabled={saving || Boolean(home.error)}
                title="Restore built-in defaults and keep custom widgets"
                onClick={() =>
                  void saveLayout([
                    ...defaultLayout(),
                    ...layout.filter(
                      (widget) =>
                        widget.kind === "html" || widget.kind === "webview"
                    )
                  ])
                }
              >
                Reset layout
              </button>
            </div>
          </div>
          <p className="muted">
            Drag a handle or use its arrow keys. Changes save automatically.
          </p>
          <div
            className="home-widget-palette"
            aria-label="Available home sections"
          >
            {sections.map(([kind, label]) => (
              <button
                key={kind}
                aria-pressed={visible(kind)}
                disabled={saving || Boolean(home.error)}
                onClick={() =>
                  void saveLayout(
                    visible(kind)
                      ? layout.filter((widget) => widget.kind !== kind)
                      : [
                          ...layout,
                          defaultLayout().find(
                            (widget) => widget.kind === kind
                          )!
                        ]
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
          <span className="eyebrow" role="status">
            {saving ? "SAVING" : "SAVED"}
          </span>
          {removed &&
            !layout.some((widget) => widget.id === removed.widget.id) && (
              <button
                className="text-button"
                disabled={saving}
                onClick={async () => {
                  const next = [...layout];
                  next.splice(removed.index, 0, removed.widget);
                  if (await saveLayout(next)) setRemoved(null);
                }}
              >
                Undo removal
              </button>
            )}
          {editor && (
            <WidgetEditor
              key={editor === "new" ? "new" : editor.id}
              widget={editor === "new" ? undefined : editor}
              existing={layout}
              busy={saving}
              onCancel={() => setEditor(null)}
              onApply={async (widget) => {
                const next = layout.some((item) => item.id === widget.id)
                  ? layout.map((item) =>
                      item.id === widget.id ? widget : item
                    )
                  : [...layout, widget];
                const saved = await saveLayout(next);
                if (saved) setEditor(null);
                return saved;
              }}
            />
          )}
        </section>
      )}
      {(homeError || home.error) && (
        <div className="home-layout-error" role="alert">
          <p>{homeError || home.error?.message}</p>
          <button
            className="text-button"
            disabled={saving}
            onClick={() => {
              setConflict(null);
              setHomeError("");
              void home.refetch();
            }}
          >
            Reload saved layout
          </button>
          {conflict && (
            <button
              disabled={saving}
              onClick={() => void saveLayout(conflict, true)}
            >
              Replace with my layout
            </button>
          )}
        </div>
      )}
      {!layout.length && <p className="empty">Add a widget using Customize.</p>}
      <div ref={grid} className="home-widget-grid" aria-label="Home widgets">
        {layout.map((widget, index) => (
          <div
            key={widget.id}
            data-home-widget={widget.id}
            className={
              "home-widget home-widget-" +
              widget.kind +
              (dragging === widget.id ? " is-dragging" : "") +
              (over === widget.id && over !== dragging ? " is-drop-target" : "")
            }
            style={{ "--widget-columns": widget.columns } as CSSProperties}
          >
            {customizing && (
              <div className="home-widget-tools">
                <button
                  className="icon-button home-widget-grip"
                  aria-label={"Move " + widgetTitle(widget)}
                  disabled={saving}
                  onPointerDown={(event) => pointerStart(event, widget.id)}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerEnd}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragging("");
                    setOver("");
                  }}
                  onKeyDown={(event) => {
                    let target = index;
                    if (event.key === "ArrowUp" || event.key === "ArrowLeft")
                      target--;
                    else if (
                      event.key === "ArrowDown" ||
                      event.key === "ArrowRight"
                    )
                      target++;
                    else if (event.key === "Home") target = 0;
                    else if (event.key === "End") target = layout.length - 1;
                    else return;
                    event.preventDefault();
                    if (layout[target]) reorder(widget.id, layout[target].id);
                  }}
                >
                  <GripVertical size={16} />
                </button>
                <span className="eyebrow">{widgetTitle(widget)}</span>
                <Select
                  aria-label={"Width for " + widgetTitle(widget)}
                  value={widget.columns}
                  disabled={saving}
                  onChange={(event) =>
                    void saveLayout(
                      layout.map((item) =>
                        item.id === widget.id
                          ? { ...item, columns: Number(event.target.value) }
                          : item
                      )
                    )
                  }
                >
                  {[
                    [2, "Narrow"],
                    [3, "Quarter"],
                    [4, "Third"],
                    [6, "Half"],
                    [8, "Wide"],
                    [12, "Full"]
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <button
                  className="icon-button"
                  aria-label={"Move " + widgetTitle(widget) + " up"}
                  disabled={saving || index === 0}
                  onClick={() => reorder(widget.id, layout[index - 1].id)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={"Move " + widgetTitle(widget) + " down"}
                  disabled={saving || index === layout.length - 1}
                  onClick={() => reorder(widget.id, layout[index + 1].id)}
                >
                  <ArrowDown size={14} />
                </button>
                {(widget.kind === "html" || widget.kind === "webview") && (
                  <button
                    className="icon-button"
                    aria-label={"Edit " + widgetTitle(widget)}
                    disabled={saving}
                    onClick={() => setEditor(widget)}
                  >
                    <Code2 size={15} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={"Remove " + widgetTitle(widget)}
                  disabled={saving}
                  onClick={async () => {
                    if (
                      await saveLayout(
                        layout.filter((item) => item.id !== widget.id)
                      )
                    )
                      setRemoved({ widget, index });
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {content(widget)}
          </div>
        ))}
      </div>
    </div>
  );
}
