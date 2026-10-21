# COLLAB CSC — Route A production cutover (seq 42) 2026-08-26

Forward-only production cutover of the OpenBot gateway from LIVE `a12e4c59e575`
to `origin/main` commit `831dd9c749b506c82009ee5e30d10dfa98e97eee`, so the
chat-inbound depth agent-allowlist + primary-session gate (PR #734 + #736) is
present in the running production image ahead of a separately-authorized
shadow-only observation window on the `bot-skill` (Skill孵化) assistant.

## Identity

| Field             | Value                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| LIVE before       | `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (seq 41)                                                                           |
| LIVE after        | `831dd9c749b506c82009ee5e30d10dfa98e97eee` (seq 42)                                                                           |
| Image             | `localhost/openbot:rc-amd64-provenance-831dd9c749` ImageID `127113e7c0fb5649b4989d6f6647a4a324c7aa99cb32210b4e30c588367a7529` |
| OCI revision      | `831dd9c749b506c82009ee5e30d10dfa98e97eee`                                                                                    |
| Provenance tag    | `provenance/sha-831dd9c749b5` → `831dd9c749b506c82009ee5e30d10dfa98e97eee`                                                    |
| Container Started | `2026-08-26T04:19:23Z` (`2026-08-26 12:19:23 +0800`); restarts 0                                                              |

## Gates / evidence

- Forward-only (`verify-forward-only.sh --candidate 831dd9c749…`): `verdict: allow`, `forwardOnly: true`, LIVE `a12e4c59e575` read from the running container.
- Blast radius: 176 commits / 230 files (`a12e4c59e575..831dd9c749`); operator-accepted.
- Build: local host `podman build` of the repo root Dockerfile (`GIT_COMMIT=831dd9c749…` + explicit `org.opencontainers.image.revision` label). A bare build OOM-killed `tsdown` (host 3.5 GB, 0 swap); a temporary 6 GB swapfile `/swapfile-cutover` was added (operator-approved) and the rebuild succeeded. The production gateway stayed `healthz 200` throughout the build.
- Image asserts: image `build-info.commit` == candidate; OCI revision label == candidate.
- Swap: `openbot-gateway-rc` stopped, renamed to `openbot-gateway-rc-prev-a12e4c59e5-safety`, new container run `--network host --user 0 --restart always`, binds `/root/.openbot` + `/root/openbot-tenants`, cmd `node openbot.mjs gateway --bind loopback --port 18789`, env carried forward from the live container (`/root/openbot-maint-cutover-831dd9c749/env.list`, mode 600).
- verify-live (`cutover-from-ghcr.sh --verify-live`): `build-info.commit` == candidate, healthz 200, readyz `ready:true failing:[]` — **PASS**.
- Flags: inbound / CSC / CONTEXT_SCOPE **unset** after swap (new code live, all flags off = zero behavior change).
- Gate code present: `getChatInboundDepthAgentAllowlist` found in `/app/dist`.
- Control UI: served `assets/index-Dpg8P1UR.js`. `OPENBOT_UI_OVERLAY_PINNED_ENTRY` is inert in this build (no code reads it; sanitizer only rewrites retired `index-CR5cronNm[6-8].js`).
- Ledger: `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 42 appended; seq 41 `liveTo=2026-08-26T04:19:23Z`. `delivery:ledger:audit` exit 0 (warnings only, no errors). `delivery:check-sot --use-release-record-live --sot-ref origin/main`: `allow` / `forwardOnly:true`.
- Merge-back: candidate `831dd9c749` is already on `main`; merge-back is a no-op. `origin/main` advanced (to `70e3320b`, then `6722d3ff`) during the process; those newer commits are deferred to a future cutover.

## Rollback

Instant, old image retained:

```
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-a12e4c59e5-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

## Status

| Key                | Value                                            |
| ------------------ | ------------------------------------------------ |
| PRODUCTION_CUTOVER | DONE (seq 42, LIVE `831dd9c749`)                 |
| FLAGS              | inbound / CSC / CONTEXT_SCOPE OFF (unchanged)    |
| SHADOW_ENABLED     | NO                                               |
| SHADOW_WINDOW (P5) | NOT STARTED — needs separate explicit auth       |
| TEMP_SWAP          | `/swapfile-cutover` still on — remove in cleanup |
| ROLLBACK_POINT     | `openbot-gateway-rc-prev-a12e4c59e5-safety`      |
