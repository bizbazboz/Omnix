import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import "./companion-banner.css";

export default function CompanionBanner() {
  const location = useLocation();
  const [native, setNative] = useState(Boolean(window.ReactNativeWebView));
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("omnix-companion-banner") === "dismissed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const ready = () => setNative(Boolean(window.ReactNativeWebView));
    window.addEventListener("omnix-native-ready", ready);
    return () => window.removeEventListener("omnix-native-ready", ready);
  }, []);
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (
    !mobile ||
    native ||
    dismissed ||
    window.location.protocol !== "https:" ||
    !/^\/(?:$|(?:email|calendar|health|notes|daily|iot|settings|onboarding)(?:\/|$))/.test(
      location.pathname
    )
  )
    return null;
  const target = new URL(
    location.pathname + location.search + location.hash,
    window.location.origin
  );
  target.searchParams.delete("omnix_app");
  const fallback = new URL(target);
  fallback.searchParams.set("omnix_app", "missing");
  const query = "url=" + encodeURIComponent(target.href);
  const missing =
    new URLSearchParams(location.search).get("omnix_app") === "missing";
  const href = /Android/i.test(navigator.userAgent)
    ? "intent://open?" +
      query +
      "#Intent;scheme=omnix;package=com.bizbazboz.omnix;S.browser_fallback_url=" +
      encodeURIComponent(fallback.href) +
      ";end"
    : "omnix://open?" + query;
  return (
    <aside className="companion-banner" aria-label="Open in Omnix app">
      <img src="/omnix-logo.png" width="32" height="32" alt="" />
      <div>
        <strong>Omnix</strong>
        <span>
          {missing
            ? "Install the companion to open this page."
            : "Continue in the companion app."}{" "}
          <a
            href="https://github.com/bizbazboz/Omnix/releases"
            target="_blank"
            rel="noreferrer"
          >
            Get app ↗
          </a>
        </span>
      </div>
      <a
        className="companion-banner-open"
        href={missing ? "https://github.com/bizbazboz/Omnix/releases" : href}
        target={missing ? "_blank" : undefined}
        rel={missing ? "noreferrer" : undefined}
      >
        {missing ? "Get app" : "Open app"}
      </a>
      <button
        aria-label="Dismiss app prompt"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem("omnix-companion-banner", "dismissed");
          } catch {
            /* Optional preference. */
          }
        }}
      >
        <X size={16} />
      </button>
    </aside>
  );
}
