import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qc, type User } from "../lib/api";
import {
  phoneStatus,
  phoneCommand,
  phoneMetrics,
  syncPhoneHealth,
  withPhoneHealthSettings,
  type PhoneConfig,
  type PhoneStatus
} from "../lib/healthConnect";
export default function HealthConnectIntegration() {
  const query = useQuery<PhoneConfig>({
    queryKey: ["phone-health"],
    queryFn: () => api("/health/connect")
  });
  const [device, setDevice] = useState<PhoneStatus | null>(null),
    [selected, setSelected] = useState<string[]>([
      "steps",
      "distance",
      "workout_minutes",
      "sleep"
    ]);
  const [preferred, setPreferred] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (query.data?.enabled) {
      setSelected(query.data.metrics);
      setPreferred(query.data.preferred ?? true);
    }
  }, [query.data]);
  useEffect(() => {
    if (!window.ReactNativeWebView) return;
    let active = true;
    const refresh = () => {
      void phoneStatus()
        .then((value) => {
          if (active) setDevice(value);
        })
        .catch(() => {
          if (active) setMessage("Update the companion to use Health Connect.");
        });
    };
    window.addEventListener("omnix-native-ready", refresh);
    if (window.omnixNativeSend) refresh();
    return () => {
      active = false;
      window.removeEventListener("omnix-native-ready", refresh);
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await withPhoneHealthSettings(user(), action);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      for (const key of ["phone-health", "health-status", "health-statistics"])
        void qc.invalidateQueries({ queryKey: [key] });
    }
  }
  const user = () => qc.getQueryData<User>(["me"])?.id || "";
  const native = Boolean(window.ReactNativeWebView),
    supported = device?.available;
  return (
    <section className="settings-card" id="health-connect">
      <span className="eyebrow">ANDROID / HEALTH CONNECT</span>
      <h2>Health from your phone</h2>
      <p className="muted">
        Read only the categories you choose. Daily totals sync privately to this
        account while Omnix is open. Google history stays separate.
      </p>
      {query.error && (
        <p role="alert" className="error">
          {query.error.message}
        </p>
      )}
      {query.data && (
        <div className="settings-form">
          {!native ? (
            <p className="notice">
              Open this integration in the Android companion to connect or sync
              a phone.
            </p>
          ) : device?.platform === "ios" ? (
            <p className="notice">Health Connect is available on Android.</p>
          ) : device && !supported ? (
            <p className="notice">
              Health Connect is unavailable or needs an update. Android 14+
              includes it; Android 9–13 needs the Health Connect app.
            </p>
          ) : null}
          {phoneMetrics.map(([id, label]) => (
            <label className="notification-option" key={id}>
              <span>{label}</span>
              <input
                type="checkbox"
                aria-label={`Sync ${label}`}
                checked={selected.includes(id)}
                disabled={busy || !supported}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, id]
                      : old.filter((v) => v !== id)
                  )
                }
              />
            </label>
          ))}
          <label className="notification-option">
            <span>Prefer phone readings for overlapping days</span>
            <input
              type="checkbox"
              checked={preferred}
              disabled={busy || !supported}
              onChange={(e) => setPreferred(e.target.checked)}
            />
          </label>
          <p className="muted">
            No location, medical records or write permissions. The first sync
            reads the last 28 days. Later syncs check changes; no background
            permission is requested. Revoking access stops new reads and retains
            saved history.
          </p>
          {query.data.enabled && (
            <p className="muted">
              Selected:{" "}
              {query.data.metrics
                .map(
                  (id) => phoneMetrics.find(([key]) => key === id)?.[1] ?? id
                )
                .join(", ")}
              . Granted at last sync:{" "}
              {query.data.permissions
                ?.map(
                  (id) => phoneMetrics.find(([key]) => key === id)?.[1] ?? id
                )
                .join(", ") || "None"}
              .{" "}
              {query.data.last_sync
                ? `Last sync: ${new Date(query.data.last_sync).toLocaleString()}`
                : "Waiting for the first sync."}
            </p>
          )}
          <div className="settings-actions">
            <button
              disabled={busy || !supported || !selected.length}
              onClick={() =>
                void run(async () => {
                  const owner = user();
                  if (!owner || owner !== query.data?.user_id)
                    throw Error("The signed-in account changed.");
                  await phoneCommand<string[]>("permissions", {
                    metrics: selected
                  });
                  const info = await phoneStatus();
                  if (!info.device_id)
                    throw Error("Device identity unavailable.");
                  setDevice(info);
                  if (user() !== owner)
                    throw Error(
                      "The signed-in account changed. Reconnect before syncing."
                    );
                  const config = await api<PhoneConfig>("/health/connect");
                  await api("/health/connect", {
                    method: "PUT",
                    body: JSON.stringify({
                      expected_revision: config.revision,
                      enabled: true,
                      preferred,
                      device_id: info.device_id,
                      metrics: selected,
                      timezone:
                        info.timezone ||
                        Intl.DateTimeFormat().resolvedOptions().timeZone
                    })
                  });
                  setMessage(await syncPhoneHealth(owner, true));
                })
              }
            >
              {query.data.enabled
                ? "Update phone access"
                : "Connect this phone"}
            </button>
            {query.data.enabled && (
              <button
                className="secondary"
                disabled={busy || !supported}
                onClick={() =>
                  void run(async () =>
                    setMessage(await syncPhoneHealth(user(), true))
                  )
                }
              >
                Sync phone now
              </button>
            )}
            {native && (
              <button
                className="secondary"
                disabled={busy || !device || device.platform !== "android"}
                onClick={() =>
                  void run(async () => {
                    await phoneCommand("settings");
                    setMessage(
                      "Review Health Connect access, then return and sync."
                    );
                  })
                }
              >
                Android permissions
              </button>
            )}
            {query.data.enabled && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const config = query.data!;
                    await api("/health/connect", {
                      method: "PUT",
                      body: JSON.stringify({
                        expected_revision: config.revision,
                        enabled: false,
                        preferred: config.preferred ?? true,
                        device_id: config.device_id,
                        metrics: config.metrics,
                        timezone: config.timezone
                      })
                    });
                    setMessage(
                      "Phone sync paused. Saved phone and Google history retained."
                    );
                  })
                }
              >
                Pause phone sync
              </button>
            )}
            {(query.data.enabled || query.data.last_sync) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Forget all synced phone health data? Google history will be kept. Android permissions are managed separately."
                    )
                  )
                    void run(async () => {
                      await api("/health/connect", { method: "DELETE" });
                      setMessage(
                        "Phone data forgotten. Review Android permissions separately."
                      );
                    });
                }}
              >
                Forget phone data
              </button>
            )}
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
