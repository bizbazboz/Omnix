import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  NavLink,
  useSearchParams,
  useLocation,
  Navigate
} from "react-router-dom";
import { api, qc } from "../../lib/api";
import { type HealthStatus, type Statistics, dayLabel, format } from "./api";
import HistoryChart from "./HistoryChart";
import { healthViews, metricDefinitions } from "./catalog";
import SleepBreakdown from "./SleepBreakdown";
import Workouts from "./Workouts";

export default function Health() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const pageId = location.pathname.split("/")[3] || "overview";
  const view = healthViews.find((view) => view.id === pageId);
  const metrics = (view || healthViews[0]).metrics.map(
    (id) => metricDefinitions[id]
  );
  const chosenMetric = metrics.some(
    (metric) => metric.id === params.get("metric")
  )
    ? params.get("metric")!
    : metrics[0].id;
  const setChosenMetric = (id: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("metric", id);
      return next;
    });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [range, setRange] = useState(7),
    [chosenDay, setChosenDay] = useState("");
  const state = useQuery<HealthStatus>({
    queryKey: ["health-status"],
    queryFn: () => api("/health/status"),
    refetchInterval: 10000
  });
  const readings = useQuery<Statistics>({
    queryKey: ["health-statistics"],
    queryFn: () => api("/health/statistics"),
    enabled: !!state.data?.connected,
    refetchInterval: 10000
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["health-status"] });
    qc.invalidateQueries({ queryKey: ["health-statistics"] });
  };
  useEffect(() => {
    const result = params.get("connect");
    if (result) {
      setMessage(
        result === "success"
          ? "Google Health connected. Fetching readings."
          : "Google connection cancelled."
      );
      invalidate();
      const next = new URLSearchParams(params);
      next.delete("connect");
      setParams(next, { replace: true });
    }
  }, [params]);
  const data = state.data?.connected ? readings.data : undefined,
    dates = data?.dates.slice(-range) || [];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone:
      data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const selected =
    chosenDay && dates.includes(chosenDay)
      ? chosenDay
      : dates.includes(today)
        ? today
        : dates.at(-1) || today;
  const selectedMetric = data?.metrics[chosenMetric];
  const values = dates.map((day) => selectedMetric?.points[day]);
  const available = values.filter(
    (value): value is number => value !== undefined
  );

  const syncing = ["pending", "syncing"].includes(state.data?.status || "");
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      await api("/health/refresh", { method: "POST" });
      setMessage("Refresh queued");
      invalidate();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!view) return <Navigate to="/app/health" replace />;
  return (
    <div className="health-product">
      <header className="health-heading">
        <div>
          <span className="eyebrow">HEALTH / {view.id.toUpperCase()}</span>
          <h1>{view.id === "overview" ? "Health" : view.name}</h1>
        </div>
        {state.data?.connected && (
          <div className="health-header-actions">
            <button
              className="secondary"
              onClick={refresh}
              disabled={busy || syncing}
            >
              {syncing ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Refresh
            </button>
          </div>
        )}
      </header>
      <p className="health-page-caption">{view.description}</p>
      {state.isLoading ? (
        <p className="muted">[LOADING]</p>
      ) : state.error ? (
        <p className="error" role="alert">
          Could not load health connection.{" "}
          <button onClick={() => state.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          {message && (
            <p className="health-inline-status" role="status">
              {message}
            </p>
          )}
          {state.data?.error && <p className="notice">{state.data.error}</p>}
          {!state.data?.connected || state.data.status === "reconnect" ? (
            <section className="health-connect">
              <HeartPulse size={28} strokeWidth={1.25} />
              <h2>
                {state.data?.connected
                  ? "Reconnect your health data"
                  : "Your health, at a glance"}
              </h2>
              <p>
                {state.data?.connected
                  ? "Renew your Google connection to resume readings."
                  : "Connect Google Health in Integrations to see your activity, sleep and measurements."}
              </p>
              <NavLink
                className="secondary"
                to="/app/settings/connections#google-health"
              >
                Open Integrations <ArrowUpRight size={16} />
              </NavLink>
            </section>
          ) : (
            <>
              <div className="health-date-row">
                <div>
                  <span className="eyebrow">
                    {selected === today ? "TODAY" : "SELECTED DAY"}
                  </span>
                  <h2>{dayLabel(selected)}</h2>
                </div>
                <span className="health-sync-label">
                  {syncing
                    ? "SYNCING"
                    : state.data?.last_sync
                      ? "UPDATED " +
                        new Date(state.data.last_sync).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit"
                        })
                      : "WAITING FOR READINGS"}
                </span>
              </div>
              {metrics.every(
                (metric) => data?.metrics[metric.id]?.status === "not_shared"
              ) && (
                <p className="notice">
                  This category has not been shared.{" "}
                  <NavLink to="/app/settings/connections#google-health">
                    Manage access in Integrations
                  </NavLink>
                  .
                </p>
              )}
              {readings.error ? (
                <p className="error" role="alert">
                  Could not load saved readings.{" "}
                  <button onClick={() => readings.refetch()}>Retry</button>
                </p>
              ) : (
                <>
                  <section
                    className={"health-metrics health-metrics-" + view.id}
                    aria-label="Daily health statistics"
                  >
                    {metrics.map((metric) => {
                      const reading = data?.metrics[metric.id],
                        value = reading?.points[selected];
                      return (
                        <button
                          key={metric.id}
                          className={
                            "health-metric " +
                            (chosenMetric === metric.id ? "selected" : "")
                          }
                          onClick={() => setChosenMetric(metric.id)}
                          aria-pressed={chosenMetric === metric.id}
                        >
                          <span className="metric-label">{metric.label}</span>
                          <strong>
                            {format(value, metric.id)}
                            <small>{metric.unit}</small>
                          </strong>
                          <span className="health-reading-status">
                            {reading?.status === "not_shared"
                              ? "NOT SHARED"
                              : reading?.stale
                                ? "SAVED · STALE"
                                : reading?.status === "error"
                                  ? "REFRESH FAILED"
                                  : ["error", "reconnect"].includes(
                                        state.data?.status || ""
                                      ) && value !== undefined
                                    ? "SAVED · STALE"
                                    : syncing && !data?.dates.length
                                      ? "FETCHING"
                                      : value === undefined
                                        ? "NO READING"
                                        : metric.id === "weight"
                                          ? "DAILY AVERAGE"
                                          : "RECORDED"}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                  {view.id === "sleep" && (
                    <SleepBreakdown
                      metrics={data?.metrics || {}}
                      day={selected}
                      stale={["error", "reconnect"].includes(
                        state.data?.status || ""
                      )}
                    />
                  )}
                  {view.id === "workouts" && (
                    <Workouts
                      metric={data?.metrics.workouts}
                      dates={dates}
                      zone={data?.timezone}
                    />
                  )}
                  <section
                    className="health-history"
                    aria-label="Health history"
                  >
                    <header>
                      <div>
                        <span className="eyebrow">HISTORY</span>
                        <h2>
                          {
                            metrics.find((metric) => metric.id === chosenMetric)
                              ?.label
                          }
                        </h2>
                      </div>
                      <div
                        className="health-range"
                        role="group"
                        aria-label="Health history range"
                      >
                        {[7, 28].map((days) => (
                          <button
                            key={days}
                            className={range === days ? "active" : ""}
                            aria-pressed={range === days}
                            onClick={() => setRange(days)}
                          >
                            {days} days
                          </button>
                        ))}
                      </div>
                    </header>
                    <div className="history-summary">
                      <div>
                        <span className="eyebrow">DAILY AVERAGE</span>
                        <strong>
                          {format(
                            available.length
                              ? available.reduce(
                                  (sum, value) => sum + value,
                                  0
                                ) / available.length
                              : undefined,
                            chosenMetric
                          )}{" "}
                          <small>{selectedMetric?.unit}</small>
                        </strong>
                      </div>
                      <div>
                        <span className="eyebrow">
                          {dayLabel(selected).toUpperCase()}
                        </span>
                        <strong>
                          {format(
                            selectedMetric?.points[selected],
                            chosenMetric
                          )}{" "}
                          <small>{selectedMetric?.unit}</small>
                        </strong>
                      </div>
                    </div>
                    {!dates.length ? (
                      <div className="health-empty">
                        <span className="eyebrow">
                          {syncing ? "[FETCHING READINGS]" : "NO READINGS YET"}
                        </span>
                        <p>
                          Your device readings will appear after the first
                          successful sync.
                        </p>
                      </div>
                    ) : (
                      <>
                        <HistoryChart
                          dates={dates}
                          points={selectedMetric?.points || {}}
                          selected={selected}
                          onSelect={setChosenDay}
                          metric={chosenMetric}
                          unit={selectedMetric?.unit || ""}
                        />
                        <div className="health-history-footer">
                          <span>
                            {dayLabel(dates[0])} — {dayLabel(dates.at(-1)!)}
                          </span>
                          <span>
                            {available.length}/{dates.length} DAYS WITH READINGS
                          </span>
                        </div>
                        <div className="health-day-controls">
                          <button
                            className="icon-button"
                            aria-label="Previous day"
                            disabled={dates.indexOf(selected) <= 0}
                            onClick={() =>
                              setChosenDay(dates[dates.indexOf(selected) - 1])
                            }
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span>
                            {format(
                              selectedMetric?.points[selected],
                              chosenMetric
                            )}{" "}
                            {selectedMetric?.unit}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Next day"
                            disabled={
                              dates.indexOf(selected) >= dates.length - 1
                            }
                            onClick={() =>
                              setChosenDay(dates[dates.indexOf(selected) + 1])
                            }
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                  <details className="health-data-table">
                    <summary>
                      Daily readings · {metricDefinitions[chosenMetric].label}
                    </summary>
                    <div className="settings-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>
                              {selectedMetric?.unit ||
                                metricDefinitions[chosenMetric].unit}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...dates].reverse().map((day) => (
                            <tr key={day}>
                              <td>{dayLabel(day)}</td>
                              <td>
                                {format(
                                  selectedMetric?.points[day],
                                  chosenMetric
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
