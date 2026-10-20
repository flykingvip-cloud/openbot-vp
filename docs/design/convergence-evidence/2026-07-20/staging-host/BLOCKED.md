# BLOCKED — no isolated staging host

```text
STAGING_HOST_RESULT=BLOCKED_NO_HOST
PRODUCTION_GO=NO
TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
IMAGE_TAG=openbot:rc-convergence-20260720
```

## Why stopped

Maintainer did **not** provide in this session:

| Required                                                              | Status      |
| --------------------------------------------------------------------- | ----------- |
| `STAGING_SSH=user@staging-host`                                       | **MISSING** |
| `STAGING_BASE_URL=https://admin.staging.<domain>` (or staging IP URL) | **MISSING** |

Optional also absent: `STAGING_GATEWAY_URL`, `STAGING_STATE_DIR` (would be required before any remote run).

## What was deliberately NOT done

- No SSH to `8.217.93.71` (production Plan-A host)
- No touch of `openbot-gateway-rc` / `rc-amd64-v69`
- No guess-as-staging deploy
- No production cutover

## What already exists (previous wave)

- Local sim PARTIAL — `docs/design/convergence-evidence/2026-07-20/staging/`
- Local image `openbot:rc-convergence-20260720` id `79d35ef089f0` still on builder

## Unblock checklist for maintainer

Reply with **all** of:

```text
STAGING_SSH=...
STAGING_BASE_URL=...
# prove non-prod:
STAGING_STATE_DIR=/var/lib/openbot/staging   # not /root/.openbot
# container name must NOT be openbot-gateway-rc
```

Then re-run `CURSOR-PHASE-STAGING-HOST-BRIEF.md`.

**Agent:** `cursor-convergence-staging-host` · **Date (UTC):** 2026-07-20T12:54:37Z
