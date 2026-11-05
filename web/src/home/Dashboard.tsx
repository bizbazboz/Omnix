import NotesSummary from "../products/notes/NotesSummary";
import DailySummary from "../products/daily/DailySummary";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Mail, Plus, RefreshCw } from "lucide-react";
import { useMinuteClock } from "../lib/useMinuteClock";
import { NavLink } from "react-router-dom";
import { Avatar } from "../components/Brand";
import { api, type Account, type Message, type User } from "../lib/api";
import Upcoming from "../products/calendar/Upcoming";
import HealthSummary from "../products/health/HealthSummary";
import "./dashboard.css";
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
  const count = (value: number | undefined) =>
    overview.isLoading ? "—" : String(value ?? 0).padStart(2, "0");
  return (
    <div className="dashboard dashboard-compact">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">OVERVIEW</span>
            <h1>
              {hour < 12
                ? "Good morning"
                : hour < 18
                  ? "Good afternoon"
                  : "Good evening"}
              , {user.name.split(" ")[0]}.
            </h1>
            <time className="clock-date" dateTime={now.toISOString()}>
              {date}
            </time>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh overview"
            onClick={() => overview.refetch()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <section className="clock-section" aria-label="Date and time">
          <time
            className="clock"
            dateTime={now.toISOString()}
            aria-label={"Current time " + time}
          >
            {clockTime}
            {dayPeriod && <span className="clock-period">{dayPeriod}</span>}
          </time>
        </section>
      </header>
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
      <DailySummary />
      <div className="dashboard-panels">
        <Upcoming zone={zone} hour12={preferences.data?.time_format === "12"} />
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
            data.recent.slice(0, 4).map((m) => (
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
        <HealthSummary zone={zone} />
        <NotesSummary />
      </div>
      <section className="dashboard-connections">
        <div className="section-title">
          <h2>Connections</h2>
          <NavLink to="/settings/connections" aria-label="Manage connections">
            <Plus size={16} />
          </NavLink>
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
  );
}
