# Data restore checklist

Checklist for a **verifiable** restore. Not executed against production this wave.

## Pre

1. Confirm backup artifact exists (image + volume / `~/.openbot` tarball + enterprise JSON if used).
2. Record current container image id and git SHA (`RELEASE_RECORD`).
3. Ensure rollback image tagged (prod today: `openbot:rc-amd64-v69` / prev `…-v68`).

## Steps

1. **Stop** gateway container / process (`openbot-gateway-rc` or staging equivalent).
2. **Snapshot** current data root (safety copy) before overwrite.
3. **Restore** backup into data root (preserve ownership/mode; prod often `--user root` + `/root/.openbot` mode 600).
4. **Start** service on **rollback or candidate** image as planned.
5. **Smoke:** `healthz` 200; `readyz` (expect known `wecom` fail only — see waiver); login; `chat.history` sample; localFolder import sample (K1/K2).
6. **Compare** session keys / tenant ids / KB listing counts vs pre-outage notes.

## Abort

- If `readyz` failing set **expands** beyond `{wecom}` → stop cutover; new waiver required.
- If session promote / history empty unexpectedly → roll back image + data snapshot.

## This wave

| Item                         | Status                                   |
| ---------------------------- | ---------------------------------------- |
| Checklist authored           | YES                                      |
| Local fixture schema dry-run | YES (`data-upgrade-dry-run.md`)          |
| Production restore rehearsal | **NOT DONE** (forbidden / not scheduled) |
