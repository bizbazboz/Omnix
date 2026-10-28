import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronRight,
  Menu,
  PanelLeftOpen,
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
import { Logo } from "./components/Brand";
import WorkspaceNavigation from "./components/WorkspaceNavigation";
import Dashboard from "./home/Dashboard";
import { api, setCsrf, type Account, type Draft, type User } from "./lib/api";
import Composer from "./products/email/Composer";
import Outbox from "./products/email/Outbox";
import { productRegistry } from "./products/registry";
import Authentication from "./settings/Authentication";
import WorkspaceSettings, { Onboarding } from "./settings/Settings";
import { useStoredFlag, useStoredWidth } from "./lib/layout";
export default function App() {
  const me = useQuery<User>({ queryKey: ["me"], queryFn: () => api("/me") });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config")
  });
  const location = useLocation();
  if (location.pathname === "/app" || location.pathname === "/app/")
    return <Navigate to={"/" + location.search + location.hash} replace />;
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
    <div className="login">
      <div className="login-art">
        <div className="login-id">
          <Logo />
          <span>OMNIX / WORKSPACE</span>
        </div>
        <div className="login-display">
          EVERYTHING.
          <br />
          CONNECTED.
        </div>
        <div className="login-grid" />
        <span className="art-footer">
          [ SYSTEM 01 ]<span>PRIVATE WORKSPACE</span>
        </span>
      </div>
      <div className="login-form">
        <div className="wordmark">
          <Logo /> omnix
        </div>
        <div>
          <span className="eyebrow">WORKSPACE ACCESS</span>
          <h1>Sign in.</h1>
          {config.isLoading ? (
            <p className="inline-status">[ LOADING ]</p>
          ) : config.error ? (
            <p className="error">
              Could not reach the application. Try refreshing the page.
            </p>
          ) : config.data?.oidc_configured ? (
            <a className="primary login-button" href="/api/v1/auth/login">
              Continue with Pocket ID <ArrowUpRight size={16} />
            </a>
          ) : (
            <p className="notice">Sign-in is not configured.</p>
          )}
        </div>
        <span className="login-foot">SECURE SESSION / OIDC</span>
      </div>
    </div>
  );
}
function Workspace({ user }: { user: User }) {
  const [mobile, setMobile] = useState(false),
    [compose, setCompose] = useState<Draft | null>(null),
    [status, setStatus] = useState("");
  const [collapsed, setCollapsed] = useStoredFlag("omnix.sidebar.collapsed");
  const [sidebarWidth, setSidebarWidth] = useStoredWidth(
    "omnix.sidebar.width",
    244,
    210,
    380
  );
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
  const activeProduct = productRegistry.find((p) =>
    location.pathname.startsWith(p.routePrefix)
  );
  const current = location.pathname.includes("settings")
    ? "Settings"
    : activeProduct
      ? activeProduct.name
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
  return (
    <div className={"workspace " + (collapsed ? "sidebar-hidden" : "")}>
      <WorkspaceNavigation
        user={user}
        displayName={preferences.data?.display_name || user.name}
        accounts={accounts.data || []}
        available={(products.data || []).map((p) => p.id)}
        mobile={mobile}
        collapsed={collapsed}
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onCollapse={() => setCollapsed(true)}
        onClose={() => setMobile(false)}
        onCompose={createDraft}
        notify={setStatus}
      />
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
          {collapsed && (
            <button
              className="icon-button desktop-toggle"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftOpen size={17} />
            </button>
          )}
          <div className="breadcrumb">
            <NavLink to="/">OMNIX</NavLink>
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
            path="/"
            element={
              preferences.data && !preferences.data.onboarding_completed ? (
                <Navigate to="/app/onboarding" replace />
              ) : (
                <Dashboard
                  user={{
                    ...user,
                    name: preferences.data?.display_name || user.name
                  }}
                  accounts={accounts.data || []}
                  onCompose={createDraft}
                />
              )
            }
          />
          {productRegistry.map((module) => {
            const Entry = module.Entry;
            return (
              <Route
                key={module.id}
                path={module.routePrefix + "/*"}
                element={
                  products.isLoading ? (
                    <div className="empty">Loading…</div>
                  ) : products.error ? (
                    <div className="empty">
                      Could not load products.{" "}
                      <button onClick={() => products.refetch()}>Retry</button>
                    </div>
                  ) : !products.data?.some((p) => p.id === module.id) ? (
                    <div className="empty">Product unavailable.</div>
                  ) : (
                    <Suspense
                      fallback={<div className="empty">Loading...</div>}
                    >
                      <Entry
                        accounts={accounts.data || []}
                        onCompose={setCompose}
                        notify={setStatus}
                      />
                    </Suspense>
                  )
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
          <Route path="*" element={<Navigate to="/" replace />} />
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
