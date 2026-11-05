"""Local OSM file import, place index and bounded walking-graph reads. No routing API."""

import heapq
import json
import math
import os
import random
import re
import sqlite3
import shutil
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

MAP_PATH = Path("/data/maps/walking.sqlite")
DEFAULT_EXTRACT = "https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf"
ALLOWED = {
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
    "cycleway",
}
FOOT_OK = {"yes", "designated", "permissive", "official"}


def metres(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    )
    return 12742000 * math.asin(math.sqrt(min(1, h)))


def walkable(tags):
    foot, access = tags.get("foot", ""), tags.get("access", "")
    return (
        tags.get("highway") in ALLOWED
        and tags.get("area") != "yes"
        and foot not in {"no", "private", "use_sidepath", "destination"}
        and (
            access not in {"no", "private", "destination", "customers"}
            or foot in FOOT_OK
        )
        and tags.get("ford") not in {"yes", "stepping_stones"}
        and tags.get("sidewalk") != "separate"
    )


def _import_map(source, name="OpenStreetMap", destination=None):
    import osmium

    destination = Path(destination or MAP_PATH)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Random SQLite writes are slow on desktop bind mounts. Build on local scratch
    # storage, then publish the finished database with a sequential atomic copy.
    descriptor, filename = tempfile.mkstemp(prefix="omnix-walking-", suffix=".sqlite")
    os.close(descriptor)
    temporary = Path(filename)
    staging = destination.with_suffix(".building.sqlite")
    db = sqlite3.connect(temporary)
    db.executescript(
        """PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-65536;
      CREATE TABLE nodes(id INTEGER PRIMARY KEY,lon REAL,lat REAL);
      CREATE TABLE edges(u INTEGER,v INTEGER,name TEXT,direction INTEGER);
      CREATE TABLE places(name TEXT,kind TEXT,lon REAL,lat REAL);
      CREATE TABLE metadata(value TEXT);
    """
    )
    wanted, road_names = set(), []
    edge_batch, node_batch, place_batch = [], [], []
    counts = {"edges": 0, "nodes": 0}

    def flush_edges():
        if edge_batch:
            db.executemany("INSERT INTO edges VALUES(?,?,?,?)", edge_batch)
            counts["edges"] += len(edge_batch)
            edge_batch.clear()

    class Ways(osmium.SimpleHandler):
        def way(self, way):
            tags = dict(way.tags)
            if walkable(tags):
                refs = [node.ref for node in way.nodes]
                wanted.update(refs)
                direction = (
                    1
                    if tags.get("oneway:foot") in {"yes", "1", "true"}
                    else -1 if tags.get("oneway:foot") == "-1" else 0
                )
                name = (
                    tags.get("name") or tags.get("highway", "Path").replace("_", " ")
                )[:160]
                for u, v in zip(refs, refs[1:]):
                    if u != v:
                        edge_batch.append((u, v, name, direction))
                if tags.get("name") and refs:
                    road_names.append((name, tags.get("highway"), refs[0]))
                if len(edge_batch) > 10000:
                    flush_edges()
                if len(wanted) > 4000000:
                    raise ValueError(
                        "Map region is too large. Use a smaller regional extract."
                    )
            elif tags.get("name") and tags.get("leisure") == "park" and len(way.nodes):
                wanted.add(way.nodes[0].ref)
                road_names.append((tags["name"][:160], "park", way.nodes[0].ref))

    def flush_nodes():
        if node_batch:
            db.executemany("INSERT OR REPLACE INTO nodes VALUES(?,?,?)", node_batch)
            counts["nodes"] += len(node_batch)
            node_batch.clear()
        if place_batch:
            db.executemany("INSERT INTO places VALUES(?,?,?,?)", place_batch)
            place_batch.clear()

    blocked = set()

    class Nodes(osmium.SimpleHandler):
        def node(self, node):
            if node.id not in wanted and not len(node.tags):
                return
            if not node.location.valid():
                return
            tags = dict(node.tags)
            if node.id in wanted:
                node_batch.append((node.id, node.location.lon, node.location.lat))
                if (
                    tags.get("foot") in {"no", "private"}
                    or (
                        tags.get("access") in {"no", "private"}
                        and tags.get("foot") not in FOOT_OK
                    )
                    or tags.get("locked") == "yes"
                ):
                    blocked.add(node.id)
            name = tags.get("name")
            if not name and tags.get("addr:street") and tags.get("addr:housenumber"):
                name = tags["addr:housenumber"] + " " + tags["addr:street"]
            if name and (
                tags.get("place")
                or tags.get("amenity")
                or tags.get("leisure")
                or tags.get("railway")
                or tags.get("addr:street")
                or tags.get("tourism")
            ):
                place_batch.append(
                    (
                        name[:160],
                        (
                            tags.get("place")
                            or tags.get("amenity")
                            or tags.get("leisure")
                            or tags.get("railway")
                            or "address"
                        )[:60],
                        node.location.lon,
                        node.location.lat,
                    )
                )
            if len(node_batch) + len(place_batch) > 10000:
                flush_nodes()

    try:
        print("OSM import: reading walking ways", flush=True)
        Ways().apply_file(
            str(source), filters=[osmium.filter.KeyFilter("highway", "leisure")]
        )
        flush_edges()
        print(f"OSM import: resolving {len(wanted)} network nodes", flush=True)
        Nodes().apply_file(str(source), filters=[osmium.filter.IdFilter(wanted)])

        class NamedNodes(Nodes):
            def node(self, node):
                if node.id not in wanted:
                    super().node(node)

        NamedNodes().apply_file(
            str(source), filters=[osmium.filter.KeyFilter("name", "addr:street")]
        )
        flush_nodes()
        if counts["nodes"] < 4 or counts["edges"] < 4:
            raise ValueError("No usable walking network in this map.")
        print("OSM import: indexing walking edges", flush=True)
        db.execute("CREATE INDEX edge_u ON edges(u)")
        db.execute("CREATE INDEX edge_v ON edges(v)")
        # Removing blocked vertices is sufficient: graph reads join against the
        # node index and discard missing endpoints. Avoid repeated edge scans.
        db.executemany("DELETE FROM nodes WHERE id=?", ((n,) for n in blocked))
        db.executemany(
            "INSERT INTO places SELECT ?,?,lon,lat FROM nodes WHERE id=?", road_names
        )
        print("OSM import: building spatial and location indexes", flush=True)
        db.executescript(
            """CREATE VIRTUAL TABLE node_bounds USING rtree(id,minlon,maxlon,minlat,maxlat);
          INSERT INTO node_bounds SELECT id,lon,lon,lat,lat FROM nodes;
          CREATE VIRTUAL TABLE place_search USING fts5(name,kind,lon UNINDEXED,lat UNINDEXED,tokenize='unicode61');
          INSERT INTO place_search SELECT name,kind,lon,lat FROM places GROUP BY name,round(lon,3),round(lat,3);
        """
        )
        bounds = db.execute(
            "SELECT min(lon),min(lat),max(lon),max(lat) FROM nodes"
        ).fetchone()
        metadata = {
            "ready": True,
            "name": name[:100],
            "nodes": db.execute("SELECT count(*) FROM nodes").fetchone()[0],
            "edges": db.execute("SELECT count(*) FROM edges").fetchone()[0],
            "bounds": bounds,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "attribution": "© OpenStreetMap contributors · ODbL",
        }
        db.execute("INSERT INTO metadata VALUES(?)", (json.dumps(metadata),))
        db.commit()
        db.close()
        print("OSM import: publishing the finished map", flush=True)
        shutil.copyfile(temporary, staging)
        staging.replace(destination)
        temporary.unlink(missing_ok=True)
        return metadata
    except BaseException:
        db.close()
        temporary.unlink(missing_ok=True)
        raise


