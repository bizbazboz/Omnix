import json
import pytest
from app import walking, walking_map
from app.core import Session, User, redis, decrypt, SystemSetting


@pytest.fixture
def regional_map(tmp_path, monkeypatch):
    path = tmp_path / "map.osm"
    nodes = []
    ways = []
    for y in range(7):
        for x in range(7):
            id = 1 + y * 7 + x
            tags = (
                '<tag k="name" v="Test Park"/><tag k="leisure" v="park"/>'
                if id == 25
                else ""
            )
            nodes.append(
                f'<node id="{id}" lat="{51.5+y*.001}" lon="{-.13+x*.001}">{tags}</node>'
            )
    for y in range(7):
        refs = "".join(f'<nd ref="{1+y*7+x}"/>' for x in range(7))
        ways.append(
            f'<way id="{100+y}">{refs}<tag k="highway" v="footway"/><tag k="name" v="Test Street {y}"/></way>'
        )
    for x in range(7):
        refs = "".join(f'<nd ref="{1+y*7+x}"/>' for y in range(7))
        ways.append(
            f'<way id="{200+x}">{refs}<tag k="highway" v="residential"/><tag k="name" v="Park Road {x}"/></way>'
        )
    path.write_text('<osm version="0.6">' + "".join(nodes + ways) + "</osm>")
    db = tmp_path / "walking.sqlite"
    walking_map.import_map(path, "Test region", db)
    monkeypatch.setattr(walking_map, "MAP_PATH", db)
    return db


def test_import_search_and_loop_use_only_local_map(regional_map, monkeypatch):
    monkeypatch.setattr(
        "app.daily_fetch.fetch_json",
        lambda *a, **k: pytest.fail("Routing must never call an external API"),
    )
    assert walking_map.map_status()["ready"]
    results = walking_map.search_places("Test Park")
    assert results and results[0]["name"] == "Test Park"
    route = walking_map.generate_loop(51.503, -0.127, 1000, seed=2)
    assert route["coordinates"][0] == route["coordinates"][-1]
    assert 700 <= route["distance_m"] <= 1300
    assert route["repeated_fraction"] <= 0.35
    assert "OpenStreetMap" in route["attribution"]
    nodes, graph = walking_map.read_graph(-0.127, 51.503, 1000)
    positions = {tuple(value): id for id, value in nodes.items()}
    for a, b in zip(route["coordinates"], route["coordinates"][1:]):
        assert any(
            edge[0] == positions[tuple(b)] for edge in graph[positions[tuple(a)]]
        )


def test_public_access_and_pedestrian_direction_rules():
    assert not walking_map.walkable({"highway": "motorway"})
    assert not walking_map.walkable({"highway": "footway", "foot": "no"})
    assert not walking_map.walkable({"highway": "residential", "access": "private"})
    assert walking_map.walkable(
        {"highway": "residential", "access": "private", "foot": "yes"}
    )
    assert not walking_map.walkable({"highway": "path", "ford": "yes"})


def test_distance_and_speed_time_targets():
    assert walking.WalkInput(latitude=0, longitude=0, distance_km=4).target() == 4000
    assert (
        walking.WalkInput(
            latitude=0, longitude=0, mode="time", speed_kmh=4, duration_minutes=45
        ).target()
        == 3000
    )
    with pytest.raises(ValueError):
        walking.WalkInput(
            latitude=0, longitude=0, mode="time", speed_kmh=12, duration_minutes=360
        )


def test_walking_routes_are_private_and_downloadable(signed_client, user, regional_map):
    assert signed_client.get("/api/v1/health/walks").json()["map"]["ready"]
    results = signed_client.get("/api/v1/health/walks/locations?q=Test%20Park").json()
    assert results["items"]
    response = signed_client.post(
        "/api/v1/health/walks",
        json={
            "latitude": 51.503,
            "longitude": -0.127,
            "distance_km": 1,
            "start_label": "Test Park",
            "seed": 2,
        },
    )
    assert response.status_code == 200, response.text
    route = response.json()
    gpx = signed_client.get(
        "/api/v1/health/walks/gpx", params={"created_at": route["created_at"]}
    )
    assert gpx.status_code == 200 and "<trkpt" in gpx.text
    assert (
        signed_client.get("/api/v1/health/walks/gpx?created_at=old").status_code == 409
    )
    with Session() as db:
        row = db.get(SystemSetting, "health-walk:" + user.id)
        assert "Test Park" not in row.value
        assert decrypt(row.value)["start_label"] == "Test Park"


def test_missing_map_and_admin_boundary(signed_client, monkeypatch, tmp_path):
    monkeypatch.setattr(walking_map, "MAP_PATH", tmp_path / "missing.sqlite")
    assert not signed_client.get("/api/v1/health/walks/map").json()["ready"]
    assert (
        signed_client.post(
            "/api/v1/health/walks", json={"latitude": 0, "longitude": 0}
        ).status_code
        == 503
    )
    assert signed_client.get("/api/v1/settings/walking-map").status_code == 403
    assert signed_client.post("/api/v1/settings/walking-map/import").status_code == 403


def test_no_loop_does_not_fabricate_geometry(monkeypatch):
    graph = {
        1: [(2, 100, "Path")],
        2: [(1, 100, "Path"), (3, 100, "Path")],
        3: [(2, 100, "Path")],
    }
    p, _ = walking_map.dijkstra(graph, 1, 3)
    route, _ = walking_map.path_to(p, 1, 3)
    assert route == [1, 2, 3]

    monkeypatch.setattr(
        walking_map,
        "read_graph",
        lambda *a, **k: ({1: (0, 0), 2: (0.001, 0), 3: (0.002, 0)}, graph),
    )
    with pytest.raises(ValueError, match="No suitable loop"):
        walking_map.generate_loop(0, 0, 500)
