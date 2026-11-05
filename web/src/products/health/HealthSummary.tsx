import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { type HealthStatus, type Statistics, format } from "./api";

export default function HealthSummary({ zone }: { zone: string }) {
  const status = useQuery<HealthStatus>({
    queryKey: ["health-status"],
    queryFn: () => api("/health/status"),
    refetchInterval: 30000
  });
  const readings = useQuery<Statistics>({
    queryKey: ["health-statistics"],
    queryFn: () => api("/health/statistics"),
    enabled: !!status.data?.connected,
    refetchInterval: 30000
  });
  const data = status.data?.connected ? readings.data : undefined;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: data?.timezone || zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const steps = data?.metrics.steps;
  const unavailable = ["error", "reconnect"].includes(
    status.data?.status || ""
  );
  const message = (id: string) => {
    const metric = data?.metrics[id];
    return metric?.status === "not_shared"
      ? "NOT SHARED"
      : metric?.stale || unavailable
        ? "SAVED · STALE"
        : metric?.status === "error"
          ? "REFRESH FAILED"
          : !data?.dates.length &&
              ["pending", "syncing"].includes(status.data?.status || "")
            ? "SYNCING"
            : metric?.points[today] === undefined
              ? "NO READING TODAY"
              : "TODAY";
  };
  return (
    <section className="dashboard-health" aria-label="Today's steps">
      <div className="section-title">
        <h2>Steps</h2>
        <NavLink to="/health/activity" aria-label="Open steps history">
          <ArrowUpRight size={14} />
        </NavLink>
      </div>
      {status.isLoading || (status.data?.connected && readings.isLoading) ? (
        <p className="muted">[LOADING]</p>
      ) : status.error || readings.error ? (
        <p className="error" role="alert">
          Health overview unavailable.{" "}
          <button
            onClick={() => {
              status.refetch();
              if (status.data?.connected) readings.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : !status.data?.connected ? (
        <div className="health-overview-empty">
          <p className="muted">No steps connected.</p>
          <NavLink to="/health" className="text-button">
            Open Health <ArrowUpRight size={14} />
          </NavLink>
        </div>
      ) : (
        <>
          <NavLink
            to="/health/activity"
            className="dashboard-stat-value"
            aria-label="View steps history"
          >
            {format(steps?.points[today], "steps")}
          </NavLink>
          <span className="eyebrow">{message("steps")}</span>
          {status.data?.status === "reconnect" && (
            <p className="notice">
              Reconnect in <NavLink to="/health">Health</NavLink>.
            </p>
          )}
        </>
      )}
    </section>
  );
}
