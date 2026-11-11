# Production security configuration

## Tunnel identity and request limits

The API continues to ignore arbitrary forwarding headers. When a tunnel connects
many users through a single peer, set `TRUSTED_PROXY_CIDRS` in Compose to **only the
actual tunnel peer addresses** visible to the API, and choose
`TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` for Cloudflare Tunnel or `x-real-ip` for
a controlled proxy that overwrites that header. Do not use `0.0.0.0/0`, `::/0`, or
an entire shared LAN. Keep the origin port bound to loopback or otherwise isolated
from clients that could impersonate the trusted peer. A single valid IP from the
configured header is accepted only from those peers; duplicate/invalid values
fall back to the transport peer. Without this configuration, shared tunnel users
necessarily share the transport-peer login budget.

Global transport-peer limits remain in effect even for trusted tunnels. Account
and mutation limits still apply across browser, REST and MCP access. The API caps
concurrent requests, enforces a 15-second body-read deadline, rejects unauthenticated
large bodies before reading them, and has configurable `API_MEMORY_LIMIT` (default
1 GiB), `API_CPUS` (default 2) and a process cap. Scale these deliberately with load.

## Admission and browser grants

Changing the local issuer/admission policy immediately denies excluded subjects
on subsequent browser, REST and MCP authentication. The save operation revokes
their PATs and removes existing sessions. Re-admission does not restore old tokens
or cookies. Provider-only deprovisioning cannot be discovered without provider
events or reauthentication: remove the subject from the local allowlist when
revoking access at Pocket ID.

Companion browser approval returns a 30-second one-use grant through a fixed app
callback. It does not make the request pollable or exchangeable on its own. The
app verifies its locally pending request ID before exchanging the grant together
with its verifier. Upgrade server and companion together. This preserves the
code-free setup and does not introduce a QR instance confirmation popup.

## Infrastructure secrets

The init service mounts the **whole host secrets parent** and changes it to root
ownership and mode 0700, including existing installations. Service-specific child
directories are mounted individually into each container. Operators must retain
that parent restriction when moving data or restoring backups; don't chmod the
deployment tree recursively to 0755/0777. Windows bind mounts also require host
ACL protection. Never publish DB/Redis ports or mount the Docker socket.

## OS updates and advisory triage

Builds use HTTPS package repositories and install vendor security upgrades.
Publishing refreshes the OS layer rather than relying indefinitely on a cached
package index. CI blocks Critical and **fixable High** image advisories. Remaining
unfixed High package matches require vendor/reachability review; scanner severity
alone is not proof of a reachable application exploit.

The 11 November 2026 baseline included the following High families. Re-review by
11 December 2026 and whenever a Debian update changes their status:

| Family                   | Baseline disposition                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APT / libapt             | Install Debian's fixed 3.0.4 or later; use HTTPS during builds. The advisory requires an on-path package-download retry attack.                            |
| zlib                     | Install `1:1.3.dfsg+really1.3.1-1+deb13u1` or later. The reported gz* write/error conditions were not reached from an API endpoint.                        |
| util-linux               | Privileged mount/cgroup helpers are not part of the app's request path; runtime is non-root with all capabilities dropped. Monitor vendor fixes.           |
| ACL library              | No untrusted ACL-processing endpoint was identified; maintain non-root, read-only runtime and monitor vendor fixes.                                        |
| Expat                    | RSS parsing uses defused XML and bounded downloads. Debian classifies some parser-reuse findings as minor; keep byte/time bounds and monitor vendor fixes. |
| ncurses                  | No remotely supplied terminal database is loaded by the web app. Monitor vendor fixes.                                                                     |
| SQLite                   | Production uses Postgres; no user-supplied SQLite database or FTS5 SQL is executed. Monitor vendor fixes.                                                  |
| systemd / udev libraries | No systemd/udev daemon or privileged device-management service runs in the image. Monitor vendor fixes.                                                    |
| Perl                     | No application endpoint executes Perl or attacker-controlled Perl code. Monitor vendor fixes.                                                              |

This is not an advisory suppression list: all findings remain visible in CI
artifacts and future fixable High findings block publishing. Do not reuse an
unfixed exception after its exploit path or package status changes.

## Android release identity

See [companion signing](../../app/README.md#production-signing-and-upgrades).
Production tags must have a private signing key and matching certificate fingerprint.
Preview IDs/schemes are separate; do not distribute the template key as a production
publisher identity. Preserve an offline backup of the production key and password.

The token-bearing MCP URL must also be redacted by the tunnel's logs and analytics;
application query stripping does not control infrastructure outside the app.
