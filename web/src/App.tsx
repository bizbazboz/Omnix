import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronRight,
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Send,
  Settings,
  X
} from "lucide-react";
import { Suspense, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation
} from "react-router-dom";
import { Avatar, Logo } from "./components/Brand";
import Dashboard from "./home/Dashboard";
import {
  api,
  qc,
  setCsrf,
  type Account,
  type Draft,
  type User
} from "./lib/api";
import Composer from "./products/email/Composer";
import Outbox from "./products/email/Outbox";
import { productRegistry } from "./products/registry";
import Authentication from "./settings/Authentication";
import WorkspaceSettings, { Onboarding } from "./settings/Settings";
export default function App() {
  const me = useQuery<User>({ queryKey: ["me"], queryFn: () => api("/me") });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config")
  });
  const location = useLocation();
  if (me.data) {
    setCsrf(me.data.csrf);
    return <Workspace user={me.data} />;
  }
  if (
    config.data?.setup_available &&
    (!config.data.oidc_configured || location.pathname === "/setup")
  )
    return <Authentication initial />;
  return (
    <div className="signin-page">
      <main className="signin-panel">
        <div className="signin-brand">
          <Logo />
          <span>omnix</span>
        </div>
        <h1>Sign in to Omnix</h1>
        <p className="muted">Use your Pocket ID account to access your mail.</p>
        {config.isLoading ? (
          <p role="status">Loading�</p>
        ) : config.error ? (
          <p className="error">
            Could not reach the application. Try refreshing the page.
          </p>
        ) : config.data?.oidc_configured ? (
          <a className="primary" href="/api/v1/auth/login">
            Continue with Pocket ID <ArrowUpRight size={16} />
          </a>
        ) : (
          <p className="notice">Sign-in has not been configured.</p>
        )}
      </main>
    </div>
  );
}
function Workspace({ user }: { user: User }) {
  const [mobile, setMobile] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [compose, setCompose] = useState<Draft | null>(null),
    [status, setStatus] = useState("");
  const location = useLocation();
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api("/connections"),
    refetchInterval: 15000
  });
  const products = useQuery<{ id: string; name: string; path: string }[]>({
    queryKey: ["products"],
    queryFn: () => api("/products")
  });
  const current = location.pathname.includes("settings")
    ? "Settings"
    : location.pathname.includes("email")
      ? "Email"
      : location.pathname.includes("onboarding")
        ? "Setup"
        : "Overview";
  function createDraft() {
    setCompose({
      version: 1,
      mailbox: accounts.data?.find((a) => a.can_send)?.id || "",
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      body: ""
    });
  }
  const folders = [
    { folder: "inbox", label: "Inbox", Icon: Inbox },
    { folder: "outbox", label: "Outbox", Icon: Send },
    { folder: "drafts", label: "Drafts", Icon: FileText }
  ];
  return (
    <div className="workspace">
      <aside
        aria-label="Workspace navigation"
        className={
          "sidebar " +
          (mobile ? "mobile-open " : "") +
          (collapsed ? "collapsed" : "")
        }
      >
        <div className="sidebar-brand">
          <Logo /> omnix
          <button
            className="icon-button mobile-close"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="compose-button"
          onClick={createDraft}
          disabled={!accounts.data?.some((a) => a.can_send)}
        >
          <Plus size={18} /> Compose
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav onClick={() => setMobile(false)}>
          <NavLink to="/app" end>
            <LayoutGrid size={17} />
            Overview
          </NavLink>
        </nav>
        <div className="nav-section-label">EMAIL</div>
        <nav onClick={() => setMobile(false)}>
          {folders.map(({ folder, label, Icon }) => (
            <NavLink
              key={folder}
              to={"/app/email" + (folder === "inbox" ? "" : "/" + folder)}
              end
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-section-label accounts-label">
          ACCOUNTS
          <NavLink to="/app/settings/connections" title="Add an account">
            <Plus size={15} />
          </NavLink>
        </div>
        <div className="account-nav">
          {accounts.data?.map((a, i) => (
            <NavLink
              key={a.id}
              to={"/app/email?account=" + a.id}
              onClick={() => setMobile(false)}
            >
              <span className={"account-dot dot-" + i} />
              <div>
                {a.label}
                <small>{a.address}</small>
              </div>
              <span
                className={
                  "connection-dot " + (a.status === "ready" ? "" : "degraded")
                }
              />
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <Avatar name={preferences.data?.display_name || user.name} />
            <div className="sidebar-identity">
              <strong>{preferences.data?.display_name || user.name}</strong>
              <span>{user.email}</span>
            </div>
            <NavLink
              className="icon-button profile-settings"
              to="/app/settings"
              title="Settings"
              aria-label="Settings"
              onClick={() => setMobile(false)}
            >
              <Settings size={18} />
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
                  setStatus((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Open navigation"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={19} />
          </button>
          <button
            className="icon-button desktop-toggle"
            title="Toggle sidebar"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Menu size={17} />
          </button>
          <div className="breadcrumb">
            <NavLink to="/app">OMNIX</NavLink>
            <ChevronRight size={12} />
            <span>{current}</span>
          </div>
          {status && (
            <div className="inline-status" role="status">
              {status}
              <button
                className="icon-button"
                aria-label="Dismiss status"
                onClick={() => setStatus("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </header>
        <Routes>
          <Route
            path="/settings"
            element={<Navigate to="/app/settings/general" replace />}
          />
          <Route
            path="/settings/*"
            element={
              <Navigate
                to={"/app" + location.pathname + location.search}
                replace
              />
            }
          />
          <Route
            path="/app/settings"
            element={<Navigate to="/app/settings/general" replace />}
          />
          <Route path="/app/onboarding" element={<Onboarding user={user} />} />
          <Route path="/app/email/outbox" element={<Outbox />} />
          <Route
            path="/app"
            element={
              preferences.data && !preferences.data.onboarding_completed ? (
                <Navigate to="/app/onboarding" replace />
              ) : (
                <Dashboard
                  accounts={accounts.data || []}
                  onCompose={createDraft}
                />
              )
            }
          />
          {(products.data || []).map((product) => {
            const module = productRegistry.find((m) => m.id === product.id);
            if (!module) return null;
            const Entry = module.Entry;
            return (
              <Route
                key={module.id}
                path={module.routePrefix + "/*"}
                element={
                  <Suspense fallback={<div className="empty">Loading�</div>}>
                    <Entry
                      accounts={accounts.data || []}
                      onCompose={setCompose}
                      notify={setStatus}
                    />
                  </Suspense>
                }
              />
            );
          })}
          <Route
            path="/app/settings/*"
            element={
              <WorkspaceSettings
                user={user}
                accounts={accounts.data || []}
                notify={setStatus}
              />
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
      {compose && (
        <Composer
          draft={compose}
          accounts={accounts.data || []}
          onClose={() => setCompose(null)}
          notify={setStatus}
        />
      )}
    </div>
  );
}
