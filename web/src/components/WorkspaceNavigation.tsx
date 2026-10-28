import {
  Archive,
  CalendarDays,
  ChevronDown,
  FileText,
  Folder,
  ArrowLeft,
  ChevronRight,
  Inbox,
  LayoutGrid,
  LogOut,
  Mail,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  X
} from "lucide-react";
import { PanelLeftClose } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { type Account, type User, api, qc, setCsrf } from "../lib/api";
import { healthViews } from "../products/health/catalog";
import { productRegistry } from "../products/registry";
import { useMailProfiles } from "../products/email/useMailProfiles";
import { Avatar, Logo } from "./Brand";
import ResizeHandle from "./ResizeHandle";

export default function WorkspaceNavigation({
  user,
  displayName,
  accounts,
  available,
  mobile,
  collapsed,
  width,
  onResize,
  onCollapse,
  onClose,
  onCompose,
  notify
}: {
  user: User;
  displayName: string;
  accounts: Account[];
  available: string[];
  mobile: boolean;
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
  onClose: () => void;
  onCompose: () => void;
  notify: (text: string) => void;
}) {
  const location = useLocation(),
    navigate = useNavigate();
  const [listForPath, setListForPath] = useState<string | null>(null);
  const firstApp = useRef<HTMLAnchorElement>(null);
  const activeApp = productRegistry.find((app) =>
    location.pathname.startsWith(app.routePrefix)
  );
  const showApps = !activeApp || listForPath === location.pathname;
  const params = new URLSearchParams(location.search);
  const account = params.get("account") || "";
  const email = location.pathname.startsWith("/app/email");
  const calendar = location.pathname.startsWith("/app/calendar");
  const folder =
    params.get("folder") || location.pathname.split("/")[3] || "inbox";
  const profiles = useMailProfiles(email ? accounts : []);
  const custom = profiles.flatMap((p) =>
    (p.data?.folders || [])
      .filter((f) => f.kind === "custom")
      .map((f) => ({ ...f, account: p.account }))
  );
  const folders = [
    { id: "inbox", name: "Inbox", Icon: Inbox },
    { id: "drafts", name: "Drafts", Icon: FileText },
    { id: "sent", name: "Sent", Icon: Send },
    { id: "starred", name: "Starred", Icon: Star },
    { id: "archive", name: "Archive", Icon: Archive },
    { id: "spam", name: "Spam", Icon: ShieldAlert },
    { id: "trash", name: "Trash", Icon: Trash2 },
    { id: "all", name: "All mail", Icon: Mail },
    { id: "outbox", name: "Outbox", Icon: Send }
  ];
  const href = (id: string, mailbox = account) =>
    "/app/email" +
    (id === "inbox" ? "" : "/" + id) +
    (mailbox ? "?account=" + encodeURIComponent(mailbox) : "");
  async function createFolder() {
    const selected =
      accounts.find((a) => a.id === account) ||
      (accounts.length === 1 ? accounts[0] : null);
    if (!selected) {
      notify("Select a mailbox before adding a folder.");
      return;
    }
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    try {
      await api("/email/mailboxes/" + selected.id + "/folders", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      qc.invalidateQueries({ queryKey: ["mail-profile", selected.id] });
      notify("Folder created.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <aside
      style={{ "--sidebar-width": width + "px" } as CSSProperties}
      aria-label="Workspace navigation"
      className={
        "sidebar app-sidebar " +
        (mobile ? "mobile-open " : "") +
        (collapsed ? "collapsed" : "")
      }
    >
      <div className="app-brand">
        <NavLink to="/" onClick={onClose}>
          <Logo />
          <span>omnix</span>
        </NavLink>
        <button
          className="icon-button sidebar-collapse"
          aria-label="Collapse navigation"
          title="Collapse navigation"
          onClick={onCollapse}
        >
          <PanelLeftClose size={17} />
        </button>
        <button
          className="icon-button mobile-close"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
      </div>
      <div className="app-sidebar-body">
        {showApps ? (
          <>
            <nav aria-label="Workspace">
              <NavLink to="/" end onClick={onClose}>
                <LayoutGrid size={17} strokeWidth={1.5} />
                Overview
              </NavLink>
            </nav>
            {available.length > 0 && (
              <div className="sidebar-group-label">APPLICATIONS</div>
            )}
            <nav className="application-list" aria-label="Applications">
              {productRegistry
                .filter((app) => available.includes(app.id))
                .map((app, index) => (
                  <NavLink
                    key={app.id}
                    ref={index === 0 ? firstApp : undefined}
                    to={app.routePrefix}
                    onClick={() => setListForPath(null)}
                  >
                    <app.Icon size={19} strokeWidth={1.5} />
                    <span>{app.name}</span>
                    <ChevronRight size={14} className="application-chevron" />
                  </NavLink>
                ))}
            </nav>
          </>
        ) : (
          <>
            <button
              className="sidebar-back"
              aria-label="Back to applications"
              onClick={() => {
                setListForPath(location.pathname);
                requestAnimationFrame(() => firstApp.current?.focus());
              }}
            >
              <ArrowLeft size={16} strokeWidth={1.5} /> All applications
            </button>
            <div className="sidebar-app-title">
              <activeApp.Icon size={21} strokeWidth={1.5} />
              <h2>{activeApp.name}</h2>
            </div>
            {email ? (
              <>
                <button
                  className="primary new-message"
                  onClick={() => {
                    onCompose();
                    onClose();
                  }}
                  disabled={!accounts.some((a) => a.can_send)}
                >
                  <Plus size={17} /> New message
                </button>
                <div className="mailbox-picker">
                  <label htmlFor="nav-mailbox">MAILBOX</label>
                  <select
                    id="nav-mailbox"
                    value={account}
                    onChange={(e) => {
                      const next = new URLSearchParams(location.search);
                      if (e.target.value) next.set("account", e.target.value);
                      else next.delete("account");
                      next.delete("message");
                      if (next.has("folder")) {
                        next.delete("folder");
                        navigate("/app/email?" + next);
                      } else navigate(location.pathname + "?" + next);
                    }}
                  >
                    <option value="">All accounts</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} />
                </div>
                <nav className="mail-folders" aria-label="Mail folders">
                  {folders.map((f) => (
                    <NavLink
                      key={f.id}
                      to={href(f.id)}
                      className={() => (folder === f.id ? "folder-active" : "")}
                      onClick={onClose}
                    >
                      <f.Icon size={17} strokeWidth={1.5} />
                      <span>{f.name}</span>
                      {folder === f.id && <i />}
                    </NavLink>
                  ))}
                </nav>
                <div className="folder-group-title">
                  <span>FOLDERS</span>
                  <button
                    className="icon-button"
                    aria-label="Create folder"
                    title="Create folder"
                    onClick={createFolder}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <nav className="custom-folders" aria-label="Custom folders">
                  {custom
                    .filter((f) => !account || f.account.id === account)
                    .map((f) => (
                      <NavLink
                        key={f.account.id + f.id}
                        to={
                          "/app/email/folder?" +
                          new URLSearchParams({
                            folder: f.key,
                            account: f.account.id
                          })
                        }
                        className={() =>
                          folder === f.key && account === f.account.id
                            ? "folder-active"
                            : ""
                        }
                        onClick={onClose}
                      >
                        <Folder size={16} />
                        <span>
                          {f.name}
                          {!account && <small>{f.account.label}</small>}
                        </span>
                      </NavLink>
                    ))}
                </nav>
                {profiles.some((p) => p.error) && (
                  <button
                    className="sidebar-retry"
                    onClick={() =>
                      profiles
                        .filter((p) => p.error)
                        .forEach((p) => p.refetch())
                    }
                  >
                    Folders unavailable · retry
                  </button>
                )}
                {!accounts.length && (
                  <NavLink
                    className="sidebar-connect"
                    to="/app/settings/connections"
                    onClick={onClose}
                  >
                    <Plus size={15} /> Connect account
                  </NavLink>
                )}
              </>
            ) : calendar ? (
              <>
                <button
                  className="primary new-message"
                  onClick={() => {
                    navigate("/app/settings/connections#calendars");
                    onClose();
                  }}
                >
                  <Plus size={17} /> Manage calendars
                </button>
                <nav aria-label="Calendar navigation">
                  <NavLink
                    to="/app/calendar?view=month"
                    className={() =>
                      params.get("view") !== "agenda" ? "folder-active" : ""
                    }
                    onClick={onClose}
                  >
                    <CalendarDays size={17} /> Month
                  </NavLink>
                  <NavLink
                    to="/app/calendar?view=agenda"
                    className={() =>
                      params.get("view") === "agenda" ? "folder-active" : ""
                    }
                    onClick={onClose}
                  >
                    <LayoutGrid size={17} />
                    Agenda
                  </NavLink>
                </nav>
              </>
            ) : activeApp.id === "health" ? (
              <nav aria-label="Health navigation">
                {healthViews.map((view) => (
                  <NavLink
                    key={view.id}
                    to={
                      "/app/health" +
                      (view.id === "overview" ? "" : "/" + view.id)
                    }
                    end
                    onClick={onClose}
                  >
                    <activeApp.Icon size={17} />
                    {view.name}
                  </NavLink>
                ))}
              </nav>
            ) : (
              <nav aria-label={activeApp.name + " navigation"}>
                <NavLink to={activeApp.routePrefix} end onClick={onClose}>
                  <activeApp.Icon size={17} />
                  Overview
                </NavLink>
              </nav>
            )}
          </>
        )}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-profile">
          <Avatar name={displayName} />
          <div className="sidebar-identity">
            <strong>{displayName}</strong>
            <span>{user.email}</span>
          </div>
          <NavLink
            className="icon-button profile-settings"
            to="/app/settings"
            aria-label="Settings"
            title="Settings"
            onClick={onClose}
          >
            <Settings size={17} />
          </NavLink>
          <button
            className="icon-button"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                setCsrf("");
                qc.clear();
                window.location.assign("/");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
      <ResizeHandle
        label="Resize sidebar"
        value={width}
        min={210}
        max={380}
        defaultValue={244}
        onChange={onResize}
      />
    </aside>
  );
}
