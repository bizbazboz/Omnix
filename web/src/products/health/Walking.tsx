import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Download, Search, X } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import SegmentedControl from "../../components/SegmentedControl";
import StreetMap from "./walking/StreetMap";
import { gpx, type Point, type Walk } from "./walking/graph";
import "../daily/daily.css";
import "./walking.css";
type Location = {
  id: string;
  label: string;
  name: string;
  latitude: number;
  longitude: number;
};
export default function Walking() {
  const [location, setLocation] = useState<Location | null>(null),
    [search, setSearch] = useState(""),
    [items, setItems] = useState<Location[]>([]),
    [distance, setDistance] = useState("5"),
    [speed, setSpeed] = useState("5"),
    [minutes, setMinutes] = useState("60"),
    [mode, setMode] = useState<"distance" | "time">("distance"),
    [route, setRoute] = useState<Walk | null>(null),
    [busy, setBusy] = useState<"" | "search" | "generate">(""),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    seed = useRef(1);
  const target =
    mode === "distance"
      ? Number(distance)
      : (Number(speed) * Number(minutes)) / 60;
  const valid = Number.isFinite(target) && target >= 0.5 && target <= 30;
  useEffect(() => () => worker.current?.terminate(), []);
  function runtime() {
    if (worker.current) return worker.current;
    const current = new Worker(
      new URL("./walking/walking.worker.ts", import.meta.url),
      { type: "module" }
    );
    current.onmessage = (event) => {
      const data = event.data;
      if (data.id !== request.current) return;
      if (data.type === "progress") {
        setProgress(data.message);
        return;
      }
      setBusy("");
      setProgress("");
      if (data.type === "locations") {
        setItems(data.items);
        if (!data.items.length)
          setMessage(
            "No locations found. Try a place or street name, or choose directly on the map."
          );
      }
      if (data.type === "route") {
        setRoute(data.route);
        seed.current++;
      }
      if (data.type === "error") setError(data.message);
    };
    current.onerror = () => {
      setError("The browser route planner stopped. Try a shorter distance.");
      setBusy("");
      setProgress("");
      current.terminate();
      worker.current = null;
    };
    worker.current = current;
    return current;
  }
  function select(point: Location) {
    setLocation(point);
    setSearch(point.label);
    setItems([]);
    setError("");
    setMessage("");
  }
  function pick(point: Point) {
    if (busy) return;
    select({
      id: "map",
      label: `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`,
      name: "Map location",
      latitude: point[1],
      longitude: point[0]
    });
  }
  function find() {
    if (busy || search.trim().length < 2) return;
    setError("");
    setMessage("");
    setBusy("search");
    setItems([]);
    runtime().postMessage({
      id: ++request.current,
      type: "search",
      query: search
    });
  }
  function locate() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. Choose a start on the map.");
      return;
    }
    const id = ++request.current;
    setBusy("search");
    setError("");
    setProgress("Finding current location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (id !== request.current) return;
        select({
          id: "current",
          label: "Current location",
          name: "Current location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setBusy("");
        setProgress("");
      },
      () => {
        if (id !== request.current) return;
        setBusy("");
        setProgress("");
        setError(
          "Location access is unavailable. Search or choose a start on the map."
        );
      },
      { timeout: 10000 }
    );
  }
  function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!location || busy || !valid) return;
    setError("");
    setMessage("");
    setBusy("generate");
    setProgress("Loading nearby walking paths…");
    runtime().postMessage({
      id: ++request.current,
      type: "generate",
      latitude: location.latitude,
      longitude: location.longitude,
      label: location.label,
      target: target * 1000,
      speed: mode === "time" ? Number(speed) : 5,
      seed: seed.current
    });
  }
  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    request.current++;
    setBusy("");
    setProgress("");
    setMessage("Calculation cancelled.");
  }
  function download() {
    if (!route) return;
    try {
      const url = URL.createObjectURL(
          new Blob([gpx(route)], { type: "application/gpx+xml" })
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = "omnix-walking-loop.gpx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("GPX downloaded");
    } catch {
      setError("The GPX file could not be created. Try again.");
    }
  }
  const point = useMemo(
    () =>
      location ? ([location.longitude, location.latitude] as Point) : null,
    [location]
  );
  return (
    <div className="page daily-page walking-page">
      <PageHeader context="Health" title="Walking loops" />
      <p className="walking-caption">
        Online OpenStreetMap. Loops calculated on this device.
      </p>
      <div className="walking-workspace">
        <form
          className="daily-walk-form"
          aria-label="Plan a walking loop"
          aria-busy={!!busy}
          onSubmit={generate}
        >
          <span className="eyebrow">PLAN YOUR WALK</span>
          <div className="walking-location-search">
            <label className="form-label" htmlFor="walk-start">
              Start location
            </label>
            <div className="walking-search-row">
              <input
                id="walk-start"
                role="combobox"
                aria-expanded={!!items.length}
                aria-controls="walk-location-results"
                autoComplete="off"
                value={search}
                disabled={!!busy}
                placeholder="Place or street name"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLocation(null);
                  setItems([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && items.length) {
                    event.preventDefault();
                    document
                      .querySelector<HTMLButtonElement>(
                        "#walk-location-results button"
                      )
                      ?.focus();
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    find();
                  }
                  if (event.key === "Escape") setItems([]);
                }}
              />
              <button
                type="button"
                className="secondary"
                aria-label="Search start location"
                disabled={!!busy || search.trim().length < 2}
                onClick={find}
              >
                <Search size={16} />
              </button>
            </div>
            {!!items.length && (
              <div
                className="walking-search-results"
                id="walk-location-results"
                role="listbox"
                aria-label="Start location results"
              >
                {items.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    key={item.id + item.label}
                    onClick={() => select(item)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        const options = Array.from(
                          event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                            "button"
                          )
                        );
                        options[
                          (options.indexOf(event.currentTarget) +
                            (event.key === "ArrowDown"
                              ? 1
                              : options.length - 1)) %
                            options.length
                        ]?.focus();
                      }
                      if (event.key === "Escape") {
                        setItems([]);
                        document.getElementById("walk-start")?.focus();
                      }
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={!!busy}
            onClick={locate}
          >
            <MapPin size={16} />
            Use current location
          </button>
          <fieldset disabled={!!busy} className="walking-target-fields">
            <SegmentedControl
              label="Walking target"
              value={mode}
              onChange={setMode}
              options={[
                { value: "distance", label: "Distance" },
                { value: "time", label: "Speed / time" }
              ]}
            />
            <div className="daily-walk-fields">
              {mode === "distance" ? (
                <label className="form-label">
                  Target distance · km
                  <input
                    type="number"
                    required
                    min="0.5"
                    max="30"
                    step="any"
                    value={distance}
                    onChange={(event) => setDistance(event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label className="form-label">
                    Walking speed · km/h
                    <input
                      type="number"
                      required
                      min="1"
                      max="12"
                      step="any"
                      value={speed}
                      onChange={(event) => setSpeed(event.target.value)}
                    />
                  </label>
                  <label className="form-label">
                    Walking time · minutes
                    <input
                      type="number"
                      required
                      min="10"
                      max="360"
                      step="1"
                      value={minutes}
                      onChange={(event) => setMinutes(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
          </fieldset>
          <div className="settings-actions">
            <button
              className="primary"
              disabled={!!busy || !location || !valid}
            >
              {busy === "generate"
                ? "Calculating…"
                : busy === "search"
                  ? "Searching…"
                  : "Generate loop"}
            </button>
            {busy && (
              <button type="button" className="text-button" onClick={cancel}>
                <X size={14} />
                Cancel
              </button>
            )}
            <span className="eyebrow">
              Target {Number.isFinite(target) ? target.toFixed(1) : "—"} km
            </span>
          </div>
          {progress && (
            <p className="walking-feedback" role="status">
              {progress}
            </p>
          )}
          {!valid && (
            <p className="error" role="alert">
              Choose a distance or speed/time combination covering 0.5–30 km.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="walking-feedback" role="status">
              {message}
            </p>
          )}
        </form>
        <div className="walking-route-panel">
          {route && (
            <section
              className="daily-walk-result"
              aria-label="Calculated walking loop"
            >
              <div className="section-title">
                <h2>
                  {(route.distance_m / 1000).toFixed(1)} km{" "}
                  <span className="muted">
                    / {Math.round(route.duration_s / 60)} min
                  </span>
                </h2>
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={download}
                >
                  <Download size={16} />
                  Export GPX
                </button>
              </div>
              <p className="muted">
                {route.start_label}
                {route.snap_distance_m > 0
                  ? ` · Path starts ${route.snap_distance_m} m from your selected point`
                  : ""}
              </p>
              <p className="walking-route-meta">
                <span>Target {route.requested_km.toFixed(1)} km</span>
                <span>{route.speed_kmh} km/h</span>
                <span>Returns to start</span>
              </p>
            </section>
          )}
          <StreetMap start={point} route={route} onPick={pick} />
          {route && (
            <details className="walking-directions">
              <summary>Directions · {route.steps.length} steps</summary>
              <ol>
                {route.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