def import_map(source, name="OpenStreetMap", destination=None):
    import fcntl

    destination = Path(destination or MAP_PATH)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.with_suffix(".lock").open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another map import is already running") from None
        return _import_map(source, name, destination)


def connect(path=None):
    path = Path(path or MAP_PATH)
    if not path.is_file():
        raise ValueError(
            "Download or import a regional OpenStreetMap file in Integrations first."
        )
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def map_status(path=None):
    try:
        with connect(path) as db:
            return json.loads(db.execute("SELECT value FROM metadata").fetchone()[0])
    except (ValueError, sqlite3.Error):
        return {
            "ready": False,
            "name": "",
            "attribution": "© OpenStreetMap contributors · ODbL",
        }


def search_places(query, path=None):
    words = re.findall(r"\w+", query, flags=re.UNICODE)[:8]
    if not words or len(query.strip()) < 2:
        return []
    match = " AND ".join('"' + word.replace('"', '""') + '"*' for word in words)
    with connect(path) as db:
        rows = db.execute(
            "SELECT name,kind,lon,lat FROM place_search WHERE place_search MATCH ? ORDER BY bm25(place_search),length(name) LIMIT 12",
            (match,),
        ).fetchall()
    return [
        {
            "id": f"{lon}:{lat}:{name}",
            "name": name,
            "label": name,
            "detail": kind.replace("_", " "),
            "longitude": lon,
            "latitude": lat,
        }
        for name, kind, lon, lat in rows
    ]


