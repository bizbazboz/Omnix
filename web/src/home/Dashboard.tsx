import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Avatar } from "../components/Brand";
import { api, type Account, type Message } from "../lib/api";

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
  accounts,
  onCompose
}: {
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
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const zone =
    preferences.data?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
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
  const data = overview.data;
  const count = (value: number | undefined) =>
    overview.isLoading ? "—" : String(value ?? 0);
  const metrics = [
    { name: "Unread", value: data?.unread, path: "/app/email" },
    { name: "Drafts", value: data?.drafts, path: "/app/email/drafts" },
    { name: "Queued", value: data?.queued, path: "/app/email/outbox" },
    {
      name: "Accounts",
      value: data?.accounts,
      path: "/app/settings/connections"
    }
  ];
  return (
    <div className="dashboard mail-overview">
      <header className="overview-heading">
        <h1>Overview</h1>
        <div className="overview-actions">
          <button
            className="icon-button"
            aria-label="Refresh overview"
            onClick={() => overview.refetch()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="primary"
            onClick={onCompose}
            disabled={!accounts.some((a) => a.can_send)}
          >
            <Plus size={16} /> Compose
          </button>
        </div>
      </header>
      <section className="overview-date" aria-label="Date and time">
        <time className="overview-time" dateTime={now.toISOString()}>
          {time}
        </time>
        <div>
          <p>{date}</p>
          <span>{zone.replaceAll("_", " ")}</span>
        </div>
      </section>
      {overview.error && (
        <p className="error" role="alert">
          Could not load the overview.{" "}
          <button className="text-button" onClick={() => overview.refetch()}>
            Retry
          </button>
        </p>
      )}
      <nav className="overview-totals" aria-label="Mail totals">
        {metrics.map((metric) => (
          <NavLink key={metric.name} to={metric.path}>
            <span>{metric.name}</span>
            <strong>{count(metric.value)}</strong>
          </NavLink>
        ))}
      </nav>
      {!!data?.unknown && (
        <NavLink className="send-warning" to="/app/email/outbox">
          {data.unknown}{" "}
          {data.unknown === 1 ? "message needs" : "messages need"} a delivery
          check. Review the outbox before resending.
        </NavLink>
      )}
      <div className="overview-content">
        <section className="overview-mail">
          <div className="overview-section-heading">
            <h2>Recent mail</h2>
            <NavLink to="/app/email">Open inbox</NavLink>
          </div>
          {overview.isLoading ? (
            <p className="overview-empty" role="status">
              Loading messages…
            </p>
          ) : !data?.recent.length ? (
            <div className="overview-empty">
              <p>
                {accounts.length
                  ? "No messages yet."
                  : "Connect an account to see your mail."}
              </p>
              {!accounts.length && (
                <NavLink className="text-button" to="/app/settings/connections">
                  Connect account
                </NavLink>
              )}
            </div>
          ) : (
            data.recent.map((message) => (
              <NavLink
                key={message.id}
                className="dashboard-message"
                to={
                  "/app/email?message=" +
                  message.id +
                  "&account=" +
                  message.mailbox
                }
              >
                <Avatar name={message.sender_name || message.sender} />
                <div>
                  <strong>{message.sender_name || message.sender}</strong>
                  <p>{message.subject || "(No subject)"}</p>
                </div>
                <span className="dashboard-message-time">
                  {new Date(message.date).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: zone
                  })}
                  {message.unread && <i />}
                </span>
              </NavLink>
            ))
          )}
        </section>
        <section className="overview-accounts">
          <div className="overview-section-heading">
            <h2>Accounts</h2>
            <NavLink to="/app/settings/connections">Manage</NavLink>
          </div>
          {accounts.length ? (
            <div className="dashboard-account-list">
              {accounts.map((account) => (
                <NavLink to="/app/settings/connections" key={account.id}>
                  <span>
                    {account.label}
                    <small>{account.address}</small>
                  </span>
                  <span
                    className={
                      "account-health " +
                      (account.status === "ready" ? "healthy" : "attention")
                    }
                  >
                    {account.status === "ready"
                      ? "Connected"
                      : account.status.replaceAll("_", " ")}
                  </span>
                </NavLink>
              ))}
            </div>
          ) : (
            <p className="overview-empty">No accounts connected.</p>
          )}
        </section>
      </div>
    </div>
  );
}
