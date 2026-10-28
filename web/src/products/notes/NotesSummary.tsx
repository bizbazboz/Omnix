import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { notesApi, type PageInfo, type Task } from "./api";
export default function NotesSummary() {
  const query = useQuery<{ recent: PageInfo[]; tasks: Task[] }>({
    queryKey: ["notes-overview"],
    queryFn: () => notesApi("/overview"),
    refetchInterval: 30000
  });
  return (
    <section className="dashboard-notes">
      <div className="section-title">
        <h2>Notes & projects</h2>
        <NavLink to="/notes">
          OPEN <ArrowUpRight size={14} />
        </NavLink>
      </div>
      {query.error ? (
        <p className="error">
          Could not load notes.
          <button onClick={() => query.refetch()}>Retry</button>
        </p>
      ) : (
        <div className="dashboard-notes-grid">
          <div>
            {query.data?.recent.map((page) => (
              <NavLink key={page.id} to={"/notes/pages/" + page.id}>
                <span>{page.title}</span>
                <small>{new Date(page.updated_at).toLocaleDateString()}</small>
              </NavLink>
            ))}
            {!query.data?.recent.length && (
              <NavLink to="/notes">
                Start a note <ArrowUpRight size={14} />
              </NavLink>
            )}
          </div>
          <div>
            {query.data?.tasks.map((task) => (
              <NavLink
                key={task.id}
                to={
                  "/notes/projects/" +
                  task.project_id +
                  "?view=issues&issue=" +
                  task.id
                }
              >
                <span>
                  {task.issue_key} · {task.title}
                </span>
                <small>{task.end}</small>
              </NavLink>
            ))}
            {!query.data?.tasks.length && (
              <span className="muted">No upcoming issues.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
