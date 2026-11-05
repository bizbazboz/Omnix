import { ArrowUpRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  articles,
  lineStatus,
  number,
  useDaily,
  weatherLabel,
  type DailyView
} from "./api";
import "./daily.css";

export default function DailySummary() {
  const query = useDaily(true),
    data = query.data;
  const news = articles(data).slice(0, 3),
    disrupted =
      data?.transport.data?.lines.filter(
        (line) => lineStatus(line)?.severity !== 10
      ) || [];
  function heading(title: string, view: DailyView) {
    return (
      <div className="section-title">
        <h2>{title}</h2>
        <NavLink to={"/daily/" + view} aria-label={"Open " + title}>
          <ArrowUpRight size={16} />
        </NavLink>
      </div>
    );
  }
  return (
    <section className="daily-summary" aria-label="Daily overview">
      {query.error ? (
        <p className="error">
          Daily overview unavailable.{" "}
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      ) : query.isLoading ? (
        <p className="muted">[ Loading daily overview… ]</p>
      ) : (
        <>
          {data?.widgets.includes("weather") && (
            <section className="daily-summary-weather">
              {heading("Weather", "weather")}
              {data.weather.data ? (
                <>
                  <span className="eyebrow">{data.weather.data.label}</span>
                  <div className="daily-hero-number">
                    {number(data.weather.data.temperature)}
                    <small>{data.weather.data.unit}</small>
                  </div>
                  <p>{weatherLabel(data.weather.data.code)}</p>
                </>
              ) : (
                <p className="muted">
                  {data.weather.enabled
                    ? "Forecast pending"
                    : "Weather not connected"}
                </p>
              )}
              <DailyFreshness compact value={data?.weather} />
            </section>
          )}
          {data?.widgets.includes("transport") && (
            <section className="daily-summary-transport">
              {heading("Train issues", "transport")}
              {data.transport.data ? (
                <>
                  {!disrupted.length && (
                    <p className="muted">
                      {data.transport.data.lines.length
                        ? "Good service on your lines."
                        : "No lines selected."}
                    </p>
                  )}
                  {disrupted.slice(0, 2).map((line) => (
                    <p key={line.id} className="daily-line-compact">
                      {line.name}
                      <span>
                        {lineStatus(line)?.description || "Status unavailable"}
                      </span>
                    </p>
                  ))}
                </>
              ) : (
                <p className="muted">No train lines connected.</p>
              )}
              <DailyFreshness compact value={data?.transport} />
            </section>
          )}
          {data?.widgets.includes("news") && (
            <section className="daily-summary-news">
              {heading("Headlines", "news")}
              {news.length ? (
                <div className="daily-headlines">
                  {news.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <small>{item.source}</small>
                      <span>{item.title}</span>
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  {data.news.enabled
                    ? "Headlines pending"
                    : "No news sources connected"}
                </p>
              )}
              <DailyFreshness compact value={data?.news} />
            </section>
          )}
        </>
      )}
    </section>
  );
}
export function DailySetup({ text }: { text: string }) {
  return (
    <div className="daily-empty">
      <p>{text}</p>
      <NavLink to="/settings/connections#daily">
        Open Integrations <ArrowUpRight size={14} />
      </NavLink>
    </div>
  );
}
export function DailyFreshness({
  compact = false,
  value
}: {
  compact?: boolean;
  value?: { last_sync: string | null; error: string };
}) {
  if (compact && !value?.error) return null;
  return (
    <div className="daily-freshness">
      {value?.error && (
        <span className="notice">
          {value.error} {value.last_sync ? "Showing saved data." : ""}
        </span>
      )}
      {!compact && value?.last_sync && (
        <time
          dateTime={value.last_sync}
          title={new Date(value.last_sync).toLocaleString()}
        >
          Synced{" "}
          {new Date(value.last_sync).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </time>
      )}
    </div>
  );
}
