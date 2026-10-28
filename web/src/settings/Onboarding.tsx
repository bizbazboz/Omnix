import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mail,
  CalendarDays,
  HeartPulse
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, qc, type User } from "../lib/api";
import { General } from "./Settings";

const steps = [
  {
    name: "Connection",
    title: "You're connected.",
    description: "A quick check before you settle in."
  },
  {
    name: "Your space",
    title: "Make it yours.",
    description: "Set your name and local time."
  },
  {
    name: "Ready",
    title: "All yours.",
    description:
      "Your workspace is ready. Connect your accounts whenever you like."
  }
];
type SetupStatus = {
  signed_in: boolean;
  database: string;
  authentication: string;
  completed: boolean;
};
export default function Onboarding({ user }: { user: User }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useQuery<SetupStatus>({
    queryKey: ["onboarding"],
    queryFn: () => api("/onboarding")
  });
  const prefs = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api("/settings/preferences")
  });
  const ready =
    status.data?.signed_in &&
    status.data.database === "connected" &&
    status.data.authentication === "configured";
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [step]);
  async function finish(path: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const preferences = await api("/settings/preferences");
      await api("/settings/preferences", {
        method: "PUT",
        body: JSON.stringify({ ...preferences, onboarding_completed: true })
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["preferences"] }),
        qc.invalidateQueries({ queryKey: ["onboarding"] })
      ]);
      navigate(path, { replace: true });
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="page onboarding-page">
      <header className="onboarding-masthead">
        <span className="eyebrow">WORKSPACE SETUP</span>
        <span className="eyebrow">
          {String(step + 1).padStart(2, "0")} / 03
        </span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-rail">
          <ol aria-label="Setup progress">
            {steps.map((item, index) => (
              <li
                key={item.name}
                aria-current={index === step ? "step" : undefined}
                className={
                  index < step ? "complete" : index === step ? "current" : ""
                }
              >
                <span>
                  {index < step ? (
                    <Check size={14} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                {item.name}
              </li>
            ))}
          </ol>
          <span className="onboarding-rail-caption">OMNIX / FIRST RUN</span>
        </aside>
        <section
          className="onboarding-stage"
          aria-labelledby="onboarding-title"
        >
          <div className="onboarding-intro">
            <h1 id="onboarding-title" tabIndex={-1} ref={heading}>
              {steps[step].title}
            </h1>
            <p>{steps[step].description}</p>
          </div>
          {step === 0 && (
            <>
              {status.isLoading ? (
                <p className="muted" role="status">
                  [CHECKING CONNECTION]
                </p>
              ) : status.error ? (
                <p className="error" role="alert">
                  Could not check your workspace.{" "}
                  <button
                    className="text-button"
                    onClick={() => status.refetch()}
                  >
                    Retry
                  </button>
                </p>
              ) : (
                <dl className="onboarding-checks">
                  {[
                    {
                      name: "Identity",
                      detail: "Pocket ID",
                      ok:
                        status.data?.signed_in &&
                        status.data.authentication === "configured"
                    },
                    {
                      name: "Workspace",
                      detail: "Database",
                      ok: status.data?.database === "connected"
                    },
                    {
                      name: "Your account",
                      detail: user.is_admin ? "Administrator" : "Member",
                      ok: status.data?.signed_in
                    }
                  ].map((check) => (
                    <div key={check.name}>
                      <dt>
                        {check.name}
                        <small>{check.detail}</small>
                      </dt>
                      <dd className={check.ok ? "" : "error"}>
                        {check.ok ? (
                          <>
                            <Check size={14} />
                            Connected
                          </>
                        ) : (
                          "Unavailable"
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="onboarding-actions">
                <button
                  className="primary"
                  disabled={!ready}
                  onClick={() => setStep(1)}
                >
                  Make it yours <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <General
              user={user}
              onSaved={() => setStep(2)}
              onBusyChange={setBusy}
            />
          )}
          {step === 2 && (
            <>
              <div className="onboarding-summary">
                <span className="eyebrow">YOUR PREFERENCES</span>
                <strong>{prefs.data?.display_name || user.name}</strong>
                <span>
                  {prefs.data?.timezone ||
                    Intl.DateTimeFormat().resolvedOptions().timeZone}
                  <span aria-hidden="true"> / </span>
                  {prefs.data?.time_format === "12"
                    ? "12-hour clock"
                    : "24-hour clock"}
                </span>
              </div>
              <div
                className="onboarding-apps"
                aria-label="Available integrations"
              >
                {[
                  { Icon: Mail, name: "Mail", detail: "Zoho & IMAP" },
                  {
                    Icon: CalendarDays,
                    name: "Calendar",
                    detail: "iCal subscriptions"
                  },
                  { Icon: HeartPulse, name: "Health", detail: "Google Health" }
                ].map((app) => (
                  <div key={app.name}>
                    <app.Icon size={20} strokeWidth={1.25} />
                    <span>
                      {app.name}
                      <small>{app.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="onboarding-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => finish("/")}
                >
                  {busy ? "Opening…" : "Open workspace"}
                  <ArrowRight size={16} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => finish("/settings/connections")}
                >
                  Set up integrations
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {step > 0 && (
            <button
              className="text-button onboarding-back"
              disabled={busy}
              onClick={() => {
                setError("");
                setStep(step - 1);
              }}
            >
              <ArrowLeft size={14} />
              Back
            </button>
          )}
        </section>
      </div>
      <footer className="onboarding-footer">
        <span>YOUR ACCOUNTS. YOUR WORKSPACE.</span>
        <span>SETTINGS CAN BE CHANGED LATER</span>
      </footer>
    </div>
  );
}
