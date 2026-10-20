# Staging image

## Source

| Field                                | Value                                      |
| ------------------------------------ | ------------------------------------------ |
| **RECOMMENDED_RC0_TIP / source SHA** | `9aceda7349da2190e00bb2fbb029175a517ecde7` |
| Tip worktree HEAD                    | verified equal to TIP                      |
| LOCKED_BASE ancestor                 | yes                                        |
| Contaminated branch HEAD             | **not used**                               |

## Build steps

```bash
# 1) Clean tip worktree
git -C /Users/daniel/AI项目/openbot-convergence worktree add \
  /Users/daniel/AI项目/openbot-rc0-staging \
  9aceda7349da2190e00bb2fbb029175a517ecde7

# 2) Full Path A build (includes Control UI)
cd /Users/daniel/AI项目/openbot-rc0-staging
pnpm build   # exit 0; UI asset index-C7hu4rVD.js

# 3) Overlay tip dist onto runnable base (keeps Control UI; unlike prod v69 layer)
# Context assembled under /tmp (repo .dockerignore excludes dist/)
docker build --platform linux/amd64 \
  --build-arg OPENBOT_GIT_SHA=9aceda7349da2190e00bb2fbb029175a517ecde7 \
  -t openbot:rc-convergence-20260720 \
  /tmp/openbot-staging-image-ctx-…
```

Overlay Dockerfile (staging WT): `Dockerfile.rc-convergence-staging` — `FROM openbot:rc`, replace `/app/dist` entirely (**retain** Control UI).

## Image identity

| Field                        | Value                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| Tag                          | `openbot:rc-convergence-20260720`                                         |
| Image id                     | `sha256:79d35ef089f06f9c52e952ed66636ccf53f289141303bd7d998399cb301476f7` |
| Arch                         | `linux/amd64`                                                             |
| OCI revision label           | `9aceda7349da2190e00bb2fbb029175a517ecde7`                                |
| `node openbot.mjs --version` | `OpenBot 2026.7.12-rc.2 (9aceda7)`                                        |
| Registry push                | **not performed** (no production registry overwrite)                      |

## Notes

- Base `openbot:rc` is an older full runtime; tip **dist + Control UI** is what RC0 needs for staging behavioral parity.
- Suggested remote load: `docker save openbot:rc-convergence-20260720 | ssh user@STAGING_HOST docker load` once a real staging host exists.
