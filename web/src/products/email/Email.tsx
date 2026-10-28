import Select from "../../components/Select";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  SlidersHorizontal
} from "lucide-react";
import {
  Archive,
  Star,
  Mail,
  MailOpen,
  Trash2,
  ShieldAlert,
  Forward,
  Paperclip
} from "lucide-react";
import { useEffect, useRef, useState, useId } from "react";
import {
  useSearchParams,
  useLocation,
  useNavigate,
  NavLink
} from "react-router-dom";

import { Avatar, Logo } from "../../components/Brand";
import { api, qc, type Account, type Draft, type Message } from "../../lib/api";
import MailBody from "./MailBody";
import { useMailProfiles } from "./useMailProfiles";
import { useStoredWidth } from "../../lib/layout";
import ResizeHandle from "../../components/ResizeHandle";
export default function Email({
  accounts,
  onCompose,
  notify
}: {
  accounts: Account[];
  onCompose: (d: Draft) => void;
  notify: (s: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const folder =
    params.get("folder") || location.pathname.split("/")[3] || "inbox";
  const account = params.get("account") || "";
  function filterMailbox(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("account", value);
    else next.delete("account");
    next.delete("message");
    if (next.has("folder") && value !== account) {
      next.delete("folder");
      navigate("/app/email?" + next);
    } else setParams(next);
  }
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState(false);
  const [starred, setStarred] = useState(false);
  const filterId = useId();
  const [filterPosition, setFilterPosition] = useState({ left: 12, top: 120 });
  const [listWidth, setListWidth] = useStoredWidth(
    "omnix.mail.list.width",
    340,
    260,
    480
  );
  const [selected, setSelected] = useState<Message | null>(null);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const marked = useRef("");
  const profiles = useMailProfiles(accounts);
  const activeProfile = profiles.find(
    (p) => p.account.id === selected?.mailbox
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setCursor("");
      setHistory([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setSelected(null);
    setCursor("");
    setHistory([]);
  }, [folder, account, unread, starred]);
  const list = useQuery<{
    items: Message[];
    next_cursor: string | null;
    search_scope: string;
  }>({
    queryKey: ["messages", folder, account, query, unread, starred, cursor],
    queryFn: () =>
      api(
        "/email/messages?" +
          new URLSearchParams({
            folder,
            account,
            q: query,
            unread: String(unread),
            starred: String(folder === "starred" || starred),
            cursor
          })
      ),
    enabled: folder !== "drafts",
    refetchInterval: 15000
  });
  const drafts = useQuery<Draft[]>({
    queryKey: ["drafts"],
    queryFn: () => api("/email/drafts"),
    enabled: folder === "drafts"
  });
  const detail = useQuery<Message>({
    queryKey: ["message", selected?.id],
    queryFn: () =>
      api(
        "/email/mailboxes/" + selected!.mailbox + "/messages/" + selected!.id
      ),
    enabled: !!selected
  });
  useEffect(() => {
    const id = params.get("message");
    const match = list.data?.items.find((m) => m.id === id);
    if (match) setSelected(match);
  }, [params.get("message"), list.data]);
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all(
        accounts
          .filter((a) => a.can_read && (!account || a.id === account))
          .map((a) =>
            api("/email/mailboxes/" + a.id + "/sync", { method: "POST" })
          )
      );
      notify("Refresh queued");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector(".modal-backdrop, [popover]:popover-open")
      ) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            'input[aria-label="Search messages"]'
          )
          ?.focus();
        return;
      }
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        document.querySelector(".modal-backdrop, [popover]:popover-open")
      )
        return;
      if (e.key === "c") {
        e.preventDefault();
        onCompose({
          version: 1,
          mailbox: accounts.find((a) => a.can_send)?.id || "",
          to: [],
          cc: [],
          bcc: [],
          subject: "",
          body: ""
        });
      }
      if (e.key === "Escape") {
        setSelected(null);
        setParams((previous) => {
          const next = new URLSearchParams(previous);
          next.delete("message");
          return next;
        });
      }
      if (e.key === "j" || e.key === "k") {
        const items = list.data?.items || [];
        const index = items.findIndex((x) => x.id === selected?.id);
        const next =
          items[
            Math.max(
              0,
              Math.min(items.length - 1, index + (e.key === "j" ? 1 : -1))
            )
          ] || null;
        setSelected(next);
        if (next)
          setParams((previous) => {
            const params = new URLSearchParams(previous);
            params.set("message", next.id);
            return params;
          });
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [list.data, selected, accounts]);
  const title =
    folder === "inbox"
      ? "Inbox"
      : folder === "all"
        ? "All mail"
        : folder.startsWith("folder:")
          ? profiles
              .flatMap((p) => p.data?.folders || [])
              .find((f) => f.key === folder)?.name || "Folder"
          : folder[0].toUpperCase() + folder.slice(1);
  const current = detail.data || selected;
  const canWrite = !!current && !activeProfile?.data?.needs_reconnect;
  async function change(action: string, destination = "", message = current) {
    if (!message) return;
    setActionBusy(true);
    try {
      await api(
        "/email/mailboxes/" +
          message.mailbox +
          "/messages/" +
          message.id +
          "/action",
        { method: "POST", body: JSON.stringify({ action, destination }) }
      );
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["message", message.id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      if (["trash", "archive", "spam", "move"].includes(action)) {
        setSelected(null);
        setParams((previous) => {
          const next = new URLSearchParams(previous);
          next.delete("message");
          return next;
        });
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  useEffect(() => {
    if (
      detail.data?.unread &&
      canWrite &&
      activeProfile?.data &&
      marked.current !== detail.data.id
    ) {
      marked.current = detail.data.id;
      change("read");
    }
  }, [detail.data?.id, canWrite, activeProfile?.data]);
  const addresses = (value: string): string[] =>
    Array.from(
      value.match(
        /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
      ) || []
    );
  async function reply(all = false, forward = false) {
    if (!current) return;
    const identities = activeProfile?.data?.identities.map(
      (i) => i.address
    ) || [accounts.find((a) => a.id === current.mailbox)?.address || ""];
    const own = new Set(
      profiles
        .flatMap((p) => [
          p.account.address,
          ...(p.data?.identities.map((i) => i.address) || [])
        ])
        .map((a) => a.toLowerCase())
    );
    const from =
      addresses(current.recipients).find((a) =>
        identities.some((i) => i.toLowerCase() === a.toLowerCase())
      ) || identities[0];
    let to = addresses(current.reply_to || current.sender);
    if (to.every((a) => own.has(a.toLowerCase())))
      to = addresses(current.recipients).filter(
        (a) => !own.has(a.toLowerCase())
      );
    const cc = all
      ? [
          ...new Set([
            ...addresses(current.recipients),
            ...addresses(current.cc || "")
          ])
        ].filter(
          (a) =>
            !own.has(a.toLowerCase()) &&
            !to.some((t) => t.toLowerCase() === a.toLowerCase())
        )
      : [];
    const attachments: string[] = [];
    if (forward) {
      setActionBusy(true);
      try {
        for (const item of current.attachments?.filter((a) => !a.cid) || []) {
          const response = await fetch(
            "/api/v1/email/mailboxes/" +
              current.mailbox +
              "/messages/" +
              current.id +
              "/attachments/" +
              encodeURIComponent(item.id)
          );
          if (!response.ok)
            throw new Error("Could not copy forwarded attachments.");
          const blob = await response.blob();
          const saved = await api(
            "/email/mailboxes/" +
              current.mailbox +
              "/uploads?" +
              new URLSearchParams({ name: item.name }),
            {
              method: "POST",
              headers: {
                "Content-Type": blob.type || "application/octet-stream"
              },
              body: blob
            }
          );
          attachments.push(saved.id);
        }
      } catch (e) {
        for (const id of attachments)
          await api("/email/mailboxes/" + current.mailbox + "/uploads/" + id, {
            method: "DELETE"
          }).catch(() => {});
        notify((e as Error).message);
        return;
      } finally {
        setActionBusy(false);
      }
    }
    onCompose({
      version: 1,
      mailbox: current.mailbox,
      from_address: from,
      to: forward ? [] : to,
      cc,
      bcc: [],
      subject: /^(re|fwd):/i.test(current.subject)
        ? current.subject
        : (forward ? "Fwd: " : "Re: ") + current.subject,
      body:
        "\n\n" +
        (forward ? "---------- Forwarded message ----------\n" : "On ") +
        new Date(current.date).toLocaleString() +
        ", " +
        current.sender +
        " wrote:\n" +
        (current.body || current.preview)
          .split("\n")
          .map((line) => (forward ? line : "> " + line))
          .join("\n"),
      attachments,
      reply_to_message: forward ? "" : current.id
    });
  }
  async function older() {
    if (!account) return;
    try {
      await api(
        "/email/mailboxes/" +
          account +
          "/older?" +
          new URLSearchParams({ folder }),
        { method: "POST" }
      );
      notify("Older messages queued for sync.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <div className="email-page">
      <div className="email-heading">
        <div>
          <h1>{title}</h1>
        </div>
        <button
          className="secondary refresh"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh
        </button>
      </div>
      <div className="email-content">
        <section
          style={
            { "--mail-list-width": listWidth + "px" } as React.CSSProperties
          }
          className={"inbox-panel " + (selected ? "has-selection" : "")}
          aria-label="Message list"
        >
          <div className="inbox-toolbar">
            <div className="view-tabs">
              <button
                className={!unread ? "active" : ""}
                onClick={() => setUnread(false)}
              >
                All messages
              </button>
              <button
                className={unread ? "active" : ""}
                onClick={() => setUnread(true)}
              >
                Unread{" "}
                <span>
                  {list.data?.items.filter((x) => x.unread).length || 0}
                </span>
              </button>
            </div>
            <button
              className="icon-button"
              title="Filter mail"
              aria-label="Filter mail"
              popoverTarget={filterId}
              data-active={!!account || unread || starred}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setFilterPosition({
                  left: Math.max(
                    12,
                    Math.min(rect.right - 300, window.innerWidth - 312)
                  ),
                  top: Math.max(
                    12,
                    Math.min(rect.bottom + 8, window.innerHeight - 350)
                  )
                });
              }}
            >
              <SlidersHorizontal size={16} />
            </button>
            <div
              id={filterId}
              popover="auto"
              className="mail-filter-panel"
              style={filterPosition}
            >
              <h3>Filter mail</h3>
              <label>
                Mailbox
                <Select
                  aria-label="Filter by mailbox"
                  value={account}
                  onChange={(event) => filterMailbox(event.target.value)}
                >
                  <option value="">All accounts</option>
                  {accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.label} · {a.address}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={unread}
                  onChange={(event) => setUnread(event.target.checked)}
                />
                Unread only
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={folder === "starred" || starred}
                  disabled={folder === "starred"}
                  onChange={(event) => setStarred(event.target.checked)}
                />
                Starred only
              </label>
              <button
                className="text-button"
                onClick={() => {
                  setUnread(false);
                  setStarred(false);
                  filterMailbox("");
                }}
              >
                Reset filters
              </button>
            </div>
          </div>
          <div className="search-row">
            <Search size={16} />
            <input
              aria-label="Search messages"
              placeholder="Search messages"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="list-label">
            <span>{folder === "drafts" ? "DRAFTS" : "MESSAGES"}</span>
            <span>
              {folder === "drafts"
                ? drafts.data?.length || 0
                : list.data?.items.length || 0}{" "}
              {folder === "drafts" ? "drafts" : "messages"}
            </span>
          </div>
          <div className="message-list">
            {list.isLoading && folder !== "drafts" && (
              <div className="empty">
                <Loader2 className="spin" /> Loading�
              </div>
            )}
            {list.error && (
              <div className="empty error">
                {list.error.message}
                <button className="secondary" onClick={() => list.refetch()}>
                  Try again
                </button>
              </div>
            )}
            {folder === "drafts"
              ? drafts.data?.map((d) => (
                  <button
                    className="message-row draft-row"
                    key={d.id}
                    onClick={() => onCompose(d)}
                  >
                    <Avatar name="Draft" />
                    <div className="message-copy">
                      <strong>{d.subject || "Untitled draft"}</strong>
                      <p>{d.to.join(", ") || "No recipients yet"}</p>
                      <span className="message-preview">{d.body || ""}</span>
                    </div>
                    <FileText size={16} />
                  </button>
                ))
              : list.data?.items.map((m, i) => (
                  <div
                    key={m.id}
                    className={
                      "message-row " +
                      (selected?.id === m.id ? "selected " : "") +
                      (m.unread ? "unread" : "")
                    }
                  >
                    <button
                      className="row-open"
                      onClick={() => {
                        setParams((previous) => {
                          const next = new URLSearchParams(previous);
                          next.set("message", m.id);
                          return next;
                        });
                        setSelected(m);
                      }}
                      aria-label={"Read " + m.subject}
                    >
                      <Avatar name={m.sender_name || m.sender} color={i % 6} />
                      <div className="message-copy">
                        <div className="message-top">
                          <strong>{m.sender_name || m.sender}</strong>
                          <time>
                            {new Date(m.date).toDateString() ===
                            new Date().toDateString()
                              ? new Date(m.date).toLocaleTimeString("en-GB", {
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })
                              : new Date(m.date).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short"
                                })}
                          </time>
                        </div>
                        <div className="message-subject">{m.subject}</div>
                        <div className="message-preview">{m.preview}</div>
                        <div className="message-meta">
                          <span
                            className={
                              "account-dot dot-" +
                              Math.max(
                                0,
                                accounts.findIndex((a) => a.id === m.mailbox)
                              )
                            }
                          />
                          {m.account}
                          {m.unread && <span className="unread-indicator" />}
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
            {((folder === "drafts" && !drafts.data?.length) ||
              (folder !== "drafts" &&
                !list.isLoading &&
                !list.data?.items.length &&
                !list.error)) && (
              <div className="empty">
                <Inbox size={32} />
                <h3>No messages</h3>
                <p>
                  {search
                    ? "No messages match your search."
                    : folder === "drafts"
                      ? "No drafts"
                      : ""}
                </p>
              </div>
            )}
          </div>
          <footer className="list-footer">
            <span>{list.data?.search_scope || "DRAFTS"}</span>
            {account &&
              !["drafts", "all", "starred"].includes(folder) &&
              !list.data?.next_cursor && (
                <button className="text-button" onClick={older}>
                  Load older
                </button>
              )}
            <div>
              <button
                className="icon-button"
                disabled={!history.length}
                onClick={() => {
                  setCursor(history[history.length - 1]);
                  setHistory(history.slice(0, -1));
                }}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                disabled={!list.data?.next_cursor}
                onClick={() => {
                  setHistory([...history, cursor]);
                  setCursor(list.data!.next_cursor!);
                }}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </footer>
          <ResizeHandle
            label="Resize message list"
            value={listWidth}
            min={260}
            max={480}
            defaultValue={340}
            onChange={setListWidth}
          />
        </section>
        <section
          className={"reader " + (current ? "reader-open" : "")}
          aria-label="Reading pane"
        >
          {current ? (
            <>
              <div className="reader-toolbar">
                <button
                  className="icon-button back-reader"
                  title="Back to messages"
                  onClick={() => {
                    setSelected(null);
                    setParams((previous) => {
                      const next = new URLSearchParams(previous);
                      next.delete("message");
                      return next;
                    });
                  }}
                >
                  <ArrowLeft size={18} />
                </button>

                <div className="reader-mail-actions">
                  <button
                    className="icon-button"
                    aria-label={
                      current.starred ? "Unstar message" : "Star message"
                    }
                    disabled={actionBusy || !canWrite}
                    onClick={() => change(current.starred ? "unstar" : "star")}
                  >
                    <Star
                      size={17}
                      fill={current.starred ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={
                      current.unread ? "Mark as read" : "Mark as unread"
                    }
                    disabled={actionBusy || !canWrite}
                    onClick={() => change(current.unread ? "read" : "unread")}
                  >
                    {current.unread ? (
                      <MailOpen size={17} />
                    ) : (
                      <Mail size={17} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Archive message"
                    disabled={actionBusy || !canWrite}
                    onClick={() => change("archive")}
                  >
                    <Archive size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Mark as spam"
                    disabled={actionBusy || !canWrite}
                    onClick={() => change("spam")}
                  >
                    <ShieldAlert size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Move to trash"
                    disabled={
                      actionBusy || !canWrite || current.folder === "trash"
                    }
                    onClick={() => change("trash")}
                  >
                    <Trash2 size={17} />
                  </button>
                  <Select
                    aria-label="Move message"
                    value=""
                    disabled={actionBusy || !canWrite}
                    onChange={(e) => change("move", e.target.value)}
                  >
                    <option value="">Move to…</option>
                    {activeProfile?.data?.folders
                      .filter((f) => f.id && f.kind !== "provider-drafts")
                      .map((f) => (
                        <option key={f.id} value={f.key}>
                          {f.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <span className="reader-account">
                  <span
                    className={
                      "account-dot dot-" +
                      Math.max(
                        0,
                        accounts.findIndex((a) => a.id === current.mailbox)
                      )
                    }
                  />
                  {current.account}
                </span>
              </div>
              <div className="reader-body">
                <h2>{current.subject}</h2>
                <div className="sender-block">
                  <Avatar name={current.sender_name || current.sender} />
                  <div>
                    <strong>{current.sender_name || current.sender}</strong>
                    <small>{current.sender}</small>
                    <small>to {current.recipients}</small>
                    {addresses(current.cc || "").length > 0 && (
                      <small>cc {current.cc!.trim()}</small>
                    )}
                  </div>
                  <time>
                    {new Date(current.date).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>
                </div>
                {activeProfile?.data?.needs_reconnect && (
                  <p className="notice">
                    Reconnect Zoho to enable read, star and folder actions.{" "}
                    <NavLink to="/app/settings/connections">
                      Open integrations
                    </NavLink>
                  </p>
                )}
                {detail.error && (
                  <div className="notice" role="alert">
                    {detail.error.message}{" "}
                    <button
                      className="text-button"
                      onClick={() => detail.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {detail.isLoading ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <MailBody
                    key={current.id}
                    html={current.html || ""}
                    body={current.body || current.preview}
                  />
                )}
                {current.attachment_notice && (
                  <p className="notice">{current.attachment_notice}</p>
                )}
                {!!current.attachments?.length && (
                  <div className="reader-attachments">
                    {current.attachments
                      .filter((a) => !a.cid)
                      .map((a) => (
                        <a
                          key={a.id}
                          href={
                            "/api/v1/email/mailboxes/" +
                            current.mailbox +
                            "/messages/" +
                            current.id +
                            "/attachments/" +
                            encodeURIComponent(a.id)
                          }
                        >
                          <Paperclip size={15} />
                          <span>
                            {a.name}
                            <small>{Math.ceil(a.size / 1024)} KB</small>
                          </span>
                        </a>
                      ))}
                  </div>
                )}
                <div className="reply-actions">
                  <button
                    className="secondary"
                    disabled={
                      actionBusy ||
                      !accounts.find((a) => a.id === current.mailbox)?.can_send
                    }
                    onClick={() => reply()}
                  >
                    <Reply size={16} />
                    Reply
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      actionBusy ||
                      !accounts.find((a) => a.id === current.mailbox)?.can_send
                    }
                    onClick={() => reply(true)}
                  >
                    <ReplyAll size={16} />
                    Reply all
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      actionBusy ||
                      !accounts.find((a) => a.id === current.mailbox)?.can_send
                    }
                    onClick={() => reply(false, true)}
                  >
                    <Forward size={16} />
                    Forward
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="reader-empty">
              <div className="empty-art">
                <Logo large />
                <span className="art-orbit orbit-one" />
                <span className="art-orbit orbit-two" />
              </div>
              <h2>Select a message.</h2>
              <div className="keyboard-hint">
                <kbd>J</kbd>
                <kbd>K</kbd> to move <span>·</span>
                <kbd>C</kbd> to compose
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
