import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qc } from "../lib/api";
import CopyField from "../components/CopyField";
import Select from "../components/Select";

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
  const [busy, setBusy] = useState(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }
  async function revoke(token: Token) {
    if (
      !window.confirm(
        `Revoke “${token.name}”? Connected clients will lose access immediately.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/settings/api-tokens/${token.id}`, { method: "DELETE" });
      setSecret("");
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="settings-card">
        <h2>API & MCP access</h2>
        <p className="muted">
          Connect an MCP client to your workspace. Each token can access only
          your data.
        </p>
        <CopyField
          label="Streamable HTTP endpoint"
          name="MCP endpoint"
          value={window.location.origin + "/mcp/"}
        />
        <p className="muted">
          Use the token as a Bearer token in your client's Authorization header.
          Tools are generated from the workspace OpenAPI specification.
        </p>
      </section>
      <section className="settings-card">
        <h2>Create token</h2>
        {secret ? (
          <div className="api-token-secret">
            <p>Copy this token now. It will not be shown again.</p>
            <CopyField label="API token" name="API token" value={secret} />
            <button className="secondary" onClick={() => setSecret("")}>
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
                onChange={(e) => setName(e.target.value)}
                placeholder="Desktop assistant"
                autoComplete="off"
              />
            </label>
            <label>
              Access
              <Select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
              >
                <option value="read">Read only</option>
                <option value="write">Read & write</option>
              </Select>
            </label>
            <label>
              Expires after
              <Select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </Select>
            </label>
            {permission === "write" && (
              <p className="muted">
                Read & write allows changes, including sending mail and deleting
                content.
              </p>
            )}
            <button disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create token"}
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>Your tokens</h2>
        {query.isPending ? (
          <p role="status">Loading tokens…</p>
        ) : query.error ? (
          <p className="error">{query.error.message}</p>
        ) : !query.data?.length ? (
          <p className="muted">No tokens created.</p>
        ) : (
          <ul className="api-token-list">
            {query.data.map((token) => {
              const inactive =
                !!token.revoked_at ||
                Date.parse(token.expires_at) <= Date.now();
              return (
                <li key={token.id}>
                  <div>
                    <strong>{token.name}</strong>
                    <span className="muted">
                      {token.prefix}… ·{" "}
                      {token.permission === "write"
                        ? "Read & write"
                        : "Read only"}
                    </span>
                    <small className="muted">
                      {token.revoked_at
                        ? "Revoked"
                        : `Expires ${new Date(token.expires_at).toLocaleDateString()}`}{" "}
                      ·{" "}
                      {token.last_used_at
                        ? `Last used ${new Date(token.last_used_at).toLocaleString()}`
                        : "Never used"}
                    </small>
                  </div>
                  {!inactive && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => revoke(token)}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
