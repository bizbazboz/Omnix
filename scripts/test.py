"""Run destructive test fixtures only in a dedicated, disposable Docker project."""

import os
from pathlib import Path
import subprocess

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


def run(*args):
    subprocess.run(
        args, cwd=ROOT, check=True, env={**os.environ, "OMNIX_IMAGE": "omnix:local"}
    )


def main():
    try:
        run("docker", "build", "--target", "production", "-t", "omnix:local", ".")
        run("docker", "build", "--target", "test", "-t", "omnix-test:local", ".")
        run(
            *COMPOSE,
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "180",
            "postgres",
            "redis",
            "migrate",
        )
        run(
            "docker",
            "run",
            "--rm",
            "--network",
            PROJECT + "_data",
            "-v",
            PROJECT + "_app-data:/data:ro",
            "-v",
            PROJECT + "_db-secret:/run/db:ro",
            "-v",
            PROJECT + "_redis-secret:/run/redis:ro",
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
        subprocess.run([*COMPOSE, "logs", "--tail=60"], cwd=ROOT)
        raise
    finally:
        # This constant project owns only test volumes; never use a caller-supplied name.
        run(*COMPOSE, "down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
