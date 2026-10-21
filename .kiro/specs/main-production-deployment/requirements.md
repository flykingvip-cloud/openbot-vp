# Requirements: main-production-deployment

## 目标

把 **正式云端生产** 的 source of truth 固定为阿里云 GHCR → podman 循环，而不是 Fly。

## 生产拓扑

- Host: Aliyun `8.217.93.71`
- Container: `openbot-gateway-rc`
- Bind: loopback `:18789` behind reverse proxy
- Image identity: GHCR digest + annotated `provenance/sha-*` + in-container `/app/dist/build-info.json`
- Ledger: `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`（权威）+ `deploy/production/RELEASE_RECORD.md`
- Operator commands: `deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`

## 发布链

1. Land on `main`.
2. `.github/workflows/docker-release.yml` publishes immutable multi-arch images to GHCR. **It must not deploy.**
3. Operator pulls the digest onto the host and runs `cutover-from-ghcr.sh` only when explicitly authorized.
4. `--verify-live --record` in this repo refuses a local ledger write and prints the OHBE ledger. Append the row there (https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl), not in openbot-vp.
5. Rollback is the previous LIVE safety container (`openbot-gateway-rc-prev-*-safety`), not `flyctl`.

## 非目标

- Fly.io app `openbot` / `https://openbot.fly.dev` is **not** official production.
- `fly.toml` remains a self-host sample (`docs/install/fly.md`).
- This spec does not authorize a LIVE swap. LIVE is frozen until Glen authorizes a new seq.
