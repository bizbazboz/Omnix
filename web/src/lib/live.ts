import { useEffect } from "react";
import { qc } from "./api";

export function useLiveUpdates() {
  useEffect(() => {
    if (!window.EventSource) return;
    const source = new EventSource("/api/v1/live");
    let timer: ReturnType<typeof setTimeout>;
    const scopes = new Set<string>();
    const flush = () => {
      const all = scopes.has("all");
      const keys = new Set<string>(["notifications"]);
      if (all || scopes.has("email"))
        [
          "messages",
          "message",
          "accounts",
          "overview",
          "drafts",
          "send-history"
        ].forEach((k) => keys.add(k));
      if (all || scopes.has("daily")) keys.add("daily");
      if (all || scopes.has("calendar"))
        [
          "calendar-events",
          "calendar-feeds",
          "upcoming-events",
          "overview"
        ].forEach((k) => keys.add(k));
      if (all || scopes.has("health"))
        ["health-status", "health-statistics"].forEach((k) => keys.add(k));
      scopes.clear();
      for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    };
    source.addEventListener("update", (event) => {
      try {
        scopes.add(JSON.parse((event as MessageEvent).data).scope);
        clearTimeout(timer);
        timer = setTimeout(flush, 150);
      } catch {
        /* A malformed event must not interrupt normal polling. */
      }
    });
    const wake = () => {
      if (document.visibilityState === "visible") {
        scopes.add("all");
        flush();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      source.close();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
}
