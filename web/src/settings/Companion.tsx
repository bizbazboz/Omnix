import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import CopyField from "../components/CopyField";
import { api } from "../lib/api";

export default function Companion({ isAdmin = false }: { isAdmin?: boolean }) {
  const query = useQuery<{ origin: string }>({
    queryKey: ["mobile-pairing"],
    queryFn: () => api("/mobile/pairing")
  });
  const [qr, setQr] = useState(""),
    [error, setError] = useState("");
  const origin = query.data?.origin || "";
  const link = "omnix://pair?origin=" + encodeURIComponent(origin);
  useEffect(() => {
    let active = true;
    setQr("");
    setError("");
    if (origin)
      void QRCode.toDataURL(link, {
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M"
      })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active) setError("Could not create the pairing code.");
        });
    return () => {
      active = false;
    };
  }, [origin, link]);
  return (
    <section className="settings-card">
      <span className="eyebrow">COMPANION / MOBILE</span>
      <h2>Take Omnix with you.</h2>
      <p className="muted">
        Scan this code in the Omnix app, then sign in with Pocket ID.
      </p>
      {(query.error || error) && (
        <p className="error" role="alert">
          {query.error?.message || error}
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      )}
      {qr && (
        <img
          src={qr}
          alt="Omnix companion pairing QR code"
          width="256"
          height="256"
          style={{ maxWidth: "100%", height: "auto" }}
        />
      )}
      {origin && (
        <CopyField
          label="Instance address"
          name="Instance address"
          value={origin}
        />
      )}
      <a
        href="https://github.com/bizbazboz/Omnix/releases"
        target="_blank"
        rel="noreferrer"
      >
        Download a companion build ↗
      </a>
      {isAdmin && <AndroidLinks origin={origin} />}
    </section>
  );
}

function AndroidLinks({ origin }: { origin: string }) {
  const query = useQuery<{ fingerprints: string[] }>({
    queryKey: ["android-links"],
    queryFn: () => api("/settings/android-links")
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await api("/settings/android-links", {
        method: "PUT",
        body: JSON.stringify({
          fingerprints: (draft ?? query.data?.fingerprints.join("\n") ?? "")
            .split(/\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        })
      });
      await query.refetch();
      setDraft(null);
      setMessage("Saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-group">
      <h3>Android App Links</h3>
      <p className="muted">
        Production links open in the signed Android app. Keep this public
        certificate fingerprint aligned with your release signing key. Other
        instances can still use QR pairing.
      </p>
      {origin && (
        <CopyField
          label="Website association"
          name="Android website association URL"
          value={origin + "/.well-known/assetlinks.json"}
        />
      )}
      <label>
        SHA-256 signing fingerprints
        <textarea
          aria-label="Android signing fingerprints"
          rows={4}
          spellCheck={false}
          value={draft ?? query.data?.fingerprints.join("\n") ?? ""}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        disabled={
          busy || query.isPending || Boolean(query.error) || draft === null
        }
        onClick={() => void save()}
      >
        Save fingerprints
      </button>
      {(message || query.error) && (
        <p role="status">{message || query.error?.message}</p>
      )}
    </div>
  );
}
