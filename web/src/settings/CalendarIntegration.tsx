import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { api, qc } from "../lib/api";
import type { Feed } from "../products/calendar/api";

export default function CalendarIntegration() {
  const feeds = useQuery<Feed[]>({
    queryKey: ["calendar-feeds"],
    queryFn: () => api("/calendar/feeds"),
    refetchInterval: 10000
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["calendar-feeds"] });
    qc.invalidateQueries({ queryKey: ["calendar-events"] });
  };
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      await api("/calendar/feeds", {
        method: "POST",
        body: JSON.stringify({
          label: values.get("label"),
          url: values.get("url")
        })
      });
      form.reset();
      invalidate();
      setMessage("Calendar added. Fetching events.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(feed: Feed, remove = false) {
    if (
      remove &&
      !window.confirm("Remove " + feed.label + " and its saved events?")
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      await api("/calendar/feeds/" + feed.id + (remove ? "" : "/refresh"), {
        method: remove ? "DELETE" : "POST"
      });
      invalidate();
      setMessage(remove ? "Calendar removed." : "Refresh queued.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" id="calendars">
      <div className="integration-heading">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h2>iCal subscriptions</h2>
        </div>
        <span className="eyebrow">{feeds.data?.length ?? "—"} CONNECTED</span>
      </div>
      <p className="muted">Read-only calendars. Refreshes every 15 minutes.</p>
      {feeds.error && (
        <p className="error" role="alert">
          Could not load calendars.{" "}
          <button onClick={() => feeds.refetch()}>Retry</button>
        </p>
      )}
      {feeds.isLoading && <p className="muted">[LOADING]</p>}
      <div className="integration-list">
        {feeds.data?.map((feed) => (
          <div key={feed.id}>
            <span>
              <strong>{feed.label}</strong>
              <small>
                {feed.host} ·{" "}
                {feed.status === "error"
                  ? "Refresh failed"
                  : feed.status === "pending"
                    ? "Fetching"
                    : "Connected"}
              </small>
              {feed.error && <small className="error">{feed.error}</small>}
            </span>
            <button
              disabled={busy}
              className="icon-button"
              aria-label={"Refresh " + feed.label}
              onClick={() => action(feed)}
            >
              <RefreshCw size={16} />
            </button>
            <button
              disabled={busy}
              className="icon-button"
              aria-label={"Remove " + feed.label}
              onClick={() => action(feed, true)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <details className="settings-advanced">
        <summary>Add calendar</summary>
        <form className="settings-form" onSubmit={add}>
          <label className="form-label">
            Name
            <input name="label" required maxLength={80} autoComplete="off" />
          </label>
          <label className="form-label">
            Subscription URL
            <input
              name="url"
              required
              maxLength={4096}
              placeholder="https://… or webcal://…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Adding…" : "Add calendar"}
          </button>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
