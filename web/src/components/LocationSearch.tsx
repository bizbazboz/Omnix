import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import "./location-search.css";

export type LocationPoint = {
  id: string;
  label: string;
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
};
export default function LocationSearch({
  label,
  value,
  onChange,
  onSelect,
  endpoint,
  disabled = false,
  hint,
  minChars = 2
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (point: LocationPoint) => void;
  endpoint: string;
  disabled?: boolean;
  hint: string;
  minChars?: number;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    [items, setItems] = useState<LocationPoint[]>([]),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open || value.trim().length < minChars) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      api<{ items: LocationPoint[] }>(
        endpoint + "?q=" + encodeURIComponent(value)
      )
        .then((data) => {
          if (!cancelled) {
            setItems(data.items);
            setActive(-1);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setItems([]);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, open, endpoint, minChars]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function choose(index: number) {
    if (!items[index]) return;
    onSelect(items[index]);
    setOpen(false);
    setItems([]);
  }
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(id + "-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  return (
    <div className="location-search" ref={root}>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="location-search-input">
        <Search size={16} />
        <input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-results"}
          aria-activedescendant={active >= 0 ? id + "-" + active : undefined}
          disabled={disabled}
          value={value}
          placeholder="Search for a location…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1)
                  )
                )
              );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              choose(active >= 0 ? active : 0);
            }
          }}
        />
      </div>
      {open && value.trim().length >= minChars && (
        <div className="location-search-popup">
          <div
            id={id + "-results"}
            role="listbox"
            aria-label={label + " results"}
          >
            {items.map((point, index) => (
              <button
                type="button"
                role="option"
                id={id + "-" + index}
                aria-selected={active === index}
                key={point.id}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{point.label}</span>
                <small>{point.detail}</small>
              </button>
            ))}
          </div>
          {busy ? (
            <p role="status">Searching…</p>
          ) : error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : !items.length ? (
            <p>No matching locations.</p>
          ) : null}
          <small>{hint}</small>
        </div>
      )}
    </div>
  );
}
