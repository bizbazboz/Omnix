import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qc } from "../lib/api";
import Select from "../components/Select";
import { type Device, type Rule, initialCommand } from "../products/iot/api";
import ActionEditor from "../products/iot/ActionEditor";
import "../products/iot/iot.css";

const freshRule = (): Omit<Rule, "id"> => ({
  name: "",
  device_id: "",
  feed_id: "",
  title_contains: "",
  timing: "start",
  offset_minutes: 0,
  include_all_day: false,
  enabled: true,
  command: initialCommand()
});
export default function GoveeIntegration() {
  const registration = useQuery<{ configured: boolean }>({
    queryKey: ["govee-registration"],
    queryFn: () => api("/settings/govee")
  });
  const devices = useQuery<{ configured: boolean; items: Device[] }>({
    queryKey: ["iot-devices"],
    queryFn: () => api("/iot/devices")
  });
  const rules = useQuery<Rule[]>({
    queryKey: ["iot-rules"],
    queryFn: () => api("/iot/rules")
  });
  const feeds = useQuery<{ id: string; label: string }[]>({
    queryKey: ["calendar-feeds"],
    queryFn: () => api("/calendar/feeds")
  });
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [form, setForm] = useState(freshRule),
    [editing, setEditing] = useState("");
  async function run(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      await Promise.all(
        ["govee-registration", "iot-devices", "iot-rules"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] })
        )
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const selected = devices.data?.items.find((d) => d.id === form.device_id);
  return (
    <section className="settings-card govee-integration" id="govee">
      <h2>Govee</h2>
      <p className="muted">
        Connect curtain lights with a Govee Developer API key from Govee Home.
        Only controls and scenes exposed by your model are available.
      </p>
      {registration.error && (
        <p className="error">{registration.error.message}</p>
      )}
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("/settings/govee", "PUT", { api_key: key })) {
            setKey("");
            setMessage(
              "Key saved. Discover your devices next. Existing calendar rules are paused."
            );
          }
        }}
      >
        <label className="form-label">
          Govee API key
          <input
            type="password"
            autoComplete="new-password"
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              registration.data?.configured ? "Replace stored key" : "API key"
            }
          />
        </label>
        <div className="settings-actions">
          <button className="secondary" disabled={busy || !key.trim()}>
            Save key
          </button>
          {registration.data?.configured && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (await run("/iot/devices/discover", "POST"))
                  setMessage(
                    "Device discovery complete. Open IoT to control your lights."
                  );
              }}
            >
              Discover devices
            </button>
          )}
        </div>
        {registration.data?.configured && (
          <p className="muted">
            Replacing the key pauses existing rules until you re-enable them.
          </p>
        )}
      </form>
      {registration.data?.configured && (
        <details>
          <summary className="text-button">Disconnect Govee</summary>
          <p className="muted">
            Removes the stored key, calendar rules and their activity history.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (await run("/settings/govee", "DELETE")) {
                setEditing("");
                setForm(freshRule());
                setMessage("Govee disconnected.");
              }
            }}
          >
            Disconnect and remove rules
          </button>
        </details>
      )}
      <div className="iot-rule-list">
        <h3>Calendar rules</h3>
        <p className="muted">
          Use your existing iCal subscriptions. Rules fire within about 30
          seconds; missed actions older than two minutes are skipped. Stale
          calendars do not trigger lights.
        </p>
        {rules.error ? (
          <p className="error">{rules.error.message}</p>
        ) : (
          rules.data?.map((rule) => (
            <article className="iot-rule-row" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <small>
                  {rule.enabled ? "ACTIVE" : "PAUSED"} /{" "}
                  {feeds.data?.find((f) => f.id === rule.feed_id)?.label ||
                    "Calendar unavailable"}{" "}
                  / EVENT {rule.timing.toUpperCase()}
                </small>
              </div>
              <div className="iot-rule-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setForm(rule);
                    setEditing(rule.id);
                  }}
                >
                  Edit {rule.name}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run("/iot/rules/" + rule.id, "PUT", {
                      ...rule,
                      enabled: !rule.enabled
                    })
                  }
                >
                  {rule.enabled ? "Pause" : "Enable"}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => run("/iot/rules/" + rule.id, "DELETE")}
                >
                  Delete {rule.name}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      {!!devices.data?.items.length && !!feeds.data?.length ? (
        <form
          className="govee-rule-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                "/iot/rules" + (editing ? "/" + editing : ""),
                editing ? "PUT" : "POST",
                form
              )
            ) {
              setForm(freshRule());
              setEditing("");
              setMessage("Calendar rule saved. Only future triggers will run.");
            }
          }}
        >
          <h3>{editing ? "Edit calendar rule" : "New calendar rule"}</h3>
          <label className="form-label">
            Rule name
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div className="govee-rule-fields">
            <label className="form-label">
              Light
              <Select
                required
                value={form.device_id}
                onChange={(e) => {
                  const device = devices.data?.items.find(
                    (d) => d.id === e.target.value
                  );
                  setForm({
                    ...form,
                    device_id: e.target.value,
                    command: initialCommand(device)
                  });
                }}
              >
                <option value="">Choose a light</option>
                {devices.data?.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="form-label">
              Calendar
              <Select
                required
                value={form.feed_id}
                onChange={(e) => setForm({ ...form, feed_id: e.target.value })}
              >
                <option value="">Choose a calendar</option>
                {feeds.data?.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="form-label">
            Event title contains
            <input
              maxLength={200}
              value={form.title_contains}
              placeholder="All events if empty"
              onChange={(e) =>
                setForm({ ...form, title_contains: e.target.value })
              }
            />
          </label>
          <div className="govee-rule-fields">
            <label className="form-label">
              Trigger
              <Select
                value={form.timing}
                onChange={(e) =>
                  setForm({
                    ...form,
                    timing: e.target.value as "start" | "end"
                  })
                }
              >
                <option value="start">Event starts</option>
                <option value="end">Event ends</option>
              </Select>
            </label>
            <label className="form-label">
              Offset in minutes
              <input
                type="number"
                min={-120}
                max={120}
                step={1}
                required
                value={form.offset_minutes}
                onChange={(e) =>
                  setForm({ ...form, offset_minutes: Number(e.target.value) })
                }
              />
              <small>Negative runs before; positive runs after.</small>
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.include_all_day}
              onChange={(e) =>
                setForm({ ...form, include_all_day: e.target.checked })
              }
            />{" "}
            Include all-day events (at their calendar boundary)
          </label>
          <ActionEditor
            device={selected}
            value={form.command}
            onChange={(command) => setForm({ ...form, command })}
            disabled={busy}
          />
          <div className="settings-actions">
            <button
              className="primary"
              disabled={busy || !selected || !form.feed_id}
            >
              Save calendar rule
            </button>
            {editing && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing("");
                  setForm(freshRule());
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="muted">
          Discover a Govee light and connect a calendar to create a rule.
        </p>
      )}
      {message && (
        <p role="status" className="iot-feedback">
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
