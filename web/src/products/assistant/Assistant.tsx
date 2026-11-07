import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ArrowUpRight, ArrowUp, Square, RotateCcw } from "lucide-react";
import Select from "../../components/Select";
import { api } from "../../lib/api";
import { defaultModel, localModels, type ModelId } from "./models";
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
    stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
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
  const [modelId, setModelId] = useState<ModelId>(defaultModel.id);
  const [runtime, setRuntime] = useState("CPU"),
    [stopping, setStopping] = useState(false);
  const model = localModels.find((model) => model.id === modelId)!;
  const [contextOpen, setContextOpen] = useState(false);
  const busy = ["loading", "retrieving", "generating"].includes(phase);
  useEffect(
    () => () => {
      clearTimeout(stopTimer.current);
      worker.current?.terminate();
    },
    []
  );
  useEffect(() => {
    if (phase === "generating")
      bottom.current?.scrollIntoView({ block: "nearest" });
  }, [answers, phase]);
  function createWorker() {
    const instance = new Worker(new URL("./model.worker.ts", import.meta.url), {
      type: "module"
    });
    instance.onmessage = (event) => {
      if (worker.current !== instance) return;
      const data = event.data;
      if (data.type === "ready") {
        setRuntime(data.device === "webgpu" ? "GPU" : "CPU");
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
      if (data.type === "done") {
        clearTimeout(stopTimer.current);
        setStopping(false);
        setProgress("");
        if (data.stopped)
          setAnswers((rows) =>
            rows.map((row, index) =>
              index === rows.length - 1 && !row.text
                ? { ...row, text: "Generation stopped." }
                : row
            )
          );
        setPhase("ready");
      }
      if (data.type === "fallback") {
        instance.terminate();
        worker.current = null;
        setProgress("GPU unavailable. Loading the CPU model…");
        createWorker().postMessage({ type: "load", model: modelId, cpu: true });
      }
      if (data.type === "error") {
        setError(data.message);
        clearTimeout(stopTimer.current);
        setStopping(false);
        setPhase("idle");
        instance.terminate();
        worker.current = null;
      }
    };
    instance.onerror = () => {
      clearTimeout(stopTimer.current);
      setStopping(false);
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
    (worker.current || createWorker()).postMessage({
      type: "load",
      model: modelId
    });
  }
  function stop() {
    if (phase === "generating") {
      if (stopping) return;
      worker.current?.postMessage({ type: "stop" });
      setStopping(true);
      setProgress("Stopping generation…");
      stopTimer.current = setTimeout(() => {
        worker.current?.terminate();
        worker.current = null;
        setStopping(false);
        setPhase("idle");
        setAnswers((rows) =>
          rows.map((row, index) =>
            index === rows.length - 1 && !row.text
              ? { ...row, text: "Generation stopped." }
              : row
          )
        );
        setProgress("Generation stopped. Reload the model to continue.");
      }, 5000);
      return;
    }
    worker.current?.terminate();
    worker.current = null;
    setPhase("idle");
    setProgress("");
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "ready" || !question.trim()) return;
    setError("");
    setPhase("retrieving");
    try {
      const data = sources.length
        ? await api<{
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
          )
        : {
            items: [] as Source[],
            as_of: new Date().toISOString(),
            notes_partial: false
          };
      // Retain sources for follow-up questions, but never reintroduce an
      // unchecked source or replace a freshly retrieved extract with old data.
      const kinds: Record<string, string> = {
        note: "notes",
        event: "calendar",
        issue: "projects"
      };
      const items = data.items.slice(0, 8);
      for (const source of answers
        .slice(-2)
        .flatMap((answer) => answer.items)
        .reverse())
        if (
          items.length < 8 &&
          sources.includes(kinds[source.kind]) &&
          !items.some((item) => item.href === source.href)
        )
          items.push(source);
      setAnswers((rows) => [
        ...rows,
        {
          question,
          text: "",
          items,
          as_of: data.as_of,
          partial: data.notes_partial
        }
      ]);
      worker.current?.postMessage({
        type: "generate",
        question,
        items,
        history: answers
          .filter(
            (answer) => answer.text && answer.text !== "Generation stopped."
          )
          .slice(-2)
          .flatMap((answer) => [
            { role: "user", content: answer.question },
            { role: "assistant", content: answer.text }
          ]),
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
      if ("caches" in window)
        await Promise.all(
          localModels.map((model) => caches.delete(model.cache))
        );
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
            {model.name} / ON THIS DEVICE
          </span>
          <label className="form-label">
            Model
            <Select
              aria-label="AI model"
              value={modelId}
              disabled={busy}
              onChange={(event) => {
                stop();
                setError("");
                setModelId(event.target.value as ModelId);
              }}
            >
              {localModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.description}
                </option>
              ))}
            </Select>
          </label>
          <p>One-time download: {model.download}. Answers run locally.</p>
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
                MODEL READY / LOCAL {runtime}
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
              <h2>Ask anything.</h2>
              <p>
                Ask a general question, find details in your notes, or check
                what’s coming up.
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
              ASK OMNIX
            </label>
            <div>
              <textarea
                id="assistant-question"
                rows={2}
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question or explore your workspace…"
                disabled={
                  phase === "loading" ||
                  phase === "retrieving" ||
                  phase === "generating"
                }
              />
              {phase === "generating" ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={stop}
                  disabled={stopping}
                >
                  <Square size={16} />
                  Stop
                </button>
              ) : (
                <button
                  className="primary"
                  aria-label="Ask AI"
                  disabled={phase !== "ready" || !question.trim()}
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
