import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
type Attempt = {
  id: string;
  address: string;
  to: string[];
  subject: string;
  status: string;
  receipt: string;
  date: string;
};
function Receipt({ raw }: { raw: string }) {
  try {
    const value = JSON.parse(raw);
    return value.refused?.length ? (
      <p className="error">Rejected recipients: {value.refused.join(", ")}</p>
    ) : null;
  } catch {
    return null;
  }
}
export default function Outbox() {
  const query = useQuery<Attempt[]>({
    queryKey: ["send-history"],
    queryFn: () => api("/email/send-attempts"),
    refetchInterval: 5000
  });
  return (
    <div className="page outbox-page">
      <div className="outbox-heading">
        <h1>Outbox</h1>
        <button
          className="icon-button"
          aria-label="Refresh send status"
          onClick={() => query.refetch()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      <div className="outbox-list">
        {query.isLoading ? (
          <div className="empty">Loading�</div>
        ) : !query.data?.length ? (
          <div className="empty">No messages sent yet.</div>
        ) : (
          query.data.map((a) => (
            <details className="send-record" key={a.id}>
              <summary>
                <div>
                  <strong>{a.subject || "(No subject)"}</strong>
                  <p>{a.to.join(", ")}</p>
                </div>
                <span className={"send-state state-" + a.status}>
                  {a.status.replaceAll("_", " ")}
                </span>
                <time>
                  {new Date(a.date).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </time>
              </summary>
              <div className="send-record-detail">
                <p>FROM / {a.address}</p>
                {a.status === "outcome_unknown" && (
                  <p className="error">
                    Check the provider’s Sent folder before resending. This
                    attempt will not retry automatically.
                  </p>
                )}
                {a.status === "accepted" && (
                  <p>Accepted by the mail server. Delivery is not confirmed.</p>
                )}
                <Receipt raw={a.receipt} />
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
