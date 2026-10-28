import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Copy,
  Folder,
  FileText,
  History,
  X,
  Download,
  FilePlus,
  Save,
  Star,
  Trash2,
  Upload
} from "lucide-react";
import ActionMenu from "./ActionMenu";
import Select from "../../components/Select";
import CopyField from "../../components/CopyField";
import DocumentEditor from "./DocumentEditor";
import { type NoteBlock, type NotesEditor } from "./schema";
import {
  allPages,
  download,
  invalidateNotes,
  notesApi,
  noteSession,
  type Note,
  type PageInfo,
  type ProjectInfo
} from "./api";
export default function NotePage({ id }: { id: string }) {
  const query = useQuery<Note>({
    queryKey: ["note", id],
    queryFn: () => notesApi(`/pages/${id}`)
  });
  if (query.error)
    return (
      <div className="page">
        <h1>Note unavailable</h1>
        <p className="error">{query.error.message}</p>
        <NavLink to="/notes">Back to notes</NavLink>
      </div>
    );
  return query.data ? (
    <Loaded key={id} initial={query.data} />
  ) : (
    <p className="page muted">[LOADING NOTE]</p>
  );
}
function Loaded({ initial }: { initial: Note }) {
  const [session] = useState(() => noteSession(initial)),
    state = useSyncExternalStore(session.subscribe, session.snapshot),
    note = state.note,
    navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState<{
      title: string;
      document: NoteBlock[];
    } | null>(null),
    [busy, setBusy] = useState(false);
  const editor = useRef<NotesEditor | null>(null),
    upload = useRef<HTMLInputElement>(null);
  const pages = useQuery({
      queryKey: ["note-pages"],
      queryFn: () => allPages()
    }),
    projects = useQuery<ProjectInfo[]>({
      queryKey: ["note-projects"],
      queryFn: () => notesApi("/projects")
    });
  const history = useQuery<
    { id: string; revision: number; created_at: string }[]
  >({
    queryKey: ["note-history", note.id],
    queryFn: () => notesApi(`/pages/${note.id}/revisions`),
    enabled: historyOpen
  });
  const backlinks = useQuery<{ items: PageInfo[]; next_offset: number | null }>(
    {
      queryKey: ["note-backlinks", note.id],
      queryFn: () => notesApi(`/pages/${note.id}/backlinks`)
    }
  );
  const assets = useQuery<
    { id: string; name: string; url: string; size: number }[]
  >({
    queryKey: ["note-assets", note.id],
    queryFn: () => notesApi(`/pages/${note.id}/assets`)
  });
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addChild(is_folder = false) {
    const page = await notesApi<Note>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent_id: note.id,
        title: is_folder ? "Untitled folder" : "Untitled",
        is_folder
      })
    });
    invalidateNotes();
    return page;
  }
  const ancestors: PageInfo[] = [];
  let parent = note.parent_id;
  for (let count = 0; parent && count < 32; count++) {
    const page = pages.data?.find((page) => page.id === parent);
    if (!page) break;
    ancestors.unshift(page);
    parent = page.parent_id;
  }
  const descendants = new Set([note.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages.data || [])
      if (
        page.parent_id &&
        descendants.has(page.parent_id) &&
        !descendants.has(page.id)
      ) {
        descendants.add(page.id);
        grew = true;
      }
  }
  return (
    <article className="notes-page note-sheet">
      <header className="notes-heading">
        <div className="note-breadcrumbs">
          <NavLink to="/notes">Pages</NavLink>
          {ancestors.map((page) => (
            <NavLink key={page.id} to={"/notes/pages/" + page.id}>
              {page.title}
            </NavLink>
          ))}
        </div>
        <span
          role="status"
          className={state.error ? "error save-state" : "save-state"}
        >
          {state.status}
        </span>
      </header>
      <input
        className="note-title"
        disabled={busy}
        aria-label="Page title"
        value={note.title}
        maxLength={300}
        onChange={(event) => session.edit({ title: event.target.value })}
      />
      <div className="notes-view-bar note-editor-actions">
        <div className="note-actions">
          {!note.is_folder && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await session.flush();
                  await notesApi(`/pages/${note.id}/revisions`, {
                    method: "POST"
                  });
                  setHistoryOpen(true);
                })
              }
            >
              <History size={15} />
              History
            </button>
          )}

          {state.dirty && (
            <button
              disabled={busy}
              className="icon-button"
              aria-label="Save now"
              title="Save now"
              onClick={() => run(() => session.retry())}
            >
              <Save size={16} />
            </button>
          )}
          <button
            disabled={busy}
            className="icon-button"
            aria-label={note.favorite ? "Unfavorite page" : "Favorite page"}
            onClick={() =>
              run(() => session.metadata({ favorite: !note.favorite }))
            }
          >
            <Star size={16} fill={note.favorite ? "currentColor" : "none"} />
          </button>
          <ActionMenu label="Page actions">
            <button
              disabled={busy}
              className="icon-button"
              aria-label="Duplicate page"
              onClick={() =>
                run(async () => {
                  await session.flush();
                  const result = await notesApi<Note>(
                    `/pages/${note.id}/duplicate`,
                    { method: "POST" }
                  );
                  invalidateNotes();
                  navigate("/notes/pages/" + result.id);
                })
              }
            >
              <Copy size={16} />
            </button>
            <button
              disabled={busy}
              className="icon-button"
              aria-label="Add nested page"
              onClick={() =>
                run(async () => {
                  const page = await notesApi<Note>("/pages", {
                    method: "POST",
                    body: JSON.stringify({ parent_id: note.id })
                  });
                  invalidateNotes();
                  navigate("/notes/pages/" + page.id);
                })
              }
            >
              <FilePlus size={16} />
            </button>
            {!note.is_folder && (
              <>
                <button
                  disabled={busy}
                  className="icon-button"
                  aria-label="Import Markdown"
                  onClick={() => upload.current?.click()}
                >
                  <Upload size={16} />
                </button>
                <button
                  disabled={busy}
                  className="icon-button"
                  aria-label="Export Markdown"
                  onClick={() =>
                    run(async () => {
                      await session.flush();
                      if (editor.current)
                        download(
                          note.title + ".md",
                          editor.current.blocksToMarkdownLossy(note.document),
                          "text/markdown"
                        );
                    })
                  }
                >
                  <Download size={16} />
                </button>
              </>
            )}
            <button
              disabled={busy}
              className="icon-button"
              aria-label="Move page to trash"
              onClick={() => {
                if (
                  window.confirm(
                    "Move this page and its nested pages to recoverable trash?"
                  )
                )
                  void run(async () => {
                    await session.flush();
                    await notesApi(`/pages/${note.id}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        expected_revision: session.state.note.revision
                      })
                    });
                    invalidateNotes();
                    navigate("/notes");
                  });
              }}
            >
              <Trash2 size={16} />
            </button>
          </ActionMenu>
        </div>
      </div>
      {(error || state.error) && (
        <div className="note-save-error" role="alert">
          <p>{error || state.error}</p>
          {state.error && (
            <>
              <button
                className="secondary"
                disabled={state.conflict || busy}
                onClick={() => run(() => session.retry())}
              >
                Retry save
              </button>
              <a
                className="text-button"
                href="/api/v1/auth/login"
                target="_blank"
                rel="noopener noreferrer"
              >
                Sign in again
              </a>
              <button
                className="secondary"
                onClick={() =>
                  run(async () => {
                    const copy = await notesApi<Note>("/pages", {
                      method: "POST",
                      body: JSON.stringify({
                        title: note.title + " (recovered copy)",
                        document: note.document
                      })
                    });
                    session.replace(await notesApi(`/pages/${note.id}`));
                    invalidateNotes();
                    navigate("/notes/pages/" + copy.id);
                  })
                }
              >
                Save a copy
              </button>
              <button
                className="text-button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Replace your unsaved buffer with the server version?"
                    )
                  )
                    void run(async () =>
                      session.replace(await notesApi(`/pages/${note.id}`))
                    );
                }}
              >
                Load remote version
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={upload}
        type="file"
        accept=".md,.markdown,text/markdown"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            void run(async () => {
              if (file.size > 800000)
                throw new Error("Markdown imports must be below 800 KB.");
              if (!editor.current) return;
              const parsed = editor.current.tryParseMarkdownToBlocks(
                await file.text()
              );
              const imported = await notesApi<Note>("/pages", {
                method: "POST",
                body: JSON.stringify({
                  title: file.name.replace(/\.(md|markdown)$/i, ""),
                  parent_id: note.parent_id,
                  document: parsed
                })
              });
              invalidateNotes();
              navigate("/notes/pages/" + imported.id);
            });
        }}
      />
      <div className="note-editor-surface">
        {!note.is_folder && (
          <DocumentEditor
            key={note.id + "-" + state.reset}
            id={note.id}
            initial={note.document}
            onChange={(document) => session.edit({ document })}
            onReady={(value) => {
              editor.current = value;
            }}
            disabled={busy}
            links={pages.data || []}
            onCreateSubpage={async () => {
              await session.flush();
              return addChild();
            }}
          />
        )}
      </div>
      <section
        className="note-children"
        aria-label={note.is_folder ? "Folder contents" : "Subpages"}
      >
        <header className="section-title">
          <h2>{note.is_folder ? "Contents" : "Subpages"}</h2>
          <div className="note-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const child = await addChild();
                  navigate("/notes/pages/" + child.id);
                })
              }
            >
              <FilePlus size={15} />
              New subpage
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const child = await addChild(true);
                  navigate("/notes/pages/" + child.id);
                })
              }
            >
              <Folder size={15} />
              New subfolder
            </button>
          </div>
        </header>
        {(pages.data || [])
          .filter((page) => page.parent_id === note.id)
          .sort((a, b) => a.position - b.position)
          .map((child) => (
            <NavLink
              className="note-child-link"
              key={child.id}
              to={"/notes/pages/" + child.id}
            >
              {child.is_folder ? <Folder size={18} /> : <FileText size={18} />}
              <span>{child.title}</span>
            </NavLink>
          ))}
        {note.is_folder &&
          !pages.data?.some((page) => page.parent_id === note.id) && (
            <p className="muted">Add a page or folder to get started.</p>
          )}
      </section>
      {historyOpen && (
        <HistoryDialog onClose={() => setHistoryOpen(false)}>
          <section className="note-history">
            <h2>Saved versions</h2>
            {history.error && <p className="error">{history.error.message}</p>}
            {history.data?.map((item) => (
              <div key={item.id}>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () =>
                      setVersion(
                        await notesApi(`/pages/${note.id}/revisions/${item.id}`)
                      )
                    )
                  }
                >
                  Version {item.revision} ·{" "}
                  {new Date(item.created_at).toLocaleString()}
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    run(async () => {
                      await session.flush();
                      const restored = await notesApi<Note>(
                        `/pages/${note.id}/revisions/${item.id}/restore`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            expected_revision: session.state.note.revision
                          })
                        }
                      );
                      session.replace(restored);
                      history.refetch();
                      setHistoryOpen(false);
                    })
                  }
                >
                  Restore
                </button>
              </div>
            ))}
            {version && (
              <div>
                <h3>{version.title}</h3>
                <DocumentEditor
                  key={JSON.stringify(version.document)}
                  id={note.id}
                  initial={version.document}
                  readOnly
                  onChange={() => {}}
                />
              </div>
            )}
          </section>
        </HistoryDialog>
      )}
      <details className="note-page-details">
        <summary>Page details & links</summary>
        <CopyField
          name="Page link"
          label="Page link"
          value={window.location.origin + "/notes/pages/" + note.id}
        />
        <label className="form-label">
          Parent page
          <Select
            aria-label="Parent page"
            value={note.parent_id || ""}
            onChange={(event) =>
              run(() =>
                session.metadata({ parent_id: event.target.value || null })
              )
            }
          >
            <option value="">Top level</option>
            {pages.data
              ?.filter((page) => !descendants.has(page.id))
              .map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
          </Select>
        </label>
        <label className="form-label">
          Project
          <Select
            aria-label="Note project"
            value={note.project_id || ""}
            onChange={(event) =>
              run(() =>
                session.metadata({ project_id: event.target.value || null })
              )
            }
          >
            <option value="">None</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </Select>
        </label>
        <h3>Linked from</h3>
        {backlinks.data?.items.map((page) => (
          <NavLink key={page.id} to={"/notes/pages/" + page.id}>
            {page.title}
          </NavLink>
        ))}
        {!backlinks.data?.items.length && (
          <p className="muted">No backlinks yet.</p>
        )}
        {backlinks.data?.next_offset !== null &&
          backlinks.data?.next_offset !== undefined && (
            <p className="muted">
              Backlinks are limited to the first scan page.
            </p>
          )}
        <button
          className="secondary"
          onClick={() =>
            run(async () => {
              await session.flush();
              download(
                note.title + ".json",
                JSON.stringify(await notesApi(`/export?page_id=${note.id}`)),
                "application/json"
              );
            })
          }
        >
          Export note archive
        </button>
        <h3>Attachments</h3>
        <input
          type="file"
          aria-label="Attach a file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void run(async () => {
                await notesApi(
                  `/pages/${note.id}/assets?name=${encodeURIComponent(file.name)}`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": file.type || "application/octet-stream"
                    },
                    body: file
                  }
                );
                assets.refetch();
              });
          }}
        />
        {assets.data?.map((asset) => (
          <a
            key={asset.id}
            href={asset.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {asset.name} · {Math.ceil(asset.size / 1024)} KB
          </a>
        ))}
      </details>
    </article>
  );
}

function HistoryDialog({
  children,
  onClose
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="note-history-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="section-title">
        <span className="eyebrow">PAGE HISTORY</span>
        <button
          className="icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
