# Tasks: main-production-deployment

## Agents

- kiro-main-production-deploy · role: owner · scope: main 合入后的不可变镜像发布、阿里云生产部署门禁、健康检查与 ledger 回写 · paths: `.kiro/specs/main-production-deployment/**`, `.github/workflows/docker-release.yml`, `deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`, `deploy/production/RELEASE_RECORD.md` · since: 2026-07-30
- historical, not live: `deploy/production/releases.jsonl` was a pre-split copy claimed by this spec. It is not the live ledger and must not be recreated in openbot-vp. Live ledger: https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl

> **生产 SoT 不是 Fly。** `fly.toml` / `fly.private.toml` / `docs/install/fly.md` 是自托管样例，不是正式生产配置。正式生产是阿里云 `8.217.93.71` 上的 `openbot-gateway-rc`（Gateway bind loopback `:18789`）。

## 生产发布链（阿里云）

`main` → `.github/workflows/docker-release.yml` **只发布**不可变 GHCR 镜像（禁止任何 deploy job）→ 主机 pull → `deploy/production/scripts/cutover-from-ghcr.sh --verify-live --record`（本仓库拒绝本地账本写入）→ 账本行写入 OHBE `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` + annotated `provenance/sha-*`。不要把 `releases.jsonl` merge-back 回 openbot-vp。

命令见 `deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`。本 spec **不授权** LIVE 切换、容器 recreate、或 `PRODUCTION_GO`。

- [x] 为生产部署使用已构建的 AMD64 镜像 digest，而非工作树或可变标签 — GHCR `main-amd64` / `provenance-sha-*`
- [x] 生产部署走 GHCR pull + 主机 podman cutover（阿里云 `8.217.93.71`），**不是** GitHub Environment `production` 上的 `flyctl deploy`
- [x] 配置 `/readyz` 与 cutover 后 `--verify-live`（R9：容器内 `build-info.commit` == 镜像 OCI `revision`）
- [x] 将 `main` 记录为生产唯一来源；可复现回滚 = 上一 LIVE 的 `openbot-gateway-rc-prev-*-safety` 容器 + `provenance/sha-*` + `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`（seq 51 LIVE / seq 50 safety 已验证）
- [x] `docker-release.yml` 与文件头一致：只发镜像；删除残留 `deploy-fly-production` job（#162 声称已删，但 job 仍在文件末尾，且在 `FLY_PRODUCTION_ENABLED=true` 时会部署到 `openbot.fly.dev`）

## 明确不做

- 不把 Fly 当正式生产
- 不在本 landing stream 加入 `scripts/install-cli.sh`（独立主题）
- 不 cutover LIVE（当前冻结 seq 51 / `59be50660d8e`，除非 Glen 书面授权）
