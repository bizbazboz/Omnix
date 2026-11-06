import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import "./multi-select.css";
export default function MultiSelect({
  label,
  value,
  options,
  onChange,
  disabled = false
}: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const complete = [
      ...options,
      ...value
        .filter((v) => !options.some((o) => o.value === v))
        .map((v) => ({ value: v, label: v + " (unavailable)" }))
    ],
    shown = complete.filter((o) =>
      o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    );
  return (
    <div
      className="multi-select"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        className="select-trigger"
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>
          {value.length ? value.length + " lines selected" : "Select lines"}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="multi-select-popup"
          id={id}
          role="group"
          aria-label={label + " choices"}
        >
          <label className="multi-select-search">
            <Search size={15} />
            <input
              autoFocus
              aria-label="Search train lines"
              placeholder="Search lines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="multi-select-actions">
            <button
              type="button"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              Select all
            </button>
            <button type="button" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="multi-select-options">
            {shown.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={value.includes(option.value)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...value, option.value]
                        : value.filter((v) => v !== option.value)
                    )
                  }
                />
                {option.label}
              </label>
            ))}
            {!shown.length && <p className="muted">No matching lines.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
