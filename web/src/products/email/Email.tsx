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
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Avatar, Logo } from "../../components/Brand";
import { api, type Account, type Draft, type Message } from "../../lib/api";
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
  const folder = location.pathname.split("/")[3] || "inbox";
  const account = params.get("account") || "";
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState(false);
  const [selected, setSelected] = useState<Message | null>(null);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
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
  }, [folder, account, unread]);
  const list = useQuery<{
    items: Message[];
    next_cursor: string | null;
    search_scope: string;
  }>({
    queryKey: ["messages", folder, account, query, unread, cursor],
    queryFn: () =>
      api(
        "/email/messages?" +
          new URLSearchParams({
            folder: folder === "starred" ? "inbox" : folder,
            account,
            q: query,
            unread: String(unread),
            starred: String(folder === "starred"),
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
        (e.target as HTMLElement).matches("input,textarea,select") ||
        document.querySelector(".modal-backdrop")
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
      if (e.key === "Escape") setSelected(null);
      if (e.key === "j" || e.key === "k") {
        const items = list.data?.items || [];
        const index = items.findIndex((x) => x.id === selected?.id);
        setSelected(
          items[
            Math.max(
              0,
              Math.min(items.length - 1, index + (e.key === "j" ? 1 : -1))
            )
          ] || null
        );
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [list.data, selected, accounts]);
  const title =
    folder === "inbox" ? "Inbox" : folder[0].toUpperCase() + folder.slice(1);
  const current = detail.data || selected;
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
              title="Toggle unread filter"
              onClick={() => setUnread(!unread)}
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>
          <div className="search-row">
            <Search size={16} />
            <input
              aria-label="Search messages"
              placeholder="Search your inbox"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="account-filters">
            <button
              className={!account ? "selected" : ""}
              onClick={() => setParams({})}
            >
              All accounts
            </button>
            {accounts.map((a, i) => (
              <button
                className={account === a.id ? "selected" : ""}
                key={a.id}
                onClick={() => setParams({ account: a.id })}
              >
                <span className={"account-dot dot-" + i} />
                {a.label}
              </button>
            ))}
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
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft size={18} />
                </button>

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
                ) : current.html ? (
                  <iframe
                    title="Sanitized email body"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    className="mail-frame"
                    srcDoc={
                      '<meta http-equiv="Content-Security-Policy" content="default-src ' +
                      "'none'" +
                      "; style-src " +
                      "'unsafe-inline'" +
                      "; img-src data:; form-action " +
                      "'none'" +
                      "; base-uri " +
                      "'none'" +
                      '"><style>body{font:14px/1.85 system-ui;color:#bbb;background:#000;overflow-wrap:anywhere}a{color:#e8e8e8}</style>' +
                      current.html
                    }
                  />
                ) : (
                  <div className="mail-text">
                    {current.body || current.preview}
                  </div>
                )}
                <div className="reply-actions">
                  <button
                    className="secondary"
                    disabled={
                      !accounts.find((a) => a.id === current.mailbox)?.can_send
                    }
                    onClick={() =>
                      onCompose({
                        version: 1,
                        mailbox: current.mailbox,
                        to: [current.sender],
                        cc: [],
                        bcc: [],
                        subject: current.subject.startsWith("Re:")
                          ? current.subject
                          : "Re: " + current.subject,
                        body:
                          "\n\nOn " +
                          new Date(current.date).toLocaleDateString() +
                          ", " +
                          current.sender +
                          " wrote:\n" +
                          (current.body || current.preview)
                            .split("\n")
                            .map((x) => "> " + x)
                            .join("\n")
                      })
                    }
                  >
                    <Reply size={16} /> Reply
                  </button>
                  <button
                    className="icon-button"
                    title="Reply all"
                    disabled={
                      !accounts.find((a) => a.id === current.mailbox)?.can_send
                    }
                    onClick={() =>
                      onCompose({
                        version: 1,
                        mailbox: current.mailbox,
                        to: [current.sender],
                        cc: current.recipients
                          .split(",")
                          .map((x) => x.trim())
                          .filter(
                            (x) =>
                              x.includes("@") &&
                              !accounts.some((a) => a.address === x)
                          ),
                        bcc: [],
                        subject: "Re: " + current.subject,
                        body: ""
                      })
                    }
                  >
                    <ReplyAll size={17} />
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
