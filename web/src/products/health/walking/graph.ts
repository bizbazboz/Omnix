export type Point = [number, number];
export type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
};
type Edge = { to: number; length: number; name: string };
export type Graph = { nodes: Map<number, Point>; edges: Map<number, Edge[]> };
export type Walk = {
  coordinates: Point[];
  distance_m: number;
  duration_s: number;
  speed_kmh: number;
  steps: string[];
  created_at: string;
  requested_km: number;
  snap_distance_m: number;
  repeated_fraction: number;
  attribution: string;
  start_label: string;
};
const FOOT = new Set(["yes", "designated", "permissive", "official"]);
const HIGHWAYS = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "residential",
  "living_street",
  "service",
  "unclassified",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "track",
  "road",
  "cycleway"
]);
export function metres(a: Point, b: Point) {
  const r = Math.PI / 180,
    la = a[1] * r,
    lb = b[1] * r,
    h =
      Math.sin((lb - la) / 2) ** 2 +
      Math.cos(la) * Math.cos(lb) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function walkable(tags: Record<string, string>) {
  if (
    !HIGHWAYS.has(tags.highway) ||
    tags.area === "yes" ||
    ["no", "private", "use_sidepath", "destination"].includes(tags.foot) ||
    (["no", "private", "destination", "customers"].includes(tags.access) &&
      !FOOT.has(tags.foot)) ||
    ["yes", "stepping_stones"].includes(tags.ford) ||
    tags.sidewalk === "separate"
  )
    return false;
  return (
    !/^(primary|secondary)/.test(tags.highway) ||
    FOOT.has(tags.foot) ||
    ["yes", "both", "left", "right"].includes(tags.sidewalk)
  );
}
export function buildGraph(elements: Element[]): Graph {
  if (elements.length > 350000)
    throw Error("This area is too dense. Try a shorter distance.");
  const nodes = new Map<number, Point>(),
    edges = new Map<number, Edge[]>();
  for (const el of elements)
    if (
      el.type === "node" &&
      Number.isFinite(el.lon) &&
      Number.isFinite(el.lat)
    ) {
      const t = el.tags || {};
      if (
        ["no", "private"].includes(t.foot) ||
        (["no", "private"].includes(t.access) && !FOOT.has(t.foot)) ||
        t.locked === "yes"
      )
        continue;
      nodes.set(el.id, [el.lon!, el.lat!]);
    }
  if (nodes.size > 180000)
    throw Error("This area is too dense. Try a shorter distance.");
  const add = (from: number, to: number, length: number, name: string) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from)!.push({ to, length, name });
  };
  for (const way of elements)
    if (way.type === "way" && way.nodes && walkable(way.tags || {})) {
      const tags = way.tags || {},
        name = (tags.name || tags.highway || "Path")
          .replaceAll("_", " ")
          .slice(0, 160);
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i - 1],
          b = way.nodes[i],
          pa = nodes.get(a),
          pb = nodes.get(b);
        if (!pa || !pb || a === b) continue;
        const length = metres(pa, pb);
        if (length <= 0) continue;
        if (tags["oneway:foot"] !== "-1") add(a, b, length, name);
        if (!["yes", "true", "1"].includes(tags["oneway:foot"]))
          add(b, a, length, name);
      }
    }
  return { nodes, edges };
}
class Heap {
  rows: [number, number, number][] = [];
  push(item: [number, number, number]) {
    const r = this.rows;
    r.push(item);
    let i = r.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (r[p][0] <= item[0]) break;
      r[i] = r[p];
      i = p;
    }
    r[i] = item;
  }
  pop() {
    const r = this.rows,
      first = r[0],
      last = r.pop()!;
    if (r.length) {
      let i = 0;
      while (i * 2 + 1 < r.length) {
        let c = i * 2 + 1;
        if (c + 1 < r.length && r[c + 1][0] < r[c][0]) c++;
        if (r[c][0] >= last[0]) break;
        r[i] = r[c];
        i = c;
      }
      r[i] = last;
    }
    return first;
  }
}
type Parent = { from: number; edge: Edge };
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
function dijkstra(
  graph: Graph,
  start: number,
  goal: number | undefined,
  penalty: Set<string> | undefined,
  limit: number,
  deadline: number,
  avoid?: number,
  occupied?: Set<number>
) {
  const costs = new Map([[start, 0]]),
    lengths = new Map([[start, 0]]),
    parents = new Map<number, Parent>(),
    queue = new Heap();
  const destination = goal === undefined ? undefined : graph.nodes.get(goal);
  const estimates = new Map<number, number>();
  const estimate = (id: number) => {
    if (!destination) return 0;
    if (!estimates.has(id))
      estimates.set(id, metres(graph.nodes.get(id)!, destination));
    return estimates.get(id)!;
  };
  queue.push([estimate(start), start, 0]);
  let visits = 0;
  while (queue.rows.length) {
    const [, u, cost] = queue.pop();
    if (cost !== costs.get(u)) continue;
    if (u === goal) break;
    if (
      ++visits > 200000 ||
      (visits % 500 === 0 && performance.now() > deadline)
    )
      break;
    for (const edge of graph.edges.get(u) || []) {
      if (edge.to === avoid) continue;
      if (edge.to !== goal && occupied?.has(edge.to)) continue;
      const length = lengths.get(u)! + edge.length;
      if (length > limit) continue;
      const score =
        cost + edge.length * (penalty?.has(edgeKey(u, edge.to)) ? 24 : 1);
      if (score < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, score);
        lengths.set(edge.to, length);
        parents.set(edge.to, { from: u, edge });
        queue.push([score + estimate(edge.to), edge.to, score]);
      }
    }
  }
  return { parents, lengths };
}
function path(parents: Map<number, Parent>, start: number, end: number) {
  const ids = [end],
    edges: { from: number; edge: Edge }[] = [];
  let at = end;
  while (at !== start) {
    const p = parents.get(at);
    if (!p || ids.length > 200000) return null;
    edges.push(p);
    ids.push(p.from);
    at = p.from;
  }
  return { ids: ids.reverse(), edges: edges.reverse() };
}
// Reuse the bounded start search for "another route" and speed-only changes.
const starts = new WeakMap<
  Graph,
  { start: number; target: number; search: ReturnType<typeof dijkstra> }
