// Pure model regressions, using Node's type stripping (Node 22.18+).
import assert from "node:assert/strict";
import { pageTreeIndex } from "../web/src/products/notes/pageTreeIndex.ts";
import {
  latestDay,
  weeklyHours,
  weekStart
} from "../web/src/products/health/readings.ts";

const workout = {
  points: {
    "2026-11-15": 10,
    "2026-11-16": 1.5,
    "2026-11-18": 0.5,
    "2026-11-23": 20
  }
};
assert.equal(weeklyHours(workout, "2026-11-18"), 2);
assert.equal(weeklyHours(workout, "2026-11-22"), 2);
assert.equal(weeklyHours(workout, "2026-11-15"), 10);
assert.equal(weeklyHours(undefined, "2026-11-18"), undefined);
assert.equal(weeklyHours({ points: { "2026-11-16": 0 } }, "2026-11-18"), 0);
assert.equal(weekStart("2027-01-01"), "2026-12-28");
assert.equal(weekStart("2026-10-25"), "2026-10-19");
assert.equal(
  latestDay({ points: { "2026-11-16": 82.4, "2026-11-20": 80 } }, "2026-11-18"),
  "2026-11-16"
);

const pages = Array.from({ length: 10000 }, (_, i) => ({
  id: String(i),
  parent_id: i ? String(Math.floor((i - 1) / 10)) : null,
  title: i === 9999 ? "Find this nested page" : "Page " + i,
  position: 10000 - i
}));
const start = performance.now();
const index = pageTreeIndex(pages, "nested page");
assert.equal(index.byId.size, 10000);
assert(index.visible.has("9999"));
assert(index.visible.has("0"));
assert(!index.visible.has("9998"));
for (const siblings of index.children.values())
  for (let i = 1; i < siblings.length; i++)
    assert(siblings[i - 1].position <= siblings[i].position);
assert.equal(pageTreeIndex(pages, " ").searching, false);
assert.equal(pageTreeIndex(pages, "missing title").visible.size, 0);
// Corrupt parent cycles must never hang ancestor search.
const cyclic = pageTreeIndex(
  [
    { id: "a", parent_id: "b", title: "Match", position: 0 },
    { id: "b", parent_id: "a", title: "Other", position: 0 }
  ],
  "match"
);
assert.deepEqual([...cyclic.visible].sort(), ["a", "b"]);
console.log(
  JSON.stringify({
    indexedPages: pages.length,
    ancestors: true,
    ordering: true,
    cycleSafe: true,
    elapsedMs: Math.round(performance.now() - start)
  })
);
