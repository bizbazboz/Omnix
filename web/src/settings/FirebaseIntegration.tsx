import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, qc } from "../lib/api";

export default function FirebaseIntegration() {
  const query = useQuery({
    queryKey: ["firebase-push"],
    queryFn: () => api("/settings/firebase")
  });
  const [key, setKey] = useState(""),
    [name, setName] = useState(""),
    [android, setAndroid] = useState(""),
    [androidName, setAndroidName] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await api("/settings/firebase", {
        method: "PUT",
        body: JSON.stringify({ service_account: key, android_config: android })
      });
      setKey("");
      setName("");
      setAndroid("");
      setAndroidName("");
      await qc.invalidateQueries({ queryKey: ["firebase-push"] });
      setMessage("Firebase settings saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" id="firebase">
      <span className="eyebrow">COMPANION / PUSH</span>
      <h2>Firebase</h2>
      <p className="muted">
        Store Firebase settings here once. The generic Android companion loads
        its configuration from this instance; nothing is embedded in its build.
      </p>
      {query.data?.project_id && (
        <p>
          {query.data.configured ? "Connected" : "Setup incomplete"} ·{" "}
          {query.data.project_id}
        </p>
      )}
      {query.data?.packages?.length > 0 && (
        <p className="muted">{query.data.packages.join(" · ")}</p>
      )}
      {query.error && <p className="error">{query.error.message}</p>}
      <div className="settings-form">
        <label className="form-label">
          Service-account JSON key
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 32000) {
                setMessage("Choose a JSON key smaller than 32 KB.");
                return;
              }
              try {
                const value = await file.text();
                setKey(value);
                setName(file.name);
                setMessage("");
              } catch {
                setMessage("Could not read this key file.");
              }
            }}
          />
        </label>
        {name && <p className="muted">{name}</p>}
        <label className="form-label">
          Android client configuration
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 128000) {
                setMessage(
                  "Choose a google-services.json file smaller than 128 KB."
                );
                return;
              }
              try {
                setAndroid(await file.text());
                setAndroidName(file.name);
                setMessage("");
              } catch {
                setMessage("Could not read the Android configuration.");
              }
            }}
          />
        </label>
        {androidName && <p className="muted">{androidName}</p>}
        <p className="muted">
          Firebase Console → Project settings → Service accounts → Generate new
          private key. Enable Firebase Cloud Messaging API v1 and grant this
          account the Firebase Cloud Messaging API Admin role. Upload the
          matching google-services.json for com.bizbazboz.omnix and, if used,
          com.bizbazboz.omnix.preview. Both files stay on this server; only
          public Android settings reach the app.
        </p>
        <div className="settings-actions">
          <button
            className="primary"
            disabled={busy || (!key && !android)}
            onClick={() => void save()}
          >
            {query.data?.key_configured || query.data?.configured
              ? "Save Firebase"
              : "Connect Firebase"}
          </button>
          {(query.data?.key_configured || query.data?.configured) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/settings/firebase", { method: "DELETE" });
                  await qc.invalidateQueries({ queryKey: ["firebase-push"] });
                  setMessage("Firebase disconnected.");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
