import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
export default function MobileApproval() {
  const [params] = useSearchParams();
  const id = params.get("request") || "";
  const [approved, setApproved] = useState(false),
    [callback, setCallback] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const query = useQuery<{ platform: string; approved: boolean }>({
    queryKey: ["mobile-request", id],
    queryFn: () => api("/mobile/requests/" + encodeURIComponent(id)),
    retry: false
  });
  async function approve() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ callback_url: string }>(
        "/mobile/requests/" + id + "/approve",
        { method: "POST" }
      );
      const target = new URL(result.callback_url);
      if (
        !["omnix:", "omnix-preview:"].includes(target.protocol) ||
        target.hostname !== "paired" ||
        target.searchParams.get("request") !== id
      )
        throw new Error("Invalid companion return link.");
      setCallback(result.callback_url);
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
        <h1>{approved ? "Return to Omnix." : "Connect your device."}</h1>
        {(error || query.error) && (
          <p className="error" role="alert">
            {error || query.error?.message}
          </p>
        )}
        {approved ? (
          <a className="primary" href={callback} rel="noreferrer">
            Return to Omnix app
          </a>
        ) : (
          query.data && (
            <>
              <p>
                Sign in to Omnix on your{" "}
                {query.data.platform === "ios"
                  ? "iPhone or iPad"
                  : "Android device"}
                .
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
