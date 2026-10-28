import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { type HealthStatus, type Statistics, format } from "./api";
import HistoryChart from "./HistoryChart";
import { metricPath } from "./catalog";

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
    <section className="dashboard-health" aria-label="Health overview">
      <div className="section-title">
        <h2>Health</h2>
        <NavLink to="/app/health">
          VIEW ALL <ArrowUpRight size={14} />
        </NavLink>
      </div>
      {status.isLoading ? (
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
          <p className="muted">Your activity, sleep and measurements.</p>
          <NavLink
            to="/app/settings/connections#google-health"
            className="text-button"
          >
            Connect in Integrations <ArrowUpRight size={14} />
          </NavLink>
        </div>
      ) : (
        <>
          <div className="health-overview-grid">
            <NavLink to="/app/health" className="health-overview-steps">
              <span className="eyebrow">STEPS</span>
              <strong>{format(steps?.points[today], "steps")}</strong>
              <span className="eyebrow">{message("steps")}</span>
            </NavLink>
            <div className="health-overview-trend">
              <span className="eyebrow">
                {data?.dates.at(-1) === today ? "LAST 7 DAYS" : "RECENT STEPS"}
                {steps?.stale || unavailable ? " · STALE" : ""}
              </span>
              <HistoryChart
                compact
                dates={data?.dates.slice(-7) || []}
                points={steps?.points || {}}
                selected={today}
              />
            </div>
            <div className="health-overview-readings">
              {[
                { id: "sleep", label: "Sleep", unit: "h" },
                {
                  id: "resting_heart_rate",
                  label: "Resting heart rate",
                  unit: "bpm"
                },
                { id: "zone_minutes", label: "Zone minutes", unit: "min" }
              ].map((metric) => (
                <NavLink key={metric.id} to={metricPath(metric.id)}>
                  <span>
                    {metric.label}
                    <small>{message(metric.id)}</small>
                  </span>
                  <strong>
                    {format(data?.metrics[metric.id]?.points[today], metric.id)}{" "}
                    <small>{metric.unit}</small>
                  </strong>
                </NavLink>
              ))}
            </div>
          </div>
          {status.data?.status === "reconnect" && (
            <p className="notice">
              Renew your Google Health connection in{" "}
              <NavLink to="/app/settings/connections#google-health">
                Integrations
              </NavLink>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}
