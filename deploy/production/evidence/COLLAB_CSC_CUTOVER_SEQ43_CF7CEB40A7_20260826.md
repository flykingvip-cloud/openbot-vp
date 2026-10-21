# CSC cutover evidence — seq 43 `cf7ceb40a7` (PR #748 same-enterprise-scope fix)

Executor: `kiro-collab-csc` · User-authorized forward-only cutover · 2026-08-26

## Purpose

Deploy `origin/main` tip `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4` (merge of PR #748) to
the production gateway so the operator's loopback Control UI (`127.0.0.1:18789`) chat with
Skill 孵化 / 数字人战队 resolves an employee actor.

## Root cause addressed (PR #748)

The loopback webchat has no `openbot.love` cookie, so no pinned enterprise/membership pair is
carried on the request. The operator (`daniel`) holds two memberships that both resolve to the
same enterprise `001` — enterprise-admin (`e4c8478b`) and member (`74c0c1dd`). Before the fix,
`resolveAuthoritativeEnterpriseScope` treated any multi-membership request without a pinned pair
as `membership-ambiguous` and denied it, so no employee actor was resolved and `bots.list` /
`chat.history` / `chat.reply` failed.

Fix A (landed as #748): when every membership resolves to the **same** enterprise, that is
unambiguous — resolve that tenant and pick the least-privileged member role. Different-enterprise
multi-membership still denies as `membership-ambiguous`. This preserves the operator's admin+member
roles (no role stripped) while unblocking the loopback chat path.

## D0 — forward-only gate (no live touch)

- Candidate = `cf7ceb40a7c43edf3698f8cba4b944f3c09c2dc4` (merge commit of #748 on `origin/main`).
- Host LIVE at gate = `831dd9c749b506c82009ee5e30d10dfa98e97eee` (read from running container build-info).
- `is-ancestor(LIVE, candidate)` = **true** → forward-only **allow**.
- Blast radius = 36 commits since `831dd9c749`.
- Baseline health: healthz 200, readyz ready, inbound/CSC/CONTEXT_SCOPE flags unset, restarts 0.

## D1 — host build (local, temporary swap on)

- `podman build` of root Dockerfile on the prod host with the temporary 6 GB `/swapfile-cutover`
  (bare build OOM-kills tsdown; swap required).
- Image alias `localhost/openbot:rc-amd64-provenance-cf7ceb40a7`.
- ImageID `389c082c274b545a40a305511c40d5bdf190c43d904142300efbd402c6d2694d`.
- OCI `revision` label + `/app/dist/build-info.json` `commit` both = `cf7ceb40a7c43…` (matches candidate).
- Gateway stayed healthy throughout the build (build is off-path; live container untouched in D1).

## D2 — stage / verify identity + capture env (no live-container touch)

- Verified image `revision` label and baked `build-info.json` == candidate.
- Control UI bundle in image: `assets/index-Dpg8P1UR.js`.
- Captured the running container's environment: 45 vars, **0** inbound/CSC/CONTEXT_SCOPE flags,
  written to `/root/openbot-maint-cutover-cf7ceb40a7/env.list` (mode 600) for the recreate.

## D3 — swap (gated, user-authorized)

- Renamed the previous live container to safety `openbot-gateway-rc-prev-831dd9c749-safety`
  (image `rc-amd64-provenance-831dd9c749`) — instant rollback target.
- Recreated `openbot-gateway-rc` from the new image (not overlay): `--network host --user 0
--restart always`; binds `/root/.openbot` + `/root/openbot-tenants`; cmd
  `node openbot.mjs gateway --bind loopback --port 18789`;
  `--env-file /root/openbot-maint-cutover-cf7ceb40a7/env.list`.
- `cutover-from-ghcr.sh --verify-live`: **PASS**.
- Post-swap LIVE = `cf7ceb40a7c43…`; StartedAt `2026-08-26T14:37:46Z`; restarts 0.
- healthz **200**; readyz **ready:true** `failing:[]`; inbound/CSC/CONTEXT_SCOPE unset.

## D4 — records

- `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`: appended seq 43; set seq 42 `liveTo=2026-08-26T14:37:46Z`.
- `deploy/production/RELEASE_RECORD.md`: new `## Latest cutover … cf7ceb40a7`; demoted
  `831dd9c749` to `## Previous cutover`.
- Provenance: annotated tag `provenance/sha-cf7ceb40a7c4` → `cf7ceb40a7c43…` (pushed).
- Gates: `pnpm delivery:ledger:audit` and `pnpm delivery:check-sot --use-release-record-live`.

## Rollback

Rename `openbot-gateway-rc` aside and rename/start `openbot-gateway-rc-prev-831dd9c749-safety`
(image `rc-amd64-provenance-831dd9c749`) — instant; old image + env.list retained. Safety
containers for `a12e4c59e575` and `5c221b9ec3` also retained.

## Follow-ups

- Operator to retest Skill 孵化 chat at `127.0.0.1:18789` (bots.list / chat.history / chat.reply
  should now resolve an employee actor).
- Remove the temporary swap `/swapfile-cutover` as the final cleanup after retest.
