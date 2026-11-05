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
            <section>
              {heading("Weather", "weather")}
              {data.weather.data ? (
                <>
                  <span className="eyebrow">{data.weather.data.label}</span>
                  <div className="daily-hero-number">
                    {number(data.weather.data.temperature)}
                    <small>{data.weather.data.unit}</small>
                  </div>
                  <p>
                    {weatherLabel(data.weather.data.code)} · feels like{" "}
                    {number(
                      data.weather.data.feels_like,
                      data.weather.data.unit
                    )}
                  </p>
                </>
              ) : (
                <DailySetup
                  text={
                    data.weather.enabled
                      ? "Forecast pending"
                      : "Choose a weather location"
                  }
                />
              )}
              <DailyFreshness value={data?.weather} />
            </section>
          )}
          {data?.widgets.includes("transport") && (
            <section>
              {heading("Transport", "transport")}
              {data.transport.data ? (
                <>
                  <div className="daily-hero-number">
                    {String(disrupted.length).padStart(2, "0")}
                  </div>
                  <span className="eyebrow">
                    {!data.transport.data.lines.length
                      ? "NO LINES SELECTED"
                      : disrupted.length
                        ? "LINES NEEDING ATTENTION"
                        : "ALL SELECTED LINES RUNNING WELL"}
                  </span>
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
                <DailySetup text="Choose your TfL lines" />
              )}
              <DailyFreshness value={data?.transport} />
            </section>
          )}
          {data?.widgets.includes("news") && (
            <section>
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
                <DailySetup
                  text={
                    data.news.enabled
                      ? "Headlines pending"
                      : "Add an RSS or Atom source"
                  }
                />
              )}
              <DailyFreshness value={data?.news} />
            </section>
          )}
          {data?.widgets.includes("walks") && (
            <section>
              {heading("Walking loop", "walks")}
              {data.walks ? (
                <>
                  <div className="daily-hero-number">
                    {(data.walks.distance_m / 1000).toFixed(1)}
                    <small>km</small>
                  </div>
                  <p>
                    {Math.round(data.walks.duration_s / 60)} min · last
                    generated route
                  </p>
                  <NavLink className="text-button" to="/daily/walks">
                    View route <ArrowUpRight size={14} />
                  </NavLink>
                </>
              ) : data.walks_configured ? (
                <NavLink className="secondary" to="/daily/walks">
                  Generate a walking loop
                </NavLink>
              ) : (
                <DailySetup text="Connect your walking provider" />
              )}
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
  value
}: {
  value?: { last_sync: string | null; error: string };
}) {
  return (
    <div className="daily-freshness">
      {value?.error && (
        <span className="notice">
          {value.error} {value.last_sync ? "Showing saved data." : ""}
        </span>
      )}
      {value?.last_sync && (
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
