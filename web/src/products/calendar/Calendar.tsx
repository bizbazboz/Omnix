import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw, MapPin } from "lucide-react";
import { useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api, qc } from "../../lib/api";
import { useStoredFlag } from "../../lib/layout";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import CalendarMonth from "./CalendarMonth";
import { type ProductProps } from "../registry";
import {
  type Feed,
  type CalendarEvent,
  eventDay,
  eventTime,
  dayLabel,
  dateKey,
  monthDays
} from "./api";

export default function Calendar({ notify }: ProductProps) {
  const [params, setParams] = useSearchParams();
  const [hidden, setHidden] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const view = params.get("view") === "agenda" ? "agenda" : "month";
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)
  );
  const [sourcesOpen, setSourcesOpen] = useStoredFlag(
    "omnix.calendar.sourcesOpen",
    true
  );
  const feeds = useQuery<Feed[]>({
    queryKey: ["calendar-feeds"],
    queryFn: () => api("/calendar/feeds"),
    refetchInterval: 10000
  });
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const zone =
    preferences.data?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const grid = monthDays(month),
    end = new Date(grid[41]);
  end.setDate(end.getDate() + 1);
  const range =
    view === "month"
      ? new URLSearchParams({
          start: dateKey(grid[0]),
          end: dateKey(end),
          timezone: zone
        }).toString()
      : "days=" + days;
  const events = useQuery<CalendarEvent[]>({
    queryKey: ["calendar-events", view, range],
    queryFn: () => api("/calendar/events?" + range),
    refetchInterval: 10000
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["calendar-feeds"] });
    qc.invalidateQueries({ queryKey: ["calendar-events"] });
  };
  async function action(feed: Feed) {
    try {
      await api("/calendar/feeds/" + feed.id + "/refresh", {
        method: "POST"
      });
      invalidate();
      notify("Calendar refresh queued.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const visible = (events.data || []).filter(
    (e) => !hidden.includes(e.feed_id)
  );
  const groups = new Map<string, CalendarEvent[]>();
  visible.forEach((event) => {
    const day = eventDay(event, zone);
    groups.set(day, [...(groups.get(day) || []), event]);
  });
  return (
    <div className="calendar-product">
      <header className="calendar-heading">
        <div>
          <span className="eyebrow">CALENDAR / {view.toUpperCase()}</span>
          <h1>Calendar</h1>
        </div>
        <div className="calendar-actions">
          <div
            className="calendar-view-toggle"
            role="group"
            aria-label="Calendar view"
          >
            {(["month", "agenda"] as const).map((mode) => (
              <button
                key={mode}
                className={view === mode ? "active" : ""}
                aria-pressed={view === mode}
                onClick={() =>
                  setParams((previous) => {
                    const next = new URLSearchParams(previous);
                    next.set("view", mode);
                    return next;
                  })
                }
              >
                {mode === "month" ? "Month" : "Agenda"}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label={sourcesOpen ? "Hide calendars" : "Show calendars"}
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            {sourcesOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
        </div>
      </header>
      <div
        className={"calendar-layout " + (!sourcesOpen ? "sources-hidden" : "")}
      >
        {sourcesOpen && (
          <aside className="calendar-feeds" aria-label="Calendar subscriptions">
            <div className="section-title">
              <h2>Calendars</h2>
              <span className="eyebrow">
                {String(feeds.data?.length || 0).padStart(2, "0")}
              </span>
            </div>
            {feeds.isLoading && <p className="muted">Loading calendars…</p>}
            {feeds.error && (
              <p className="error" role="alert">
                Could not load calendars.
              </p>
            )}
            {!feeds.isLoading && !feeds.error && !feeds.data?.length && (
              <p className="muted">No calendars connected.</p>
            )}
            {feeds.data?.map((feed, index) => (
              <div className="calendar-feed" key={feed.id}>
                <label className="calendar-feed-toggle">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(feed.id)}
                    onChange={() =>
                      setHidden((current) =>
                        current.includes(feed.id)
                          ? current.filter((id) => id !== feed.id)
                          : [...current, feed.id]
                      )
                    }
                  />
                  <span className="feed-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong>{feed.label}</strong>
                </label>
                <small>{feed.host}</small>
                <div className="feed-status">
                  <span
                    className={
                      feed.status === "error" ? "warning-value" : "muted"
                    }
                  >
                    {feed.status === "pending"
                      ? "Fetching…"
                      : feed.status === "error"
                        ? "Refresh failed"
                        : feed.last_sync
                          ? "Updated " +
                            new Date(feed.last_sync).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          : "Waiting"}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={"Refresh " + feed.label}
                    onClick={() => action(feed)}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                {feed.error && (
                  <p className="feed-error">
                    {feed.error} Previously fetched events remain available.
                  </p>
                )}
              </div>
            ))}
            <p className="calendar-note">
              Read-only subscriptions · refresh every 15 minutes
            </p>
          </aside>
        )}
        <section
          className="calendar-agenda"
          aria-label={view === "month" ? "Calendar month" : "Upcoming events"}
        >
          {view === "agenda" && (
            <div className="section-title">
              <h2>Upcoming</h2>
              <select
                aria-label="Agenda range"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>Next 7 days</option>
                <option value={30}>Next 30 days</option>
                <option value={90}>Next 90 days</option>
              </select>
            </div>
          )}
          {events.error ? (
            <div className="error" role="alert">
              Could not load events.{" "}
              <button onClick={() => events.refetch()}>Retry</button>
            </div>
          ) : events.isLoading ? (
            <div className="empty">Loading events…</div>
          ) : view === "month" ? (
            <CalendarMonth
              key={dateKey(month)}
              month={month}
              onMonth={setMonth}
              events={visible}
              zone={zone}
              hour12={preferences.data?.time_format === "12"}
            />
          ) : !visible.length ? (
            <div className="calendar-empty">
              <CalendarDays size={32} />
              <h2>No upcoming events</h2>
              <p className="muted">
                {feeds.data?.length
                  ? "No events match this view."
                  : "Bring your calendars into one agenda."}
              </p>
              {!feeds.data?.length && (
                <NavLink
                  className="secondary"
                  to="/app/settings/connections#calendars"
                >
                  Open Integrations
                </NavLink>
              )}
            </div>
          ) : (
            [...groups]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([day, items]) => (
                <section className="agenda-day" key={day}>
                  <h3>{dayLabel(day)}</h3>
                  {items.map((event) => (
                    <article className="agenda-event" key={event.id}>
                      <time>
                        {eventTime(
                          event,
                          zone,
                          preferences.data?.time_format === "12"
                        )}
                      </time>
                      <div>
                        <h3>{event.title}</h3>
                        <span className="event-calendar">{event.calendar}</span>
                        {event.location && (
                          <p className="event-location">
                            <MapPin size={12} />
                            {event.location}
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              ))
          )}
        </section>
      </div>
    </div>
  );
}
