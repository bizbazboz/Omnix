import { useState } from "react";
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
type SavedWalk = Walk & {
  start_label?: string;
  speed_kmh?: number;
  snap_distance_m?: number;
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
    [error, setError] = useState("");
  const shown = route || query.data?.route,
    target =
      mode === "distance"
        ? Number(distance)
        : (Number(speed) * Number(minutes)) / 60;
  function select(point: LocationPoint) {
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
          <form
            className="daily-walk-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!location) return;
              setBusy(true);
              setError("");
              try {
                const value = await api<SavedWalk>("/health/walks", {
                  method: "POST",
                  body: JSON.stringify({
                    latitude: location.latitude,
                    longitude: location.longitude,
                    start_label: location.label,
                    mode,
                    distance_km: Number(distance),
                    speed_kmh: Number(speed),
                    duration_minutes: Number(minutes),
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
            <LocationSearch
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
                    step="0.5"
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
                      step="0.5"
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
                      step="5"
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="settings-actions">
              <button
                className="primary"
                disabled={busy || !location || target < 0.5 || target > 30}
              >
                {busy ? "Calculating…" : "Generate loop"}
              </button>
              <span className="eyebrow">
                Target {Number.isFinite(target) ? target.toFixed(1) : "—"} km
              </span>
            </div>
            <p className="muted">
              Calculated here from mapped walking paths. Actual distance depends
              on the network.
            </p>
          </form>
        </>
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
                "/api/v1/health/walks/gpx?created_at=" +
                encodeURIComponent(shown.created_at)
              }
              download
            >
              <Download size={16} />
              GPX
            </a>
          </div>
          <p className="muted">
            {shown.start_label}
            {!!shown.snap_distance_m &&
              ` · Start snapped ${shown.snap_distance_m} m to the walking network`}
          </p>
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
    </div>
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
