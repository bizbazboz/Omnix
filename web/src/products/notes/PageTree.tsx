import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  FolderKanban,
  Plus,
  Search,
  Star,
  Trash2
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  allPages,
  notesApi,
  invalidateNotes,
  type Note,
  type PageInfo
} from "./api";
export default function PageTree({
  onClose = () => {}
}: {
  onClose?: () => void;
}) {
  const pages = useQuery({
      queryKey: ["note-pages"],
      queryFn: () => allPages()
    }),
    navigate = useNavigate();
  const [closed, setClosed] = useState<string[]>([]),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  async function add(parent_id: string | null = null, is_folder = false) {
    try {
      setSearch("");
      const note = await notesApi<Note>("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent_id,
          is_folder,
          title: is_folder ? "Untitled folder" : "Untitled"
        })
      });
      invalidateNotes();
      navigate("/notes/pages/" + note.id);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function drop(event: React.DragEvent, parent: PageInfo | null) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/omnix-page"),
      source = pages.data?.find((page) => page.id === id);
    if (!source) return;
    try {
      let parentId = parent?.id || null,
        position =
          pages.data?.filter((page) => page.parent_id === parentId).length || 0;
      const bounds = event.currentTarget.getBoundingClientRect(),
        fraction = (event.clientY - bounds.top) / bounds.height;
      if (parent && (fraction < 0.25 || fraction > 0.75)) {
        parentId = parent.parent_id;
        const siblings = (pages.data || [])
          .filter((page) => page.parent_id === parentId && page.id !== id)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
        position =
          Math.max(
            0,
            siblings.findIndex((page) => page.id === parent.id)
          ) + (fraction > 0.75 ? 1 : 0);
      }
      await notesApi(`/pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: source.revision,
          parent_id: parentId,
          position
        })
      });
      invalidateNotes();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const matches = new Set(
    (pages.data || [])
      .filter((page) => page.title.toLowerCase().includes(search.toLowerCase()))
      .map((page) => page.id)
  );
  if (search)
    for (const id of [...matches]) {
      let parent = pages.data?.find((page) => page.id === id)?.parent_id;
      for (let depth = 0; parent && depth < 32; depth++) {
        matches.add(parent);
        parent = pages.data?.find((page) => page.id === parent)?.parent_id;
      }
    }
  function tree(parent: string | null, depth = 0): React.ReactNode {
    if (depth > 32) return null;
    return (pages.data || [])
      .filter(
        (page) => page.parent_id === parent && (!search || matches.has(page.id))
      )
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
      .map((page) => {
        const children = pages.data?.some(
          (child) => child.parent_id === page.id
        );
        return (
          <div key={page.id}>
            <div
              className="note-tree-row"
              style={{ paddingLeft: Math.min(depth, 8) * 12 }}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("text/omnix-page", page.id)
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation();
                void drop(event, page);
              }}
            >
              <button
                className="icon-button"
                aria-label={
                  (closed.includes(page.id) ? "Expand " : "Collapse ") +
                  page.title
                }
                disabled={!children}
                onClick={() =>
                  setClosed((current) =>
                    current.includes(page.id)
                      ? current.filter((id) => id !== page.id)
                      : [...current, page.id]
                  )
                }
              >
                {closed.includes(page.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
              <NavLink
                title={page.title}
                to={"/notes/pages/" + page.id}
                onClick={onClose}
              >
                {page.is_folder ? <Folder size={14} /> : <FileText size={14} />}
                <span>{page.title}</span>
              </NavLink>
              <button
                className="icon-button tree-add"
                aria-label={"Add child to " + page.title}
                onClick={() => add(page.id)}
              >
                <Plus size={12} />
              </button>
            </div>
            {(!closed.includes(page.id) || search) && tree(page.id, depth + 1)}
          </div>
        );
      });
  }
  return (
    <div className="notes-navigation">
      <button className="primary new-message" onClick={() => add()}>
        <Plus size={16} />
        New page
      </button>
      <label className="notes-sidebar-search">
        <Search size={15} />
        <input
          aria-label="Find a page"
          placeholder="Find a page…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <nav aria-label="Notes navigation">
        <NavLink to="/notes" end onClick={onClose}>
          <FileText size={17} />
          Recent
        </NavLink>
        <NavLink to="/notes/favorites" onClick={onClose}>
          <Star size={17} />
          Favorites
        </NavLink>
        <NavLink to="/notes/projects" onClick={onClose}>
          <FolderKanban size={17} />
          Projects
        </NavLink>
      </nav>
      <div
        className="note-tree"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => drop(event, null)}
      >
        <div className="note-tree-heading">
          <span className="eyebrow">
            PAGES{" "}
            <span className="note-tree-count">{pages.data?.length || 0}</span>
          </span>
          <div>
            <button
              className="icon-button"
              title="New folder"
              aria-label="New folder"
              onClick={() => add(null, true)}
            >
              <FolderPlus size={16} />
            </button>
            <button
              className="icon-button"
              title="New top-level page"
              aria-label="New top-level page"
              onClick={() => add()}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        {pages.isLoading ? (
          <p className="muted">[LOADING]</p>
        ) : pages.error ? (
          <button className="text-button" onClick={() => pages.refetch()}>
            Retry pages
          </button>
        ) : search && !matches.size ? (
          <p className="notes-tree-empty">No matching pages.</p>
        ) : pages.data?.length ? (
          tree(null)
        ) : (
          <p className="notes-tree-empty">
            Create a page or folder to start your workspace.
          </p>
        )}
      </div>
      <nav className="notes-trash">
        <NavLink to="/notes/trash" onClick={onClose}>
          <Trash2 size={17} />
          Trash
        </NavLink>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
