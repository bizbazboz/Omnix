import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  buildGraph,
  generateLoop,
  walkable,
  gpx
} from "../web/src/products/health/walking/graph.ts";
const { walkingFixture } = createRequire(import.meta.url)(
  "./walking_fixture.cjs"
);
const graph = buildGraph(walkingFixture().elements),
  point = [-0.127, 51.503];
const route = generateLoop(graph, point, 3200, 5, 1);
assert.deepEqual(route.coordinates[0], route.coordinates.at(-1));
assert(route.distance_m >= 2240 && route.distance_m <= 4160);
assert(route.repeated_fraction <= 0.35);
const ids = new Map(
  Array.from(graph.nodes, ([id, point]) => [point.join(","), id])
);
for (let i = 1; i < route.coordinates.length; i++)
  assert(
    graph.edges
      .get(ids.get(route.coordinates[i - 1].join(",")))
      .some((edge) => edge.to === ids.get(route.coordinates[i].join(",")))
  );
const timed = generateLoop(graph, point, 3000, 4, 2);
assert.equal(timed.duration_s, Math.round(timed.distance_m / (4 / 3.6)));
assert(!walkable({ highway: "motorway" }));
assert(!walkable({ highway: "path", foot: "no" }));
assert(!walkable({ highway: "path", access: "private" }));
assert(walkable({ highway: "path", access: "private", foot: "yes" }));
assert(!walkable({ highway: "primary" }));
assert(walkable({ highway: "primary", sidewalk: "both" }));
const nodes = [
  { type: "node", id: 1, lon: 0, lat: 0 },
  { type: "node", id: 2, lon: 0.001, lat: 0 },
  { type: "node", id: 3, lon: 0.002, lat: 0 }
];
const directed = buildGraph([
  ...nodes,
  {
    type: "way",
    id: 4,
    nodes: [1, 2],
    tags: { highway: "footway", "oneway:foot": "-1" }
  }
]);
assert(!directed.edges.has(1));
assert.equal(directed.edges.get(2)[0].to, 1);
const chain = buildGraph([
  ...nodes,
  { type: "way", id: 4, nodes: [1, 2, 3], tags: { highway: "footway" } }
]);
assert.throws(() => generateLoop(chain, [0, 0], 500, 5), /No suitable loop/);
assert.throws(() => generateLoop(graph, point, 10, 5), /distance/);
let sparseLoops = 0;
for (let variant = 1; variant <= 8; variant++) {
  const sparse = buildGraph(walkingFixture().elements);
  for (const [id, edges] of sparse.edges)
    sparse.edges.set(
      id,
      edges.filter((edge) => {
        const a = Math.min(id, edge.to),
          b = Math.max(id, edge.to);
        const hash =
          (Math.imul(a, 73856093) ^
            Math.imul(b, 19349663) ^
            Math.imul(variant, 83492791)) >>>
          0;
        return hash % 100 >= 42;
      })
    );
  for (let seed = 1; seed <= 8; seed++) {
    let loop;
    try {
      loop = generateLoop(sparse, point, 3200, 5, seed);
    } catch (error) {
      assert.match(error.message, /No suitable loop/);
      continue;
    }
    sparseLoops++;
    assert.deepEqual(loop.coordinates[0], loop.coordinates.at(-1));
    assert.equal(
      loop.repeated_fraction,
      0,
      "Prefer a non-repeating loop where the network allows it"
    );
    for (let i = 2; i < loop.coordinates.length; i++)
      assert.notDeepEqual(
        loop.coordinates[i],
        loop.coordinates[i - 2],
        "No immediate out-and-back spur"
      );
  }
}
assert(
  sparseLoops >= 52,
  "Find loops across sparse networks without trading away route coverage"
);
route.start_label = "Park <test> & cafe";
const xml = gpx(route);
assert(xml.includes("&lt;test&gt; &amp; cafe"));
assert.equal((xml.match(/<trkpt /g) || []).length, route.coordinates.length);
assert(xml.includes('xmlns="http://www.topografix.com/GPX/1/1"'));
console.log(
  JSON.stringify({
    browserWalkingGraph: true,
    closedLoop: true,
    walkableEdges: true,
    directionRules: true,
    noFabricatedRoutes: true,
    speedTime: true,
    gpxEscaping: true,
    distance: route.distance_m
  })
);
