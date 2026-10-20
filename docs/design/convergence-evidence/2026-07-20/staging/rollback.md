# Rollback

## Target (production current)

| Field     | Value                                                    |
| --------- | -------------------------------------------------------- |
| Git SHA   | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (LOCKED_BASE) |
| Image tag | `openbot:rc-amd64-v69`                                   |
| Container | `openbot-gateway-rc`                                     |
| Record    | shared `deploy/production/RELEASE_RECORD.md`             |

## If staging local sim misbehaves

```bash
docker rm -f openbot-staging-rc0-sim
# optional: remove candidate image only if needed
# docker rmi openbot:rc-convergence-20260720
```

No production impact.

## If a future dedicated staging host runs this candidate

1. Stop staging container/compose (staging name only).
2. Retag/run previous staging image **or** rebuild from LOCKED_BASE / v69.
3. Restore staging state dir from pre-deploy backup.
4. Smoke `healthz` / `readyz` (failing ⊆ `{wecom}`).

## Production rollback (reference only — not executed)

```bash
# illustrative — DO NOT RUN in this agent wave
podman rm -f openbot-gateway-rc
# restore prior container/image per RELEASE_RECORD (v68/v69 notes)
```

This wave: **no production rollback required** (production untouched).
