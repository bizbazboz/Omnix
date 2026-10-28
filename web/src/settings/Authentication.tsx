import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import CopyField from "../components/CopyField";
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
        {initial ? <h2>Connect Pocket ID.</h2> : <h1>Authentication</h1>}
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
            <CopyField
              value={window.location.origin + "/api/v1/auth/callback"}
              name="Pocket ID callback URL"
            />
          </div>
        </div>
      )}
      {!initial && (
        <CopyField
          value={
            status.data?.callback_url ||
            window.location.origin + "/api/v1/auth/callback"
          }
          name="Pocket ID callback URL"
        />
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
              Run on your Docker host:{" "}
              <code>
                docker compose exec api python -m app.operator setup-token
              </code>
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
    <div className="setup-page setup-welcome">
      <header>
        <Logo />
        <span className="setup-wordmark">omnix</span>
        <span className="setup-header-label">FIRST RUN / 01</span>
      </header>
      <main className="setup-shell">
        <aside className="setup-intro">
          <span className="eyebrow">WELCOME TO OMNIX</span>
          <h1>
            Your
            <br />
            workspace.
          </h1>
          <p>Start with your existing Pocket ID account.</p>
          <ol aria-label="First-run steps">
            <li aria-current="step">
              <span>01</span>Connect identity
            </li>
            <li>
              <span>02</span>Make it yours
            </li>
          </ol>
        </aside>
        <section className="setup-content" aria-label="Identity setup">
          {status.isLoading ? (
            <p className="muted" role="status">
              [CHECKING SETUP]
            </p>
          ) : status.error ? (
            <div role="alert">
              <p className="error">Could not load setup.</p>
              <button className="secondary" onClick={() => status.refetch()}>
                Retry
              </button>
            </div>
          ) : status.data?.setup_available === false ? (
            <div className="setup-locked">
              <h2>Setup is complete.</h2>
              <a className="primary" href="/api/v1/auth/login">
                Sign in <ArrowRight size={16} />
              </a>
            </div>
          ) : (
            form
          )}
        </section>
      </main>
      <footer className="setup-welcome-footer">
        <span>OMNIX / WORKSPACE</span>
        <span>IDENTITY VIA POCKET ID</span>
      </footer>
    </div>
  ) : (
    <div className="page auth-page">{form}</div>
  );
}
