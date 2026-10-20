# Staging environment

| Field             | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Captured at (UTC) | 2026-07-20T12:43:00Z                                                                    |
| Agent             | `cursor-convergence-staging`                                                            |
| Task              | `repository-wide-branch-convergence`                                                    |
| Tip worktree      | `/Users/daniel/AI项目/openbot-rc0-staging` @ `9aceda7349da2190e00bb2fbb029175a517ecde7` |
| Docs worktree     | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20`                   |

## Staging host status

```text
STAGING_ENV=MISSING
```

- No dedicated `admin.staging.*` host was available for this wave.
- Scripts that default `STAGING_HOST=root@8.217.93.71` point at the **production** Plan-A host (`openbot.love`) — **not used**.
- Local substitute: Docker Desktop staging simulation on loopback.

## Local simulation

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Compose / script basis | `deploy/production/scripts/staging-local-sim.sh` (manual equivalent) |
| Container name         | `openbot-staging-rc0-sim` (**not** `openbot-gateway-rc`)             |
| Host port              | `127.0.0.1:18799` → container `18789`                                |
| Image                  | `openbot:rc-convergence-20260720`                                    |
| State dir              | ephemeral `/tmp/openbot-staging-rc0.*`                               |
| Auth                   | token mode (platformAuth disabled in minimal config)                 |

## Production safety

- Production container `openbot-gateway-rc`: **not present / not modified**
- Production image tag `rc-amd64-v69`: **not overwritten**
- No SSH to `8.217.93.71` this wave
