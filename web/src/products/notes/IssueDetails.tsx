import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { X, Plus, MessageSquare } from "lucide-react";
import Select from "../../components/Select";
import CopyField from "../../components/CopyField";
import { markUnsaved } from "../../lib/api";
import {
  notesApi,
  defaultTask,
  type Task,
  type PageInfo,
  type ProjectInfo
} from "./api";
import { statuses, issueTypes, IssueIcon } from "./Project";
const drafts = new Map<string, Partial<Task>>();
const commentDrafts = new Map<string, string>();
type Discussion = {
  comments: { id: string; body: string; created_at: string }[];
  activity: { id: string; summary: string; created_at: string }[];
};
export default function IssueDetails({
  project,
  value,
  tasks,
  pages,
  busy,
  onClose,
  onSave,
  onDelete,
  onOpen,
  onNew
}: {
  project: ProjectInfo;
  value: Partial<Task>;
  tasks: Task[];
  pages: PageInfo[];
  busy: boolean;
  onClose: () => void;
  onSave: (value: Partial<Task>) => Promise<Task>;
  onDelete: (value: Partial<Task>) => Promise<void>;
  onOpen: (task: Task) => void;
  onNew: (value: Partial<Task>) => void;
}) {
  const draftKey = "issue:" + project.id + ":" + (value.id || "new"),
    cached = drafts.get(draftKey);
  const [form, setForm] = useState({ ...defaultTask, ...value, ...cached }),
    [dirty, setDirty] = useState(Boolean(cached)),
    [error, setError] = useState(""),
    [comment, setComment] = useState(commentDrafts.get(draftKey) || ""),
    [posting, setPosting] = useState(false),
    [tab, setTab] = useState("comments");
  const dialog = useRef<HTMLDialogElement>(null);
  const discussion = useQuery<Discussion>({
    queryKey: ["issue-discussion", value.id, value.revision],
    queryFn: () =>
      notesApi(`/projects/${project.id}/tasks/${value.id}/discussion`),
    enabled: Boolean(value.id)
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!dirty) setForm({ ...defaultTask, ...value });
  }, [value.revision]);
  useEffect(() => {
    markUnsaved(draftKey, dirty || Boolean(comment));
  }, [dirty, comment, draftKey]);
  function edit(patch: Partial<Task>) {
    setForm((current) => {
      const next = { ...current, ...patch };
      drafts.set(draftKey, next);
      return next;
    });
    setDirty(true);
  }
  function discard() {
    drafts.delete(draftKey);
    commentDrafts.delete(draftKey);
    markUnsaved(draftKey, false);
  }
  function leave(action = onClose) {
    if (
      (dirty || comment.trim()) &&
      !window.confirm("Discard unsaved issue changes?")
    )
      return;
    discard();
    action();
  }
  const descendants = new Set([form.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks)
      if (
        task.parent_id &&
        descendants.has(task.parent_id) &&
        !descendants.has(task.id)
      ) {
        descendants.add(task.id);
        changed = true;
      }
  }
  return (
    <dialog
      ref={dialog}
      className="issue-detail-modal"
      aria-label={value.id ? "Issue details" : "Create issue"}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !posting) leave();
      }}
    >
      <header className="issue-detail-heading">
        <span className="eyebrow">
          {project.title} / {value.issue_key || "NEW ISSUE"}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label="Close issue"
          disabled={busy || posting}
          onClick={() => leave()}
        >
          <X size={18} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setError("");
          void onSave({
            ...form,
            labels: form.labels.map((label) => label.trim()).filter(Boolean),
            milestone: false
          })
            .then((saved) => {
              discard();
              setDirty(false);
              setForm(saved);
            })
            .catch((error) => setError(error.message));
        }}
      >
        <fieldset disabled={busy} className="task-fields issue-fields">
          <label className="form-label issue-summary-label">
            Summary
            <input
              autoFocus
              aria-label="Issue summary"
              required
              maxLength={300}
              value={form.title}
              onChange={(event) => edit({ title: event.target.value })}
            />
          </label>
          <div className="issue-detail-grid">
            <main>
              <label className="form-label">
                Description
                <textarea
                  aria-label="Issue description"
                  rows={8}
                  maxLength={20000}
                  placeholder="Context, requirements and acceptance criteria…"
                  value={form.description}
                  onChange={(event) =>
                    edit({ description: event.target.value })
                  }
                />
              </label>
              {value.id && (
                <section className="issue-subtasks">
                  <header className="section-title">
                    <h3>Child issues</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        leave(() =>
                          onNew({
                            parent_id: value.id,
                            issue_type:
                              form.issue_type === "epic" ? "story" : "subtask",
                            sprint: form.sprint
                          })
                        )
                      }
                    >
                      <Plus size={14} />
                      Add {form.issue_type === "epic" ? "story" : "subtask"}
                    </button>
                  </header>
                  {tasks
                    .filter((task) => task.parent_id === value.id)
                    .map((task) => (
                      <button
                        type="button"
                        className="issue-child"
                        key={task.id}
                        onClick={() => leave(() => onOpen(task))}
                      >
                        <IssueIcon type={task.issue_type} />
                        <span className="issue-key">{task.issue_key}</span>
                        <span>{task.title}</span>
                      </button>
                    ))}
                </section>
              )}
              <details className="issue-relations">
                <summary>Linked issues & dates</summary>
                <label className="form-label">
                  Blocked by
                  <Select
                    aria-label="Blocked by"
                    value=""
                    onChange={(event) => {
                      if (
                        event.target.value &&
                        !form.dependencies.includes(event.target.value)
                      )
                        edit({
                          dependencies: [
                            ...form.dependencies,
                            event.target.value
                          ]
                        });
                    }}
                  >
                    <option value="">Add blocking issue</option>
                    {tasks
                      .filter(
                        (task) =>
                          task.id !== form.id &&
                          !form.dependencies.includes(task.id)
                      )
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.issue_key} · {task.title}
                        </option>
                      ))}
                  </Select>
                </label>
                {form.dependencies.map((id) => {
                  const task = tasks.find((row) => row.id === id);
                  return (
                    <div className="issue-child" key={id}>
                      <span>
                        {task?.issue_key} · {task?.title}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={"Remove blocker " + task?.issue_key}
                        type="button"
                        onClick={() =>
                          edit({
                            dependencies: form.dependencies.filter(
                              (key) => key !== id
                            )
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
                <label className="form-label">
                  Start date
                  <input
                    type="date"
                    value={form.start || ""}
                    onChange={(event) =>
                      edit({ start: event.target.value || null })
                    }
                  />
                </label>
              </details>
            </main>
            <aside className="issue-properties">
              <label className="form-label">
                Status
                <Select
                  aria-label="Issue status"
                  value={form.status}
                  onChange={(event) => edit({ status: event.target.value })}
                >
                  {statuses.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="form-label">
                Type
                <Select
                  aria-label="Issue type"
                  value={form.issue_type}
                  onChange={(event) =>
                    edit({
                      issue_type: event.target.value,
                      ...(event.target.value === "epic"
                        ? { parent_id: null }
                        : {})
                    })
                  }
                >
                  {issueTypes.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="form-label">
                Priority
                <Select
                  aria-label="Issue priority"
                  value={form.priority}
                  onChange={(event) => edit({ priority: event.target.value })}
                >
                  {["low", "normal", "high", "urgent"].map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="form-label">
                Parent issue
                <Select
                  aria-label="Parent issue"
                  value={form.parent_id || ""}
                  disabled={form.issue_type === "epic"}
                  onChange={(event) =>
                    edit({ parent_id: event.target.value || null })
                  }
                >
                  <option value="">None</option>
                  {tasks
                    .filter((task) => !descendants.has(task.id))
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.issue_key} · {task.title}
                      </option>
                    ))}
                </Select>
              </label>
              <label className="form-label">
                Sprint
                <input
                  aria-label="Sprint"
                  maxLength={100}
                  list="issue-sprints"
                  placeholder="Backlog"
                  value={form.sprint}
                  onChange={(event) => edit({ sprint: event.target.value })}
                />
                <datalist id="issue-sprints">
                  {[
                    ...new Set(tasks.map((task) => task.sprint).filter(Boolean))
                  ].map((sprint) => (
                    <option key={sprint} value={sprint} />
                  ))}
                </datalist>
              </label>
              <label className="form-label">
                Story points
                <input
                  aria-label="Story points"
                  type="number"
                  min="0"
                  max="1000"
                  value={form.estimate ?? ""}
                  onChange={(event) =>
                    edit({
                      estimate:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value)
                    })
                  }
                />
              </label>
              <label className="form-label">
                Due date
                <input
                  aria-label="Due date"
                  type="date"
                  min={form.start || undefined}
                  value={form.end || ""}
                  onChange={(event) =>
                    edit({ end: event.target.value || null })
                  }
                />
              </label>
              <label className="form-label">
                Labels
                <input
                  aria-label="Labels"
                  placeholder="Comma separated"
                  maxLength={800}
                  value={form.labels.join(",")}
                  onChange={(event) =>
                    edit({ labels: event.target.value.split(",") })
                  }
                  onBlur={() =>
                    edit({
                      labels: form.labels
                        .map((label) => label.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
              <label className="form-label">
                Linked page
                <Select
                  aria-label="Linked page"
                  value={form.page_id || ""}
                  onChange={(event) =>
                    edit({ page_id: event.target.value || null })
                  }
                >
                  <option value="">None</option>
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </Select>
              </label>
              {form.page_id && (
                <NavLink
                  to={"/notes/pages/" + form.page_id}
                  onClick={(event) => {
                    if (
                      (dirty || comment) &&
                      !window.confirm("Discard unsaved issue changes?")
                    )
                      event.preventDefault();
                    else discard();
                  }}
                >
                  Open linked page ↗
                </NavLink>
              )}
            </aside>
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="issue-save-bar">
          <span className="muted">
            {dirty ? "Unsaved changes" : value.id ? "Saved" : "New issue"}
          </span>
          <button className="primary" disabled={busy || posting}>
            {busy ? "Saving…" : value.id ? "Save changes" : "Create issue"}
          </button>
          {value.id && (
            <button
              type="button"
              className="text-button"
              disabled={busy || posting}
              onClick={() => {
                if (
                  window.confirm(
                    "Permanently delete this issue and its comments?"
                  )
                )
                  void onDelete(form)
                    .then(discard)
                    .catch((error) => setError(error.message));
              }}
            >
              Delete issue
            </button>
          )}
        </footer>
      </form>
      {value.id && (
        <>
          <CopyField
            name="Issue link"
            label="Issue link"
            value={
              window.location.origin +
              "/notes/projects/" +
              project.id +
              "?issue=" +
              value.id
            }
          />
          <section className="issue-discussion">
            <div className="notes-view-bar">
              <div role="group" aria-label="Issue activity view">
                <button
                  className={tab === "comments" ? "active" : ""}
                  onClick={() => setTab("comments")}
                >
                  <MessageSquare size={14} />
                  Comments
                </button>
                <button
                  className={tab === "activity" ? "active" : ""}
                  onClick={() => setTab("activity")}
                >
                  Activity
                </button>
              </div>
            </div>
            {discussion.error && (
              <p className="error">
                {discussion.error.message}
                <button onClick={() => discussion.refetch()}>Retry</button>
              </p>
            )}
            {tab === "comments" ? (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!comment.trim() || posting) return;
                    setPosting(true);
                    setError("");
                    void notesApi(
                      `/projects/${project.id}/tasks/${value.id}/comments`,
                      {
                        method: "POST",
                        body: JSON.stringify({ body: comment })
                      }
                    )
                      .then(() => {
                        setComment("");
                        commentDrafts.delete(draftKey);
                        discussion.refetch();
                      })
                      .catch((error) => setError(error.message))
                      .finally(() => setPosting(false));
                  }}
                >
                  <label className="form-label">
                    Add comment
                    <textarea
                      aria-label="Comment"
                      placeholder="Write a comment…"
                      rows={3}
                      maxLength={5000}
                      value={comment}
                      disabled={busy || posting}
                      onChange={(event) => {
                        setComment(event.target.value);
                        commentDrafts.set(draftKey, event.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={posting || busy || !comment.trim()}
                  >
                    {posting ? "Posting…" : "Add comment"}
                  </button>
                </form>
                {discussion.data?.comments.map((row) => (
                  <article key={row.id} className="issue-comment">
                    <time>{new Date(row.created_at).toLocaleString()}</time>
                    <p>{row.body}</p>
                  </article>
                ))}
              </>
            ) : (
              <ol className="issue-activity">
                {discussion.data?.activity.map((row) => (
                  <li key={row.id}>
                    <span>{row.summary}</span>
                    <time>{new Date(row.created_at).toLocaleString()}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </dialog>
  );
}
