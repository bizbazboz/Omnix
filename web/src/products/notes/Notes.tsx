import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams
} from "react-router-dom";
import {
  Download,
  FileText,
  FolderKanban,
  Folder,
  Plus,
  RotateCcw,
  Search
} from "lucide-react";
import {
  allPages,
  notesApi,
  invalidateNotes,
  download,
  type Note,
  type ProjectInfo
} from "./api";
import NotePage from "./NotePage";
import Project from "./Project";
import "./notes.css";
function PageRoute() {
  const { id } = useParams();
  return <NotePage key={id} id={id!} />;
}
function ProjectRoute() {
  const { id } = useParams();
  return <Project key={id} id={id!} />;
}
export default function Notes() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="favorites" element={<Home favorites />} />
      <Route path="trash" element={<Home trash />} />
      <Route path="projects" element={<Projects />} />
      <Route path="pages/:id" element={<PageRoute />} />
      <Route path="projects/:id" element={<ProjectRoute />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
const templates: { name: string; description: string; document: unknown[] }[] =
  [
    {
      name: "Blank page",
      description: "Start writing",
      document: [{ type: "paragraph", content: [] }]
    },
    {
      name: "Meeting notes",
      description: "Agenda, discussion and actions",
      document: [
        { type: "heading", props: { level: 2 }, content: "Agenda" },
        { type: "bulletListItem", content: [] },
        { type: "heading", props: { level: 2 }, content: "Discussion" },
        { type: "paragraph", content: [] },
        { type: "heading", props: { level: 2 }, content: "Actions" },
        { type: "checkListItem", props: { checked: false }, content: [] }
      ]
    },
    {
      name: "Project brief",
      description: "Outcomes, scope and milestones",
      document: [
        { type: "heading", props: { level: 2 }, content: "Outcome" },
        { type: "paragraph", content: [] },
        { type: "heading", props: { level: 2 }, content: "Scope" },
        { type: "bulletListItem", content: [] },
        { type: "heading", props: { level: 2 }, content: "Milestones" },
        { type: "checkListItem", content: [] }
      ]
    },
    {
      name: "Task notes",
      description: "Context and a checklist",
      document: [
        { type: "heading", props: { level: 2 }, content: "Context" },
        { type: "paragraph", content: [] },
        { type: "heading", props: { level: 2 }, content: "Checklist" },
        { type: "checkListItem", content: [] }
      ]
    }
  ];
function Home({
  favorites = false,
  trash = false
}: {
  favorites?: boolean;
  trash?: boolean;
}) {
  const navigate = useNavigate(),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    archive = useRef<HTMLInputElement>(null);
  const pages = useQuery({
      queryKey: ["note-pages", trash, search],
      queryFn: () => allPages(trash, search)
    }),
    projects = useQuery<ProjectInfo[]>({
      queryKey: ["note-projects", trash],
      queryFn: () => notesApi("/projects?trash=" + trash),
      enabled: trash
    });
  async function create(index = 0, is_folder = false) {
    setBusy(true);
    setError("");
    try {
      const page = await notesApi<Note>("/pages", {
        method: "POST",
        body: JSON.stringify({
          title: is_folder
            ? "Untitled folder"
            : index
              ? templates[index].name
              : "Untitled",
          is_folder,
          document: templates[index].document
        })
      });
      invalidateNotes();
      navigate("/notes/pages/" + page.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shown = (pages.data || []).filter(
    (page) => !favorites || page.favorite
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="notes-page">
      <header className="notes-heading">
        <div>
          <span className="eyebrow">NOTES & PROJECTS</span>
          <h1>{trash ? "Trash" : favorites ? "Favorites" : "Your pages."}</h1>
        </div>
        {!trash && (
          <div className="note-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => create(0, true)}
            >
              <Folder size={16} />
              New folder
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => create()}
            >
              <Plus size={16} />
              New page
            </button>
          </div>
        )}
      </header>
      <input
        ref={archive}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            void (async () => {
              setBusy(true);
              try {
                if (file.size > 32 * 1024 * 1024)
                  throw new Error("Archives must be below 32 MiB.");
                const result = await notesApi<{ pages: string[] }>("/import", {
                  method: "POST",
                  body: await file.text()
                });
                invalidateNotes();
                pages.refetch();
                if (result.pages[0])
                  navigate("/notes/pages/" + result.pages[0]);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            })();
        }}
      />
      <div className="notes-search">
        <Search size={16} />
        <input
          aria-label="Search notes"
          placeholder="Search your notes…"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setSearch(value), 350);
          }}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pages.error && (
        <p className="error" role="alert">
          {pages.error.message}
          <button onClick={() => pages.refetch()}>Retry</button>
        </p>
      )}
      {!trash && !favorites && !query && (
        <section className="note-templates" aria-label="Note templates">
          {templates.map((template, index) => (
            <button
              key={template.name}
              disabled={busy}
              onClick={() => create(index)}
            >
              <FileText size={20} />
              <strong>{template.name}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </section>
      )}
      {trash && (
        <p className="notice">
          Trashed pages and projects remain recoverable. Restoring a page also
          restores its nested pages from the same deletion.
        </p>
      )}
      <div className="notes-list" aria-label="Notes list">
        {pages.isLoading ? (
          <p className="muted">[LOADING]</p>
        ) : shown.length ? (
          shown.map((page) => (
            <div key={page.id}>
              <NavLink
                to={trash ? "#" : "/notes/pages/" + page.id}
                onClick={(event) => {
                  if (trash) event.preventDefault();
                }}
              >
                {page.is_folder ? <Folder size={18} /> : <FileText size={18} />}
                <span>
                  <strong>{page.title}</strong>
                  <small>
                    {page.parent_id ? "Nested page · " : ""}
                    {new Date(page.updated_at).toLocaleDateString()}
                  </small>
                </span>
              </NavLink>
              {trash ? (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await notesApi(`/pages/${page.id}/restore`, {
                        method: "POST"
                      });
                      invalidateNotes();
                      pages.refetch();
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              ) : (
                <span className="eyebrow">
                  {page.favorite
                    ? "FAVORITE"
                    : page.is_folder
                      ? "FOLDER"
                      : "PAGE"}
                </span>
              )}
            </div>
          ))
        ) : (
          <p className="empty">
            {trash
              ? "Trash is empty."
              : favorites
                ? "Favorite a page to keep it here."
                : query
                  ? "No matching notes."
                  : "Create a page to start writing."}
          </p>
        )}
      </div>
      {trash &&
        projects.data?.map((project) => (
          <div className="task-summary-row" key={project.id}>
            <span>
              <FolderKanban size={16} /> {project.title}
            </span>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await notesApi(`/projects/${project.id}/restore`, {
                    method: "POST"
                  });
                  invalidateNotes();
                  projects.refetch();
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              Restore project
            </button>
          </div>
        ))}
      {!trash && (
        <details className="note-page-details">
          <summary>Import & export</summary>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => archive.current?.click()}
          >
            Import Omnix archive
          </button>
          <p className="muted">
            Download a private JSON archive of your pages and projects. Keep
            exported files private.
          </p>
          <button
            className="secondary"
            onClick={async () => {
              try {
                const data = await notesApi("/export");
                download(
                  "omnix-notes.json",
                  JSON.stringify(data, null, 2),
                  "application/json"
                );
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            <Download size={14} />
            Export workspace
          </button>
        </details>
      )}
    </div>
  );
}
function Projects() {
  const navigate = useNavigate(),
    projects = useQuery<ProjectInfo[]>({
      queryKey: ["note-projects"],
      queryFn: () => notesApi("/projects")
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false);
  return (
    <div className="notes-page">
      <header className="notes-heading">
        <div>
          <span className="eyebrow">NOTES & PROJECTS</span>
          <h1>Projects</h1>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          New project
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {projects.error && <p className="error">{projects.error.message}</p>}
      {creating && (
        <NewProject
          busy={busy}
          error={error}
          onClose={() => setCreating(false)}
          onCreate={async (title, key) => {
            setBusy(true);
            setError("");
            try {
              const project = await notesApi<ProjectInfo>("/projects", {
                method: "POST",
                body: JSON.stringify({ title, key })
              });
              invalidateNotes();
              navigate("/notes/projects/" + project.id);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      <div className="note-cards">
        {projects.data?.map((project) => (
          <NavLink key={project.id} to={"/notes/projects/" + project.id}>
            <FolderKanban size={24} />
            <strong>{project.title}</strong>
            <small>
              Updated {new Date(project.updated_at).toLocaleDateString()}
            </small>
          </NavLink>
        ))}
      </div>
      {!projects.isLoading && !projects.data?.length && (
        <p className="empty">Create a project to plan your work.</p>
      )}
    </div>
  );
}

function NewProject({
  busy,
  error,
  onCreate,
  onClose
}: {
  busy: boolean;
  error: string;
  onCreate: (title: string, key: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [title, setTitle] = useState(""),
    [key, setKey] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="issue-detail-modal project-create-modal"
      ref={dialog}
      aria-label="New project"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void onCreate(title, key);
        }}
      >
        <h2>New project</h2>
        <label className="form-label">
          Name
          <input
            aria-label="Project name"
            autoFocus
            required
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="form-label">
          Project key
          <input
            aria-label="Project key"
            pattern="[A-Z][A-Z0-9]{1,9}"
            maxLength={10}
            placeholder="e.g. OMN"
            value={key}
            onChange={(event) =>
              setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
            }
          />
        </label>
        <p className="muted">
          A short prefix for issue keys. Leave blank to generate one.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="issue-save-bar">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
