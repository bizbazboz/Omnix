import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { api, qc } from "../lib/api";
import Select from "../components/Select";
import { dailyViews, useDaily, type DailyView } from "../products/daily/api";
import "../products/daily/daily.css";

type Provider = {
  endpoint: string;
  api_key?: string;
  key_configured?: boolean;
};
type Config = {
  news: { id: string; name: string; url: string }[];
  weather: Provider & {
    enabled: boolean;
    label: string;
    latitude: number | null;
    longitude: number | null;
    temperature_unit: string;
  };
  transport: Provider & {
    enabled: boolean;
    lines: string[];
    all_lines: boolean;
  };
  walks: Provider;
  widgets: DailyView[];
  clear_keys?: string[];
};
export default function DailyIntegration() {
  const query = useQuery<Config>({
      queryKey: ["daily-settings"],
      queryFn: () => api("/settings/daily")
    }),
    daily = useDaily();
  const [form, setForm] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [lineText, setLineText] = useState("");
  function initialise(value: Config) {
    setLineText(value.transport.lines.join(", "));
    setForm({
      ...value,
      clear_keys: [],
      weather: { ...value.weather, api_key: "" },
      transport: { ...value.transport, api_key: "" },
      walks: { ...value.walks, api_key: "" }
    });
  }
  useEffect(() => {
    if (query.data) initialise(query.data);
  }, [query.data]);
  if (query.error)
    return (
      <section className="settings-card" id="daily">
        <h2>Daily sources</h2>
        <p className="error">{query.error.message}</p>
        <button className="secondary" onClick={() => query.refetch()}>
          Retry
        </button>
      </section>
    );
  if (!form)
    return (
      <section className="settings-card" id="daily">
        [ Loading daily sources… ]
      </section>
    );
  const value = form;
  function provider(
    name: "weather" | "transport" | "walks",
    patch: Partial<Provider>
  ) {
    setForm((current) =>
      current
        ? {
            ...current,
            [name]: { ...current[name], ...patch },
            clear_keys: patch.api_key
              ? current.clear_keys?.filter((key) => key !== name)
              : current.clear_keys
          }
        : current
    );
  }
  function location() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. Enter coordinates instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setForm((current) =>
          current
            ? {
                ...current,
                weather: {
                  ...current.weather,
                  latitude: Number(p.coords.latitude.toFixed(6)),
                  longitude: Number(p.coords.longitude.toFixed(6))
                }
              }
            : current
        ),
      () => setError("Location access unavailable. Enter coordinates instead."),
      { timeout: 10000 }
    );
  }
  function endpoint(name: "weather" | "transport" | "walks", title: string) {
    return (
      <details className="daily-provider-options">
        <summary>{title} source</summary>
        <div className="settings-form">
          <label className="form-label">
            HTTPS endpoint
            <input
              type="url"
              required
              value={value[name].endpoint}
              onChange={(e) => provider(name, { endpoint: e.target.value })}
            />
          </label>
          <label className="form-label">
            API key (if required)
            <input
              type="password"
              autoComplete="new-password"
              value={value[name].api_key || ""}
              placeholder={
                value[name].key_configured
                  ? "Saved · leave blank to keep"
                  : "API key"
              }
              onChange={(e) => provider(name, { api_key: e.target.value })}
            />
          </label>
          {value[name].key_configured && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                provider(name, { key_configured: false, api_key: "" });
                setForm((current) =>
                  current
                    ? {
                        ...current,
                        clear_keys: [...(current.clear_keys || []), name]
                      }
                    : current
                );
              }}
            >
              Remove saved key
            </button>
          )}
        </div>
        <p className="muted">
          Changing the endpoint clears its saved key unless you enter a new one.
        </p>
      </details>
    );
  }
  return (
    <section className="settings-card daily-integration" id="daily">
      <h2>Daily sources</h2>
      <p className="muted">Choose your sources and what appears on Home.</p>
      <form
        className="settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const saved = await api<Config>("/settings/daily", {
              method: "PUT",
              body: JSON.stringify({
                ...value,
                transport: {
                  ...value.transport,
                  lines: lineText
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                }
              })
            });
            initialise(saved);
            qc.setQueryData(["daily-settings"], saved);
            await qc.invalidateQueries({ queryKey: ["daily"] });
            setMessage("Sources saved. Refresh queued.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend>Home screen</legend>
          <div className="daily-widget-options">
            {dailyViews.map((view) => (
              <label key={view.id}>
                <input
                  type="checkbox"
                  checked={value.widgets.includes(view.id)}
                  onChange={(e) =>
                    setForm({
                      ...value,
                      widgets: e.target.checked
                        ? [...value.widgets, view.id]
                        : value.widgets.filter((id) => id !== view.id)
                    })
                  }
                />
                {view.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>News · RSS / Atom</legend>
          <div className="daily-source-list">
            {value.news.map((source, i) => (
              <div className="daily-source-row" key={source.id}>
                <label className="form-label">
                  Source name
                  <input
                    required
                    maxLength={80}
                    value={source.name}
                    onChange={(e) =>
                      setForm({
                        ...value,
                        news: value.news.map((item, index) =>
                          index === i ? { ...item, name: e.target.value } : item
                        )
                      })
                    }
                  />
                </label>
                <label className="form-label">
                  Feed URL
                  <input
                    required
                    type="url"
                    placeholder="https://example.com/feed.xml"
                    value={source.url}
                    onChange={(e) =>
                      setForm({
                        ...value,
                        news: value.news.map((item, index) =>
                          index === i ? { ...item, url: e.target.value } : item
                        )
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    "Remove news source " + (source.name || String(i + 1))
                  }
                  onClick={() =>
                    setForm({
                      ...value,
                      news: value.news.filter((_, index) => index !== i)
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="secondary"
            type="button"
            disabled={value.news.length >= 12}
            onClick={() =>
              setForm({
                ...value,
                news: [
                  ...value.news,
                  { id: crypto.randomUUID(), name: "", url: "" }
                ]
              })
            }
          >
            <Plus size={16} />
            Add feed
          </button>
        </fieldset>
        <fieldset>
          <legend>Weather</legend>
          <label className="daily-check">
            <input
              type="checkbox"
              checked={value.weather.enabled}
              onChange={(e) =>
                setForm({
                  ...value,
                  weather: { ...value.weather, enabled: e.target.checked }
                })
              }
            />
            Enable weather
          </label>
          <div className="daily-location-fields">
            <label className="form-label">
              Location name
              <input
                required={value.weather.enabled}
                maxLength={80}
                value={value.weather.label}
                placeholder="London"
                onChange={(e) =>
                  setForm({
                    ...value,
                    weather: { ...value.weather, label: e.target.value }
                  })
                }
              />
            </label>
            <label className="form-label">
              Latitude
              <input
                type="number"
                required={value.weather.enabled}
                step="any"
                min="-90"
                max="90"
                value={value.weather.latitude ?? ""}
                onChange={(e) =>
                  setForm({
                    ...value,
                    weather: {
                      ...value.weather,
                      latitude:
                        e.target.value === "" ? null : Number(e.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="form-label">
              Longitude
              <input
                type="number"
                required={value.weather.enabled}
                step="any"
                min="-180"
                max="180"
                value={value.weather.longitude ?? ""}
                onChange={(e) =>
                  setForm({
                    ...value,
                    weather: {
                      ...value.weather,
                      longitude:
                        e.target.value === "" ? null : Number(e.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="form-label">
              Temperature
              <Select
                value={value.weather.temperature_unit}
                onChange={(e) =>
                  setForm({
                    ...value,
                    weather: {
                      ...value.weather,
                      temperature_unit: e.target.value
                    }
                  })
                }
              >
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
              </Select>
            </label>
          </div>
          <button className="text-button" type="button" onClick={location}>
            <MapPin size={16} />
            Use current location
          </button>
          <p className="muted">
            Open-Meteo by default. Custom sources must return the same forecast
            format.
          </p>
          {endpoint("weather", "Weather")}
        </fieldset>
        <fieldset>
          <legend>Transport · TfL</legend>
          <label className="daily-check">
            <input
              type="checkbox"
              checked={value.transport.enabled}
              onChange={(e) =>
                setForm({
                  ...value,
                  transport: { ...value.transport, enabled: e.target.checked }
                })
              }
            />
            Enable TfL line status
          </label>
          <label className="form-label">
            TfL line selection
            <Select
              value={value.transport.all_lines ? "all" : "selected"}
              onChange={(e) =>
                setForm({
                  ...value,
                  transport: {
                    ...value.transport,
                    all_lines: e.target.value === "all"
                  }
                })
              }
            >
              <option value="all">All lines</option>
              <option value="selected">Choose lines</option>
            </Select>
          </label>
          {!value.transport.all_lines && (
            <>
              <label className="form-label">
                Selected line IDs (comma separated)
                <input
                  value={lineText}
                  placeholder="central, victoria"
                  onChange={(e) => setLineText(e.target.value)}
                />
                <small>
                  Save to load available line choices. An empty selection shows
                  no lines.
                </small>
              </label>
              {!!daily.data?.transport.data?.available_lines.length && (
                <div className="daily-widget-options">
                  {daily.data.transport.data.available_lines.map((line) => (
                    <label key={line.id}>
                      <input
                        type="checkbox"
                        checked={lineText
                          .split(",")
                          .map((s) => s.trim())
                          .includes(line.id)}
                        onChange={(e) => {
                          const selected = lineText
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setLineText(
                            (e.target.checked
                              ? [...new Set([...selected, line.id])]
                              : selected.filter((id) => id !== line.id)
                            ).join(", ")
                          );
                        }}
                      />
                      {line.name}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          {endpoint("transport", "TfL-compatible")}
        </fieldset>
        <fieldset>
          <legend>Walking loops</legend>
          <p className="muted">
            Use an{" "}
            <a
              href="https://openrouteservice.org/"
              target="_blank"
              rel="noreferrer"
            >
              openrouteservice
            </a>{" "}
            API key, or a compatible public HTTPS router. Route generation sends
            your chosen start point to that source.
          </p>
          {endpoint("walks", "Walking router")}
        </fieldset>
        <div className="settings-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save daily sources"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
