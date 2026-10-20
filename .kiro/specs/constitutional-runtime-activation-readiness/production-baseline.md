# Production baseline — Checkpoint A

assessedAt: 2026-09-28T12:10:00+08:00
Transcript: `evidence/production-probe.txt`

## Result

| Field              | Value       |
| ------------------ | ----------- |
| Gateway SHA        | **unknown** |
| UI SHA             | **unknown** |
| Ledger sequence    | **unknown** |
| `productionProven` | **unknown** |

No live build identity was read. This page does not copy SHAs from `deploy/production/releases.jsonl` or from any branch name. Those files are repository history, not the running container.

## Probe

Preferred command, not runnable here:

```
podman exec openbot-gateway-rc cat /app/dist/build-info.json
```

Evidence from this machine:

- `command -v podman` printed nothing. `podman` is not on `PATH`. `podman version` and `podman ps -a` failed with `command not found`.
- `command -v docker` resolved to `/usr/local/bin/docker`.
- `docker ps -a` listed local containers (`buildx_buildkit_openbot-manual0`, two exited `openbot-evolution-canary-*` containers, and unrelated postgres / redis / mysql / ollama / open-wearables containers). None is named `openbot-gateway-rc`.
- `docker exec openbot-gateway-rc cat /app/dist/build-info.json` returned `Error response from daemon: No such container: openbot-gateway-rc`.
- `docker ps -a --filter name=openbot-gateway-rc` returned no rows.

This matches the kickoff observation that Docker existed and `openbot-gateway-rc` did not. Checkpoint A does not start a container, does not deploy, and does not treat any canary image id as the production gateway.
