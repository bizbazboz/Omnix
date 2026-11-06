"""Playwright against real routes, GPX and two users in a disposable Docker stack.

Requires the web dependencies and Playwright Chromium. Pass --map to exercise an
existing OSM SQLite graph read-only; otherwise import a small deterministic grid.
No authentication bypass or production database is used.
"""

import argparse
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent

SEED = """
import json
from pathlib import Path
from app.core import Session, User, SESSION_COOKIE
from app.sessions import create_session
from app.workspace_settings import store_setting
from app.walking_map import import_map
origin = {origin!r}
if {make_map!r}:
    nodes, ways = [], []
    for y in range(31):
        for x in range(31):
            id = 1 + y * 31 + x
            tags = '<tag k="name" v="Test Park"/><tag k="leisure" v="park"/>' if (x,y) == (15,15) else ''
            nodes.append(f'<node id="{{id}}" lat="{{51.488+y*.001}}" lon="{{-.142+x*.001}}">{{tags}}</node>')
    for y in range(31):
        refs = ''.join(f'<nd ref="{{1+y*31+x}}"/>' for x in range(31))
        ways.append(f'<way id="{{100+y}}">{{refs}}<tag k="highway" v="footway"/><tag k="name" v="Test Street {{y}}"/></way>')
    for x in range(31):
        refs = ''.join(f'<nd ref="{{1+y*31+x}}"/>' for y in range(31))
        ways.append(f'<way id="{{200+x}}">{{refs}}<tag k="highway" v="footway"/><tag k="name" v="Park Road {{x}}"/></way>')
    source = Path('/tmp/test.osm')
    source.write_text('<osm version="0.6">'+''.join(nodes+ways)+'</osm>')
    import_map(source, 'Walking browser test region')
with Session() as db:
    store_setting(db, 'oidc', {{'issuer':'https://identity.example.test','client_id':'walking-e2e','client_secret':'disposable-test-only','public_origin':origin}})
    cookies = []
    for name in ['Walker', 'Other']:
        user = User(issuer='https://identity.example.test', subject=name, name=name, email=name.lower()+'@example.test')
        db.add(user)
        db.commit()
        store_setting(db, 'preferences:'+user.id, {{'display_name':name,'timezone':'Europe/London','time_format':'24','start_page':'overview','default_account':'','onboarding_completed':True}})
        cookies.append({{'name':SESSION_COOKIE,'value':create_session(user.id),'url':origin,'httpOnly':True,'sameSite':'Lax'}})
print('WALKING_SESSIONS='+json.dumps(cookies))
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--map", type=Path)
    parser.add_argument("--search", default="Parliament Square")
    args = parser.parse_args()
    parent = (ROOT / ".local" / "verification").resolve()
    parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="walk-", dir=parent)).resolve()
    data = temporary / "data"
    project = "omnix-walk-" + temporary.name.removeprefix("walk-")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    env = {
        **os.environ,
        "OMNIX_IMAGE": "omnix:local",
        "OMNIX_DATA_DIR": str(data),
        "HTTP_PORT": str(port),
        "BIND_ADDRESS": "127.0.0.1",
    }
    compose = [
        "docker",
        "compose",
        "--env-file",
        os.devnull,
        "-f",
        str(ROOT / "compose.yml"),
        "-p",
        project,
    ]

    def run(*command, **kwargs):
        return subprocess.run(command, cwd=ROOT, env=env, check=True, **kwargs)

    try:
        config = json.loads(
            subprocess.check_output(
                [*compose, "config", "--format", "json"], cwd=ROOT, env=env
            )
        )
        for service in config["services"].values():
            for mount in service.get("volumes", []):
                if mount["type"] != "bind" or not Path(
                    mount["source"]
                ).resolve().is_relative_to(data):
                    raise RuntimeError(
                        "Test configuration refers to non-isolated storage"
                    )
        pg = config["services"]["postgres"]
        pg["volumes"] = [
            v for v in pg["volumes"] if v["target"] != "/var/lib/postgresql/data"
        ]
        pg["tmpfs"] = ["/var/lib/postgresql/data:rw,size=512m"]
        pg["command"] = ["postgres", "-c", "fsync=off", "-c", "synchronous_commit=off"]
        pg["environment"]["POSTGRES_INITDB_ARGS"] = "--no-sync"
        (data / "app" / "maps").mkdir(parents=True)
        config["services"]["init"]["command"] = [
            "python",
            "-c",
            "from app.bootstrap_keys import main; main(); import os; os.chown('/data/maps',10001,10001)",
        ]
        if args.map:
            source = args.map.resolve(strict=True)
            if not source.is_file():
                raise ValueError("--map must refer to an existing OSM SQLite file")
            # The API's parent /data mount is read-only; create its file mountpoint first.
            (data / "app" / "maps" / "walking.sqlite").touch()
            config["services"]["api"]["volumes"].append(
                {
                    "type": "bind",
                    "source": str(source),
                    "target": "/data/maps/walking.sqlite",
                    "read_only": True,
                }
            )
        runtime = temporary / "compose.json"
        runtime.write_text(json.dumps(config), encoding="utf-8")
        compose = ["docker", "compose", "-f", str(runtime), "-p", project]
        if not args.skip_build:
            run("docker", "build", "--target", "production", "-t", "omnix:local", ".")
        run(*compose, "up", "-d", "--wait", "--wait-timeout", "180", "api")
        seed = temporary / "seed.py"
        seed.write_text(
            SEED.format(origin=origin, make_map=not args.map), encoding="utf-8"
        )
        provision = copy.deepcopy(config["services"]["api"])
        provision.pop("ports", None)
        provision["restart"] = "no"
        provision["healthcheck"] = {"disable": True}
        for mount in provision["volumes"]:
            if mount["target"] == "/data":
                mount["read_only"] = False
        provision["volumes"].append(
            {
                "type": "bind",
                "source": str(seed),
                "target": "/checks/seed.py",
                "read_only": True,
            }
        )
        config["services"]["walking-seed"] = provision
        runtime.write_text(json.dumps(config), encoding="utf-8")
        try:
            result = run(
                *compose,
                "run",
                "--rm",
                "--no-deps",
                "-T",
                "walking-seed",
                "python",
                "-c",
                "exec(open('/checks/seed.py').read())",
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as error:
            # Provisioning output can contain session cookies; never log stdout.
            print(error.stderr)
            raise
        cookies = next(
            line.removeprefix("WALKING_SESSIONS=")
            for line in result.stdout.splitlines()
            if line.startswith("WALKING_SESSIONS=")
        )
        sessions = temporary / "sessions.json"
        sessions.write_text(cookies, encoding="utf-8")
        env.update(
            OMNIX_WALKING_E2E="1",
            OMNIX_WALKING_URL=origin,
            OMNIX_WALKING_SESSIONS=str(sessions),
            OMNIX_WALKING_SEARCH=args.search if args.map else "Test Park",
        )
        run("node", "scripts/check_walking.cjs")
    finally:
        run(*compose, "down", "--remove-orphans")
        if temporary.parent != parent or not temporary.name.startswith("walk-"):
            raise RuntimeError("Unsafe test cleanup path")
        # Only the verified disposable subtree is mounted, never the source map.
        run(
            "docker",
            "run",
            "--rm",
            "--user",
            "0:0",
            "--network",
            "none",
            "--mount",
            "type=bind,source=" + str(temporary) + ",target=/cleanup",
            "omnix:local",
            "python",
            "-c",
            "from pathlib import Path; import shutil; [shutil.rmtree(p) if p.is_dir() else p.unlink() for p in Path('/cleanup').iterdir()]",
        )
        temporary.rmdir()


if __name__ == "__main__":
    main()