def read_graph(longitude, latitude, target, path=None):
    radius = max(1200, target / 3 + 400)
    dlat = radius / 111000
    dlon = dlat / max(0.1, math.cos(math.radians(latitude)))
    with connect(path) as db:
        rows = db.execute(
            "SELECT n.id,n.lon,n.lat FROM node_bounds b JOIN nodes n ON n.id=b.id WHERE b.minlon>=? AND b.maxlon<=? AND b.minlat>=? AND b.maxlat<=? LIMIT 300001",
            (longitude - dlon, longitude + dlon, latitude - dlat, latitude + dlat),
        ).fetchall()
        if len(rows) > 300000:
            raise ValueError(
                "This area is too dense for that distance. Choose a shorter walk."
            )
        nodes = {row[0]: (row[1], row[2]) for row in rows}
        edges = db.execute(
            "SELECT e.u,e.v,e.name,e.direction FROM edges e JOIN node_bounds b ON b.id=e.u WHERE b.minlon>=? AND b.maxlon<=? AND b.minlat>=? AND b.maxlat<=?",
            (longitude - dlon, longitude + dlon, latitude - dlat, latitude + dlat),
        )
        graph = {key: [] for key in nodes}
        for u, v, name, direction in edges:
            if u not in nodes or v not in nodes:
                continue
            length = metres(nodes[u], nodes[v])
            if length <= 0:
                continue
            if direction >= 0:
                graph[u].append((v, length, name))
            if direction <= 0:
                graph[v].append((u, length, name))
    graph = {key: value for key, value in graph.items() if value}
    return nodes, graph


def dijkstra(graph, start, goal=None, penalty=None, limit=30000, deadline=None):
    distances = {start: 0}
    lengths = {start: 0}
    parents = {}
    queue = [(0, start)]
    visited = 0
    while queue:
        cost, u = heapq.heappop(queue)
        if cost != distances[u]:
            continue
        if u == goal:
            break
        visited += 1
        if visited > 200000 or (
            deadline and visited % 1000 == 0 and time.monotonic() > deadline
        ):
            break
        for v, length, name in graph.get(u, []):
            distance = lengths[u] + length
            if distance > limit:
                continue
            score = cost + length * (
                6 if penalty and tuple(sorted((u, v))) in penalty else 1
            )
            if score < distances.get(v, float("inf")):
                distances[v] = score
                lengths[v] = distance
                parents[v] = (u, length, name)
                heapq.heappush(queue, (score, v))
    return parents, lengths


