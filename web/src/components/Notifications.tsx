import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck, Settings, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, qc } from "../lib/api";
import { useLiveUpdates } from "../lib/live";
import { enablePush } from "../lib/push";
import "./notifications.css";

type Item = {
  id: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  created_at: string;
};
export default function Notifications({ userId }: { userId: string }) {
  useLiveUpdates();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const registering = useRef(false);
  useEffect(() => {
    const key = "omnix.push-device:" + userId;
    const refresh = () => {
      if (
        !window.ReactNativeWebView ||
        !localStorage.getItem(key) ||
        registering.current ||
        document.visibilityState !== "visible"
      )
        return;
      registering.current = true;
      void enablePush(true, userId)
        .then((id) => {
          localStorage.setItem(key, id);
          qc.setQueryData<{ id: string; kind: string }[]>(
            ["push-devices"],
            (old) => [
              ...(old || []).filter((d) => d.id !== id),
              { id, kind: "fcm" }
            ]
          );
          window.dispatchEvent(new Event("omnix-push-device"));
        })
        .catch(() => {})
        .finally(() => {
          registering.current = false;
        });
    };
    refresh();
    window.addEventListener("omnix-token-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("omnix-token-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId]);
  async function markRead(path: string) {
    setError("");
    try {
      await api(path, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const query = useQuery<{ items: Item[]; unread: number }>({
    queryKey: ["notifications"],
    queryFn: () => api("/notifications"),
    refetchInterval: 60000
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="notification-center" ref={panel}>
      <button
        className="icon-button"
        aria-label={`Notifications${query.data?.unread ? `, ${query.data.unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={18} />
        {!!query.data?.unread && <span className="notification-dot" />}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Notifications">
          <header>
            <h2>Notifications</h2>
            <Link
              to="/settings/notifications"
              aria-label="Notification settings"
              onClick={() => setOpen(false)}
            >
              <Settings size={17} />
            </Link>
            <button
              className="icon-button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          {!!query.data?.unread && (
            <button
              className="secondary"
              onClick={() => void markRead("/notifications/read")}
            >
              <CheckCheck size={15} />
              Mark all read
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : !query.data ? (
            <p role="status">Loading…</p>
          ) : !query.data.items.length ? (
            <p className="muted">You’re up to date.</p>
          ) : (
            <ul>
              {query.data.items.map((item) => (
                <li key={item.id} className={item.read ? "" : "is-unread"}>
                  <Link
                    to={item.href}
                    onClick={() => {
                      setOpen(false);
                      void markRead(`/notifications/${item.id}/read`);
                    }}
                  >
                    <strong>{item.title}</strong>
                    {item.body && <span>{item.body}</span>}
                    <time dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
