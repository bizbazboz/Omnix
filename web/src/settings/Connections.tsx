import Select from "../components/Select";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Link2,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, qc, type Account } from "../lib/api";
export default function Connections({
  accounts,
  notify
}: {
  accounts: Account[];
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("zoho");
  const [region, setRegion] = useState("eu");
  const [form, setForm] = useState<Record<string, string>>({
    label: "",
    address: "",
    imap_host: "",
    imap_user: "",
    imap_password: "",
    smtp_host: "",
    smtp_user: "",
    smtp_password: "",
    smtp_port: "465"
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [params, setParams] = useSearchParams();
  const discovery = params.get("discovery");
  const [chosen, setChosen] = useState<string[]>([]);
  const catalog = useQuery({
    queryKey: ["connectors"],
    queryFn: () => api("/connectors")
  });
  const discovered = useQuery<{ id: string; address: string }[]>({
    queryKey: ["discovery", discovery],
    queryFn: () => api("/connections/zoho/discovery/" + discovery),
    enabled: !!discovery
  });
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "zoho") {
        const result = await api("/connections/zoho/authorize", {
          method: "POST",
          body: JSON.stringify({ region })
        });
        window.location.assign(result.url);
      } else {
        await api(
          editing
            ? "/connections/" + editing + "/protocol"
            : "/connections/protocol",
          {
            method: editing ? "PUT" : "POST",
            body: JSON.stringify({
              ...form,
              smtp_port: Number(form.smtp_port)
            })
          }
        );
        setForm({ ...form, imap_password: "", smtp_password: "" });
        setEditing("");
        await qc.invalidateQueries({ queryKey: ["accounts"] });
        notify("Account connected");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page settings-page">
      <h2>Mail accounts</h2>
      <div className="settings-grid">
        <section>
          <div className="section-title">
            <h3>Your accounts</h3>
            <span>{accounts.length} connected</span>
          </div>
          {accounts.map((a, i) => (
            <div key={a.id} className="connection-card">
              <div className={"account-symbol symbol-" + i}>
                <Mail size={21} />
              </div>
              <div className="connection-info">
                <h3>
                  {a.label}
                  <span className="provider-tag">
                    {a.provider.toUpperCase()}
                  </span>
                </h3>
                <p>{a.address}</p>
                <small>
                  <span
                    className={
                      "connection-dot " +
                      (a.status !== "ready" ? "degraded" : "")
                    }
                  />
                  {a.status === "ready" ? "Connected and ready" : a.status} ·{" "}
                  {a.can_read ? "Receive" : ""}
                  {a.can_read && a.can_send ? " + " : ""}
                  {a.can_send ? "Send" : ""}
                </small>
                {a.error && <p className="error">{a.error}</p>}
              </div>
              <button
                className="icon-button"
                title={"Test " + a.label}
                onClick={async () => {
                  try {
                    await api("/connections/" + a.id + "/test", {
                      method: "POST"
                    });
                    notify("Connection verified");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                  qc.invalidateQueries({ queryKey: ["accounts"] });
                }}
              >
                <Check size={16} />
              </button>
              <button
                className="icon-button"
                title={"Reconnect " + a.label}
                onClick={async () => {
                  if (a.provider === "zoho") {
                    try {
                      const r = await api("/connections/zoho/authorize", {
                        method: "POST",
                        body: JSON.stringify({
                          region: (a as any).region || "eu"
                        })
                      });
                      window.location.assign(r.url);
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  } else {
                    setEditing(a.id);
                    setTab("imap");
                    setForm({
                      ...form,
                      label: a.label,
                      address: a.address,
                      imap_password: "",
                      smtp_password: ""
                    });
                    document
                      .querySelector(".connect-panel")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
              >
                <RefreshCw size={16} />
              </button>
              <button
                className="icon-button"
                title={"Rename " + a.label}
                onClick={async () => {
                  const label = window.prompt("Account label", a.label);
                  if (!label) return;
                  try {
                    await api("/connections/" + a.id, {
                      method: "PATCH",
                      body: JSON.stringify({ label })
                    });
                    qc.invalidateQueries({ queryKey: ["accounts"] });
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <NotebookPen size={16} />
              </button>
              <button
                className="icon-button"
                title={"Disconnect " + a.label}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Disconnect " +
                        a.address +
                        "? Local access and background jobs will stop."
                    )
                  )
                    return;
                  try {
                    const result = await api("/connections/" + a.id, {
                      method: "DELETE"
                    });
                    qc.invalidateQueries({ queryKey: ["accounts"] });
                    notify(
                      result.provider_revocation === "not_applicable"
                        ? "Account disconnected."
                        : result.provider_revocation
                    );
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div className="privacy-note">
            <Link2 size={18} />
            <div>
              <p>
                Connections belong to your account. Other workspace members
                cannot see your mail or credentials.
              </p>
            </div>
          </div>
        </section>
        <section className="connect-panel">
          <div className="card-icon">
            <Plus size={22} />
          </div>
          <h2>{editing ? "Update account" : "Add account"}</h2>
          {editing && (
            <button className="secondary" onClick={() => setEditing("")}>
              Cancel update
            </button>
          )}
          {discovery ? (
            <>
              <h3>Select your Zoho mailboxes</h3>
              {discovered.data?.map((a) => (
                <label className="discovery-choice" key={a.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(a.id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, a.id]
                          : chosen.filter((x) => x !== a.id)
                      )
                    }
                  />
                  {a.address}
                </label>
              ))}
              {discovered.error && (
                <p className="error">{discovered.error.message}</p>
              )}
              <button
                className="primary"
                disabled={!chosen.length}
                onClick={async () => {
                  try {
                    await api("/connections/zoho/discovery/" + discovery, {
                      method: "POST",
                      body: JSON.stringify({ account_ids: chosen })
                    });
                    setParams({});
                    qc.invalidateQueries({ queryKey: ["accounts"] });
                    notify("Mailboxes enabled");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Enable selected mailboxes <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <div className="connector-tabs">
                <button
                  className={tab === "zoho" ? "active" : ""}
                  onClick={() => setTab("zoho")}
                >
                  Zoho Mail
                </button>
                <button
                  className={tab === "imap" ? "active" : ""}
                  onClick={() => setTab("imap")}
                >
                  IMAP / SMTP
                </button>
              </div>
              <form onSubmit={connect}>
                {tab === "zoho" ? (
                  <>
                    <div className="zoho-mark">
                      <span>Z</span>
                      <span>O</span>
                      <span>H</span>
                      <span>O</span>
                    </div>
                    <p className="small-copy">
                      Connect securely with your Zoho account. You choose which
                      mailboxes to bring in.
                    </p>
                    <label className="form-label">
                      Account data center
                      <Select
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                      >
                        <option value="eu">Europe · zoho.eu</option>
                        <option value="us">United States · zoho.com</option>
                        <option value="in">India · zoho.in</option>
                        <option value="au">Australia · zoho.com.au</option>
                      </Select>
                    </label>
                    {catalog.data?.find((x: any) => x.id === "zoho")
                      ?.configured === false && (
                      <div className="notice">
                        Ask an administrator to configure Zoho registration in
                        Integrations, or connect an IMAP/SMTP account.
                      </div>
                    )}
                    <button
                      className="primary full-width"
                      disabled={
                        busy ||
                        catalog.data?.find((x: any) => x.id === "zoho")
                          ?.configured === false
                      }
                    >
                      Connect Zoho <ArrowUpRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <p className="small-copy">
                      Use an app password and a public mail server with verified
                      TLS. Leave either transport blank for read-only or
                      send-only access.
                    </p>
                    {[
                      ["label", "Account label", "text"],
                      ["address", "Email address", "email"],
                      ["imap_host", "Incoming host · IMAP 993", "text"],
                      ["imap_user", "IMAP username", "text"],
                      ["imap_password", "IMAP app password", "password"],
                      ["smtp_host", "Outgoing SMTP host", "text"],
                      ["smtp_user", "SMTP username · same as email", "text"],
                      ["smtp_password", "SMTP app password", "password"]
                    ].map(([key, label, type]) => (
                      <label className="form-label" key={key}>
                        {label}
                        <input
                          type={type}
                          value={form[key]}
                          onChange={(e) =>
                            setForm({ ...form, [key]: e.target.value })
                          }
                          required={["label", "address"].includes(key)}
                          autoComplete={
                            type === "password" ? "new-password" : "off"
                          }
                        />
                      </label>
                    ))}
                    <label className="form-label">
                      SMTP transport
                      <Select
                        value={form.smtp_port}
                        onChange={(e) =>
                          setForm({ ...form, smtp_port: e.target.value })
                        }
                      >
                        <option value="465">465 · Implicit TLS</option>
                        <option value="587">587 · Required STARTTLS</option>
                      </Select>
                    </label>
                    <button className="primary full-width" disabled={busy}>
                      {busy ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Link2 size={16} />
                      )}{" "}
                      Test & connect
                    </button>
                    <small className="secure-caption">
                      No test email is sent.
                    </small>
                  </>
                )}
              </form>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