>();
export function generateLoop(
  graph: Graph,
  point: Point,
  target: number,
  speed: number,
  seed = 1
): Walk {
  if (
    !Number.isFinite(target) ||
    target < 500 ||
    target > 30000 ||
    !Number.isFinite(speed) ||
    speed < 1 ||
    speed > 12
  )
    throw Error(
      "Choose a distance between 0.5 and 30 km and a valid walking speed."
    );
  let start: number | undefined,
    snap = Infinity;
  const longitudeScale = Math.cos((point[1] * Math.PI) / 180);
  for (const id of graph.edges.keys()) {
    const p = graph.nodes.get(id)!;
    const d =
      ((p[0] - point[0]) * longitudeScale) ** 2 + (p[1] - point[1]) ** 2;
    if (d < snap) {
      snap = d;
      start = id;
    }
  }
  if (start === undefined)
    throw Error("No walking paths were found here. Choose another start.");
  snap = metres(graph.nodes.get(start)!, point);
  if (snap > 250)
    throw Error("Choose a start closer to a mapped public walking path.");
  const deadline = performance.now() + 2400;
  const previous = starts.get(graph);
  const first =
    previous?.start === start && previous.target === target
      ? previous.search
      : dijkstra(graph, start, undefined, undefined, target * 0.5, deadline);
  starts.set(graph, { start, target, search: first });
  const origin = graph.nodes.get(start)!,
    candidates: number[] = [],
    eligible = Array.from(first.lengths)
      .filter(
        ([id, length]) =>
          id !== start &&
          length > target * 0.16 &&
          length < target * 0.5 &&
          !(
            graph.edges.get(id)?.length === 1 &&
            graph.edges.get(id)![0].to === first.parents.get(id)?.from
          )
      )
      .map(([id, length]) => {
        const p = graph.nodes.get(id)!;
        return {
          id,
          length,
          bearing: Math.atan2(
            p[1] - origin[1],
            (p[0] - origin[0]) * longitudeScale
          )
        };
      });
  let state = seed | 0;
  state = (Math.imul(state ^ 0x6d2b79f5, 0x45d9f3b) ^ state) >>> 0;
  const rotation = (state / 4294967296) * Math.PI * 2;
  for (let sector = 0; sector < 8; sector++) {
    const angle = rotation + (sector * Math.PI) / 4;
    let best = Infinity,
      chosen: number | undefined;
    for (const { id, length, bearing } of eligible) {
      const delta = Math.abs(
          Math.atan2(Math.sin(bearing - angle), Math.cos(bearing - angle))
        ),
        score = Math.abs(length - target / 3.8) / (target / 3.8) + delta * 0.8;
      if (score < best) {
        best = score;
        chosen = id;
      }
    }
    if (chosen !== undefined && !candidates.includes(chosen))
      candidates.push(chosen);
  }
  let best:
    | {
        score: number;
        ids: number[];
        edges: { from: number; edge: Edge }[];
        distance: number;
        repeated: number;
      }
    | undefined;
  for (
    let i = 0;
    i < candidates.length * 2 && performance.now() < deadline;
    i++
  ) {
    const a = candidates[i % candidates.length],
      b = candidates[(i + (i < candidates.length ? 2 : 1)) % candidates.length],
      p1 = path(first.parents, start, a);
    if (!p1) continue;
    const used = new Set(p1.edges.map((p) => edgeKey(p.from, p.edge.to))),
      occupied = new Set(p1.ids);
    const p2 =
      path(
        dijkstra(graph, a, b, used, target * 0.65, deadline, start, occupied)
          .parents,
        a,
        b
      ) ||
      path(
        dijkstra(graph, a, b, used, target * 0.65, deadline, start).parents,
        a,
        b
      );
    if (!p2) continue;
    p2.edges.forEach((p) => used.add(edgeKey(p.from, p.edge.to)));
    p2.ids.forEach((id) => occupied.add(id));
    const p3 =
      path(
        dijkstra(
          graph,
          b,
          start,
          used,
          target * 0.65,
          deadline,
          undefined,
          occupied
        ).parents,
        b,
        start
      ) ||
      path(
        dijkstra(graph, b, start, used, target * 0.65, deadline).parents,
        b,
        start
      );
    if (!p3) continue;
    // Remove waypoint spurs instead of walking to a dead end and immediately back.
    const edges: typeof p1.edges = [];
    for (const segment of [...p1.edges, ...p2.edges, ...p3.edges]) {
      const last = edges.at(-1);
      if (
        last &&
        last.from === segment.edge.to &&
        last.edge.to === segment.from
      )
        edges.pop();
      else edges.push(segment);
    }
    const distance = edges.reduce((sum, p) => sum + p.edge.length, 0),
      counts = new Map<string, number>();
    for (const p of edges) {
      const k = edgeKey(p.from, p.edge.to);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const repeated =
        edges.reduce(
          (sum, p) =>
            sum +
            ((counts.get(edgeKey(p.from, p.edge.to)) || 0) > 1
              ? p.edge.length
              : 0),
          0
        ) / Math.max(1, distance),
      error = Math.abs(distance - target) / target,
      area =
        Math.abs(
          edges.reduce((sum, p) => {
            const a = graph.nodes.get(p.from)!,
              b = graph.nodes.get(p.edge.to)!;
            return (
              sum +
              ((a[0] - origin[0]) * (b[1] - origin[1]) -
                (b[0] - origin[0]) * (a[1] - origin[1])) *
                longitudeScale *
                111195 ** 2
            );
          }, 0)
        ) / 2,
      compactness = Math.min(
        1,
        (area * 4 * Math.PI) / Math.max(1, distance ** 2)
      ),
      score = error * 1.5 + repeated * 8 + (1 - compactness) * 0.3;
    if (repeated > 0.35 || error > 0.3) continue;
    if (!best || score < best.score)
      best = {
        score,
        ids: [start, ...edges.map((p) => p.edge.to)],
        edges,
        distance,
        repeated
      };
    if (best && repeated < 0.01 && error < 0.08 && compactness > 0.3) break;
  }
  if (!best)
    throw Error("No suitable loop found. Try another start or distance.");
  const instructions: { name: string; length: number }[] = [];
  for (const p of best.edges) {
    const last = instructions.at(-1);
    if (last?.name === p.edge.name) last.length += p.edge.length;
    else instructions.push({ name: p.edge.name, length: p.edge.length });
  }
  return {
    coordinates: best.ids.map((id) => graph.nodes.get(id)!),
    distance_m: Math.round(best.distance * 10) / 10,
    duration_s: Math.round(best.distance / (speed / 3.6)),
    speed_kmh: speed,
    requested_km: target / 1000,
    snap_distance_m: Math.round(snap),
    repeated_fraction: Math.round(best.repeated * 1000) / 1000,
    steps: [
      ...instructions.map(
        (p) => `Follow ${p.name} for ${Math.round(p.length)} m`
      ),
      "Return to the start"
    ],
    created_at: new Date().toISOString(),
    attribution: "© OpenStreetMap contributors · ODbL · Omnix browser routing",
    start_label: "Selected location"
  };
}
const xml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;"
      })[c]!
  );
export function gpx(route: Walk) {
  const points = route.coordinates;
  if (!points.length) throw Error("Generate a route before exporting.");
  const name = xml("Walking loop · " + route.start_label),
    [lon, lat] = points[0];
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Omnix" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${name}</name><desc>${xml(route.attribution)}</desc><time>${route.created_at}</time></metadata><wpt lat="${lat}" lon="${lon}"><name>Start / finish</name></wpt><trk><name>${name}</name><type>walking</type><trkseg>${points.map(([x, y]) => `<trkpt lat="${y}" lon="${x}"/>`).join("")}</trkseg></trk></gpx>`;
}
