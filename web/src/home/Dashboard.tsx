import NotesSummary from "../products/notes/NotesSummary";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Mail, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Avatar } from "../components/Brand";
import { api, type Account, type Message, type User } from "../lib/api";
import Upcoming from "../products/calendar/Upcoming";
import HealthSummary from "../products/health/HealthSummary";
type Overview = {
  unread: number;
  messages: number;
  drafts: number;
  queued: number;
  unknown: number;
  accounts: number;
  healthy: number;
  recent: Message[];
};
export default function Dashboard({
  user,
  accounts,
  onCompose
}: {
  user: User;
  accounts: Account[];
  onCompose: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
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
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23"
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const calendarDate = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
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
  const count = (value: number | undefined) =>
    overview.isLoading ? "—" : String(value ?? 0).padStart(2, "0");
  const weekday = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth(),
    1
  ).getDay();
  const offset = (weekday + 6) % 7;
  const days = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + 1,
    0
  ).getDate();
  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">
            OVERVIEW / {String(calendarDate.getMonth() + 1).padStart(2, "0")}.
            {calendarDate.getFullYear()}
          </span>
          <h1>
            {hour < 12
              ? "Good morning"
              : hour < 18
                ? "Good afternoon"
                : "Good evening"}
            , {user.name.split(" ")[0]}.
          </h1>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh overview"
          onClick={() => overview.refetch()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <section className="clock-section" aria-label="Date and time">
        <div className="clock-primary">
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
        </div>
        <div className="clock-instrument">
          <div className="day-progress-label">
            <span>DAY ELAPSED</span>
            <span>{Math.floor(((hour * 60 + minute) / 1440) * 100)}%</span>
          </div>
          <div className="day-progress" aria-label="Day elapsed">
            {Array.from({ length: 48 }, (_, i) => (
              <span
                key={i}
                className={i < (hour * 60 + minute) / 30 ? "filled" : ""}
              />
            ))}
          </div>
          <span className="instrument-caption">
            00:00<span>24:00</span>
          </span>
          <div className="clock-calendar-label">
            {calendarDate.toLocaleDateString("en-GB", { month: "long" })}{" "}
            <span>{calendarDate.getFullYear()}</span>
          </div>
          <div className="calendar-grid">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span className="calendar-weekday" key={"w" + i}>
                {d}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"empty" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => (
              <span
                key={i}
                aria-current={
                  i + 1 === calendarDate.getDate() ? "date" : undefined
                }
                className={
                  i + 1 === calendarDate.getDate() ? "calendar-today" : ""
                }
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      </section>
      {overview.error && (
        <p className="error" role="alert">
          [ OVERVIEW UNAVAILABLE ]{" "}
          <button className="text-button" onClick={() => overview.refetch()}>
            Retry
          </button>
        </p>
      )}
      <section className="metric-strip" aria-label="Workspace totals">
        {[
          {
            name: "UNREAD",
            value: data?.unread,
            path: "/email",
            suffix: "INBOX"
          },
          {
            name: "DRAFTS",
            value: data?.drafts,
            path: "/email/drafts",
            suffix: "SAVED"
          },
          {
            name: "ACCOUNTS",
            value: data?.accounts,
            path: "/settings/connections",
            suffix: count(data?.healthy) + " CONNECTED"
          },
          {
            name: data?.unknown ? "CHECK SENDS" : "OUTBOX",
            value: data?.unknown || data?.queued,
            path: "/email/outbox",
            suffix: data?.unknown ? "OUTCOME UNKNOWN" : "QUEUED"
          }
        ].map((metric) => (
          <NavLink to={metric.path} className="metric" key={metric.name}>
            <div className="metric-label">
              {metric.name}
              <ArrowUpRight size={15} />
            </div>
            <div
              className={
                "metric-value " +
                (metric.name === "CHECK SENDS" ? "warning-value" : "")
              }
            >
              {count(metric.value)}
            </div>
            <span className="metric-suffix">{metric.suffix}</span>
          </NavLink>
        ))}
      </section>
      <NotesSummary />
      <HealthSummary zone={zone} />
      <Upcoming zone={zone} hour12={preferences.data?.time_format === "12"} />
      <div className="dashboard-bottom">
        <section className="dashboard-mail">
          <div className="section-title">
            <h2>Recent mail</h2>
            <NavLink to="/email">
              VIEW ALL <ArrowUpRight size={14} />
            </NavLink>
          </div>
          {overview.isLoading ? (
            <div className="empty">[ LOADING ]</div>
          ) : !data?.recent.length ? (
            <div className="dashboard-empty">
              <Mail size={24} />
              <span>
                {accounts.length ? "NO MESSAGES" : "CONNECT YOUR FIRST ACCOUNT"}
              </span>
              <NavLink className="secondary" to="/settings/connections">
                <Plus size={15} /> Connect account
              </NavLink>
            </div>
          ) : (
            data.recent.map((m) => (
              <NavLink
                key={m.id}
                className="dashboard-message"
                to={"/email?message=" + m.id + "&account=" + m.mailbox}
              >
                <Avatar name={m.sender_name || m.sender} />
                <div>
                  <strong>{m.sender_name || m.sender}</strong>
                  <p>{m.subject}</p>
                </div>
                <span className="dashboard-message-time">
                  {new Date(m.date).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short"
                  })}
                  {m.unread && <i />}
                </span>
              </NavLink>
            ))
          )}
        </section>
        <section className="dashboard-connections">
          <div className="section-title">
            <h2>Connections</h2>
            <NavLink to="/settings/connections">
              <Plus size={16} />
            </NavLink>
          </div>
          <div className="connection-readout">
            <span className="connection-readout-value">
              {count(data?.healthy)}
              <span> / {count(data?.accounts)}</span>
            </span>
            <span className="eyebrow">ONLINE</span>
          </div>
          <div className="health-segments">
            {Array.from({ length: 20 }, (_, i) => (
              <span
                key={i}
                className={
                  data?.accounts && i < (20 * data.healthy) / data.accounts
                    ? "filled"
                    : ""
                }
              />
            ))}
          </div>
          <div className="dashboard-account-list">
            {accounts.slice(0, 4).map((a) => (
              <NavLink to="/settings/connections" key={a.id}>
                <span>
                  {a.label}
                  <small>{a.address}</small>
                </span>
                <span
                  className={
                    "account-health " +
                    (a.status === "ready" ? "healthy" : "attention")
                  }
                >
                  {a.status === "ready"
                    ? "READY"
                    : a.status.replaceAll("_", " ")}
                </span>
              </NavLink>
            ))}
            {!accounts.length && (
              <span className="empty-label">NO ACCOUNTS</span>
            )}
          </div>
          <button
            className="primary dashboard-compose"
            onClick={onCompose}
            disabled={!accounts.some((a) => a.can_send)}
          >
            Compose <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <footer className="dashboard-footer">
        <span>OMNIX / WORKSPACE</span>
        <span>ENCRYPTED CONNECTIONS</span>
      </footer>
    </div>
  );
}
