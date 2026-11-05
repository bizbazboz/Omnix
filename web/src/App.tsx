import { canonicalWorkspaceUrl, signInUrl } from "./lib/routes";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronRight,
  Menu,
  PanelLeftOpen,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation
} from "react-router-dom";
import { Logo } from "./components/Brand";
import WorkspaceNavigation from "./components/WorkspaceNavigation";
import DataStatus from "./components/DataStatus";
import "./components/workspace-ui.css";
import "./components/nothing-ui.css";
import PageLoading from "./components/PageLoading";
import { api, setCsrf, type Account, type Draft, type User } from "./lib/api";
import { productRegistry } from "./products/registry";
import { useStoredFlag, useStoredWidth } from "./lib/layout";
const Dashboard = lazy(() => import("./home/Dashboard"));
const Composer = lazy(() => import("./products/email/Composer"));
const Outbox = lazy(() => import("./products/email/Outbox"));
const Authentication = lazy(() => import("./settings/Authentication"));
const WorkspaceSettings = lazy(() => import("./settings/Settings"));
const Onboarding = lazy(() => import("./settings/Onboarding"));

export default function App() {
  const me = useQuery<User>({ queryKey: ["me"], queryFn: () => api("/me") });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config")
  });
  const location = useLocation();
  const canonical = canonicalWorkspaceUrl(
    location.pathname + location.search + location.hash
  );
  if (canonical !== location.pathname + location.search + location.hash)
    return <Navigate to={canonical} replace />;
  if (me.data) {
    setCsrf(me.data.csrf);
    return <Workspace user={me.data} />;
  }
  if (
    config.data?.setup_available &&
    (!config.data.oidc_configured || location.pathname === "/setup")
  )
    return (
      <Suspense fallback={<PageLoading label="Loading setup" />}>
        <Authentication initial />
      </Suspense>
    );
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
            <a className="primary login-button" href={signInUrl(canonical)}>
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
  const menuButton = useRef<HTMLButtonElement>(null);
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
  useEffect(
    () => setMobile(false),
    [location.pathname, location.search, location.hash]
  );
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const resized = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener("change", resized);
    return () => desktop.removeEventListener("change", resized);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMobile(false);
        requestAnimationFrame(() => menuButton.current?.focus());
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [mobile]);
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
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
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
      <main
        id="workspace-main"
        className="main"
        tabIndex={-1}
        inert={mobile || undefined}
      >
        <header className="topbar">
          <button
            ref={menuButton}
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
          <DataStatus />
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
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route
              path="/settings"
              element={<Navigate to="/settings/general" replace />}
            />
            <Route path="/onboarding" element={<Onboarding user={user} />} />
            <Route path="/email/outbox" element={<Outbox />} />
            <Route
              path="/"
              element={
                preferences.data && !preferences.data.onboarding_completed ? (
                  <Navigate to="/onboarding" replace />
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
                      <PageLoading label="Loading applications" />
                    ) : products.error ? (
                      <div className="empty">
                        Could not load products.{" "}
                        <button onClick={() => products.refetch()}>
                          Retry
                        </button>
                      </div>
                    ) : !products.data?.some((p) => p.id === module.id) ? (
                      <div className="empty">Product unavailable.</div>
                    ) : (
                      <Suspense
                        fallback={
                          <PageLoading
                            label={"Loading " + module.name.toLowerCase()}
                          />
                        }
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
              path="/settings/*"
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
        </Suspense>
      </main>
      {compose && (
        <Suspense fallback={<PageLoading label="Loading composer" />}>
          <Composer
            draft={compose}
            accounts={accounts.data || []}
            onClose={() => setCompose(null)}
            notify={setStatus}
          />
        </Suspense>
      )}
    </div>
  );
}
