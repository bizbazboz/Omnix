import { Loader2, NotebookPen, Send, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { api, qc, type Account, type Draft } from "../../lib/api";
export default function Composer({
  draft,
  accounts,
  onClose,
  notify
}: {
  draft: Draft;
  accounts: Account[];
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        formRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"
        ) || []
      );
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      previous?.focus();
    };
  }, []);
  const [data, setData] = useState<Draft>(draft);
  const [recipients, setRecipients] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [bcc, setBcc] = useState(draft.bcc.join(", "));
  const [extras, setExtras] = useState(!!(cc || bcc));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const key = useRef(crypto.randomUUID());
  const attemptRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const split = (x: string) =>
    x
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  function payload() {
    return { ...data, to: split(recipients), cc: split(cc), bcc: split(bcc) };
  }
  async function save() {
    setError("");
    setBusy(true);
    try {
      const saved = await api(
        data.id ? "/email/drafts/" + data.id : "/email/drafts",
        { method: data.id ? "PATCH" : "POST", body: JSON.stringify(payload()) }
      );
      setData({ ...data, ...saved });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      notify("Draft saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function poll(id: string) {
    const a = await api("/email/send-attempts/" + id);
    setStatus(a.status);
    if (a.status === "accepted") {
      let receipt: any = {};
      try {
        receipt = JSON.parse(a.receipt);
      } catch {}
      notify(
        receipt.refused?.length
          ? "Partially accepted. Refused: " + receipt.refused.join(", ")
          : "Accepted by the provider. Delivery is not confirmed."
      );
      if (data.id) await api("/email/drafts/" + data.id, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      onClose();
    } else if (["failed", "outcome_unknown"].includes(a.status)) {
      setError(
        a.status === "outcome_unknown"
          ? "Submission outcome unknown. Check the provider Sent folder before an explicit new send. No automatic retry will occur."
          : "Sending failed. Reopen this message after checking the account."
      );
      setBusy(false);
    } else
      timer.current = setTimeout(
        () =>
          poll(id).catch((e) => {
            setError(
              "Status unavailable. Recheck this attempt; do not submit again. " +
                e.message
            );
            setBusy(false);
          }),
        1000
      );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (attemptRef.current) {
        await poll(attemptRef.current);
        return;
      }
      const attempt = await api("/email/mailboxes/" + data.mailbox + "/send", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: JSON.stringify(payload())
      });
      attemptRef.current = attempt.id;
      await poll(attempt.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="composer" onSubmit={submit} aria-label="Compose email">
        <div className="modal-title">
          <div>
            <NotebookPen size={18} />
            <strong>{data.subject ? "Your message" : "New message"}</strong>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close composer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="compose-field">
          <label htmlFor="from">From</label>
          <select
            id="from"
            value={data.mailbox}
            onChange={(e) => {
              setData({ ...data, mailbox: e.target.value });
              key.current = crypto.randomUUID();
            }}
            required
            disabled={!!attemptRef.current}
          >
            {accounts
              .filter((a) => a.can_send)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} &lt;{a.address}&gt;
                </option>
              ))}
          </select>
        </div>
        <div className="compose-field">
          <label htmlFor="to">To</label>
          <input
            id="to"
            autoFocus
            placeholder="name@example.com"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            disabled={!!attemptRef.current}
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setExtras(!extras)}
          >
            Cc / Bcc
          </button>
        </div>
        {extras && (
          <>
            <div className="compose-field">
              <label htmlFor="cc">Cc</label>
              <input
                id="cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
              />
            </div>
            <div className="compose-field">
              <label htmlFor="bcc">Bcc</label>
              <input
                id="bcc"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="compose-field">
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            placeholder="Subject"
            value={data.subject}
            onChange={(e) => setData({ ...data, subject: e.target.value })}
            maxLength={998}
            disabled={!!attemptRef.current}
          />
        </div>
        <textarea
          className="compose-body"
          aria-label="Message body"
          placeholder="Message"
          value={data.body}
          onChange={(e) => setData({ ...data, body: e.target.value })}
          disabled={!!attemptRef.current}
        />
        {error && (
          <div role="alert" className="error compose-error">
            {error}
          </div>
        )}
        <div className="compose-footer">
          <button
            className="primary"
            type="submit"
            disabled={busy || !data.mailbox}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}{" "}
            {busy
              ? status || "Sending…"
              : attemptRef.current
                ? "Recheck status"
                : "Send message"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={save}
            disabled={busy || !!attemptRef.current}
          >
            Save draft
          </button>
          <span></span>
        </div>
      </form>
    </div>
  );
}
