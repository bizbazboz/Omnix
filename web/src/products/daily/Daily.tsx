import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowUpRight, MapPin, RefreshCw, Download } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import { api, qc } from "../../lib/api";
import {
  articles,
  dailyViews,
  lineStatus,
  number,
  useDaily,
  weatherLabel,
  type DailyData,
  type Walk
} from "./api";
import { DailyFreshness, DailySetup } from "./DailySummary";
import Select from "../../components/Select";
import "./daily.css";

export default function Daily() {
  const id = useLocation().pathname.split("/")[2] || "news",
    view = dailyViews.find((v) => v.id === id),
    query = useDaily();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!view) return <Navigate to="/daily/news" replace />;
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      await api("/daily/refresh", { method: "POST" });
      setMessage("Refresh queued");
      await qc.invalidateQueries({ queryKey: ["daily"] });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page daily-page">
      <PageHeader context="Daily" title={view.name}>
        {id !== "walks" && (
          <button className="secondary" disabled={busy} onClick={refresh}>
            <RefreshCw size={16} />
            Refresh
          </button>
        )}
      </PageHeader>
      {message && (
        <p className="daily-feedback" role="status">
          {message}
        </p>
      )}
      {query.error ? (
        <p className="error" role="alert">
          {query.error.message}{" "}
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      ) : !query.data ? (
        <p className="muted">[ Loading… ]</p>
      ) : (
        <>
          {id === "news" && <News data={query.data} />}
          {id === "weather" && <Weather data={query.data} />}
          {id === "transport" && <Transport data={query.data} />}
          {id === "walks" && <Walks data={query.data} />}
        </>
      )}
    </div>
  );
}
function News({ data }: { data: DailyData }) {
  const [source, setSource] = useState("");
  const all = articles(data),
    shown = all.filter((item) => !source || item.source_id === source);
  return (
    <>
      <DailyFreshness value={data.news} />
      {data.news.enabled ? (
        <>
          <div className="daily-toolbar">
            <Select
              aria-label="News source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              {data.news.data?.feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.name}
                </option>
              ))}
            </Select>
            <span className="eyebrow">{shown.length} HEADLINES</span>
          </div>
          {data.news.data?.feeds
            .filter((f) => f.error)
            .map((feed) => (
              <p key={feed.id} className="notice">
                {feed.name}: {feed.error}
              </p>
            ))}
          <div className="daily-news-list">
            {shown.map((item) => (
              <article key={item.id}>
                <div className="daily-news-meta">
                  <span>{item.source}</span>
                  {item.published && (
                    <time dateTime={item.published}>
                      {new Date(item.published).toLocaleDateString([], {
                        day: "numeric",
                        month: "short"
                      })}
                    </time>
                  )}
                </div>
                <h2>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                    <ArrowUpRight size={18} />
                  </a>
                </h2>
                {item.summary && <p>{item.summary}</p>}
              </article>
            ))}
          </div>
          {!shown.length && (
            <p className="empty">No headlines available yet.</p>
          )}
        </>
      ) : (
        <DailySetup text="Add your RSS and Atom sources" />
      )}
    </>
  );
}
function Weather({ data }: { data: DailyData }) {
  const weather = data.weather.data;
  return (
    <>
      <DailyFreshness value={data.weather} />
      {weather ? (
        <>
          <div className="daily-weather-current">
            <div>
              <span className="eyebrow">{weather.label}</span>
              <div className="daily-hero-number">
                {number(weather.temperature)}
                <small>{weather.unit}</small>
              </div>
              <h2>{weatherLabel(weather.code)}</h2>
            </div>
            <dl>
              <div>
                <dt>Feels like</dt>
                <dd>{number(weather.feels_like, weather.unit)}</dd>
              </div>
              <div>
                <dt>Wind</dt>
                <dd>{number(weather.wind, " km/h")}</dd>
              </div>
            </dl>
          </div>
          <div className="daily-forecast" aria-label="Seven day forecast">
            {weather.days.map((day) => (
              <div key={day.date}>
                <time dateTime={day.date}>
                  {new Date(day.date + "T12:00:00").toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric"
                  })}
                </time>
                <span>{weatherLabel(day.code)}</span>
                <strong>
                  {number(day.high, "°")} <small>{number(day.low, "°")}</small>
                </strong>
                <span>{number(day.rain, "% rain")}</span>
              </div>
            ))}
          </div>
          <p className="daily-attribution">
            Weather data:{" "}
            {weather.source?.endsWith("open-meteo.com") ? (
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open-Meteo
              </a>
            ) : (
              weather.source || "Custom forecast source"
            )}
          </p>
        </>
      ) : (
        <DailySetup
          text={
            data.weather.enabled
              ? "No forecast cached yet. Refresh to fetch it."
              : "Choose a location and weather source"
          }
        />
      )}
    </>
  );
}
function Transport({ data }: { data: DailyData }) {
  return (
    <>
      <DailyFreshness value={data.transport} />
      {data.transport.enabled && data.transport.data ? (
        <>
          <div className="daily-transport-list">
            {data.transport.data.lines.map((line) => {
              const status = lineStatus(line);
              return (
                <article key={line.id}>
                  <div className="daily-transport-title">
                    <h2>{line.name}</h2>
                    <span
                      className={
                        status?.severity === 10 ? "healthy" : "attention"
                      }
                    >
                      {status?.description || "Status unavailable"}
                    </span>
                  </div>
                  {line.statuses
                    .filter((s) => s.reason)
                    .map((s, i) => (
                      <p key={i}>{s.reason}</p>
                    ))}
                </article>
              );
            })}
            {!data.transport.data.lines.length && (
              <p className="empty">
                No selected lines returned by this source.
              </p>
            )}
          </div>
          <a
            className="daily-attribution"
            href="https://tfl.gov.uk/tube-dlr-overground/status/"
            target="_blank"
            rel="noreferrer"
          >
            Transport for London <ArrowUpRight size={14} />
          </a>
        </>
      ) : (
        <DailySetup
          text={
            data.transport.enabled
              ? "No line status cached yet. Refresh to fetch TfL status."
              : "Choose your transport source and lines"
          }
        />
      )}
    </>
  );
}
function Walks({ data }: { data: DailyData }) {
  const [lat, setLat] = useState(""),
    [lon, setLon] = useState(""),
    [distance, setDistance] = useState("5"),
    [seed, setSeed] = useState(1),
    [route, setRoute] = useState<Walk | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const shown = route || data.walks;
  function locate() {
    if (!navigator.geolocation) {
      setError("Location is unavailable in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6));
        setLon(position.coords.longitude.toFixed(6));
        setError("");
      },
      () => setError("Location access unavailable. Enter coordinates instead."),
      { timeout: 10000 }
    );
  }
  return (
    <>
      {!data.walks_configured ? (
        <DailySetup text="Connect openrouteservice or a compatible walking router" />
      ) : (
        <form
          className="daily-walk-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            try {
              const value = await api<Walk>("/daily/walks", {
                method: "POST",
                body: JSON.stringify({
                  latitude: Number(lat),
                  longitude: Number(lon),
                  distance_km: Number(distance),
                  seed
                })
              });
              setRoute(value);
              setSeed((s) => s + 1);
              qc.invalidateQueries({ queryKey: ["daily"] });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="daily-walk-fields">
            <label className="form-label">
              Start latitude
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                required
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </label>
            <label className="form-label">
              Start longitude
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                required
                value={lon}
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
            <label className="form-label">
              Target distance · km
              <input
                type="number"
                min="1"
                max="30"
                step="0.5"
                required
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </label>
          </div>
          <div className="settings-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Generating…" : "Generate loop"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={locate}
            >
              <MapPin size={16} />
              Use current location
            </button>
          </div>
          <p className="muted">
            The start point is sent to your configured routing source. Actual
            distance can differ from your target.
          </p>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown && (
        <section className="daily-walk-result">
          <div className="section-title">
            <h2>
              {(shown.distance_m / 1000).toFixed(1)} km{" "}
              <span className="muted">
                / {Math.round(shown.duration_s / 60)} min
              </span>
            </h2>
            <a
              className="secondary"
              href={
                "/api/v1/daily/walks/gpx?created_at=" +
                encodeURIComponent(shown.created_at)
              }
              download
            >
              <Download size={16} />
              GPX
            </a>
          </div>
          <RoutePreview route={shown} />
          <p className="daily-attribution">
            {shown.attribution} · Generated{" "}
            {new Date(shown.created_at).toLocaleString()}
          </p>
          <details>
            <summary>Directions · {shown.steps.length} steps</summary>
            <ol>
              {shown.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </>
  );
}
function RoutePreview({ route }: { route: Walk }) {
  const { minX, maxX, minY, maxY } = route.coordinates.reduce(
    (bounds, [lon, lat]) => ({
      minX: Math.min(bounds.minX, lon),
      maxX: Math.max(bounds.maxX, lon),
      minY: Math.min(bounds.minY, lat),
      maxY: Math.max(bounds.maxY, lat)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const cos = Math.max(0.1, Math.cos((((minY + maxY) / 2) * Math.PI) / 180));
  const scale = Math.min(
    640 / Math.max((maxX - minX) * cos, 0.00001),
    300 / Math.max(maxY - minY, 0.00001)
  );
  const points = route.coordinates
    .map(
      ([lon, lat]) =>
        `${30 + (lon - minX) * cos * scale},${330 - (lat - minY) * scale}`
    )
    .join(" ");
  const first = points.split(" ")[0].split(",");
  return (
    <svg
      className="daily-route-preview"
      viewBox="0 0 700 360"
      role="img"
      aria-label="Generated walking loop; line follows the routing provider's path"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx={first[0]} cy={first[1]} r="5" fill="currentColor" />
      <text x="24" y="22">
        START / FINISH · ROUTE OUTLINE
      </text>
    </svg>
  );
}
