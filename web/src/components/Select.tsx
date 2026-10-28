import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
type Option = {
  value: string;
  label: string;
  group: string;
  disabled: boolean;
};
type Props = {
  children: ReactNode;
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  className?: string;
  "aria-label"?: string;
};
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child)
    )
    .join("");
}
function parse(children: ReactNode, group = ""): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        label?: string;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === "option")
      return [
        {
          value: String(child.props.value ?? text(child.props.children)),
          label: child.props.label || text(child.props.children),
          disabled: !!child.props.disabled,
          group
        }
      ];
    return parse(
      child.props.children,
      child.type === "optgroup" ? child.props.label || "" : group
    );
  });
}
export default function Select({
  children,
  value,
  onChange,
  id,
  name,
  disabled = false,
  required = false,
  searchable,
  className = "",
  ...aria
}: Props) {
  const uid = useId(),
    listId = uid + "-list",
    options = parse(children),
    selected = options.find((option) => option.value === String(value));
  const root = useRef<HTMLSpanElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    typeahead = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(-1),
    [label, setLabel] = useState(aria["aria-label"] || "");
  const filtered = options.filter((option) =>
      option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ),
    canSearch = searchable ?? options.length > 12;
  useEffect(() => {
    if (aria["aria-label"]) return;
    const owner =
      root.current?.closest("label") ||
      (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null);
    if (owner) {
      const clone = owner.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(".select-field,small")
        .forEach((node) => node.remove());
      setLabel(clone.textContent?.trim() || "Choose an option");
    }
  }, [id, aria["aria-label"]]);
  useEffect(() => {
    if (disabled && open) popup.current?.hidePopover();
  }, [disabled, open]);
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(uid + "-option-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, uid]);
  function close(restore = true) {
    popup.current?.hidePopover();
    if (restore) trigger.current?.focus();
  }
  function show(last = false) {
    if (disabled) return;
    setQuery("");
    const candidates = options
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0);
    setActive(
      last
        ? (candidates.at(-1) ?? -1)
        : Math.max(
            candidates[0] ?? -1,
            options.findIndex(
              (option) => option.value === String(value) && !option.disabled
            )
          )
    );
    const rect = trigger.current!.getBoundingClientRect(),
      width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16),
      below = window.innerHeight - rect.bottom - 12,
      above = rect.top - 12,
      height = Math.min(320, Math.max(below, above)),
      placeBelow = below >= Math.min(280, above);
    Object.assign(popup.current!.style, {
      left:
        Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px",
      top: placeBelow ? rect.bottom + 6 + "px" : "auto",
      bottom: placeBelow ? "auto" : window.innerHeight - rect.top + 6 + "px",
      width: width + "px",
      maxHeight: height + "px"
    });
    popup.current?.showPopover();
    if (canSearch) search.current?.focus();
    else list.current?.focus();
  }
  function choose(index: number) {
    const option = filtered[index];
    if (!option || option.disabled) return;
    if (option.value !== String(value))
      onChange({ target: { value: option.value } });
    close();
  }
  function keys(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const eligible = filtered
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = eligible.indexOf(active);
      setActive(
        event.key === "Home"
          ? (eligible[0] ?? -1)
          : event.key === "End"
            ? (eligible.at(-1) ?? -1)
            : event.key === "ArrowDown"
              ? (eligible[(index + 1) % eligible.length] ?? -1)
              : (eligible[(index - 1 + eligible.length) % eligible.length] ??
                -1)
      );
    } else if (
      event.key === "Enter" ||
      (event.key === " " && event.target !== search.current)
    ) {
      event.preventDefault();
      choose(active);
    } else if (
      !canSearch &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      const now = Date.now();
      typeahead.current = {
        text:
          (now - typeahead.current.time < 700 ? typeahead.current.text : "") +
          event.key.toLocaleLowerCase(),
        time: now
      };
      const next = filtered.findIndex(
        (option) =>
          !option.disabled &&
          option.label.toLocaleLowerCase().startsWith(typeahead.current.text)
      );
      if (next >= 0) setActive(next);
    }
  }
  return (
    <span className={"select-field " + className} ref={root}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={aria["aria-label"] || label || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            show(event.key === "ArrowUp" || event.key === "End");
          }
        }}
      >
        <span>{selected?.label || "Select…"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <select
        className="select-native"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        onChange={(event) =>
          onChange({ target: { value: event.target.value } })
        }
        onInvalid={(event) => {
          event.preventDefault();
          trigger.current?.focus();
          show();
        }}
      >
        {children}
      </select>
      <div
        ref={popup}
        popover="auto"
        className="select-popup"
        onToggle={() => setOpen(!!popup.current?.matches(":popover-open"))}
        onKeyDown={keys}
      >
        {canSearch && (
          <div className="select-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              ref={search}
              aria-label={
                "Search " + (label || aria["aria-label"] || "options")
              }
              value={query}
              placeholder="Search…"
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                setActive(
                  options
                    .filter((option) =>
                      option.label
                        .toLocaleLowerCase()
                        .includes(next.toLocaleLowerCase())
                    )
                    .findIndex((option) => !option.disabled)
                );
              }}
            />
          </div>
        )}
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label || aria["aria-label"] || "Options"}
          aria-activedescendant={
            active >= 0 ? uid + "-option-" + active : undefined
          }
          tabIndex={-1}
          className="select-options"
        >
          {filtered.map((option, index) => (
            <span key={option.value + index}>
              {option.group && filtered[index - 1]?.group !== option.group && (
                <span className="select-group" aria-hidden="true">
                  {option.group}
                </span>
              )}
              <button
                type="button"
                id={uid + "-option-" + index}
                role="option"
                aria-selected={option.value === String(value)}
                aria-disabled={option.disabled || undefined}
                tabIndex={-1}
                data-highlighted={index === active || undefined}
                className="select-option"
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === String(value) && (
                  <Check size={14} aria-hidden="true" />
                )}
              </button>
            </span>
          ))}
          {!filtered.length && <span className="select-empty">No matches</span>}
        </div>
      </div>
    </span>
  );
}
