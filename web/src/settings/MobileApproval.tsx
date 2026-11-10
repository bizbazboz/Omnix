import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
export default function MobileApproval() {
  const [params] = useSearchParams();
  const id = params.get("request") || "";
  const [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const query = useQuery<{ code: string; platform: string; approved: boolean }>(
    {
      queryKey: ["mobile-request", id],
      queryFn: () => api("/mobile/requests/" + encodeURIComponent(id)),
      retry: false
    }
  );
  async function approve() {
    setBusy(true);
    setError("");
    try {
      await api("/mobile/requests/" + id + "/approve", { method: "POST" });
      setApproved(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <section className="settings-card">
        <span className="eyebrow">COMPANION / SIGN IN</span>
        <h1>{approved ? "Device approved." : "Connect your device."}</h1>
        {(error || query.error) && (
          <p className="error" role="alert">
            {error || query.error?.message}
          </p>
        )}
        {approved ? (
          <a className="primary" href="omnix://paired">
            Return to Omnix app
          </a>
        ) : (
          query.data && (
            <>
              <p>
                Check that this code matches the{" "}
                {query.data.platform === "ios"
                  ? "iPhone or iPad"
                  : "Android device"}{" "}
                you are connecting.
              </p>
              <p
                className="clock"
                style={{ fontSize: "clamp(36px, 8vw, 72px)", margin: "32px 0" }}
              >
                {query.data.code}
              </p>
              <button
                className="primary"
                disabled={busy || query.data.approved}
                onClick={() => void approve()}
              >
                {busy
                  ? "Connecting…"
                  : query.data.approved
                    ? "Already approved"
                    : "Connect this device"}
              </button>
              <p className="muted">
                Only approve a connection you started in your Omnix app.
              </p>
            </>
          )
        )}
      </section>
    </div>
  );
}
