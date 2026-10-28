import Select from "../../components/Select";
import { Loader2, NotebookPen, Send, X, Paperclip, Trash2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { api, qc, type Account, type Draft } from "../../lib/api";
import { useMailProfiles } from "./useMailProfiles";
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
  const closeRef = useRef(onClose);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (formRef.current?.querySelector(".select-popup:popover-open"))
          return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        formRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"
        ) || []
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0 &&
          element.getAttribute("aria-hidden") !== "true"
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
  const baseline = useRef(JSON.stringify(draft));
  const profiles = useMailProfiles(accounts);
  const identities = accounts
    .filter((a) => a.can_send)
    .flatMap((a) =>
      (
        profiles.find((p) => p.account.id === a.id)?.data?.identities || [
          { address: a.address, name: a.label, primary: true }
        ]
      ).map((i) => ({ ...i, mailbox: a.id, label: a.label }))
    );
  const [files, setFiles] = useState<
    Record<string, { name: string; size: number }>
  >({});
  const [uploading, setUploading] = useState(false);
  const removed = useRef<string[]>([]);
  useEffect(() => {
    Promise.all(
      (draft.attachments || []).map(async (id) => {
        const item = await api(
          "/email/mailboxes/" + draft.mailbox + "/uploads/" + id
        );
        setFiles((old) => ({ ...old, [id]: item }));
      })
    ).catch(() =>
      setError(
        "Some saved attachments are unavailable. Remove them before sending."
      )
    );
  }, []);
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
    return {
      ...data,
      from_address:
        data.from_address ||
        accounts.find((a) => a.id === data.mailbox)?.address ||
        "",
      to: split(recipients),
      cc: split(cc),
      bcc: split(bcc)
    };
  }
  closeRef.current = () => {
    if (busy || uploading) {
      setError("Wait for the current operation to finish.");
      return;
    }
    if (
      (JSON.stringify({
        ...data,
        to: split(recipients),
        cc: split(cc),
        bcc: split(bcc)
      }) !== baseline.current ||
        (!data.id &&
          (data.subject ||
            data.body.trim() ||
            recipients ||
            data.attachments?.length))) &&
      !window.confirm("Close without saving your changes?")
    )
      return;
    if (!attemptRef.current)
      for (const id of data.attachments || [])
        if (!draft.attachments?.includes(id))
          api("/email/mailboxes/" + data.mailbox + "/uploads/" + id, {
            method: "DELETE"
          }).catch(() => {});
    onClose();
  };
  async function cleanup() {
    for (const id of removed.current)
      await api("/email/mailboxes/" + data.mailbox + "/uploads/" + id, {
        method: "DELETE"
      }).catch(() => {});
    removed.current = [];
  }
  async function attach(items: FileList | null) {
    if (!items) return;
    setUploading(true);
    setError("");
    try {
      let count = data.attachments?.length || 0;
      let total = (data.attachments || []).reduce(
        (n, id) => n + (files[id]?.size || 0),
        0
      );
      for (const file of Array.from(items)) {
        if (
          count >= 10 ||
          file.size > 10 * 1024 * 1024 ||
          total + file.size > 20 * 1024 * 1024
        )
          throw new Error(
            "Use up to 10 attachments, 10 MiB per file and 20 MiB total."
          );
        const item = await api(
          "/email/mailboxes/" +
            data.mailbox +
            "/uploads?" +
            new URLSearchParams({ name: file.name }),
          {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream"
            },
            body: file
          }
        );
        setFiles((old) => ({ ...old, [item.id]: item }));
        setData((old) => ({
          ...old,
          attachments: [...(old.attachments || []), item.id]
        }));
        count++;
        total += file.size;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function discard() {
    if (!window.confirm("Discard this draft?")) return;
    try {
      if (data.id) await api("/email/drafts/" + data.id, { method: "DELETE" });
      removed.current.push(...(data.attachments || []));
      await cleanup();
      qc.invalidateQueries({ queryKey: ["drafts"] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
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
      baseline.current = JSON.stringify({
        ...data,
        ...saved,
        to: split(recipients),
        cc: split(cc),
        bcc: split(bcc)
      });
      await cleanup();
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
      removed.current.push(...(data.attachments || []));
      await cleanup();
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
      <form
        ref={formRef}
        className="composer"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Compose email"
      >
        <div className="modal-title">
          <div>
            <NotebookPen size={18} />
            <strong>{data.subject ? "Your message" : "New message"}</strong>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => closeRef.current()}
            aria-label="Close composer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="compose-field">
          <label htmlFor="from">From</label>
          <Select
            id="from"
            value={JSON.stringify([
              data.mailbox,
              data.from_address ||
                accounts.find((a) => a.id === data.mailbox)?.address ||
                ""
            ])}
            onChange={(e) => {
              const [mailbox, address] = JSON.parse(e.target.value);
              if (mailbox !== data.mailbox && data.attachments?.length) {
                setError("Remove attachments before switching accounts.");
                return;
              }
              setData({
                ...data,
                mailbox,
                from_address: address,
                reply_to_message:
                  mailbox === data.mailbox ? data.reply_to_message : ""
              });
              key.current = crypto.randomUUID();
            }}
            required
            disabled={!!attemptRef.current}
          >
            {identities.map((a) => (
              <option
                key={a.mailbox + a.address}
                value={JSON.stringify([a.mailbox, a.address])}
              >
                {a.label} &lt;{a.address}&gt;
              </option>
            ))}
          </Select>
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
                disabled={!!attemptRef.current}
                onChange={(e) => setCc(e.target.value)}
              />
            </div>
            <div className="compose-field">
              <label htmlFor="bcc">Bcc</label>
              <input
                id="bcc"
                value={bcc}
                disabled={!!attemptRef.current}
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
        {!!data.attachments?.length && (
          <div className="compose-attachments">
            {data.attachments.map((id) => (
              <div key={id}>
                <Paperclip size={14} />
                <span>
                  {files[id]?.name || "Attachment"}
                  <small>
                    {files[id] ? Math.ceil(files[id].size / 1024) + " KB" : ""}
                  </small>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={"Remove " + (files[id]?.name || "attachment")}
                  disabled={busy || uploading || !!attemptRef.current}
                  onClick={() => {
                    removed.current.push(id);
                    setData({
                      ...data,
                      attachments: data.attachments!.filter((a) => a !== id)
                    });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {profiles.some((p) => p.error) && (
          <p className="notice">
            Some sender aliases could not be loaded. Check the account
            connection.
          </p>
        )}
        {error && (
          <div role="alert" className="error compose-error">
            {error}
          </div>
        )}
        <div className="compose-footer">
          <button
            className="primary"
            type="submit"
            disabled={busy || uploading || !data.mailbox}
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
            disabled={busy || uploading || !!attemptRef.current}
          >
            Save draft
          </button>
          <label
            className={
              "attachment-picker " +
              (busy || uploading || !!attemptRef.current ? "disabled" : "")
            }
            title="Attach files"
          >
            <Paperclip size={18} />
            <span>{uploading ? "Uploading…" : "Attach"}</span>
            <input
              type="file"
              multiple
              aria-label="Attach files"
              disabled={busy || uploading || !!attemptRef.current}
              onChange={(e) => {
                attach(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="icon-button"
            title="Discard draft"
            aria-label="Discard draft"
            disabled={busy || uploading || !!attemptRef.current}
            onClick={discard}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
