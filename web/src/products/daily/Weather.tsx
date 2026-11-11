import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { DailyFreshness, DailySetup } from "./DailySummary";
import { number, weatherLabel, type DailyData, type Forecast } from "./api";
import WeatherGlyph from "./WeatherGlyph";
import "./weather.css";

const dateLabel = (date: string, today?: string) =>
  date === today
    ? "Today"
    : new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "short" });
const hourLabel = (time: string) => time.slice(11, 16);

export default function Weather({ data }: { data: DailyData }) {
  const weather = data.weather.data;
  if (!weather)
    return (
      <>
        <DailyFreshness value={data.weather} />
        <DailySetup
          text={
            data.weather.enabled
              ? "No forecast cached yet. Refresh to fetch it."
              : "Choose a location and weather source"
          }
        />
      </>
    );
  const today = weather.days[0];
  return (
    <div className="weather-layout">
      <section
        className="daily-weather-current weather-now"
        aria-label="Current weather"
      >
        <div className="weather-location">
          <MapPin size={14} />
          <span>{weather.label}</span>
        </div>
        <div className="weather-current-heading">
          <div className="weather-temperature">
            {number(weather.temperature)}
            <span>{weather.unit}</span>
          </div>
          <div className="weather-condition">
            <p>{weatherLabel(weather.code)}</p>
            <span>
              H {number(today?.high, "°")} / L {number(today?.low, "°")}
            </span>
          </div>
        </div>
        <div className="weather-symbol">
          <WeatherGlyph code={weather.code} size={224} />
        </div>
        <dl className="weather-details">
          <div>
            <dt>Feels like</dt>
            <dd>{number(weather.feels_like, weather.unit)}</dd>
          </div>
          <div>
            <dt>Wind</dt>
            <dd>{number(weather.wind, " km/h")}</dd>
          </div>
          <div>
            <dt>Chance of rain</dt>
            <dd>{number(today?.rain, "%")}</dd>
          </div>
        </dl>
        <DailyFreshness value={data.weather} />
      </section>
      <div className="weather-forecasts">
        <Hourly hours={weather.hours || []} />
        <Daily days={weather.days} today={weather.time?.slice(0, 10)} />
        <p className="daily-attribution">
          Weather data:{" "}
          {weather.source?.endsWith("open-meteo.com") ? (
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo ↗
            </a>
          ) : (
            weather.source || "Custom forecast source"
          )}
        </p>
      </div>
    </div>
  );
}

function Hourly({ hours }: { hours: NonNullable<Forecast["hours"]> }) {
  const [page, setPage] = useState(0);
  const offset = Math.min(
    page * 6,
    Math.max(0, Math.ceil(hours.length / 6) - 1) * 6
  );
  const shown = hours.slice(offset, offset + 6);
  const values = shown.flatMap((h) =>
    h.temperature === null ? [] : [h.temperature]
  );
  const min = Math.min(...values),
    max = Math.max(...values);
  const points = shown.map((hour, i) =>
    hour.temperature === null
      ? null
      : {
          x: 30 + i * 60,
          y: 70 - ((hour.temperature - min) / Math.max(max - min, 4)) * 45
        }
  );
  return (
    <section className="weather-panel" aria-labelledby="hourly-title">
      <header>
        <h2 id="hourly-title">Hourly forecast</h2>
        <div className="weather-period">
          {!!hours.length && (
            <span>
              {offset + 1}–{Math.min(offset + 6, hours.length)} / {hours.length}{" "}
              H
            </span>
          )}
          <button
            className="icon-button"
            aria-label="Earlier forecast hours"
            disabled={!offset}
            onClick={() => setPage(Math.max(0, offset / 6 - 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Later forecast hours"
            disabled={offset + 6 >= hours.length}
            onClick={() => setPage(offset / 6 + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      {shown.length ? (
        <>
          <div
            className="weather-hours"
            style={{ "--hours": shown.length } as CSSProperties}
          >
            {shown.map((hour) => (
              <div key={hour.time}>
                <time dateTime={hour.time}>{hourLabel(hour.time)}</time>
                <strong>{number(hour.temperature, "°")}</strong>
                <WeatherGlyph code={hour.code} size={32} />
                <span aria-label={`Chance of rain ${number(hour.rain, "%")}`}>
                  {number(hour.rain, "%")}
                </span>
              </div>
            ))}
          </div>
          <svg
            className="weather-trend"
            viewBox={`0 0 ${shown.length * 60} 90`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Temperature trend for the displayed hours"
          >
            <path
              className="weather-trend-baseline"
              d={`M0 80H${shown.length * 60}`}
            />
            {points.map(
              (point, i) =>
                point && (
                  <g key={i}>
                    {i > 0 && points[i - 1] && (
                      <path
                        d={`M${points[i - 1]!.x} ${points[i - 1]!.y}L${point.x} ${point.y}`}
                      />
                    )}
                    <circle cx={point.x} cy={point.y} r="2.5" />
                  </g>
                )
            )}
          </svg>
        </>
      ) : (
        <p className="weather-unavailable">
          Hourly data is unavailable from this source.
        </p>
      )}
    </section>
  );
}

function Daily({ days, today }: { days: Forecast["days"]; today?: string }) {
  const values = days.flatMap((day) =>
    [day.low, day.high].filter((n): n is number => n !== null)
  );
  const min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(1, max - min);
  return (
    <section className="weather-panel" aria-labelledby="daily-title">
      <header>
        <h2 id="daily-title">Daily forecast</h2>
        <span className="eyebrow">{days.length} DAYS</span>
      </header>
      <div className="weather-days" aria-label="Seven day forecast">
        {days.map((day) => (
          <div className="weather-day" key={day.date}>
            <time dateTime={day.date}>{dateLabel(day.date, today)}</time>
            <span className="weather-day-icon" title={weatherLabel(day.code)}>
              <WeatherGlyph code={day.code} />
              <span className="sr-only">{weatherLabel(day.code)}</span>
            </span>
            <span
              className="weather-rain"
              aria-label={`Chance of rain ${number(day.rain, "%")}`}
            >
              {number(day.rain, "%")}
            </span>
            <span className="weather-low">{number(day.low, "°")}</span>
            <span className="weather-range" aria-hidden="true">
              {day.low !== null && day.high !== null && (
                <span
                  style={{
                    left: `${Math.min(96, ((day.low - min) / span) * 100)}%`,
                    width: `${Math.max(4, ((day.high - day.low) / span) * 100)}%`
                  }}
                />
              )}
            </span>
            <span className="weather-high">{number(day.high, "°")}</span>
          </div>
        ))}
      </div>
      {!days.length && (
        <p className="weather-unavailable">Daily forecast unavailable.</p>
      )}
    </section>
  );
}