def path_to(parents, start, end):
    if end == start:
        return [start], []
    route = [end]
    edges = []
    while route[-1] != start:
        item = parents.get(route[-1])
        if not item:
            return [], []
        parent, length, name = item
        edges.append((parent, route[-1], length, name))
        route.append(parent)
    return route[::-1], edges[::-1]


def generate_loop(latitude, longitude, target_m, seed=1, speed_kmh=5, path=None):
    nodes, graph = read_graph(longitude, latitude, target_m, path)
    if not graph:
        raise ValueError("No walking paths near that start point in the installed map.")
    start = min(graph, key=lambda n: metres(nodes[n], (longitude, latitude)))
    snap = metres(nodes[start], (longitude, latitude))
    if snap > 250:
        raise ValueError("Choose a start closer to a mapped public walking path.")
    deadline = time.monotonic() + 25
    parents, lengths = dijkstra(graph, start, limit=target_m * 0.5, deadline=deadline)
    rng = random.Random(seed)
    rotation = rng.uniform(0, math.tau)
    candidates = []
    for sector in range(8):
        angle = rotation + sector * math.tau / 8

        def score(n):
            dx = (nodes[n][0] - nodes[start][0]) * math.cos(math.radians(latitude))
            dy = nodes[n][1] - nodes[start][1]
            bearing = math.atan2(dy, dx)
            delta = abs(
                math.atan2(math.sin(bearing - angle), math.cos(bearing - angle))
            )
            return abs(lengths[n] - target_m / 3.8) / (target_m / 3.8) + delta * 0.8

        eligible = [
            n
            for n in lengths
            if n != start and target_m * 0.16 < lengths[n] < target_m * 0.5
        ]
        if eligible:
            candidates.append(min(eligible, key=score))
    candidates = list(dict.fromkeys(candidates))
    best = None
    for i, a in enumerate(candidates):
        if time.monotonic() > deadline:
            break
        b = candidates[(i + 3) % len(candidates)]
        first, edges1 = path_to(parents, start, a)
        used = {tuple(sorted((u, v))) for u, v, _, _ in edges1}
        p2, _ = dijkstra(graph, a, b, used, limit=target_m * 0.65, deadline=deadline)
        second, edges2 = path_to(p2, a, b)
        if not second:
            continue
        used.update(tuple(sorted((u, v))) for u, v, _, _ in edges2)
        p3, _ = dijkstra(
            graph, b, start, used, limit=target_m * 0.65, deadline=deadline
        )
        third, edges3 = path_to(p3, b, start)
        if not third:
            continue
        edges = edges1 + edges2 + edges3
        distance = sum(edge[2] for edge in edges)
        counted = Counter(tuple(sorted((u, v))) for u, v, _, _ in edges)
        repeated = sum(
            length for u, v, length, _ in edges if counted[tuple(sorted((u, v)))] > 1
        ) / max(distance, 1)
        error = abs(distance - target_m) / target_m
        if repeated > 0.35 or error > 0.3:
            continue
        score = error * 3 + repeated
        if best is None or score < best[0]:
            best = (score, first + second[1:] + third[1:], edges, distance, repeated)
    if best is None:
        raise ValueError(
            "No suitable loop found on this walking network. Try another start point or distance."
        )
    _, route, edges, distance, repeated = best
    instructions = []
    for _, _, length, name in edges:
        if instructions and instructions[-1][0] == name:
            instructions[-1][1] += length
        else:
            instructions.append([name, length])
    steps = [f"Follow {name} for {round(length)} m" for name, length in instructions]
    steps.append("Return to the start")
    return {
        "coordinates": [list(nodes[n]) for n in route],
        "distance_m": round(distance, 1),
        "duration_s": round(distance / (speed_kmh / 3.6)),
        "speed_kmh": speed_kmh,
        "steps": steps,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "requested_km": target_m / 1000,
        "snap_distance_m": round(snap),
        "repeated_fraction": round(repeated, 3),
        "attribution": "© OpenStreetMap contributors · ODbL · Omnix local routing",
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--name", default="OpenStreetMap")
    args = parser.parse_args()
    print(json.dumps(import_map(args.source, args.name)))
