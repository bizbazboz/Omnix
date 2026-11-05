import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { readViewStatus, subscribeViewStatus } from "../lib/viewStatus";

export default function DataStatus() {
  const location = useLocation();
  const key = location.pathname + location.search;
  const state = useSyncExternalStore(subscribeViewStatus, () =>
    readViewStatus(key)
  );
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const date =
    state.sourceAt ??
    (state.kind === "synced" ? null : state.updatedAt || null);
  const label =
    state.kind === "synced"
      ? "Last synced"
      : state.kind === "saved"
        ? "Saved"
        : "Updated";
  const text = state.pending
    ? state.writing && location.pathname.startsWith("/notes")
      ? "Saving…"
      : "Updating…"
    : state.failed
      ? "Update failed"
      : state.connected === false
        ? "Not connected"
        : !date
          ? state.kind === "synced"
            ? "Not synced yet"
            : "Waiting for data"
          : null;
  const full = date ? new Date(date).toLocaleString() : undefined;
  const age = date ? Date.now() - date : 0;
  return (
    <span
      className="view-data-status"
      aria-busy={state.pending > 0}
      data-failed={state.failed || undefined}
      title={
        full
          ? `${label}: ${full}${state.kind === "synced" ? " · Latest successful provider sync" : ""}`
          : undefined
      }
    >
      {text || (
        <>
          {label}{" "}
          <time dateTime={new Date(date!).toISOString()}>
            {age < 60000
              ? "just now"
              : age < 3600000
                ? `${Math.floor(age / 60000)}m ago`
                : age < 86400000
                  ? new Date(date!).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })
                  : new Date(date!).toLocaleDateString([], {
                      day: "numeric",
                      month: "short"
                    })}
          </time>
        </>
      )}
    </span>
  );
}
