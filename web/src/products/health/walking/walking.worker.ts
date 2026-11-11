import {
  buildGraph,
  generateLoop,
  metres,
  type Graph,
  type Point,
  type Element
} from "./graph";
let cached: { point: Point; radius: number; graph: Graph } | undefined;
const searches = new Map<string, unknown[]>();
let lastSearch = 0,
  busy = false;
async function json(
  url: string,
  options: RequestInit = {},
  limit = 20 * 1024 * 1024
) {
  const response = await fetch(url, {
    ...options,
    credentials: "omit",
    referrerPolicy: "strict-origin-when-cross-origin",
    signal: AbortSignal.timeout(45000)
  });
  if (response.status === 429 || response.status === 504)
    throw Error(
      "The map-data service is busy. Wait a moment or try a shorter distance."
    );
  if (!response.ok)
    throw Error("Online map data is unavailable. Try again later.");
  if (!response.body) throw Error("Online map data is unavailable.");
  const reader = response.body.getReader(),
    chunks: string[] = [],
    decoder = new TextDecoder();
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error("Too much map data for this area. Try a shorter distance.");
    }
    chunks.push(decoder.decode(part.value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return JSON.parse(chunks.join(""));
}
self.onmessage = async (event: MessageEvent) => {
  const { id, type } = event.data;
  if (busy) return;
  busy = true;
  try {
    if (type === "search") {
      const q = String(event.data.query).trim().slice(0, 150),
        key = q.toLowerCase();
      if (q.length < 2) throw Error("Enter at least two characters.");
      if (searches.has(key)) {
        self.postMessage({ id, type: "locations", items: searches.get(key) });
        return;
      }
      if (Date.now() - lastSearch < 1200)
        throw Error("Wait a moment before searching again.");
      lastSearch = Date.now();
      const value = await json(
        "https://photon.komoot.io/api/?" +
          new URLSearchParams({ q, limit: "6" }),
        {},
        1024 * 1024
      );
      const items = (value.features || [])
        .map((f: any) => {
          const p = f.properties || {},
            point = f.geometry?.coordinates;
          return {
            id: String(p.osm_id || point),
            name: p.name || p.street || "Location",
            label: [
              p.name,
              p.housenumber && p.street
                ? `${p.housenumber} ${p.street}`
                : p.street,
              p.city || p.town || p.village,
              p.country
            ]
              .filter((v, i, a) => v && a.indexOf(v) === i)
              .join(", "),
            longitude: point?.[0],
            latitude: point?.[1]
          };
        })
        .filter(
          (p: any) =>
            Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
        );
      if (searches.size >= 30) searches.delete(searches.keys().next().value!);
      searches.set(key, items);
      self.postMessage({ id, type: "locations", items });
    } else if (type === "generate") {
      const { latitude, longitude, target, speed, seed, label } = event.data;
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 85 ||
        Math.abs(longitude) > 180 ||
        !Number.isFinite(target) ||
        target < 500 ||
        target > 30000
      )
        throw Error(
          "Choose a valid start and a distance between 0.5 and 30 km."
        );
      const point: Point = [longitude, latitude],
        radius = Math.min(8000, Math.max(450, target / 3 + 200));
      if (
        !cached ||
        metres(point, cached.point) > 100 ||
        radius > cached.radius
      ) {
        self.postMessage({
          id,
          type: "progress",
          message: "Loading nearby walking paths…"
        });
        const query = `[out:json][timeout:25][maxsize:33554432];way(around:${Math.ceil(radius + 100)},${latitude},${longitude})["highway"~"^(footway|path|pedestrian|steps|residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|road|cycleway)$"];(._;>;);out body;`;
        const value = await json("https://overpass-api.de/api/interpreter", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query })
        });
        if (value.remark || !Array.isArray(value.elements))
          throw Error(
            "The map service could not complete that area. Try a shorter distance."
          );
        cached = {
          point,
          radius,
          graph: buildGraph(value.elements as Element[])
        };
      }
      self.postMessage({
        id,
        type: "progress",
        message: "Finding a loop on this device…"
      });
      const route = generateLoop(cached.graph, point, target, speed, seed);
      route.start_label = String(label).slice(0, 300);
      self.postMessage({ id, type: "route", route });
    }
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The route could not be generated."
    });
  } finally {
    busy = false;
  }
};
