import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
export default function ActionMenu({
  label,
  children,
  compact = false
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node))
        menu.current?.removeAttribute("open");
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
        event.stopPropagation();
      }
    }
    function scroll(event: Event) {
      if (!menu.current?.contains(event.target as Node))
        menu.current?.removeAttribute("open");
    }
    function resize() {
      menu.current?.removeAttribute("open");
    }
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details
      className={"note-action-menu" + (compact ? " compact" : "")}
      ref={menu}
      onToggle={() => {
        if (!menu.current?.open) return;
        const rect = menu.current
          .querySelector("summary")!
          .getBoundingClientRect();
        const height =
          menu.current
            .querySelector(".note-action-popup")
            ?.getBoundingClientRect().height || 200;
        setPosition({
          left: Math.max(
            12,
            Math.min(rect.right - 240, window.innerWidth - 252)
          ),
          top: Math.max(
            12,
            Math.min(rect.bottom + 8, window.innerHeight - height - 12)
          )
        });
      }}
    >
      <summary title={label} aria-label={label}>
        <MoreHorizontal size={18} />
        {!compact && <span>{label}</span>}
      </summary>
      <div
        className="note-action-popup"
        style={position}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button"))
            menu.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
