import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Search, X, ArrowUpRight } from "lucide-react";
import { notesApi } from "./api";
import {
  type ReferenceKind,
  type WorkspaceReference,
  referenceLabels,
  ReferenceIcon
} from "./WorkspaceReference";
export default function ReferencePicker({
  initialKind,
  onSelect,
  onClose
}: {
  initialKind: ReferenceKind;
  onSelect: (item: WorkspaceReference, embed: boolean) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind),
    [text, setText] = useState(""),
    [search, setSearch] = useState(""),
    [embed, setEmbed] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const query = useInfiniteQuery({
    queryKey: ["reference-picker", kind, search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      notesApi<{ items: WorkspaceReference[]; next_offset: number | null }>(
        "/references?" +
          new URLSearchParams({ kind, q: search, offset: String(pageParam) })
      ),
    getNextPageParam: (last) => last.next_offset ?? undefined
  });
  const items = query.data?.pages.flatMap((page) => page.items) || [];
  return (
    <dialog
      className="reference-picker"
      ref={dialog}
      aria-label="Insert workspace reference"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>Insert reference</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Close picker"
          aria-label="Close reference picker"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div
        className="reference-sources"
        role="group"
        aria-label="Reference source"
      >
        {(Object.keys(referenceLabels) as ReferenceKind[]).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key);
              setText("");
              setSearch("");
              input.current?.focus();
            }}
          >
            <ReferenceIcon kind={key} size={15} />
            {referenceLabels[key]}
          </button>
        ))}
      </div>
      <label className="reference-search">
        <Search size={18} />
        <input
          ref={input}
          aria-label="Search workspace references"
          placeholder={"Search " + referenceLabels[kind].toLowerCase() + "…"}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div
        className="reference-results"
        aria-label="Reference results"
        aria-busy={query.isFetching}
      >
        {query.isLoading ? (
          <p className="muted">[LOADING]</p>
        ) : query.error ? (
          <p className="error" role="alert">
            Could not load references.
            <button type="button" onClick={() => query.refetch()}>
              Retry
            </button>
          </p>
        ) : !items.length ? (
          <p className="reference-empty">
            {search
              ? "No matches in synced data."
              : "Nothing available yet. Connect a source in Settings or create an item first."}
          </p>
        ) : (
          items.map((item) => (
            <button
              className="reference-result"
              type="button"
              key={item.container_id + ":" + item.id}
              onClick={() => onSelect(item, embed)}
            >
              <ReferenceIcon kind={item.kind} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.subtitle}
                  {item.date ? " · " + item.date.slice(0, 10) : ""}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))
        )}
        {query.hasNextPage && (
          <button
            type="button"
            className="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Search more"}
          </button>
        )}
      </div>
      <footer>
        <span className="muted">Synced workspace data</span>
        <div role="group" aria-label="Reference appearance">
          <button
            type="button"
            aria-pressed={embed}
            onClick={() => setEmbed(true)}
          >
            Live card
          </button>
          <button
            type="button"
            aria-pressed={!embed}
            onClick={() => setEmbed(false)}
          >
            Text link
          </button>
        </div>
      </footer>
    </dialog>
  );
}
