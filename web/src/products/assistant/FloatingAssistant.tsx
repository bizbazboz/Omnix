import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MessageSquare, Minus } from "lucide-react";
import "./floating-assistant.css";
const Assistant = lazy(() => import("./Assistant"));

export default function FloatingAssistant({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const visible = open && !disabled;
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  useEffect(() => {
    if (!visible) return;
    heading.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [visible]);
  return (
    <div className="floating-assistant">
      {mounted && (
        <section
          className="assistant-floating-panel"
          id="workspace-ai-chat"
          role="dialog"
          aria-modal="false"
          aria-labelledby="workspace-ai-heading"
          hidden={!visible}
        >
          <header className="assistant-floating-heading">
            <div>
              <h2 id="workspace-ai-heading" tabIndex={-1} ref={heading}>
                AI
              </h2>
              <span className="eyebrow">ON THIS DEVICE</span>
            </div>
            <button
              className="icon-button"
              aria-label="Minimise AI chat"
              onClick={close}
            >
              <Minus size={18} />
            </button>
          </header>
          <Suspense
            fallback={
              <p className="assistant-chat-loading" role="status">
                [LOADING CHAT]
              </p>
            }
          >
            <Assistant onNavigate={close} />
          </Suspense>
        </section>
      )}
      <button
        ref={trigger}
        className="assistant-launcher"
        disabled={disabled}
        aria-label={visible ? "Close AI chat" : "Open AI chat"}
        aria-expanded={visible}
        aria-controls={mounted ? "workspace-ai-chat" : undefined}
        onClick={() => {
          if (visible) close();
          else {
            setMounted(true);
            setOpen(true);
          }
        }}
      >
        <MessageSquare size={20} />
        <span>AI</span>
      </button>
    </div>
  );
}
