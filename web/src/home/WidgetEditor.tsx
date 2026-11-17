import { useState, type FormEvent } from "react";
import Select from "../components/Select";
import {
  sections,
  newWidget,
  type HomeWidget,
  type WidgetKind
} from "./layout";

export default function WidgetEditor({
  widget,
  existing,
  busy,
  onApply,
  onCancel
}: {
  widget?: HomeWidget;
  existing: HomeWidget[];
  busy: boolean;
  onApply: (widget: HomeWidget) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(widget ?? newWidget("html"));
  const [error, setError] = useState("");
  const [height, setHeight] = useState(String(widget?.height ?? 260));
  function update(patch: Partial<HomeWidget>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.kind === "html" && !draft.html.trim()) {
      setError("Enter HTML for this widget.");
      return;
    }
    if (draft.kind === "webview") {
      try {
        const url = new URL(draft.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw Error();
      } catch {
        setError("Enter an HTTPS website address without credentials.");
        return;
      }
    }
    await onApply({ ...draft, height: Number(height) });
  }
  return (
    <form
      className="home-widget-editor"
      aria-label="Widget settings"
      onSubmit={(event) => void submit(event)}
    >
      <div className="section-title">
        <h2>{widget ? "Edit widget" : "Add a widget"}</h2>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {!widget && (
        <label>
          Component
          <Select
            aria-label="Widget component"
            value={draft.kind}
            disabled={busy}
            onChange={(event) => {
              setDraft(newWidget(event.target.value as WidgetKind));
              setError("");
            }}
          >
            {sections
              .filter(([kind]) => !existing.some((item) => item.kind === kind))
              .map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            <option value="html">Custom HTML</option>
            <option value="webview">Website frame</option>
          </Select>
        </label>
      )}
      {(draft.kind === "html" || draft.kind === "webview") && (
        <>
          <label>
            Title
            <input
              aria-label="Widget title"
              maxLength={80}
              value={draft.title}
              disabled={busy}
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
          {draft.kind === "html" ? (
            <label>
              HTML
              <textarea
                aria-label="Widget HTML"
                rows={8}
                spellCheck={false}
                maxLength={20000}
                value={draft.html}
                disabled={busy}
                onChange={(event) => update({ html: event.target.value })}
              />
            </label>
          ) : (
            <label>
              Website URL
              <input
                aria-label="Widget website URL"
                type="url"
                placeholder="https://"
                maxLength={4096}
                value={draft.url}
                disabled={busy}
                onChange={(event) => update({ url: event.target.value })}
              />
              <span className="muted">The website must allow embedding.</span>
            </label>
          )}
          <label>
            Height
            <input
              aria-label="Widget height"
              type="number"
              min={120}
              max={900}
              step={10}
              required
              value={height}
              disabled={busy}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
          <p className="muted">
            Custom content runs in an isolated frame without access to your
            workspace session.
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy} type="submit">
        {widget ? "Apply changes" : "Add widget"}
      </button>
    </form>
  );
}
