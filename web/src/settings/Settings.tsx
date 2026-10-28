import Select from "../components/Select";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api, qc, type Account, type User } from "../lib/api";
import CopyField from "../components/CopyField";
import Authentication from "./Authentication";
import Connections from "./Connections";
import HealthIntegration from "./HealthIntegration";
import CalendarIntegration from "./CalendarIntegration";
import TimezoneSelect, { currentTimezone } from "./TimezoneSelect";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useStoredFlag } from "../lib/layout";

export function ZohoRegistration() {
  const query = useQuery({
    queryKey: ["zoho-registration"],
    queryFn: () => api("/settings/zoho")
  });
  const [form, setForm] = useState({
    client_id: "",
    client_secret: "",
    region: "eu"
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.data)
      setForm({
        client_id: query.data.client_id,
        region: query.data.region,
        client_secret: ""
      });
  }, [query.data]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/settings/zoho", {
        method: "PUT",
        body: JSON.stringify(form)
      });
      setForm({ ...form, client_secret: "" });
      await qc.invalidateQueries({ queryKey: ["zoho-registration"] });
      await qc.invalidateQueries({ queryKey: ["connectors"] });
      setMessage(
        "Registration saved. Connect an account to verify authorization."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (query.isLoading)
    return (
      <section className="settings-card" role="status">
        Loading registration…
      </section>
    );
  if (query.error) return <p className="error">{query.error.message}</p>;
  return (
    <section className="settings-card">
      <h2>Zoho registration</h2>
      <p className="muted">
        Create a Server-based Application in the Zoho API Console for your
        region.
      </p>
      <CopyField
        value={window.location.origin + "/api/v1/connections/zoho/callback"}
        name="Zoho callback URL"
      />
      <form onSubmit={save} className="settings-form">
        <label className="form-label">
          Data center
          <Select
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          >
            <option value="eu">Europe</option>
            <option value="us">United States</option>
            <option value="in">India</option>
            <option value="au">Australia</option>
          </Select>
        </label>
        <label className="form-label">
          Client ID
          <input
            required
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          />
        </label>
        <label className="form-label">
          Client secret
          <input
            type="password"
            autoComplete="new-password"
            value={form.client_secret}
            placeholder={
              query.data?.client_secret_configured
                ? "Saved · leave blank to keep"
                : "Required"
            }
            onChange={(e) =>
              setForm({ ...form, client_secret: e.target.value })
            }
          />
        </label>
        <div className="settings-actions">
          <button className="primary" disabled={busy}>
            Save registration
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !query.data?.configured}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                const r = await api("/settings/zoho/probe", { method: "POST" });
                setMessage(r.detail);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Test region
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function General({
  user,
  onSaved,
  onBusyChange
}: {
  user: User;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const workspace = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => api("/settings/workspace")
  });
  const [form, setForm] = useState<any>(null);
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.data)
      setForm({
        ...query.data,
        timezone: query.data.timezone || currentTimezone()
      });
  }, [query.data]);
  useEffect(() => {
    if (workspace.data) {
      setName(workspace.data.name);
      setHosts((workspace.data.private_mail_hosts || []).join("\n"));
    }
  }, [workspace.data]);
  if (query.error || workspace.error)
    return <p className="error">{(query.error || workspace.error)?.message}</p>;
  if (!form) return <p role="status">Loading settings…</p>;
  return (
    <form
      className="settings-card settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        setSaved(false);
        try {
          await api("/settings/preferences", {
            method: "PUT",
            body: JSON.stringify(form)
          });
          if (user.is_admin)
            await api("/settings/workspace", {
              method: "PUT",
              body: JSON.stringify({
                name,
                private_mail_hosts: hosts
                  .split(/[,\n]/)
                  .map((x) => x.trim())
                  .filter(Boolean)
              })
            });
          await qc.invalidateQueries({ queryKey: ["preferences"] });
          await qc.invalidateQueries({ queryKey: ["workspace-settings"] });
          setSaved(true);
          onSaved?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
          onBusyChange?.(false);
        }
      }}
    >
      {!onSaved && (
        <div className="settings-section-heading">
          <h2>General</h2>
        </div>
      )}
      <div className="general-fields">
        {user.is_admin && (
          <label className="form-label">
            Workspace name
            <input
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="form-label">
          Display name
          <input
            required
            maxLength={80}
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
        </label>
        <label className="form-label">
          Time zone
          <TimezoneSelect
            value={form.timezone}
            onChange={(timezone) => setForm({ ...form, timezone })}
          />
        </label>
        <label className="form-label">
          Clock
          <Select
            value={form.time_format}
            onChange={(e) => setForm({ ...form, time_format: e.target.value })}
          >
            <option value="24">24 hour</option>
            <option value="12">12 hour</option>
          </Select>
        </label>
      </div>
      {user.is_admin && !onSaved && (
        <details className="settings-advanced">
          <summary>Advanced · mail access</summary>
          <label className="form-label">
            Private mail hosts · optional
            <textarea
              rows={2}
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
            />
            <small>
              Exact hostnames allowed to connect to private IMAP/SMTP servers.
            </small>
          </label>
        </details>
      )}
      <div className="settings-save">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : onSaved ? "Save and continue" : "Save changes"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="settings-saved" role="status">
            Saved
          </p>
        )}
      </div>
    </form>
  );
}

