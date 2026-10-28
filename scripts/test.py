"""Run destructive contracts with isolated host bind mounts, never production data."""

import os
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "omnix-verification"
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    os.devnull,
    "-f",
    str(ROOT / "compose.yml"),
    "-p",
    PROJECT,
]


def main():
    test_parent = (ROOT / ".local" / "verification").resolve()
    test_parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="run-", dir=test_parent)).resolve()
    data = temporary / "data"
    if temporary.parent != test_parent or not temporary.name.startswith("run-"):
        raise RuntimeError("Unsafe test data path")
    environment = {
        **os.environ,
        "OMNIX_IMAGE": "omnix:local",
        "OMNIX_DATA_DIR": str(data),
    }

    def run(*args):
        subprocess.run(args, cwd=ROOT, check=True, env=environment)

    try:
        resolved = json.loads(
            subprocess.check_output(
                [*COMPOSE, "config", "--format", "json"], cwd=ROOT, env=environment
            )
        )
        for service in resolved["services"].values():
            for mount in service.get("volumes", []):
                if mount["type"] != "bind" or not Path(
                    mount["source"]
                ).resolve().is_relative_to(data.resolve()):
                    raise RuntimeError(
                        "Test configuration refers to non-isolated storage"
                    )
        run("docker", "build", "--target", "production", "-t", "omnix:local", ".")
        run("docker", "build", "--target", "test", "-t", "omnix-test:local", ".")
        run(
            *COMPOSE, "up", "-d", "--wait", "--wait-timeout", "180", "postgres", "redis"
        )
        run(*COMPOSE, "run", "--rm", "migrate")
        run(
            "docker",
            "run",
            "--rm",
            "--network",
            PROJECT + "_data",
            "-v",
            str(data / "app") + ":/data:ro",
            "-v",
            str(data / "secrets" / "db") + ":/run/db:ro",
            "-v",
            str(data / "secrets" / "redis") + ":/run/redis:ro",
            "--read-only",
            "--tmpfs",
            "/tmp",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "-e",
            "OMNIX_TESTS=1",
            "omnix-test:local",
            "python",
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
        )
    except Exception:
        subprocess.run([*COMPOSE, "logs", "--tail=60"], cwd=ROOT, env=environment)
        raise
    finally:
        run(*COMPOSE, "down", "--remove-orphans")
        if data.exists():
            # PostgreSQL owns its test files. Remove only this verified, disposable subtree.
            if data.resolve().parent != temporary or temporary.parent != test_parent:
                raise RuntimeError("Unsafe cleanup path")
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
                "import shutil; shutil.rmtree('/cleanup/data')",
            )
        temporary.rmdir()


if __name__ == "__main__":
    main()
