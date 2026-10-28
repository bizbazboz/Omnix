import { useMemo, useEffect } from "react";
import { Play, Square, RotateCcw, Copy, X } from "lucide-react";
import Select from "../../components/Select";
import {
  codeLanguages,
  highlightedCode,
  normalizedLanguage
} from "./codeLanguages";
import { useNotebookCell, type KernelLanguage } from "./NotebookExecution";
export default function CodeCell({
  id,
  source,
  language,
  contentRef,
  onLanguage
}: {
  id: string;
  source: string;
  language: string;
  contentRef: (node: HTMLElement | null) => void;
  onLanguage: (value: string) => void;
}) {
  const highlight = useMemo(
    () => highlightedCode(source, language),
    [source, language]
  );
  const { runtime, state, enabled } = useNotebookCell(id),
    effective = highlight.language;
  const executable = effective === "python" || effective === "javascript",
    busy = ["queued", "loading", "running"].includes(state.status);
  useEffect(() => () => runtime.cancelCell(id), [runtime, id]);
  function run() {
    if (executable && enabled && !busy)
      void runtime.run(id, effective as KernelLanguage, source);
  }
  return (
    <div
      className="notebook-code-cell"
      data-cell-id={id}
      data-language={effective}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey || event.shiftKey) &&
          executable &&
          enabled
        ) {
          event.preventDefault();
          event.stopPropagation();
          run();
        }
      }}
    >
      <header className="code-cell-header" contentEditable={false}>
        <Select
          aria-label="Code language"
          disabled={!enabled || busy}
          value={normalizedLanguage(language)}
          onChange={(event) => onLanguage(event.target.value)}
        >
          <option value="auto">
            Auto
            {effective !== "plaintext"
              ? " · " + (codeLanguages[effective] || effective)
              : ""}
          </option>
          {Object.entries(codeLanguages).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <div>
          {executable && (
            <>
              {busy ? (
                <button
                  className="text-button"
                  type="button"
                  title="Stop and reset kernel"
                  aria-label="Stop cell"
                  onClick={() => runtime.stop(effective as KernelLanguage)}
                >
                  <Square size={14} />
                  Stop
                </button>
              ) : (
                <button
                  className="text-button"
                  type="button"
                  disabled={!enabled || !source.trim()}
                  title="Run cell · Shift+Enter"
                  aria-label={
                    "Run " +
                    (effective === "python" ? "Python" : "JavaScript") +
                    " cell"
                  }
                  onClick={run}
                >
                  <Play size={14} />
                  Run
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                disabled={!enabled}
                aria-label="Restart cell kernel"
                title="Restart this language kernel"
                onClick={() =>
                  runtime.stop(effective as KernelLanguage, "Kernel restarted.")
                }
              >
                <RotateCcw size={14} />
              </button>
            </>
          )}
          <button
            className="icon-button"
            type="button"
            title="Copy code"
            aria-label="Copy code"
            onClick={() => void navigator.clipboard.writeText(source)}
          >
            <Copy size={14} />
          </button>
        </div>
      </header>
      <div className="code-cell-source" data-empty={!source.trim()}>
        <pre className="code-cell-highlight" aria-hidden="true">
          <code
            dangerouslySetInnerHTML={{
              __html: highlight.html + (source.endsWith("\n") ? " " : "")
            }}
          />
        </pre>
        <pre className="code-cell-editor">
          <code ref={contentRef} spellCheck={false} />
        </pre>
      </div>
      {state.status !== "idle" && (
        <section
          className="code-cell-result"
          contentEditable={false}
          aria-label="Cell output"
        >
          <header>
            <span className="eyebrow">
              {state.count ? "OUT [" + state.count + "] · " : ""}
              {state.status === "loading"
                ? "STARTING PYTHON…"
                : state.status.toUpperCase()}
              {state.duration !== undefined
                ? " · " + (state.duration / 1000).toFixed(2) + "S"
                : ""}
            </span>
            <button
              className="icon-button"
              type="button"
              disabled={busy}
              aria-label="Clear cell output"
              title="Clear output"
              onClick={() => runtime.clear(id)}
            >
              <X size={14} />
            </button>
          </header>
          <pre className="code-cell-output" aria-live="polite">
            {state.output.length
              ? state.output.map((line, index) => (
                  <span
                    className={line.error ? "code-output-error" : ""}
                    key={index}
                  >
                    {line.text + "\n"}
                  </span>
                ))
              : busy
                ? "[RUNNING]"
                : "No output."}
          </pre>
        </section>
      )}
    </div>
  );
}