function Pipelines() {
  const query = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api("/settings/pipelines"),
    refetchInterval: 10000
  });
  const [interval, setInterval] = useState(120),
    [enabled, setEnabled] = useState(true),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (query.data) {
      setInterval(query.data.configuration.sync_interval);
      setEnabled(query.data.configuration.sync_enabled);
    }
  }, [
    query.data?.configuration.sync_interval,
    query.data?.configuration.sync_enabled
  ]);
  async function action(path: string, body?: object) {
    try {
      await api(path, {
        method: body ? "PUT" : "POST",
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      setMessage(body ? "Saved" : "Queued");
      query.refetch();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="settings-card">
      <h2>Pipelines</h2>
      <p className="muted">
        Sync retries transient failures. Outbox submits only queued messages;
        uncertain sends require manual reconciliation.
      </p>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          action("/settings/pipelines", {
            sync_enabled: enabled,
            sync_interval: interval
          });
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Automatic mail sync
        </label>
        <label className="form-label">
          Sync interval · seconds
          <input
            type="number"
            min={60}
            max={86400}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
        </label>
        <button className="primary">Save schedule</button>
      </form>
      <div className="settings-actions">
        {["sync-dispatch", "outbox-dispatch", "recovery"].map((name) => (
          <button
            key={name}
            className="secondary"
            onClick={() => action("/settings/pipelines/" + name + "/run")}
          >
            Run {name.replaceAll("-", " ")}
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {query.error && <p className="error">{query.error.message}</p>}
      <h3>Recent executions</h3>
      <div className="settings-table">
        <table>
          <thead>
            <tr>
              <th>Pipeline</th>
              <th>Status</th>
              <th>Started</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.runs.map((r: any) => (
              <tr key={r.id}>
                <td>{r.pipeline}</td>
                <td>{r.status}</td>
                <td>{new Date(r.started_at).toLocaleString()}</td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.data?.runs.length && <p className="muted">No executions yet.</p>}
    </section>
  );
}

function System() {
  const query = useQuery({
    queryKey: ["system"],
    queryFn: () => api("/settings/system"),
    refetchInterval: 15000
  });
  return (
    <section className="settings-card">
      <h2>System & storage</h2>
      {query.error && <p className="error">{query.error.message}</p>}
      <dl className="system-grid">
        {Object.entries(query.data || {}).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>
              {typeof value === "boolean"
                ? value
                  ? "Ready"
                  : "Awaiting heartbeat"
                : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Back up the host data directory and database together before upgrades.
      </p>
    </section>
  );
}

function Administration({ user }: { user: User }) {
  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api("/settings/users")
  });
  const [error, setError] = useState("");
  return (
    <section className="settings-card">
      <h2>Administration</h2>
      <p className="muted">
        Users join through Pocket ID. Admission is controlled in Authentication
        and in your Pocket ID client.
      </p>
      {query.data?.map((u: any) => (
        <div className="user-setting" key={u.id}>
          <span>
            {u.name}
            <small>{u.email}</small>
          </span>
          <label>
            <input
              type="checkbox"
              disabled={u.id === user.id}
              checked={u.is_admin}
              onChange={async (e) => {
                try {
                  await api("/settings/users/" + u.id, {
                    method: "PATCH",
                    body: JSON.stringify({ is_admin: e.target.checked })
                  });
                  query.refetch();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />{" "}
            Administrator
          </label>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {query.error && <p className="error">{query.error.message}</p>}
    </section>
  );
}

function Sessions() {
  const query = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api("/settings/sessions")
  });
  const [message, setMessage] = useState("");
  return (
    <section className="settings-card">
      <h2>Sessions</h2>
      <p>{query.data?.length ?? "…"} active sessions</p>
      <button
        className="secondary"
        onClick={async () => {
          try {
            await api("/settings/sessions/revoke-others", { method: "POST" });
            query.refetch();
            setMessage("Other sessions signed out");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Sign out other sessions
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export default function Settings({
  user,
  accounts,
  notify
}: {
  user: User;
  accounts: Account[];
  notify: (s: string) => void;
}) {
  const location = useLocation();
  const [navHidden, setNavHidden] = useStoredFlag("omnix.settings.navHidden");
  const section = location.pathname.split("/")[3] || "general";
  useEffect(() => {
    const target = location.hash.slice(1);
    if (target)
      document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [location.pathname, location.hash]);
  const tabs = [
    ["general", "General"],
    ["connections", "Integrations"],
    ["security", "Sessions"],
    ...(user.is_admin
      ? [
          ["auth", "Authentication"],
          ["pipelines", "Pipelines"],
          ["system", "System & storage"],
          ["administration", "Administration"]
        ]
      : [])
  ];
  return (
    <div className="page settings-hub">
      <div className="settings-heading">
        <h1>Settings</h1>
        <button
          className="secondary"
          aria-expanded={!navHidden}
          onClick={() => setNavHidden(!navHidden)}
        >
          {navHidden ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}{" "}
          {navHidden ? "Show categories" : "Hide categories"}
        </button>
      </div>
      <div
        className={
          "settings-layout " + (navHidden ? "settings-nav-hidden" : "")
        }
      >
        {!navHidden && (
          <nav className="settings-tabs" aria-label="Settings categories">
            {tabs.map(([key, name]) => (
              <NavLink key={key} to={"/app/settings/" + key}>
                {name}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="settings-content">
          {section === "general" ? (
            <General user={user} />
          ) : section === "connections" ? (
            <>
              <nav className="integration-shortcuts" aria-label="Integrations">
                <NavLink to="/app/settings/connections#mail">Mail</NavLink>
                <NavLink to="/app/settings/connections#calendars">
                  Calendar
                </NavLink>
                <NavLink to="/app/settings/connections#google-health">
                  Health
                </NavLink>
              </nav>
              <div id="mail">
                {user.is_admin && <ZohoRegistration />}
                <Connections accounts={accounts} notify={notify} />
              </div>
              <CalendarIntegration />
              <HealthIntegration notify={notify} />
            </>
          ) : section === "security" ? (
            <Sessions />
          ) : user.is_admin && section === "auth" ? (
            <Authentication />
          ) : user.is_admin && section === "pipelines" ? (
            <Pipelines />
          ) : user.is_admin && section === "system" ? (
            <System />
          ) : user.is_admin && section === "administration" ? (
            <Administration user={user} />
          ) : (
            <p className="error">This settings category is unavailable.</p>
          )}
        </div>
      </div>
    </div>
  );
}
