import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { prepareJavaScript } from "./javascriptCells";
import { runnableCells } from "./codeLanguages";
export type KernelLanguage = "python" | "javascript";
export type CellState = {
  status:
    "idle" | "queued" | "loading" | "running" | "done" | "error" | "stopped";
  output: { text: string; error: boolean }[];
  count: number;
  duration?: number;
};
class NotebookRuntime {
  frame: HTMLIFrameElement | null = null;
  channel = crypto.randomUUID();
  ready: Promise<void> | null = null;
  readyResolve: (() => void) | null = null;
  readyReject: ((error: Error) => void) | null = null;
  states = new Map<string, CellState>();
  listeners = new Map<string, Set<() => void>>();
  pending = new Map<
    string,
    {
      cell: string;
      language: KernelLanguage;
      resolve: (state: CellState) => void;
      timer: ReturnType<typeof setTimeout>;
      start: number;
    }
  >();
  chains: Partial<Record<KernelLanguage, Promise<unknown>>> = {};
  generation = { python: 0, javascript: 0 };
  counts = { python: 0, javascript: 0 };
  cellRuns = new Map<string, Promise<CellState>>();
  revision = 0;
  disposed = false;
  enabled = true;
  constructor() {}
  get = (id: string): CellState => {
    if (!this.states.has(id))
      this.states.set(id, { status: "idle", output: [], count: 0 });
    return this.states.get(id)!;
  };
  subscribe = (id: string, listener: () => void) => {
    const group = this.listeners.get(id) || new Set();
    group.add(listener);
    this.listeners.set(id, group);
    return () => {
      group.delete(listener);
    };
  };
  update(id: string, patch: Partial<CellState>) {
    this.states.set(id, { ...this.get(id), ...patch });
    this.revision++;
    this.listeners.get(id)?.forEach((fn) => fn());
    this.listeners.get("*")?.forEach((fn) => fn());
  }
  async initialize() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    window.addEventListener("message", this.message);
    this.frame = document.createElement("iframe");
    this.frame.hidden = true;
    this.frame.title = "Notebook execution sandbox";
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.src = "/notebook/runtime.html?channel=" + this.channel;
    document.body.append(this.frame);
    const timer = setTimeout(
      () =>
        this.readyReject?.(
          new Error(
            "The notebook sandbox could not start. Reload the page and retry."
          )
        ),
      20000
    );
    try {
      await this.ready;
    } finally {
      clearTimeout(timer);
    }
  }
  message = (event: MessageEvent) => {
    if (
      event.source !== this.frame?.contentWindow ||
      event.origin !== "null" ||
      event.data?.channel !== this.channel
    )
      return;
    const data = event.data;
    if (data.type === "ready") {
      this.readyResolve?.();
      return;
    }
    const request = this.pending.get(data.id);
    if (!request) return;
    if (data.type === "loading" || data.type === "running") {
      clearTimeout(request.timer);
      request.timer = setTimeout(
        () =>
          this.stop(
            request.language,
            data.type === "loading"
              ? "Python initialization timed out. Retry to restart the kernel."
              : "Stopped after 15 seconds; the kernel was reset."
          ),
        data.type === "loading" ? 60000 : 15000
      );
      this.update(request.cell, { status: data.type });
    } else if (data.type === "output" && typeof data.text === "string") {
      const output = this.get(request.cell).output;
      const used = output.reduce((sum, line) => sum + line.text.length, 0);
      if (used < 67000 && output.length < 1000)
        this.update(request.cell, {
          output: [
            ...output,
            {
              text: data.text.slice(0, 67000 - used),
              error: Boolean(data.error)
            }
          ]
        });
    } else if (data.type === "done") {
      clearTimeout(request.timer);
      this.pending.delete(data.id);
      this.update(request.cell, {
        status: data.failed ? "error" : "done",
        duration: Date.now() - request.start
      });
      request.resolve(this.get(request.cell));
    }
  };
  run(cell: string, language: KernelLanguage, source: string) {
    if (["queued", "loading", "running"].includes(this.get(cell).status))
      return this.cellRuns.get(cell) || Promise.resolve(this.get(cell));
    if (!this.enabled) return Promise.resolve(this.get(cell));
    const generation = this.generation[language];
    this.update(cell, { status: "queued", output: [], duration: undefined });
    const task = (this.chains[language] || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.disposed || generation !== this.generation[language]) {
          this.update(cell, { status: "stopped" });
          return this.get(cell);
        }
        try {
          if (source.length > 100000)
            throw new Error(
              "Executable cells are limited to 100,000 characters."
            );
          const code =
            language === "javascript" ? prepareJavaScript(source) : source;
          await this.initialize();
          if (this.disposed || generation !== this.generation[language])
            return this.get(cell);
          const id = crypto.randomUUID();
          this.update(cell, {
            status: "running",
            count: ++this.counts[language]
          });
          return await new Promise<CellState>((resolve) => {
            const timer = setTimeout(
              () =>
                this.stop(
                  language,
                  "Stopped after 15 seconds; the kernel was reset."
                ),
              15000
            );
            this.pending.set(id, {
              cell,
              language,
              resolve,
              timer,
              start: Date.now()
            });
            this.frame!.contentWindow!.postMessage(
              { channel: this.channel, type: "run", id, language, code },
              "*"
            );
          });
        } catch (error) {
          this.update(cell, {
            status: "error",
            output: [{ text: (error as Error).message, error: true }]
          });
          return this.get(cell);
        }
      });
    this.chains[language] = task;
    this.cellRuns.set(cell, task);
    void task.finally(() => {
      if (this.cellRuns.get(cell) === task) this.cellRuns.delete(cell);
    });
    return task;
  }
  stop(language: KernelLanguage, message = "Stopped; the kernel was reset.") {
    this.generation[language]++;
    this.counts[language] = 0;
    this.frame?.contentWindow?.postMessage(
      { channel: this.channel, type: "reset", language },
      "*"
    );
    for (const [id, request] of this.pending)
      if (request.language === language) {
        clearTimeout(request.timer);
        this.pending.delete(id);
        this.update(request.cell, {
          status: "stopped",
          output: [
            ...this.get(request.cell).output,
            { text: message, error: true }
          ]
        });
        request.resolve(this.get(request.cell));
      }
  }
  cancelCell(id: string) {
    for (const request of this.pending.values())
      if (request.cell === id) {
        this.stop(request.language, "Cell removed; kernel reset.");
        break;
      }
  }
  clear(id: string) {
    this.update(id, {
      status: "idle",
      output: [],
      count: 0,
      duration: undefined
    });
  }
  busy() {
    return [...this.states.values()].some((state) =>
      ["queued", "running", "loading"].includes(state.status)
    );
  }
  dispose() {
    this.disposed = true;
    this.stop("python");
    this.stop("javascript");
    window.removeEventListener("message", this.message);
    this.frame?.remove();
    this.listeners.clear();
  }
}
const NotebookContext = createContext<{
  runtime: NotebookRuntime;
  enabled: boolean;
} | null>(null);
export function NotebookProvider({
  children,
  enabled = true
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const runtime = useRef<NotebookRuntime | null>(null);
  if (!runtime.current) runtime.current = new NotebookRuntime();
  runtime.current.enabled = enabled;
  useEffect(() => {
    runtime.current!.disposed = false;
    return () => runtime.current?.dispose();
  }, []);
  return (
    <NotebookContext.Provider value={{ runtime: runtime.current, enabled }}>
      {children}
    </NotebookContext.Provider>
  );
}
export function useNotebookCell(id: string) {
  const context = useContext(NotebookContext);
  if (!context) throw new Error("Notebook context is missing.");
  const { runtime, enabled } = context;
  const state = useSyncExternalStore(
    (listener) => runtime.subscribe(id, listener),
    () => runtime.get(id)
  );
  return { runtime, state, enabled };
}
export function NotebookToolbar({ blocks }: { blocks: readonly unknown[] }) {
  const { runtime, enabled } = useContext(NotebookContext)!;
  useSyncExternalStore(
    (listener) => runtime.subscribe("*", listener),
    () => runtime.revision
  );
  const cells = runnableCells(blocks);
  if (!cells.length || !enabled) return null;
  const busy = runtime.busy();
  return (
    <div className="notebook-toolbar" contentEditable={false}>
      <span className="eyebrow">
        NOTEBOOK · {cells.length} {cells.length === 1 ? "CELL" : "CELLS"}
      </span>
      <div>
        {busy ? (
          <button
            className="text-button"
            onClick={() => {
              runtime.stop("python");
              runtime.stop("javascript");
            }}
          >
            <Square size={13} />
            Stop
          </button>
        ) : (
          <button
            className="text-button"
            onClick={() =>
              void (async () => {
                for (const cell of cells) {
                  const result = await runtime.run(
                    cell.id,
                    cell.language,
                    cell.source
                  );
                  if (result.status === "error" || result.status === "stopped")
                    break;
                }
              })()
            }
          >
            <Play size={13} />
            Run all
          </button>
        )}
        <button
          className="text-button"
          onClick={() => {
            runtime.stop("python", "Kernel restarted.");
            runtime.stop("javascript", "Kernel restarted.");
          }}
        >
          <RotateCcw size={13} />
          Restart kernels
        </button>
      </div>
    </div>
  );
}
