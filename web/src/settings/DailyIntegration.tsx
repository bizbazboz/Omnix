import LocationSearch from "../components/LocationSearch";
import MultiSelect from "../components/MultiSelect";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { api, qc } from "../lib/api";
import Select from "../components/Select";
import { dailyViews, type DailyView } from "../products/daily/api";
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
  widgets: DailyView[];
  clear_keys?: string[];
};
export default function DailyIntegration() {
  const query = useQuery<Config>({
      queryKey: ["daily-settings"],
      queryFn: () => api("/settings/daily")
    }),
    catalog = useQuery<{ items: { id: string; name: string }[] }>({
      queryKey: ["daily-lines"],
      queryFn: () => api("/daily/transport/catalog"),
      staleTime: 600000
    });
  const [form, setForm] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  function initialise(value: Config) {
    setForm({
      ...value,
      clear_keys: [],
      weather: { ...value.weather, api_key: "" },
      transport: { ...value.transport, api_key: "" }
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
  function provider(name: "weather" | "transport", patch: Partial<Provider>) {
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
                  longitude: Number(p.coords.longitude.toFixed(6)),
                  label: "Current location"
                }
              }
            : current
        ),
      () => setError("Location access unavailable. Enter coordinates instead."),
      { timeout: 10000 }
    );
  }
  function endpoint(name: "weather" | "transport", title: string) {
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
              body: JSON.stringify(value)
            });
            initialise(saved);
            qc.setQueryData(["daily-settings"], saved);
            await qc.invalidateQueries({ queryKey: ["daily"] });
            qc.invalidateQueries({ queryKey: ["daily-lines"] });
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
            <LocationSearch
              label="Weather location"
              value={value.weather.label}
              endpoint="/daily/locations"
              minChars={3}
              hint="GeoNames / Open-Meteo"
              onChange={(label) =>
                setForm({
                  ...value,
                  weather: {
                    ...value.weather,
                    label,
                    latitude: null,
                    longitude: null
                  }
                })
              }
              onSelect={(point) =>
                setForm({
                  ...value,
                  weather: {
                    ...value.weather,
                    label: point.label,
                    latitude: point.latitude,
                    longitude: point.longitude
                  }
                })
              }
            />
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
              <MultiSelect
                label="Train lines"
                value={value.transport.lines}
                options={(catalog.data?.items || []).map((line) => ({
                  value: line.id,
                  label: line.name
                }))}
                disabled={catalog.isLoading}
                onChange={(lines) =>
                  setForm({
                    ...value,
                    transport: { ...value.transport, lines }
                  })
                }
              />
              {catalog.error && (
                <p className="error" role="alert">
                  Line choices could not load.{" "}
                  <button type="button" onClick={() => catalog.refetch()}>
                    Retry
                  </button>
                </p>
              )}
            </>
          )}
          {endpoint("transport", "TfL-compatible")}
        </fieldset>
        <div className="settings-actions">
          <button
            className="primary"
            disabled={
              busy ||
              (value.weather.enabled &&
                (value.weather.latitude === null ||
                  value.weather.longitude === null))
            }
          >
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
