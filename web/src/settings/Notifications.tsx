import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, qc } from "../lib/api";
import { enablePush, disablePush } from "../lib/push";

export default function Notifications({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api("/notifications/preferences")
  });
  const key = "omnix.push-device:" + userId;
  const native = Boolean(window.ReactNativeWebView);
  const firebase = useQuery({
    queryKey: ["firebase-push"],
    queryFn: () => api("/settings/firebase")
  });
  const [device, setDevice] = useState(() => localStorage.getItem(key) || "");
  useEffect(() => {
    const refresh = () => setDevice(localStorage.getItem(key) || "");
    window.addEventListener("omnix-push-device", refresh);
    return () => window.removeEventListener("omnix-push-device", refresh);
  }, [key]);
  const devices = useQuery<{ id: string; kind: string; latest?: string }[]>({
    queryKey: ["push-devices"],
    queryFn: () => api("/notifications/devices"),
    refetchInterval: device ? 5000 : false
  });
  useEffect(() => {
    if (device && devices.data && !devices.data.some((d) => d.id === device)) {
      localStorage.removeItem(key);
      setDevice("");
    }
  }, [device, devices.data, key]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <span className="eyebrow">STAY IN SYNC</span>
      <h2>Notifications</h2>
      <p className="muted">
        Updates appear live. Choose what reaches your notification inbox and
        this device.
      </p>
      {query.error && <p className="error">{query.error.message}</p>}
      {query.data && (
        <div className="settings-form">
          {(
            [
              ["email", "New email"],
              ["news", "New headlines"],
              ["previews", "Show previews on the lock screen"]
            ] as const
          ).map(([id, label]) => (
            <label className="notification-option" key={id}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={query.data[id]}
                disabled={busy}
                onChange={(e) =>
                  void run(async () => {
                    await api("/notifications/preferences", {
                      method: "PUT",
                      body: JSON.stringify({
                        ...query.data,
                        [id]: e.target.checked
                      })
                    });
                    await qc.invalidateQueries({
                      queryKey: ["notification-preferences"]
                    });
                  })
                }
              />
            </label>
          ))}
          <p className="muted">
            Previews are off by default. Your first mailbox or feed import stays
            quiet.
          </p>
          {!native && (
            <p className="muted">
              Push notifications are app-only. Open the Android companion to
              enable alerts on your phone.
            </p>
          )}
          {native && !firebase.data?.configured && (
            <p className="notice">
              An administrator needs to connect Firebase in Integrations first.
            </p>
          )}
          <div className="settings-actions">
            <button
              className="primary"
              disabled={busy || !native || !firebase.data?.configured}
              onClick={() =>
                void run(async () => {
                  if (device) {
                    await disablePush(device);
                    localStorage.removeItem(key);
                    setDevice("");
                    setMessage("Push disabled on this device.");
                  } else {
                    const id = await enablePush(false, userId);
                    localStorage.setItem(key, id);
                    qc.setQueryData<{ id: string; kind: string }[]>(
                      ["push-devices"],
                      (old) => [...(old || []), { id, kind: "fcm" }]
                    );
                    setDevice(id);
                    setMessage("Push enabled on this device.");
                  }
                })
              }
            >
              {device ? "Disable on this device" : "Enable on this device"}
            </button>
            {device && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("/notifications/test", { method: "POST" });
                    setMessage("Test notification queued.");
                  })
                }
              >
                Send test
              </button>
            )}
          </div>
          {device && (
            <p role="status" className="muted">
              Last delivery:{" "}
              {(
                {
                  sent: "Accepted by Firebase",
                  pending: "Queued",
                  failed:
                    "Failed — check Firebase credentials and app configuration",
                  cancelled: "Cancelled"
                } as Record<string, string>
              )[devices.data?.find((d) => d.id === device)?.latest || ""] ||
                "No delivery yet"}
            </p>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
