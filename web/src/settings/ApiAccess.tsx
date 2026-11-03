import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qc } from "../lib/api";
import CopyField from "../components/CopyField";
import Select from "../components/Select";
import "./ApiAccess.css";

type Token = {
  id: string;
  name: string;
  prefix: string;
  permission: "read" | "write";
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export default function ApiAccess() {
  const query = useQuery<Token[]>({
    queryKey: ["api-tokens"],
    queryFn: () => api("/settings/api-tokens")
  });
  const [name, setName] = useState("");
  const [permission, setPermission] = useState("read");
  const [days, setDays] = useState("30");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "create" | "revoke" | null
  >(null);
  const busy = pendingAction !== null;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const active = query.data?.filter(
    (token) => !token.revoked_at && Date.parse(token.expires_at) > Date.now()
  ).length;
  const endpoint = window.location.origin + "/mcp";
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPendingAction("create");
    setError("");
    try {
      const result = await api("/settings/api-tokens", {
        method: "POST",
        body: JSON.stringify({
          name,
          permission,
          expires_in_days: Number(days)
        })
      });
      setSecret(result.token);
      setName("");
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPendingAction(null);
    }
  }
  async function revoke(token: Token) {
    setPendingAction("revoke");
    setError("");
    try {
      await api(`/settings/api-tokens/${token.id}`, { method: "DELETE" });
      setSecret("");
      setConfirmId(null);
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPendingAction(null);
    }
  }
  return (
    <div className="api-access">
      <header className="api-access-heading">
        <div>
          <span className="api-access-label">Personal access</span>
          <h2>API access</h2>
          <p>Connect your tools to your workspace.</p>
        </div>
        <span className="api-access-count">
          {active === undefined ? "—" : String(active).padStart(2, "0")} active
          tokens
        </span>
      </header>
      {error && (
        <p className="error api-access-error" role="alert">
          {error}
        </p>
      )}
      <div className="api-access-endpoint">
        <span className="api-access-label">Endpoint</span>
        <code>{endpoint}</code>
        <span className="api-access-label">Streamable HTTP</span>
      </div>
      <section
        className="api-access-section"
        aria-labelledby="api-create-heading"
      >
        <div className="api-access-section-heading">
          <h3 id="api-create-heading">
            {secret ? "Token ready" : "Create a token"}
          </h3>
          <p>
            {secret
              ? "Copy the connection URL now. It won’t be shown again."
              : "Access stays within your account. Read-only by default."}
          </p>
        </div>
        {secret ? (
          <div className="api-token-secret">
            <CopyField
              label="MCP connection URL"
              name="MCP connection URL"
              value={endpoint + "?accesstoken=" + encodeURIComponent(secret)}
            />
            <details className="api-token-value">
              <summary>Token value</summary>
              <CopyField label="API token" name="API token" value={secret} />
            </details>
            <button
              className="secondary"
              onClick={() => {
                setSecret("");
                setPermission("read");
                setDays("30");
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <form className="api-token-form" onSubmit={create}>
            <label>
              Name
              <input
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Desktop assistant"
                autoComplete="off"
              />
            </label>
            <div className="api-token-controls">
              <label>
                Access
                <Select
                  aria-label="Token access"
                  value={permission}
                  disabled={busy}
                  onChange={(e) => setPermission(e.target.value)}
                >
                  <option value="read">Read only</option>
                  <option value="write">Read & write</option>
                </Select>
              </label>
              <label>
                Expires after
                <Select
                  aria-label="Token expiry"
                  value={days}
                  disabled={busy}
                  onChange={(e) => setDays(e.target.value)}
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </Select>
              </label>
            </div>
            {permission === "write" && (
              <p className="api-access-note">
                Allows sending mail, editing content and deleting data.
              </p>
            )}
            <div className="api-token-form-footer">
              <button
                className="primary"
                type="submit"
                disabled={busy || !name.trim()}
              >
                {pendingAction === "create" ? "Creating…" : "Create token"}
              </button>
            </div>
          </form>
        )}
      </section>
      <section
        className="api-access-section"
        aria-labelledby="api-tokens-heading"
      >
        <div className="api-access-section-heading">
          <h3 id="api-tokens-heading">Your tokens</h3>
          <p>Revoking a token disconnects its clients immediately.</p>
        </div>
        {query.isPending ? (
          <p className="api-access-label" role="status">
            [ Loading tokens… ]
          </p>
        ) : query.error ? (
          <p className="error" role="alert">
            {query.error.message}
          </p>
        ) : !query.data?.length ? (
          <p className="api-access-empty">No tokens yet.</p>
        ) : (
          <ul className="api-token-list">
            {query.data.map((token) => {
              const state = token.revoked_at
                ? "revoked"
                : Date.parse(token.expires_at) <= Date.now()
                  ? "expired"
                  : "active";
              return (
                <li key={token.id}>
                  <div className="api-token-row-heading">
                    <div className="api-token-identity">
                      <strong>{token.name}</strong>
                      <span className="api-token-state" data-state={state}>
                        <i aria-hidden="true" />
                        {state}
                      </span>
                    </div>
                    {state === "active" &&
                      (confirmId === token.id ? (
                        <div
                          className="api-token-confirm"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setConfirmId(null);
                          }}
                        >
                          <button
                            className="secondary"
                            autoFocus
                            disabled={busy}
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="secondary api-token-destructive"
                            disabled={busy}
                            onClick={() => revoke(token)}
                          >
                            {pendingAction === "revoke"
                              ? "Revoking…"
                              : "Revoke token"}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="api-token-revoke"
                          disabled={busy}
                          aria-label={"Revoke " + token.name}
                          onClick={() => {
                            setConfirmId(token.id);
                            setError("");
                          }}
                        >
                          Revoke
                        </button>
                      ))}
                  </div>
                  <div className="api-token-metadata">
                    <code>{token.prefix}…</code>
                    <span className="api-token-permission">
                      {token.permission === "write"
                        ? "Read & write"
                        : "Read only"}
                    </span>
                    <span>
                      {token.revoked_at
                        ? "Revoked " +
                          new Date(token.revoked_at).toLocaleDateString()
                        : "Expires " +
                          new Date(token.expires_at).toLocaleDateString()}
                    </span>
                    <span>
                      {token.last_used_at
                        ? "Used " +
                          new Date(token.last_used_at).toLocaleString()
                        : "Never used"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
