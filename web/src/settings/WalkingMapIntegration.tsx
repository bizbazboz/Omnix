import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qc } from "../lib/api";
export default function WalkingMapIntegration({
  administrator
}: {
  administrator: boolean;
}) {
  const status = useQuery<{
    ready: boolean;
    name: string;
    nodes?: number;
    updated_at?: string;
    import_status?: { state: string; message: string };
  }>({
    queryKey: ["walking-map"],
    queryFn: () => api("/health/walks/map"),
    refetchInterval: 10000
  });
  const config = useQuery<{ name: string; url: string }>({
    queryKey: ["walking-map-config"],
    queryFn: () => api("/settings/walking-map"),
    enabled: administrator
  });
  const [name, setName] = useState("Greater London"),
    [url, setUrl] = useState(
      "https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf"
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (config.data) {
      setName(config.data.name);
      setUrl(config.data.url);
    }
  }, [config.data]);
  const importing = ["downloading", "importing"].includes(
    status.data?.import_status?.state || ""
  );
  return (
    <section className="settings-card" id="walking-map">
      <h2>Walking map</h2>
      <p className="muted">
        Walking loops and start-location search run locally from a regional
        OpenStreetMap file. No routing API or key.
      </p>
      {status.error ? (
        <p className="error">{status.error.message}</p>
      ) : status.data?.ready ? (
        <p>
          {status.data.name} · {status.data.nodes?.toLocaleString()} mapped
          nodes
          {status.data.updated_at && (
            <span className="daily-attribution">
              Imported {new Date(status.data.updated_at).toLocaleString()}
            </span>
          )}
        </p>
      ) : (
        <p>No map installed.</p>
      )}
      {status.data?.import_status?.message && (
        <p role="status">{status.data.import_status.message}</p>
      )}
      {administrator ? (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            setError("");
            try {
              await api("/settings/walking-map", {
                method: "PUT",
                body: JSON.stringify({ name, url })
              });
              await api("/settings/walking-map/import", { method: "POST" });
              setMessage(
                "Map download and import queued. The installed map stays available until its replacement is ready."
              );
              qc.invalidateQueries({ queryKey: ["walking-map"] });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label">
            Region name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="form-label">
            Regional OSM PBF file
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <small>
              Default: Greater London from Geofabrik, approximately 124 MB.
              Downloads and indexing can take several minutes.
            </small>
          </label>
          <div className="settings-actions">
            <button className="primary" disabled={busy || importing}>
              {busy || importing ? "Preparing map…" : "Download and build map"}
            </button>
          </div>
        </form>
      ) : !status.data?.ready ? (
        <p className="muted">
          Ask your workspace administrator to import the region you need.
        </p>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p className="daily-attribution">© OpenStreetMap contributors · ODbL</p>
    </section>
  );
}
