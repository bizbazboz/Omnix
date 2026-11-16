import { useState } from "react";
import { api, type Account } from "../lib/api";
import CopyField from "../components/CopyField";
import Select from "../components/Select";

export default function MailWebhooks({ accounts }: { accounts: Account[] }) {
  const zoho = accounts.filter(
    (a) => a.provider === "zoho" && a.status !== "disconnected"
  );
  const [id, setId] = useState(zoho[0]?.id || ""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!zoho.length) return null;
  return (
    <section className="settings-card">
      <h2>Instant Zoho sync</h2>
      <p className="muted">
        Connect an outgoing Mail webhook in Zoho’s Developer Space. Choose all
        incoming mail and Limited Data List. Omnix verifies the signature and
        fetches the email from your account.
      </p>
      <div className="settings-form">
        <label className="form-label">
          Mailbox
          <Select
            value={id || zoho[0].id}
            onChange={(e) => {
              setId(e.target.value);
              setUrl("");
            }}
          >
            {zoho.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label || a.address}
              </option>
            ))}
          </Select>
        </label>
        <div className="settings-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await api(
                  `/email/mailboxes/${encodeURIComponent(id || zoho[0].id)}/webhook`,
                  { method: "POST" }
                );
                setUrl(r.url);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {url ? "Replace webhook URL" : "Create webhook URL"}
          </button>
        </div>
        {url && (
          <>
            <CopyField name="Zoho outgoing webhook URL" value={url} />
            <p className="muted">
              Keep this URL private. Creating another invalidates the previous
              URL. Save it in Zoho now to complete the signed handshake.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}
