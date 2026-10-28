import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Download,
  Trash2,
  Circle,
  Bug,
  Bookmark,
  Layers,
  CheckSquare
} from "lucide-react";
import Select from "../../components/Select";
import { qc } from "../../lib/api";
import {
  notesApi,
  allPages,
  invalidateNotes,
  defaultTask,
  taskPayload,
  download,
  type Task,
  type Note,
  type ProjectInfo
} from "./api";
import IssueDetails from "./IssueDetails";
export const statuses = [
  ["backlog", "Backlog"],
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["in_review", "In review"],
  ["blocked", "Blocked"],
  ["done", "Done"]
];
export const issueTypes = [
  ["task", "Task"],
  ["story", "Story"],
  ["bug", "Bug"],
  ["epic", "Epic"],
  ["subtask", "Subtask"]
];
export function IssueIcon({ type }: { type: string }) {
  const Icon =
    type === "bug"
      ? Bug
      : type === "epic"
        ? Layers
        : type === "story"
          ? Bookmark
          : type === "subtask"
            ? CheckSquare
            : Circle;
  return <Icon size={15} aria-hidden="true" />;
}
export default function Project({ id }: { id: string }) {
  const navigate = useNavigate(),
    [params, setParams] = useSearchParams(),
    rawView = params.get("view") === "table" ? "issues" : params.get("view"),
    view = ["board", "backlog", "issues", "overview", "notes"].includes(
      rawView || ""
    )
      ? rawView!
      : "board";
  const [draft, setDraft] = useState<Partial<Task> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const project = useQuery<ProjectInfo>({
    queryKey: ["note-project", id],
    queryFn: () => notesApi(`/projects/${id}`)
  });
  const tasks = useQuery<Task[]>({
    queryKey: ["project-tasks", id],
    queryFn: () => notesApi(`/projects/${id}/tasks`)
  });
  const pages = useQuery({
    queryKey: ["note-pages"],
    queryFn: () => allPages()
  });
  const search = params.get("q") || "",
    status = params.get("status") || "",
    priority = params.get("priority") || "",
    type = params.get("type") || "",
    sprint = params.get("sprint") || "";
  function filter(key: string, value: string, replace = true) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace }
    );
  }
  function refresh() {
    qc.invalidateQueries({ queryKey: ["project-tasks", id] });
    qc.invalidateQueries({ queryKey: ["note-project", id] });
    invalidateNotes();
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
      throw error;
    } finally {
      setBusy(false);
    }
  }
  async function change(task: Task) {
    await run(async () => {
      const updated = await notesApi<Task>(`/projects/${id}/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify(taskPayload(task))
      });
      qc.setQueryData<Task[]>(["project-tasks", id], (current) =>
        current?.map((row) => (row.id === updated.id ? updated : row))
      );
      refresh();
    });
  }
  const rows = tasks.data || [],
    notes = (pages.data || []).filter((page) => page.project_id === id);
  const filtered = rows.filter(
    (task) =>
      (!search ||
        (
          task.issue_key +
          " " +
          task.title +
          " " +
          task.description +
          " " +
          task.labels.join(" ")
        )
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status || task.status === status) &&
      (!priority || task.priority === priority) &&
      (!type || task.issue_type === type) &&
      (!sprint || task.sprint === sprint)
  );
  const editing = draft || rows.find((row) => row.id === params.get("issue"));
  function open(task: Task) {
    setDraft(null);
    filter("issue", task.id, false);
  }
  function close() {
    setDraft(null);
    filter("issue", "", false);
  }
  function create(value: Partial<Task> = {}) {
    filter("issue", "");
    setDraft({ ...defaultTask, ...value });
  }
  async function createNote() {
    const note = await notesApi<Note>("/pages", {
      method: "POST",
      body: JSON.stringify({ project_id: id, title: "Project notes" })
    });
    invalidateNotes();
    navigate("/notes/pages/" + note.id);
  }
  const issueRow = (task: Task) => (
    <div className="issue-list-entry" key={task.id}>
      <button className="issue-row" onClick={() => open(task)}>
        <IssueIcon type={task.issue_type} />
        <span className="issue-key">{task.issue_key}</span>
        <span className="issue-row-title">{task.title}</span>
        <span className="issue-status">
          {statuses.find(([key]) => key === task.status)?.[1]}
        </span>
        <small>{task.priority}</small>
        {task.estimate !== null && (
          <span className="issue-estimate">{task.estimate}</span>
        )}
      </button>
      {task.status === "backlog" && (
        <Select
          aria-label={"Status for " + task.issue_key}
          value={task.status}
          disabled={busy}
          onChange={(event) =>
            void change({ ...task, status: event.target.value }).catch(() => {})
          }
        >
          {statuses.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
  if (project.error)
    return (
      <div className="page">
        <h1>Project unavailable</h1>
        <p className="error">{project.error.message}</p>
        <NavLink to="/notes/projects">Projects</NavLink>
      </div>
    );
  if (!project.data) return <p className="page muted">[LOADING PROJECT]</p>;
  const pr = project.data;
  return (
    <article className="notes-page project-page">
      <header className="notes-heading">
        <span className="eyebrow">PROJECT / {pr.issue_prefix}</span>
        <div className="note-actions">
          <button
            className="icon-button"
            aria-label="Export issues"
            onClick={() => {
              const csv = [
                [
                  "Key",
                  "Type",
                  "Summary",
                  "Status",
                  "Priority",
                  "Sprint",
                  "Points",
                  "Due",
                  "Labels"
                ],
                ...rows.map((task) => [
                  task.issue_key,
                  task.issue_type,
                  task.title,
                  task.status,
                  task.priority,
                  task.sprint,
                  String(task.estimate ?? ""),
                  task.end || "",
                  task.labels.join(";")
                ])
              ]
                .map((row) =>
                  row
                    .map(
                      (value) =>
                        '\"' +
                        (/^[=+@\-\t\r]/.test(value) ? "'" : "") +
                        value.replaceAll('\"', '\"\"') +
                        '\"'
                    )
                    .join(",")
                )
                .join("\n");
              download(pr.title + ".csv", csv, "text/csv");
            }}
          >
            <Download size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Archive project"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Move this project to recoverable trash?"))
                void run(async () => {
                  await notesApi(`/projects/${id}`, {
                    method: "DELETE",
                    body: JSON.stringify({ expected_revision: pr.revision })
                  });
                  invalidateNotes();
                  navigate("/notes/projects");
                }).catch(() => {});
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>
      <input
        key={pr.id + pr.revision}
        className="note-title"
        aria-label="Project title"
        defaultValue={pr.title}
        maxLength={300}
        onBlur={(event) => {
          const title = event.target.value;
          if (title !== pr.title)
            void run(async () => {
              await notesApi(`/projects/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ title, expected_revision: pr.revision })
              });
              refresh();
            }).catch(() => {});
        }}
      />
      <div className="notes-view-bar">
        <div role="group" aria-label="Project view">
          {["board", "backlog", "issues", "overview", "notes"].map((mode) => (
            <button
              key={mode}
              className={view === mode ? "active" : ""}
              onClick={() => filter("view", mode, false)}
            >
              {mode}
            </button>
          ))}
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            create({ status: view === "board" ? "todo" : "backlog" })
          }
        >
          <Plus size={15} />
          Create issue
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              refresh();
              setError("");
            }}
          >
            Reload issues
          </button>
        </p>
      )}
      {tasks.error && <p className="error">{tasks.error.message}</p>}
      {["board", "backlog", "issues"].includes(view) && (
        <div className="project-filters issue-filters">
          <input
            type="search"
            aria-label="Search issues"
            placeholder="Search issues or keys…"
            value={search}
            onChange={(event) => filter("q", event.target.value)}
          />
          <Select
            aria-label="Issue status filter"
            value={status}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Issue type filter"
            value={type}
            onChange={(event) => filter("type", event.target.value)}
          >
            <option value="">All types</option>
            {issueTypes.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Issue priority filter"
            value={priority}
            onChange={(event) => filter("priority", event.target.value)}
          >
            <option value="">All priorities</option>
            {["low", "normal", "high", "urgent"].map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sprint filter"
            value={sprint}
            onChange={(event) => filter("sprint", event.target.value)}
          >
            <option value="">All sprints</option>
            {[...new Set(rows.map((task) => task.sprint).filter(Boolean))]
              .sort()
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </Select>
        </div>
      )}
      {view === "board" ? (
        <>
          <div className="issue-board" aria-label="Issue board">
            {statuses
              .filter(([code]) => code !== "backlog")
              .map(([code, label]) => (
                <section
                  key={code}
                  aria-label={label + " column"}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (busy) return;
                    const task = rows.find(
                      (row) =>
                        row.id ===
                        event.dataTransfer.getData("text/omnix-issue")
                    );
                    if (task)
                      void change({ ...task, status: code }).catch(() => {});
                  }}
                >
                  <header>
                    <h3>{label}</h3>
                    <span>
                      {filtered.filter((task) => task.status === code).length}
                    </span>
                  </header>
                  {filtered
                    .filter((task) => task.status === code)
                    .map((task) => (
                      <button
                        className="issue-card"
                        key={task.id}
                        draggable={!busy}
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            "text/omnix-issue",
                            task.id
                          )
                        }
                        onClick={() => open(task)}
                      >
                        <span className="issue-card-title">{task.title}</span>
                        <span className="issue-labels">
                          {task.labels.map((label) => (
                            <small key={label}>{label}</small>
                          ))}
                        </span>
                        <span className="issue-card-meta">
                          <IssueIcon type={task.issue_type} />
                          <span>{task.issue_key}</span>
                          <small>{task.priority}</small>
                          {task.estimate !== null && (
                            <b className="issue-estimate">{task.estimate}</b>
                          )}
                        </span>
                      </button>
                    ))}
                  <button
                    className="text-button issue-quick-add"
                    onClick={() => create({ status: code })}
                  >
                    <Plus size={14} />
                    Create issue
                  </button>
                </section>
              ))}
          </div>
          <button
            className="text-button backlog-shortcut"
            onClick={() => filter("view", "backlog", false)}
          >
            Backlog · {rows.filter((task) => task.status === "backlog").length}{" "}
            issues
          </button>
        </>
      ) : view === "backlog" ? (
        <div className="issue-backlog">
          {[
            ...new Set(
              filtered
                .filter((task) => task.status === "backlog" && task.sprint)
                .map((task) => task.sprint)
            ),
            ""
          ].map((name) => (
            <section key={name || "backlog"}>
              <header className="section-title">
                <h2>{name || "Backlog"}</h2>
                <button
                  className="text-button"
                  onClick={() => create({ sprint: name })}
                >
                  <Plus size={14} />
                  Create issue
                </button>
              </header>
              {filtered
                .filter((task) =>
                  name
                    ? task.sprint === name && task.status === "backlog"
                    : !task.sprint && task.status === "backlog"
                )
                .map(issueRow)}
              {!filtered.some(
                (task) => !task.sprint && task.status === "backlog"
              ) &&
                !name && <p className="muted">Your backlog is clear.</p>}
            </section>
          ))}
        </div>
      ) : view === "issues" ? (
        <div className="issue-list" aria-label="Issues list">
          {filtered.map(issueRow)}
          {!filtered.length && <p className="empty">No matching issues.</p>}
        </div>
      ) : view === "overview" ? (
        <>
          <section className="project-summary">
            <div>
              <span className="eyebrow">ISSUES</span>
              <strong>{rows.length}</strong>
            </div>
            <div>
              <span className="eyebrow">COMPLETE</span>
              <strong>
                {rows.filter((task) => task.status === "done").length}
              </strong>
            </div>
            <div>
              <span className="eyebrow">BLOCKED</span>
              <strong>
                {rows.filter((task) => task.status === "blocked").length}
              </strong>
            </div>
          </section>
          <h2>Open issues</h2>
          <div className="issue-list">
            {rows
              .filter((task) => task.status !== "done")
              .slice(0, 12)
              .map(issueRow)}
          </div>
        </>
      ) : (
        <>
          <button
            className="secondary"
            onClick={() => void run(createNote).catch(() => {})}
          >
            <Plus size={15} />
            New project note
          </button>
          <div className="note-cards">
            {notes.map((page) => (
              <NavLink key={page.id} to={"/notes/pages/" + page.id}>
                {page.title}
              </NavLink>
            ))}
          </div>
        </>
      )}
      {params.get("issue") && !editing && !tasks.isLoading && (
        <p className="error">
          This issue is unavailable.<button onClick={close}>Close</button>
        </p>
      )}
      {editing && (
        <IssueDetails
          key={editing.id || "new"}
          project={pr}
          value={editing}
          tasks={rows}
          pages={pages.data || []}
          busy={busy}
          onClose={close}
          onOpen={open}
          onNew={create}
          onSave={async (value) => {
            let saved!: Task;
            await run(async () => {
              const body = value.id
                ? taskPayload(value as Task)
                : Object.fromEntries(
                    Object.entries(value).filter(
                      ([key]) =>
                        ![
                          "id",
                          "revision",
                          "project_id",
                          "issue_key",
                          "issue_number"
                        ].includes(key)
                    )
                  );
              const updated = await notesApi<Task>(
                `/projects/${id}/tasks` + (value.id ? "/" + value.id : ""),
                {
                  method: value.id ? "PUT" : "POST",
                  body: JSON.stringify(body)
                }
              );
              saved = updated;
              qc.setQueryData<Task[]>(["project-tasks", id], (current) =>
                value.id
                  ? current?.map((row) =>
                      row.id === updated.id ? updated : row
                    )
                  : [...(current || []), updated]
              );
              refresh();
              setDraft(null);
              filter("issue", updated.id, Boolean(value.id));
            });
            return saved;
          }}
          onDelete={async (value) => {
            await run(async () => {
              await notesApi(`/projects/${id}/tasks/${value.id}`, {
                method: "DELETE",
                body: JSON.stringify({ expected_revision: value.revision })
              });
              refresh();
              close();
            });
          }}
        />
      )}
    </article>
  );
}
