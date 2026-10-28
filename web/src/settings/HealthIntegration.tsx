import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Link2, Unplug } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, qc } from "../lib/api";
import type { HealthStatus } from "../products/health/api";
const permissions = [
  {
    id: "activity",
    name: "Activity",
    description: "Movement, energy, fitness and recorded workouts"
  },
  {
    id: "sleep",
    name: "Sleep",
    description: "Sleep duration, stages and naps"
  },
  {
    id: "nutrition",
    name: "Nutrition",
    description: "Logged food, nutrients and water · optional"
  },
  {
    id: "measurements",
    name: "Measurements",
    description:
      "Heart, oxygen, breathing, skin temperature and body measurements"
  }
];
function Registration({ onSaved }: { onSaved: () => void }) {
  const registration = useQuery<{
    client_id: string;
    secret_saved: boolean;
    redirect_uri: string;
  }>({
    queryKey: ["health-registration"],
    queryFn: () => api("/health/google/registration")
  });
  const [client, setClient] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    if (registration.data) setClient(registration.data.client_id);
  }, [registration.data]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      await api("/health/google/registration", {
        method: "PUT",
        body: JSON.stringify({ client_id: client, client_secret: secret })
      });
      setSecret("");
      setStatus("Saved");
      qc.invalidateQueries({ queryKey: ["health-registration"] });
      onSaved();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="health-registration"
      open={!registration.data?.secret_saved}
    >
      <summary>Google app setup</summary>
      <p>
        Create a web application OAuth client in Google Cloud and enable Google
        Health API. Add this callback URL and your Google account as a test
        user.
      </p>
      <a
        className="text-button"
        href="https://developers.google.com/health/setup"
        target="_blank"
        rel="noopener noreferrer"
      >
        Google setup guide <ArrowUpRight size={13} />
      </a>
      {registration.error ? (
        <p className="error">
          Could not load Google registration.{" "}
          <button onClick={() => registration.refetch()}>Retry</button>
        </p>
      ) : (
        <form
          className="settings-form health-registration-form"
          onSubmit={save}
        >
          <label className="form-label">
            Callback URL
            <input
              aria-label="Google callback URL"
              readOnly
              value={registration.data?.redirect_uri || ""}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label className="form-label">
            Client ID
            <input
              required
              maxLength={500}
              value={client}
              onChange={(event) => setClient(event.target.value)}
              placeholder="…apps.googleusercontent.com"
              autoComplete="off"
            />
          </label>
          <label className="form-label">
            Client secret
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                registration.data?.secret_saved
                  ? "Saved · leave blank to keep"
                  : "Google OAuth client secret"
              }
              autoComplete="new-password"
              required={!registration.data?.secret_saved}
            />
          </label>
          <div>
            <button
              className="secondary"
              disabled={busy || registration.isLoading}
            >
              {busy ? "Saving…" : "Save registration"}
            </button>
            {status && (
              <span role="status" className="inline-status">
                {status}
              </span>
            )}
          </div>
        </form>
      )}
    </details>
  );
}

export default function HealthIntegration({
  notify
}: {
  notify: (text: string) => void;
}) {
  const state = useQuery<HealthStatus>({
    queryKey: ["health-status"],
    queryFn: () => api("/health/status")
  });
  const [groups, setGroups] = useState(["activity", "sleep", "measurements"]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (state.data?.connected) setGroups(state.data.groups);
  }, [state.data?.connected, state.data?.groups.join(",")]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["health-status"] });
    qc.invalidateQueries({ queryKey: ["health-statistics"] });
  };
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/health/google/authorize", {
        method: "POST",
        body: JSON.stringify({ groups })
      });
      window.location.assign(result.url);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }
  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google Health and delete your saved health readings from Omnix?"
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api("/health/connection", { method: "DELETE" });
      qc.removeQueries({ queryKey: ["health-statistics"] });
      invalidate();
      setMessage(
        result.remote_revoked
          ? "Google Health disconnected."
          : "Disconnected locally. Remove Omnix from your Google Account to revoke remote access."
      );
      notify("Health connection removed.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card health-integration" id="google-health">
      <div className="integration-heading">
        <div>
          <span className="eyebrow">HEALTH</span>
          <h2>Google Health</h2>
        </div>
        <span className="eyebrow">
          {state.data?.connected ? "CONNECTED" : "NOT CONNECTED"}
        </span>
      </div>
      {state.isLoading ? (
        <p className="muted">[LOADING]</p>
      ) : state.error ? (
        <p className="error" role="alert">
          Could not load Google Health.{" "}
          <button onClick={() => state.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          {state.data?.can_configure && <Registration onSaved={invalidate} />}
          <p className="muted">
            Read-only access to the Google Health categories you choose.
          </p>
          {state.data?.configured ? (
            <>
              <fieldset>
                <legend>Permissions</legend>
                {permissions.map((permission) => (
                  <label key={permission.id}>
                    <input
                      type="checkbox"
                      checked={groups.includes(permission.id)}
                      onChange={() =>
                        setGroups((current) =>
                          current.includes(permission.id)
                            ? current.filter((group) => group !== permission.id)
                            : [...current, permission.id]
                        )
                      }
                    />
                    <span>
                      <strong>{permission.name}</strong>
                      <small>{permission.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="muted">
                Tokens and readings are encrypted and private to your Omnix
                account. Link your Google Health profile in the mobile app
                before connecting.
              </p>
              <div className="settings-actions">
                <button
                  className="primary"
                  disabled={busy || !groups.length}
                  onClick={connect}
                >
                  <Link2 size={16} />
                  {busy
                    ? "Connecting…"
                    : state.data.connected
                      ? "Update permissions"
                      : "Connect Google Health"}
                </button>
                {state.data?.connected && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={disconnect}
                  >
                    <Unplug size={16} />
                    Disconnect
                  </button>
                )}
              </div>
            </>
          ) : (
            !state.data?.can_configure && (
              <p className="muted">
                An administrator must configure the Google app first.
              </p>
            )
          )}
          {state.data?.error && <p className="notice">{state.data.error}</p>}
        </>
      )}
      {message && (
        <p role="status" className="health-inline-status">
          {message}
        </p>
      )}
    </section>
  );
}
