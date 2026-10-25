import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/Brand";
import { api, qc } from "../lib/api";
export default function Authentication({
  initial = false
}: {
  initial?: boolean;
}) {
  const status = useQuery({
    queryKey: ["auth-settings", initial],
    queryFn: () => api(initial ? "/setup/status" : "/settings/auth")
  });
  const [token, setToken] = useState(""),
    [issuer, setIssuer] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [allowAll, setAllowAll] = useState(false),
    [subjects, setSubjects] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!initial && status.data) {
      setIssuer(status.data.issuer || "");
      setClientId(status.data.client_id || "");
      setAllowAll(status.data.allow_all || false);
      setSubjects((status.data.allowed_subjects || []).join("\n"));
    }
  }, [status.data, initial]);
  function payload() {
    return {
      public_origin: window.location.origin,
      issuer,
      client_id: clientId,
      client_secret: clientSecret,
      allow_all: allowAll,
      allowed_subjects: subjects
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean)
    };
  }
  async function submit(probe: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const path = initial
        ? "/setup/oidc" + (probe ? "/probe" : "")
        : "/settings/auth" + (probe ? "/probe" : "");
      const result = await api(path, {
        method: "POST",
        headers: initial ? { "X-Setup-Token": token } : {},
        body: JSON.stringify(payload())
      });
      if (probe)
        setMessage(
          "Discovery verified. Client credentials are checked during sign-in."
        );
      else if (initial) {
        setClientSecret("");
        setToken("");
        window.location.assign(result.next);
      } else {
        setClientSecret("");
        setMessage("Saved");
        qc.invalidateQueries({ queryKey: ["config"] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const originAllowed =
    window.location.protocol === "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const form = (
    <>
      <div className="setup-heading">
        <h1>{initial ? "Connect Pocket ID." : "Authentication"}</h1>
      </div>
      {initial && window.location.protocol !== "https:" && (
        <p className="notice">
          Open this page through your HTTPS tunnel before registering Pocket ID.
          The current browser URL determines the callback.
        </p>
      )}
      {initial && (
        <div className="setup-instructions">
          <div>
            <h3>Create a confidential OIDC client in Pocket ID.</h3>
            <p>
              Restrict its users or groups, then register this exact callback.
            </p>
            <div className="callback-value">
              <code>{window.location.origin + "/api/v1/auth/callback"}</code>
              <button
                className="icon-button"
                aria-label="Copy callback URL"
                onClick={() =>
                  navigator.clipboard.writeText(
                    window.location.origin + "/api/v1/auth/callback"
                  )
                }
              >
                <Copy size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="setup-form"
      >
        {initial && (
          <label className="form-label">
            Operator setup code
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="one-time-code"
              required
            />
            <small>
              Retrieve it from the app container: python -m app.operator
              setup-token
            </small>
          </label>
        )}
        <label className="form-label">
          Pocket ID URL
          <input
            type="url"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="https://id.yourdomain.com"
            required
          />
        </label>
        <label className="form-label">
          Client ID
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="form-label">
          Client secret
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="new-password"
            required={initial}
          />
          {!initial && <small>Leave blank to keep the current secret.</small>}
        </label>
        <label className="admission-choice">
          <input
            type="checkbox"
            checked={allowAll}
            onChange={(e) => setAllowAll(e.target.checked)}
          />
          <span>Admit users assigned to this Pocket ID client.</span>
        </label>
        {!allowAll && (
          <label className="form-label">
            Allowed subject IDs
            <textarea
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
              placeholder="One Pocket ID subject ID per line"
              rows={3}
              required
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="setup-status">
            <Check size={15} /> {message}
          </p>
        )}
        <div className="setup-actions">
          <button
            className="secondary"
            type="button"
            disabled={
              !originAllowed ||
              busy ||
              !issuer ||
              !clientId ||
              (initial && (!token || !clientSecret))
            }
            onClick={() => submit(true)}
          >
            {busy ? "Checking…" : "Test connection"}
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !originAllowed}
          >
            {initial ? "Save and sign in" : "Save settings"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
      {initial && (
        <p className="setup-caption">
          Settings are encrypted in the database. This setup locks after the
          paired browser completes its first sign-in.
        </p>
      )}
    </>
  );
  return initial ? (
    <div className="setup-page">
      <header>
        <Logo />
        <span>Omnix setup</span>
      </header>
      <main>
        {status.data?.setup_available === false ? (
          <div className="empty">
            <h1>Setup is locked.</h1>
            <a className="primary" href="/api/v1/auth/login">
              Sign in
            </a>
          </div>
        ) : (
          form
        )}
      </main>
    </div>
  ) : (
    <div className="page auth-page">{form}</div>
  );
}
