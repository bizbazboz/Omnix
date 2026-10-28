import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import {
  type CalendarEvent,
  type Feed,
  eventTime,
  eventDay,
  dayLabel
} from "./api";

export default function Upcoming({
  zone,
  hour12
}: {
  zone: string;
  hour12: boolean;
}) {
  const events = useQuery<CalendarEvent[]>({
    queryKey: ["calendar-events", 7],
    queryFn: () => api("/calendar/events?days=7"),
    refetchInterval: 30000
  });
  const feeds = useQuery<Feed[]>({
    queryKey: ["calendar-feeds"],
    queryFn: () => api("/calendar/feeds"),
    refetchInterval: 30000
  });
  return (
    <section className="dashboard-agenda">
      <div className="section-title">
        <h2>Coming up</h2>
        <NavLink to="/app/calendar">
          CALENDAR <ArrowUpRight size={14} />
        </NavLink>
      </div>
      {feeds.data?.some((feed) => feed.status === "error") && (
        <p className="notice">
          A calendar could not refresh. Showing saved events.
        </p>
      )}
      {events.error ? (
        <p role="alert" className="error">
          Could not load events.{" "}
          <button onClick={() => events.refetch()}>Retry</button>
        </p>
      ) : events.isLoading ? (
        <p className="muted">Loading events…</p>
      ) : events.data?.length ? (
        events.data.slice(0, 4).map((event) => (
          <NavLink to="/app/calendar" className="upcoming-event" key={event.id}>
            <time>
              <span>{dayLabel(eventDay(event, zone))}</span>
              {eventTime(event, zone, hour12)}
            </time>
            <div>
              <strong>{event.title}</strong>
              <small>{event.calendar}</small>
            </div>
            <ArrowUpRight size={14} />
          </NavLink>
        ))
      ) : (
        <NavLink to="/app/calendar" className="upcoming-empty">
          <CalendarDays size={22} />
          <span>
            {feeds.data?.length
              ? "No events in the next 7 days"
              : "Connect your calendars"}
            <small>
              {feeds.data?.length ? "Open agenda" : "Add an iCal subscription"}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </NavLink>
      )}
    </section>
  );
}
