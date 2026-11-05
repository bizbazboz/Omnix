import DailySummary from "../products/daily/DailySummary";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useMinuteClock } from "../lib/useMinuteClock";
import { NavLink } from "react-router-dom";
import { api, type User } from "../lib/api";
import Upcoming from "../products/calendar/Upcoming";
import HealthSummary from "../products/health/HealthSummary";
import "./dashboard.css";

type Overview = { unread: number };
export default function Dashboard({ user }: { user: User }) {
  const now = useMinuteClock();
  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api("/overview"),
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
  return (
    <div className="dashboard dashboard-focus">
      <header className="dashboard-hero">
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
        <div className="dashboard-at-a-glance">
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
          <HealthSummary zone={zone} />
        </div>
      </header>
      <div className="dashboard-briefing">
        <Upcoming zone={zone} hour12={preferences.data?.time_format === "12"} />
        <DailySummary />
      </div>
    </div>
  );
}
