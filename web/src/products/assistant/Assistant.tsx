import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ArrowUpRight, ArrowUp, Square, RotateCcw } from "lucide-react";
import Select from "../../components/Select";
import { api } from "../../lib/api";
import "./assistant.css";
type Source = { kind: string; title: string; text: string; href: string };
type Answer = {
  question: string;
  text: string;
  items: Source[];
  as_of: string;
  partial: boolean;
};
export default function Assistant({ onNavigate }: { onNavigate: () => void }) {
  const worker = useRef<Worker | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<
      "idle" | "loading" | "ready" | "retrieving" | "generating"
    >("idle"),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [question, setQuestion] = useState(""),
    [sources, setSources] = useState(["notes", "calendar", "projects"]),
    [days, setDays] = useState("14"),
    [answers, setAnswers] = useState<Answer[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const busy = ["loading", "retrieving", "generating"].includes(phase);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (phase === "generating")
      bottom.current?.scrollIntoView({ block: "nearest" });
  }, [answers, phase]);
  function createWorker() {
    const instance = new Worker(new URL("./model.worker.ts", import.meta.url), {
      type: "module"
    });
    instance.onmessage = (event) => {
      const data = event.data;
      if (data.type === "ready") {
        setPhase("ready");
        setProgress("");
      }
      if (data.type === "progress")
        setProgress(
          data.total
            ? `${Math.round(data.loaded / 1024 / 1024)} / ${Math.round(data.total / 1024 / 1024)} MB`
            : "Loading model files…"
        );
      if (data.type === "token")
        setAnswers((rows) =>
          rows.map((row, i) =>
            i === rows.length - 1 ? { ...row, text: row.text + data.text } : row
          )
        );
      if (data.type === "done") setPhase("ready");
      if (data.type === "error") {
        setError(data.message);
        setPhase("idle");
        instance.terminate();
        worker.current = null;
      }
    };
    instance.onerror = () => {
      setError("The local AI runtime stopped. Reload the model to continue.");
      setPhase("idle");
      instance.terminate();
      worker.current = null;
    };
    worker.current = instance;
    return instance;
  }
  function load() {
    setError("");
    setProgress("Preparing browser runtime…");
    setPhase("loading");
    (worker.current || createWorker()).postMessage({ type: "load" });
  }
  function stop() {
    worker.current?.terminate();
    worker.current = null;
    if (phase === "generating")
      setAnswers((rows) =>
        rows.map((row, i) =>
          i === rows.length - 1 && !row.text
            ? { ...row, text: "Generation stopped." }
            : row
        )
      );
    setPhase("idle");
    setProgress("");
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "ready" || !question.trim() || !sources.length) return;
    setError("");
    setPhase("retrieving");
    try {
      const data = await api<{
        items: Source[];
        as_of: string;
        notes_partial: boolean;
      }>(
        "/assistant/context?" +
          new URLSearchParams({
            question: question.trim(),
            sources: sources.join(","),
            days
          })
      );
      if (!data.items.length) {
        setAnswers((rows) => [
          ...rows,
          {
            question,
            text: "No matching information was found in the selected sources and date range.",
            items: [],
            as_of: data.as_of,
            partial: data.notes_partial
          }
        ]);
        setQuestion("");
        setPhase("ready");
        return;
      }
      setAnswers((rows) => [
        ...rows,
        {
          question,
          text: "",
          items: data.items,
          as_of: data.as_of,
          partial: data.notes_partial
        }
      ]);
      worker.current?.postMessage({
        type: "generate",
        question,
        items: data.items,
        as_of: data.as_of
      });
      setQuestion("");
      setPhase("generating");
    } catch (e) {
      setError((e as Error).message);
      setPhase("ready");
    }
  }
  async function clear() {
    stop();
    setAnswers([]);
    setError("");
    try {
      if ("caches" in window) await caches.delete("omnix-smollm2-v1");
      setProgress("Downloaded model removed from this browser.");
    } catch {
      setError(
        "The browser could not remove its model cache. Clear this site's storage in browser settings."
      );
    }
  }
  return (
    <div className="assistant-chat-content">
      <div className="assistant-layout">
        <section className="assistant-controls" aria-label="AI context">
          <span className="eyebrow">LOCAL MODEL</span>
          <span className="assistant-model-name">
            SmolLM2 · 135M / ON THIS DEVICE
          </span>
          <p>One-time model download: about 140 MB. Answers run locally.</p>
          <div className="assistant-model-actions">
            {phase === "idle" ? (
              <button className="primary" onClick={load}>
                Load local model
              </button>
            ) : phase === "loading" ? (
              <button className="secondary" onClick={stop}>
                Cancel download
              </button>
            ) : (
              <span className="assistant-ready" role="status">
                MODEL READY / LOCAL CPU
              </span>
            )}
          </div>
          {progress && (
            <p className="assistant-progress" role="status">
              {progress}
            </p>
          )}
          <button
            className="text-button assistant-context-toggle"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen(!contextOpen)}
          >
            {contextOpen ? "Hide context and storage" : "Context and storage"}
          </button>
          {contextOpen && (
            <div className="assistant-options">
              <fieldset disabled={busy}>
                <legend>USE AS CONTEXT</legend>
                {["notes", "calendar", "projects"].map((source) => (
                  <label key={source} className="checkbox">
                    <input
                      type="checkbox"
                      checked={sources.includes(source)}
                      onChange={(e) =>
                        setSources(
                          e.target.checked
                            ? [...sources, source]
                            : sources.filter((s) => s !== source)
                        )
                      }
                    />
                    {source[0].toUpperCase() + source.slice(1)}
                  </label>
                ))}
                <label className="form-label">
                  Calendar range
                  <Select
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  >
                    {[7, 14, 30, 90].map((n) => (
                      <option key={n} value={n}>
                        Next {n} days
                      </option>
                    ))}
                  </Select>
                </label>
              </fieldset>
              <p>
                Questions and answers stay in this tab. Relevant workspace
                extracts are retrieved from Omnix; inference runs locally. Model
                downloads go to Hugging Face.
              </p>
              <p>Small models can be wrong. Check the linked sources.</p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setAnswers([])}
              >
                <RotateCcw size={15} /> Clear conversation
              </button>
              <button className="text-button" disabled={busy} onClick={clear}>
                Remove downloaded model
              </button>
            </div>
          )}
        </section>
        <section
          className="assistant-conversation"
          aria-label="AI conversation"
        >
          {!answers.length && (
            <div className="assistant-welcome">
              <span className="eyebrow">YOUR WORKSPACE / YOUR DEVICE</span>
              <h2>Ask your workspace.</h2>
              <p>
                Find details in your notes, see what’s coming up, or check
                project tasks.
              </p>
              <div className="assistant-suggestions">
                {[
                  "What is on my calendar this week?",
                  "Summarise my recent notes",
                  "Which project tasks are still open?"
                ].map((text) => (
                  <button key={text} onClick={() => setQuestion(text)}>
                    {text}
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="assistant-answers" aria-live="polite">
            {answers.map((answer, i) => (
              <article key={i}>
                <h3>{answer.question}</h3>
                <p className="assistant-answer">
                  {answer.text || "Thinking locally…"}
                </p>
                {answer.items.length > 0 && (
                  <details>
                    <summary>Sources · {answer.items.length}</summary>
                    <div className="assistant-sources">
                      {answer.items.map((source, index) => (
                        <NavLink
                          key={source.href}
                          to={source.href}
                          onClick={onNavigate}
                        >
                          <span>
                            [{index + 1}] {source.title}
                            <small>{source.kind.toUpperCase()}</small>
                          </span>
                          <ArrowUpRight size={15} />
                        </NavLink>
                      ))}
                    </div>
                    <small>
                      Retrieved {new Date(answer.as_of).toLocaleString()}
                      {answer.partial
                        ? " · Notes search limited to the latest 250 pages"
                        : ""}
                    </small>
                  </details>
                )}
              </article>
            ))}
          </div>
          <div ref={bottom} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form className="assistant-prompt" onSubmit={ask}>
            <label htmlFor="assistant-question" className="eyebrow">
              ASK YOUR WORKSPACE
            </label>
            <div>
              <textarea
                id="assistant-question"
                rows={2}
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about your notes, calendar or projects…"
                disabled={
                  phase === "loading" ||
                  phase === "retrieving" ||
                  phase === "generating"
                }
              />
              {phase === "generating" ? (
                <button type="button" className="secondary" onClick={stop}>
                  <Square size={16} />
                  Stop
                </button>
              ) : (
                <button
                  className="primary"
                  aria-label="Ask AI"
                  disabled={
                    phase !== "ready" || !question.trim() || !sources.length
                  }
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
            <span className="assistant-progress">
              {phase === "retrieving"
                ? "Finding relevant sources…"
                : phase === "generating"
                  ? "Generating on this device…"
                  : phase === "idle"
                    ? "Load the model to begin."
                    : phase === "loading"
                      ? "Downloading model…"
                      : "READY"}
            </span>
          </form>
        </section>
      </div>
    </div>
  );
}
