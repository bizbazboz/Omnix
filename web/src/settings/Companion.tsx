import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import CopyField from "../components/CopyField";
import { api } from "../lib/api";

export default function Companion() {
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
        href="https://github.com/bizbazboz/Omnix/actions/workflows/companion.yml"
        target="_blank"
        rel="noreferrer"
      >
        Download a companion build ↗
      </a>
    </section>
  );
}
