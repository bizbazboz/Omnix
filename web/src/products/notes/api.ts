import type { NoteBlock } from "./schema";
import { api, qc, markUnsaved, ApiError, setCsrf } from "../../lib/api";
export type PageInfo = {
  id: string;
  title: string;
  parent_id: string | null;
  is_folder: boolean;
  project_id: string | null;
  position: number;
  favorite: boolean;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
};
export type Note = PageInfo & { document: NoteBlock[]; schema_version: number };
export type ProjectInfo = {
  issue_prefix: string;
  id: string;
  title: string;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
};
export type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  issue_key: string;
  issue_number: number;
  issue_type: string;
  labels: string[];
  sprint: string;
  estimate: number | null;
  parent_id: string | null;
  page_id: string | null;
  status: string;
  priority: string;
  start: string | null;
  end: string | null;
  progress: number;
  milestone: boolean;
  position: number;
  dependencies: string[];
  revision: number;
};
export const notesApi = <T = any>(path: string, options: RequestInit = {}) =>
  api<T>("/notes" + path, options, true);
export async function allPages(trash = false, q = "") {
  const items: PageInfo[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const result: { items: PageInfo[]; next_offset: number | null } =
      await notesApi(
        `/pages?limit=500&offset=${offset}&trash=${trash}&q=${encodeURIComponent(q)}`
      );
    items.push(...result.items);
    offset = result.next_offset;
  }
  return items;
}
export function invalidateNotes() {
  qc.invalidateQueries({ queryKey: ["note-pages"] });
  qc.invalidateQueries({ queryKey: ["note-projects"] });
  qc.invalidateQueries({ queryKey: ["notes-overview"] });
}
export const defaultTask = {
  title: "",
  description: "",
  status: "backlog",
  issue_type: "task",
  labels: [],
  sprint: "",
  estimate: null,
  priority: "normal",
  start: null,
  end: null,
  progress: 0,
  milestone: false,
  position: 0,
  parent_id: null,
  page_id: null,
  dependencies: []
} as Omit<
  Task,
  "id" | "project_id" | "revision" | "issue_key" | "issue_number"
>;
export function taskPayload(task: Task) {
  const { id, project_id, revision, issue_key, issue_number, ...body } = task;
  void issue_key;
  void issue_number;
  void id;
  void project_id;
  return { ...body, expected_revision: revision };
}
export function download(name: string, body: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type SaveState = {
  note: Note;
  dirty: boolean;
  status: string;
  error: string;
  conflict: boolean;
  reset: number;
};
// Controllers outlive page mounts: switching pages does not discard pending saves.
class NoteSession {
  state: SaveState;
  listeners = new Set<() => void>();
  timer: ReturnType<typeof setTimeout> | undefined;
  flight: Promise<void> | null = null;
  edits = 0;
  firstDirty = 0;
  failures = 0;
  constructor(note: Note) {
    this.state = {
      note,
      dirty: false,
      status: "Saved",
      error: "",
      conflict: false,
      reset: 0
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  update(patch: Partial<SaveState>) {
    this.state = { ...this.state, ...patch };
    markUnsaved(this.state.note.id, this.state.dirty);
    this.listeners.forEach((listener) => listener());
  }
  edit(patch: Partial<Pick<Note, "title" | "document">>) {
    this.edits++;
    if (!this.state.dirty) this.firstDirty = Date.now();
    this.update({
      note: { ...this.state.note, ...patch },
      dirty: true,
      status: "Unsaved"
    });
    if (!this.state.conflict) this.schedule();
  }
  schedule(delay?: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.save().catch(() => {});
      },
      delay ?? Math.max(0, Math.min(500, 2000 - (Date.now() - this.firstDirty)))
    );
  }
  async save() {
    if (this.flight) return this.flight;
    if (!this.state.dirty) return;
    if (this.state.conflict) throw new Error(this.state.error);
    clearTimeout(this.timer);
    const note = this.state.note,
      generation = this.edits;
    this.update({ status: "Saving…", error: "" });
    this.flight = (async () => {
      try {
        const result = await notesApi<Note>(`/pages/${note.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            expected_revision: note.revision,
            title: note.title,
            document: note.document
          })
        });
        this.failures = 0;
        const dirty = this.edits !== generation;
        this.update({
          note: {
            ...result,
            ...(dirty
              ? {
                  title: this.state.note.title,
                  document: this.state.note.document
                }
              : {})
          },
          dirty,
          status: dirty ? "Unsaved" : "Saved",
          error: ""
        });
        invalidateNotes();
        if (dirty) this.schedule();
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        this.failures++;
        this.update({
          status: "Could not save",
          error: (error as Error).message,
          conflict: status === 409
        });
        if (![401, 403, 409, 413, 422].includes(status) && this.failures <= 5)
          this.schedule(Math.min(15000, 1000 * 2 ** this.failures));
        throw error;
      } finally {
        this.flight = null;
      }
    })();
    return this.flight;
  }
  async flush() {
    while (this.state.dirty) {
      if (this.state.conflict) throw new Error(this.state.error);
      await this.save();
    }
  }
  async retry() {
    const me = await api<{ csrf: string }>("/me", {}, true);
    setCsrf(me.csrf);
    this.failures = 0;
    return this.flush();
  }
  replace(note: Note) {
    clearTimeout(this.timer);
    this.update({
      note,
      dirty: false,
      status: "Saved",
      error: "",
      conflict: false,
      reset: this.state.reset + 1
    });
  }
  async metadata(patch: Partial<PageInfo>) {
    await this.flush();
    const generation = this.edits;
    this.flight = (async () => {
      try {
        const result = await notesApi<Note>(`/pages/${this.state.note.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...patch,
            expected_revision: this.state.note.revision
          })
        });
        const dirty = this.edits !== generation;
        this.update({
          note: {
            ...result,
            ...(dirty
              ? {
                  title: this.state.note.title,
                  document: this.state.note.document
                }
              : {})
          },
          dirty,
          status: dirty ? "Unsaved" : "Saved"
        });
        invalidateNotes();
      } finally {
        this.flight = null;
        if (this.state.dirty && !this.state.conflict) this.schedule();
      }
    })();
    return this.flight;
  }
}
const sessions = new Map<string, NoteSession>();
export function noteSession(note: Note) {
  let session = sessions.get(note.id);
  if (!session) {
    for (const [id, value] of sessions)
      if (sessions.size > 20 && !value.state.dirty && !value.listeners.size)
        sessions.delete(id);
    session = new NoteSession(note);
    sessions.set(note.id, session);
  } else if (
    !session.state.dirty &&
    !session.flight &&
    note.revision > session.state.note.revision
  )
    session.replace(note);
  return session;
}
