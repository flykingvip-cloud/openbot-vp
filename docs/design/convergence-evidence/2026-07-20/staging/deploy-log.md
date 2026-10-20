# Deploy log

## Decision

| Step           | Action                                                        | Result                                                                            |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Tip pin        | worktree `openbot-rc0-staging` @ `9aceda7349…`                | OK                                                                                |
| Build          | `pnpm build` in tip WT                                        | exit 0 (~28.6s)                                                                   |
| Image          | `openbot:rc-convergence-20260720`                             | id `79d35ef089f0…`                                                                |
| Remote staging | dedicated host                                                | **SKIPPED** — `STAGING_ENV=MISSING`; would-be default `8.217.93.71` is production |
| Local deploy   | `docker run` → `openbot-staging-rc0-sim` on `127.0.0.1:18799` | OK · healthy ~6s                                                                  |
| Production     | any touch of `openbot-gateway-rc` / v69                       | **NONE**                                                                          |

## Local run (abbrev)

```bash
IMAGE=openbot:rc-convergence-20260720
NAME=openbot-staging-rc0-sim
HOST_PORT=18799
# minimal openclaw.json: gateway.mode=local, auth.token, controlUi enabled
docker run -d --name "$NAME" \
  -e OPENBOT_GATEWAY_TOKEN=… \
  -p 127.0.0.1:${HOST_PORT}:18789 \
  "$IMAGE" \
  node dist/index.js gateway --port 18789 --bind lan
```

## Handbook for future dedicated staging host

Follow `deploy/production/staging-runbook.md` with substitutions:

1. `OPENBOT_IMAGE=openbot:rc-convergence-20260720`
2. State under `/var/lib/openbot/staging/` (never `/root/.openbot` production)
3. Container/compose service name **≠** `openbot-gateway-rc`
4. `OPENBOT_PUBLIC_APP_BASE_URL=https://admin.staging.<domain>`
5. Do **not** SSH-deploy to `8.217.93.71` under the name “staging” without a separate maintainer isolation plan

## Cleanup note

Local sim container may be removed after evidence capture (`docker rm -f openbot-staging-rc0-sim`). Image tag retained on builder for reload.
