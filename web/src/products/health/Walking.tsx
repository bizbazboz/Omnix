import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { MapPin, Download } from "lucide-react";
import { api, qc } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import LocationSearch, {
  type LocationPoint
} from "../../components/LocationSearch";
import SegmentedControl from "../../components/SegmentedControl";
import type { Walk } from "./api";
import "../daily/daily.css";
import "./walking.css";
type SavedWalk = Walk & {
  start_label?: string;
  speed_kmh?: number;
  snap_distance_m?: number;
  start_latitude?: number;
  start_longitude?: number;
  target_mode?: "distance" | "time";
  seed?: number;
};
export default function Walking() {
  const query = useQuery<{
    route: SavedWalk | null;
    map: {
      ready: boolean;
      name: string;
      import_status?: { state: string; message: string };
    };
  }>({
    queryKey: ["walking"],
    queryFn: () => api("/health/walks"),
    refetchInterval: 30000
  });
  const [location, setLocation] = useState<LocationPoint | null>(null),
    [search, setSearch] = useState(""),
    [distance, setDistance] = useState("5"),
    [speed, setSpeed] = useState("5"),
    [minutes, setMinutes] = useState("60"),
    [mode, setMode] = useState<"distance" | "time">("distance"),
    [seed, setSeed] = useState(1),
    [route, setRoute] = useState<SavedWalk | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(""),
    [exported, setExported] = useState("");
  const hydrated = useRef(false);
  useEffect(() => {
    if (!query.data || hydrated.current) return;
    hydrated.current = true;
    const saved = query.data.route;
    if (!saved || search || location) return;
    const [lon, lat] = saved.coordinates[0];
    select({
      id: "saved",
      name: saved.start_label || "Previous start",
      label: saved.start_label || "Previous start",
      detail: "",
      latitude: saved.start_latitude ?? lat,
      longitude: saved.start_longitude ?? lon
    });
    setMode(saved.target_mode || "distance");
    setDistance(String(saved.requested_km));
    setSpeed(String(saved.speed_kmh || 5));
    setMinutes(
      String(Math.round((saved.requested_km / (saved.speed_kmh || 5)) * 60))
    );
    setSeed(((saved.seed || 1) + 1) % 2147483647);
  }, [query.data, search, location]);
  const shown = route || query.data?.route,
    target =
      mode === "distance"
        ? Number(distance)
        : (Number(speed) * Number(minutes)) / 60;
  function select(point: LocationPoint) {
    setError("");
    setLocation(point);
    setSearch(point.label);
  }
  function locate() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. Search for a start instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        select({
          id: "current",
          name: "Current location",
          label: "Current location",
          detail: "",
          latitude: p.coords.latitude,
          longitude: p.coords.longitude
        }),
      () =>
        setError("Location access is unavailable. Search for a start instead."),
      { timeout: 10000 }
    );
  }
  async function downloadGpx(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (!shown || exporting || busy) return;
    setExporting(true);
    setExportError("");
    setExported("");
    try {
      const response = await fetch(event.currentTarget.href);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          response.status === 401
            ? "Sign in again before exporting your route."
            : body?.detail || "Could not export this route. Try again."
        );
      }
      const text = await response.text();
      const xml = new DOMParser().parseFromString(text, "application/xml");
      if (
        xml.querySelector("parsererror") ||
        xml.documentElement.localName !== "gpx" ||
        !xml.getElementsByTagName("trkpt").length
      )
        throw new Error("The export did not contain a GPX track. Try again.");
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/gpx+xml" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "omnix-walking-loop.gpx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExported("GPX downloaded");
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="page daily-page walking-page">
      <PageHeader context="Health" title="Walking loops" />
      {query.error ? (
        <p className="error" role="alert">
          {query.error.message}
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      ) : !query.data ? (
        <p className="muted">[ Loading walking map… ]</p>
      ) : !query.data.map.ready ? (
        <div className="daily-empty">
          <p>
            {query.data.map.import_status?.message ||
              "Install a regional OpenStreetMap file to generate loops locally."}
          </p>
          <NavLink className="secondary" to="/settings/connections#walking-map">
            Walking map setup
          </NavLink>
        </div>
      ) : (
        <>
          <p className="daily-attribution walking-map-label">
            {query.data.map.name} · local OpenStreetMap graph
          </p>
          <div className="walking-workspace">
            <form
              aria-label="Plan a walking loop"
              aria-busy={busy}
              className="daily-walk-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!location || busy || !Number.isFinite(target)) return;
                setBusy(true);
                setError("");
                setExported("");
                setExportError("");
                try {
                  const value = await api<SavedWalk>("/health/walks", {
                    method: "POST",
                    body: JSON.stringify({
                      latitude: location.latitude,
                      longitude: location.longitude,
                      start_label: location.label,
                      mode,
                      distance_km: mode === "distance" ? Number(distance) : 5,
                      speed_kmh: mode === "time" ? Number(speed) : 5,
                      duration_minutes: mode === "time" ? Number(minutes) : 60,
                      seed
                    })
                  });
                  setRoute(value);
                  setSeed((s) => s + 1);
                  qc.invalidateQueries({ queryKey: ["walking"] });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span className="eyebrow">PLAN YOUR WALK</span>
              <LocationSearch
                disabled={busy}
                label="Start location"
                value={search}
                onChange={(text) => {
                  setSearch(text);
                  setLocation(null);
                }}
                onSelect={select}
                endpoint="/health/walks/locations"
                hint="Local OpenStreetMap location index"
              />
              <button
                type="button"
                className="text-button"
                onClick={locate}
                disabled={busy}
              >
                <MapPin size={16} />
                Use current location
              </button>
              <fieldset disabled={busy} className="walking-target-fields">
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
                        onChange={(e) => setDistance(e.target.value)}
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
                          onChange={(e) => setSpeed(e.target.value)}
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
                          onChange={(e) => setMinutes(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </div>
              </fieldset>
              <div className="settings-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !location ||
                    !Number.isFinite(target) ||
                    target < 0.5 ||
                    target > 30
                  }
                >
                  {busy ? "Calculating…" : "Generate loop"}
                </button>
                <span className="eyebrow">
                  Target {Number.isFinite(target) ? target.toFixed(1) : "—"} km
                </span>
              </div>
              {busy ? (
                <p className="walking-feedback" role="status">
                  Finding paths and a return to your start…
                </p>
              ) : (
                <p className="muted">
                  Follows mapped public paths. Distance may vary from your
                  target.
                </p>
              )}
              {mode === "time" && (target < 0.5 || target > 30) && (
                <p className="error" role="alert">
                  Choose a speed and time covering 0.5–30 km.
                </p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </form>
            <div className="walking-route-panel">
              {shown ? (
                renderRoute(shown)
              ) : (
                <div className="walking-empty">
                  <MapPin size={24} />
                  <h2>Your next loop</h2>
                  <p>
                    Select a start and a distance to find a route that brings
                    you back.
                  </p>
                  <span className="eyebrow">LOCAL ROUTING / OPENSTREETMAP</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {shown && !query.data?.map.ready && renderRoute(shown)}
    </div>
  );

  function renderRoute(shown: SavedWalk) {
    return (
      <section
        className="daily-walk-result"
        aria-label="Saved walking loop"
        aria-busy={busy}
      >
        <span className="eyebrow">YOUR ROUTE</span>
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
              "/api/v1/health/walks/gpx?created_at=" +
              encodeURIComponent(shown.created_at)
            }
            download
            onClick={downloadGpx}
            aria-disabled={exporting || busy}
          >
            <Download size={16} />
            {exporting ? "Exporting…" : "Export GPX"}
          </a>
        </div>
        <p className="muted">
          {shown.start_label}
          {!!shown.snap_distance_m &&
            ` · Start snapped ${shown.snap_distance_m} m to the walking network`}
        </p>
        <p className="walking-route-meta">
          <span>Target {shown.requested_km.toFixed(1)} km</span>
          <span>{shown.speed_kmh || 5} km/h</span>
          <span>Returns to start</span>
        </p>
        {exportError && (
          <p className="error" role="alert">
            {exportError}
          </p>
        )}
        {exported && (
          <p className="walking-feedback" role="status">
            {exported}
          </p>
        )}
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
    );
  }
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
      aria-label="Saved walking loop route outline"
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
