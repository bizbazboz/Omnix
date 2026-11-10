import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";
import { Lightbulb, RefreshCw } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import { api, qc } from "../../lib/api";
import ActionEditor from "./ActionEditor";
import { type Device, initialCommand, controlNames } from "./api";
import "./iot.css";

export default function IoT() {
  const activity = useLocation().pathname.endsWith("/activity");
  const query = useQuery<{ configured: boolean; items: Device[] }>({
    queryKey: ["iot-devices"],
    queryFn: () => api("/iot/devices")
  });
  const history = useQuery<
    { id: string; event: string; status: string; created_at: string }[]
  >({
    queryKey: ["iot-history"],
    queryFn: () => api("/iot/history"),
    enabled: activity,
    refetchInterval: activity ? 30000 : false
  });
  return (
    <div className="page iot-page">
      <PageHeader
        context="IoT"
        title={activity ? "Calendar activity" : "Lights"}
      />
      {activity ? (
        <>
          <div className="section-title">
            <h2>Calendar triggers</h2>
            <NavLink to="/settings/connections#govee">Manage rules</NavLink>
          </div>
          <p className="muted iot-caption">
            Checks every 30 seconds. Accepted means Govee received the command;
            unconfirmed actions are never replayed automatically.
          </p>
          {history.error ? (
            <p className="error" role="alert">
              {history.error.message}
            </p>
          ) : history.isLoading ? (
            <p className="muted">[LOADING]</p>
          ) : !history.data?.length ? (
            <p className="empty-label">No calendar actions yet.</p>
          ) : (
            <div className="iot-history">
              {history.data.map((run) => (
                <article key={run.id}>
                  <div>
                    <strong>{run.event}</strong>
                    <time>{new Date(run.created_at).toLocaleString()}</time>
                  </div>
                  <span className="eyebrow">
                    {{
                      accepted: "Accepted",
                      deferred: "Deferred",
                      sending: "Unconfirmed",
                      not_sent: "Not sent",
                      unconfirmed: "Unconfirmed"
                    }[run.status] || run.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </>
      ) : query.isLoading ? (
        <p className="muted">[LOADING]</p>
      ) : query.error ? (
        <p className="error" role="alert">
          {query.error.message}{" "}
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      ) : !query.data?.items.length ? (
        <div className="iot-empty">
          <Lightbulb size={28} />
          <h2>Your curtain lights, connected.</h2>
          <p>Connect Govee and discover your lights in Integrations.</p>
          <NavLink className="secondary" to="/settings/connections#govee">
            Open Integrations
          </NavLink>
        </div>
      ) : (
        <>
          <p className="muted iot-caption">
            Controls are provided by your device. Calendar rules live in{" "}
            <NavLink to="/settings/connections#govee">Integrations</NavLink>.
          </p>
          <div className="iot-device-grid">
            {query.data.items.map((device) => (
              <Light key={device.id} device={device} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function Light({ device }: { device: Device }) {
  const [command, setCommand] = useState(() => initialCommand(device)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [state, setState] = useState<{
      capabilities?: { instance: string; state: { value: unknown } }[];
    } | null>(null);
  async function perform(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api("/iot/devices/" + device.id + "/" + path, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (path === "state") setState(value);
      else if (path === "scenes") {
        await qc.invalidateQueries({ queryKey: ["iot-devices"] });
        setMessage("Available scenes refreshed.");
      } else setMessage(value.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="iot-device" aria-label={device.name}>
      <div className="section-title">
        <div>
          <span className="eyebrow">GOVEE / {device.sku}</span>
          <h2>{device.name}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={"Refresh " + device.name + " state"}
          disabled={busy}
          onClick={() => perform("state")}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform("control", command);
        }}
      >
        <ActionEditor
          device={device}
          value={command}
          onChange={setCommand}
          disabled={busy}
        />
        <div className="settings-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Sending…" : "Apply"}
          </button>
          {device.capabilities.some((c) =>
            ["lightScene", "diyScene"].includes(c.instance)
          ) && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => perform("scenes")}
            >
              Refresh scenes
            </button>
          )}
        </div>
      </form>
      {state && (
        <div className="iot-state">
          <span className="eyebrow">REPORTED STATE</span>
          {state.capabilities
            ?.filter((c) => controlNames[c.instance])
            .map((c) => (
              <p key={c.instance}>
                <span>{controlNames[c.instance]}</span>
                <span>
                  {c.instance === "powerSwitch"
                    ? c.state.value
                      ? "On"
                      : "Off"
                    : typeof c.state.value === "object"
                      ? "Available"
                      : String(c.state.value)}
                </span>
              </p>
            ))}
        </div>
      )}
      {message && (
        <p className="iot-feedback" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
