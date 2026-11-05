import type { PageInfo } from "./api";

/** Build once per page/search change, rather than rescanning every tree row. */
export function pageTreeIndex(pages: PageInfo[], search: string) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const children = new Map<string | null, PageInfo[]>();
  const visible = new Set<string>();
  const needle = search.trim().toLocaleLowerCase();
  for (const page of pages) {
    const siblings = children.get(page.parent_id) || [];
    siblings.push(page);
    children.set(page.parent_id, siblings);
    if (needle && page.title.toLocaleLowerCase().includes(needle)) {
      let current: PageInfo | undefined = page;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        visible.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
    }
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) => a.position - b.position || a.title.localeCompare(b.title)
    );
  return { byId, children, visible, searching: Boolean(needle) };
}
