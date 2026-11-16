import DailySummary from "../products/daily/DailySummary";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { useMinuteClock } from "../lib/useMinuteClock";
import { NavLink } from "react-router-dom";
import { api, qc, type User } from "../lib/api";
import Upcoming from "../products/calendar/Upcoming";
import HealthSummary from "../products/health/HealthSummary";
import "./dashboard.css";

const homeSections = [
  ["clock", "Clock and date"],
  ["unread", "Unread mail"],
  ["steps", "Steps"],
  ["calendar", "Upcoming events"],
  ["weather", "Weather"],
  ["transport", "Train issues"],
  ["news", "Headlines"]
] as const;
type HomePreferences = { widgets: string[] };
const defaultHome = { widgets: homeSections.map(([key]) => key) };
type Overview = { unread: number };
export default function Dashboard({ user }: { user: User }) {
  const now = useMinuteClock();
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [homeError, setHomeError] = useState("");
  const home = useQuery<HomePreferences>({
    queryKey: ["home-preferences"],
    queryFn: () => api("/settings/home"),
    refetchOnWindowFocus: true
  });
  const widgets = home.data?.widgets ?? defaultHome.widgets;
  const visible = (key: string) => widgets.includes(key);
  async function saveHome(next: HomePreferences) {
    setSaving(true);
    setHomeError("");
    const previous = home.data;
    qc.setQueryData(["home-preferences"], next);
    try {
      const saved = await api<HomePreferences>("/settings/home", {
        method: "PUT",
        body: JSON.stringify(next)
      });
      // Updating the cache keeps the preview and every mounted home in sync.
      qc.setQueryData(["home-preferences"], saved);
    } catch (error) {
      qc.setQueryData(["home-preferences"], previous);
      setHomeError((error as Error).message);
    } finally {
      setSaving(false);
    }
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
  if (home.isPending)
    return (
      <div className="dashboard dashboard-focus">
        <p className="muted" role="status">
          Loading homepage…
        </p>
      </div>
    );
  return (
    <div className="dashboard dashboard-focus">
      <div className="home-controls">
        <button
          className="text-button"
          aria-expanded={customizing}
          aria-controls="home-customize"
          onClick={() => setCustomizing(!customizing)}
        >
          <SlidersHorizontal size={16} /> Customize
        </button>
      </div>
      {customizing && (
        <section
          id="home-customize"
          className="home-customize"
          aria-label="Customize homepage"
        >
          <div className="section-title">
            <h2>Your homepage</h2>
            <button
              className="text-button"
              disabled={saving || home.isPending || Boolean(home.error)}
              onClick={() => void saveHome(defaultHome)}
            >
              Reset
            </button>
          </div>
          <fieldset disabled={saving || home.isPending || Boolean(home.error)}>
            <legend className="sr-only">Visible sections</legend>
            {homeSections.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={visible(key)}
                  onChange={() =>
                    void saveHome({
                      widgets: homeSections
                        .map(([id]) => id)
                        .filter((id) =>
                          id === key ? !visible(id) : visible(id)
                        )
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="muted" role="status">
            {saving ? "Saving…" : "Saved automatically to your account."}
          </p>
          {(homeError || home.error) && (
            <p className="error" role="alert">
              {homeError || home.error?.message}
              <button className="text-button" onClick={() => home.refetch()}>
                Retry
              </button>
            </p>
          )}
        </section>
      )}
      {!widgets.length && (
        <p className="empty">Choose the sections you want using Customize.</p>
      )}
      <header
        className={
          "dashboard-hero" + (!visible("clock") ? " without-clock" : "")
        }
      >
        {visible("clock") && (
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
        )}
        {(visible("unread") || visible("steps")) && (
          <div className="dashboard-at-a-glance">
            {visible("unread") && (
              <section className="dashboard-unread" aria-label="Unread mail">
                <div className="section-title">
                  <h2>Unread mail</h2>
                  <NavLink
                    to="/email?unread=true"
                    aria-label="Open unread mail"
                  >
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
            )}
            {visible("steps") && <HealthSummary zone={zone} />}
          </div>
        )}
      </header>
      {(visible("calendar") ||
        ["weather", "transport", "news"].some(visible)) && (
        <div
          className={
            "dashboard-briefing" +
            (!visible("calendar") ? " without-calendar" : "")
          }
        >
          {visible("calendar") && (
            <Upcoming
              zone={zone}
              hour12={preferences.data?.time_format === "12"}
            />
          )}
          {["weather", "transport", "news"].some(visible) && (
            <DailySummary widgets={widgets} />
          )}
        </div>
      )}
    </div>
  );
}
