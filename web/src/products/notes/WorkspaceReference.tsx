import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  Mail,
  CalendarDays,
  FileText,
  FolderKanban,
  CircleDot,
  ArrowUpRight,
  RefreshCw
} from "lucide-react";
import { notesApi } from "./api";
export type ReferenceKind = "mail" | "event" | "issue" | "project" | "page";
export type WorkspaceReference = {
  kind: ReferenceKind;
  id: string;
  container_id: string;
  title: string;
  subtitle: string;
  excerpt: string;
  href: string;
  date?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  status?: string;
};
export const referenceLabels: Record<ReferenceKind, string> = {
  mail: "Email",
  event: "Calendar event",
  issue: "Issue",
  project: "Project",
  page: "Page"
};
export function ReferenceIcon({
  kind,
  size = 18
}: {
  kind: ReferenceKind;
  size?: number;
}) {
  const Icon =
    kind === "mail"
      ? Mail
      : kind === "event"
        ? CalendarDays
        : kind === "issue"
          ? CircleDot
          : kind === "project"
            ? FolderKanban
            : FileText;
  return <Icon size={size} aria-hidden="true" />;
}
export function referencePath(
  kind: ReferenceKind,
  id: string,
  container: string
) {
  if (kind === "page") return "/notes/pages/" + encodeURIComponent(id);
  if (kind === "project") return "/notes/projects/" + encodeURIComponent(id);
  if (kind === "issue")
    return (
      "/notes/projects/" +
      encodeURIComponent(container) +
      "?issue=" +
      encodeURIComponent(id)
    );
  if (kind === "mail")
    return (
      "/email/all?" + new URLSearchParams({ account: container, message: id })
    );
  return "/calendar?" + new URLSearchParams({ event: id });
}
export default function LiveReference({
  kind,
  itemId,
  containerId
}: {
  kind: ReferenceKind;
  itemId: string;
  containerId: string;
}) {
  const query = useQuery<WorkspaceReference>({
    queryKey: ["workspace-reference", kind, itemId, containerId],
    queryFn: () =>
      notesApi(
        "/references/resolve?" +
          new URLSearchParams({ kind, id: itemId, container_id: containerId })
      ),
    refetchInterval: 60000,
    retry: false
  });
  const item = query.data;
  return (
    <div
      className="workspace-embed"
      contentEditable={false}
      data-reference-kind={kind}
    >
      <div className="workspace-embed-symbol">
        <ReferenceIcon kind={kind} />
      </div>
      <div className="workspace-embed-content">
        <span className="eyebrow">{referenceLabels[kind]}</span>
        {query.error ? (
          <>
            <strong>Reference unavailable</strong>
            <p className="muted">
              The source was removed or is no longer accessible.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => query.refetch()}
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </>
        ) : !item ? (
          <span className="muted">[LOADING]</span>
        ) : (
          <>
            <NavLink className="workspace-embed-title" to={item.href}>
              {item.title}
              <ArrowUpRight size={16} />
            </NavLink>
            <div className="workspace-embed-meta">
              <span>{item.subtitle}</span>
              {item.date && (
                <time>
                  {/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.all_day
                    ? new Date(
                        item.date.slice(0, 10) + "T12:00:00"
                      ).toLocaleDateString()
                    : new Date(item.date).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short"
                      })}
                </time>
              )}
              {item.status && <span>{item.status}</span>}
              {item.location && <span>{item.location}</span>}
            </div>
            {item.excerpt && <p>{item.excerpt}</p>}
          </>
        )}
      </div>
    </div>
  );
}
