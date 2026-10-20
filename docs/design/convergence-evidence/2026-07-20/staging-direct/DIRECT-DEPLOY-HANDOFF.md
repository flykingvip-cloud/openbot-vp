# DIRECT DEPLOY HANDOFF (Grok)

```text
STAGING_ENV=LOCAL_ONLY
STAGING_RESULT=SUCCESS_LOCAL
STAGING_HOST_RESULT=BLOCKED_NO_HOST   # still no remote isolation host
PRODUCTION_GO=NO
TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
IMAGE=openbot:rc-convergence-20260720
CONTAINER=openbot-staging-rc0-sim
URL=http://127.0.0.1:18799
```

## What was authorized and done

- Owner authorized direct execution without Cursor.
- Deployed **local** RC0 candidate image pinned to **D4 tip**.
- Smoke healthz/readyz/control-ui + tip regression tests green.
- **Production was not deployed.**

## What is still needed for remote staging SUCCESS

Maintainer must provide:

```text
STAGING_SSH=...
STAGING_BASE_URL=...
```

Then re-run host deploy (Grok or Cursor STAGING-HOST brief).

## Production

Still requires written `PRODUCTION_GO=YES` + HUMAN-PRODUCTION-CUTOVER-CHECKLIST.
