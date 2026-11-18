import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select";
import { api } from "../lib/api";
type Rule = {
  id: string;
  mailbox_id: string;
  sender: string;
  subject: string;
  action: "notify" | "mute";
};
type Preferences = {
  email: boolean;
  news: boolean;
  previews: boolean;
  email_default?: boolean;
  email_content?: string;
  email_rules?: Rule[];
};
export default function EmailNotificationRules({
  value,
  busy,
  onSave
}: {
  value: Preferences;
  busy: boolean;
  onSave: (next: Preferences) => Promise<void>;
}) {
  const accounts = useQuery<{ id: string; label: string; address: string }[]>({
    queryKey: ["connections"],
    queryFn: () => api("/connections")
  });
  const [rules, setRules] = useState<Rule[]>(value.email_rules ?? []);
  const [fallback, setFallback] = useState(value.email_default ?? true);
  const [content, setContent] = useState(value.email_content ?? "full");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setRules(value.email_rules ?? []);
      setFallback(value.email_default ?? true);
      setContent(value.email_content ?? "full");
    }
  }, [value, dirty]);
  function edit(next: Rule[]) {
    setRules(next);
    setDirty(true);
  }
  return (
    <fieldset className="email-notification-rules" disabled={busy}>
      <legend>Email rules</legend>
      <p className="muted">
        First matching rule wins. Sender accepts an email address or
        @domain.example. Leave a field empty to match any.
      </p>
      {rules.map((rule, index) => (
        <div className="email-notification-rule" key={rule.id}>
          <div className="section-title">
            <span className="eyebrow">
              RULE {String(index + 1).padStart(2, "0")}
            </span>
            <div className="settings-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`Move rule ${index + 1} up`}
                disabled={index === 0 || busy}
                onClick={() => {
                  const next = [...rules];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1]
                  ];
                  edit(next);
                }}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move rule ${index + 1} down`}
                disabled={index === rules.length - 1 || busy}
                onClick={() => {
                  const next = [...rules];
                  [next[index + 1], next[index]] = [
                    next[index],
                    next[index + 1]
                  ];
                  edit(next);
                }}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete rule ${index + 1}`}
                onClick={() => edit(rules.filter((r) => r.id !== rule.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <label>
            Mailbox
            <Select
              aria-label={`Mailbox for rule ${index + 1}`}
              value={rule.mailbox_id}
              onChange={(e) =>
                edit(
                  rules.map((r) =>
                    r.id === rule.id ? { ...r, mailbox_id: e.target.value } : r
                  )
                )
              }
            >
              <option value="">All mailboxes</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.address}
                </option>
              ))}
              {rule.mailbox_id &&
                !accounts.data?.some((a) => a.id === rule.mailbox_id) && (
                  <option value={rule.mailbox_id}>
                    Disconnected mailbox — choose another
                  </option>
                )}
            </Select>
          </label>
          <label>
            Sender
            <input
              aria-label={`Sender for rule ${index + 1}`}
              value={rule.sender}
              maxLength={254}
              placeholder="person@example.com or @example.com"
              onChange={(e) =>
                edit(
                  rules.map((r) =>
                    r.id === rule.id ? { ...r, sender: e.target.value } : r
                  )
                )
              }
            />
          </label>
          <label>
            Subject contains
            <input
              aria-label={`Subject for rule ${index + 1}`}
              value={rule.subject}
              maxLength={150}
              onChange={(e) =>
                edit(
                  rules.map((r) =>
                    r.id === rule.id ? { ...r, subject: e.target.value } : r
                  )
                )
              }
            />
          </label>
          <label>
            Action
            <Select
              aria-label={`Action for rule ${index + 1}`}
              value={rule.action}
              onChange={(e) =>
                edit(
                  rules.map((r) =>
                    r.id === rule.id
                      ? { ...r, action: e.target.value as Rule["action"] }
                      : r
                  )
                )
              }
            >
              <option value="notify">Notify</option>
              <option value="mute">Mute</option>
            </Select>
          </label>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={busy || rules.length >= 30}
        onClick={() =>
          edit([
            ...rules,
            {
              id: crypto.randomUUID(),
              mailbox_id: "",
              sender: "",
              subject: "",
              action: "notify"
            }
          ])
        }
      >
        <Plus size={16} /> Add email rule
      </button>
      <label>
        Other emails
        <Select
          aria-label="Unmatched emails"
          value={fallback ? "notify" : "mute"}
          onChange={(e) => {
            setFallback(e.target.value === "notify");
            setDirty(true);
          }}
        >
          <option value="notify">Notify</option>
          <option value="mute">Mute</option>
        </Select>
      </label>
      <label>
        Notification detail
        <Select
          aria-label="Email notification detail"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
        >
          <option value="subject">Subject and mailbox</option>
          <option value="sender_subject">Sender, subject and mailbox</option>
          <option value="full">
            Sender, subject, recipient and message preview
          </option>
        </Select>
      </label>
      <p className="muted">
        Lock-screen previews must be enabled to show these details. Muted emails
        still sync to your mailbox.
      </p>
      {accounts.error && (
        <p role="alert" className="error">
          Could not load mailboxes. Reload before adding a mailbox rule.
        </p>
      )}
      <button
        type="button"
        disabled={busy || !dirty}
        onClick={async () => {
          try {
            await onSave({
              ...value,
              email_rules: rules,
              email_default: fallback,
              email_content: content
            });
            setDirty(false);
          } catch {
            /* Parent displays the error; keep the draft. */
          }
        }}
      >
        Save email rules
      </button>
    </fieldset>
  );
}
