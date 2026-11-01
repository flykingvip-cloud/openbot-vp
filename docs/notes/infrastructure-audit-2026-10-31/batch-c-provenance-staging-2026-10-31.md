# Batch C — provenance / staging topology (read-only) — 2026-10-31 Asia/Shanghai

Status: **只读清点完成**. No DIGEST, recreate, ledger append, or staging mutate.
Codex = independent acceptance; this agent does not declare PASS.

## Scope this pass
- Machine ledger + human release record vs LIVE / private soak identity
- R9 identity gate (`build-info.commit` == OCI `revision`)
- Staging pack topology as documented (not a live staging swap)
- Delivery tooling surface under `scripts/delivery/**` and `deploy/production/scripts/*verify*`

## SoT map (declared)

| Role | Path | Notes |
|---|---|---|
| Path B machine ledger (append-only) | `deploy/production/releases.jsonl` in `flykingvip-cloud/openbot-vp` | schemaVersion 2; tip open row has no `liveTo` |
| Human release notes | `deploy/production/RELEASE_RECORD.md` | not machine SoT |
| Ledger doc pointer | `deploy/production/LEDGER.md` | points at local JSONL |
| R9 gate | `deploy/production/scripts/verify-live-image-identity.sh` | fail-closed 20/21 |
| Forward-only / alignment | `verify-forward-only.sh`, `verify-delivery-alignment.sh`, `pnpm delivery:*` | |
| Staging install pack | `deploy/production/staging-runbook.md` + `env.staging.example` + `docker-compose.prod.yml` | host/process topology guidance |
| Build provenance stamp | `scripts/write-build-info.ts` → `/app/dist/build-info.json` | |

`RELEASE_RECORD.md` still cites a **separate** harness ledger URL historically; dual-track skill (this agent) says Path B rows must **not** be appended to OHBE — product tip + JSONL live in `openbot-vp`.

## Live identity (read-only SSH, 2026-10-31 ~20:05 Asia/Shanghai)

### HK SaaS LIVE — `root@8.217.93.71` / `openbot-gateway-rc`

| Field | Observed |
|---|---|
| status | running |
| image | `localhost/openbot:rc-amd64-provenance-d37bed5117d6` |
| StartedAt | `2026-10-31 11:21:00.871 +0800` |
| `build-info.commit` | `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a` |
| OCI revision label | `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a` |
| image digest | `sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48` |
| healthz | 200 |
| readyz | `ready:true`, `failing:[]` |

**R9:** PASS on observation (commit == revision; digest matches ledger tip).

### Private soak — `root@103.155.77.194:22004` / `openbot-gateway`

| Field | Observed |
|---|---|
| image | `openbot:rc-amd64-provenance-d37bed5117d6` |
| `build-info.commit` | `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a` |
| healthz | 200 |
| other containers | `openbot-soak-proxy`, several `aw-browser-*` / `aw-exec-lease-*` |

Same tip as HK LIVE (follow image). No promote checked or performed.

## Machine ledger tip (`releases.jsonl` on `main`)

- Rows: 149 JSON objects; `seq` range 1…151
- **Open LIVE row:** seq **151**
  - `gatewaySha`: `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a`
  - `artifactDigest`: `sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48`
  - `tag`: `provenance/sha-d37bed5117d6`
  - `imageTag`: `rc-amd64-provenance-d37bed5117d6`
  - `liveFrom`: `2026-10-31T03:21:00.871Z` (matches container StartedAt UTC)
  - `liveVerified`: true
  - no `liveTo` (open)
  - `executor`: `bug优化`
- Prior closed: seq 150 `66bad421c9bb…` with `liveTo` = seq 151 `liveFrom`

**Ledger ↔ LIVE:** aligned (已证实对账).

## Human record drift (配置风险 / 文档债务)

`deploy/production/RELEASE_RECORD.md` **L3 identity** still claims seq **107** / `bb72d0340284…` as Current LIVE, and “Latest cutover” section is 2026-09-29/30.

That is **stale relative to machine ledger seq 151** and relative to the live hosts checked above. Treat JSONL + live `build-info` as Path B SoT for identity; do not cut over or audit from the frozen L3 paragraph without refresh.

Historical note inside the same file: Actions described as `startup_failure` for every workflow at the seq 104–107 manual build window — consistent with Batch A empty-steps / no-runner class, not a fresh claim.

Older evidence `deploy/production/evidence/live-provenance-audit-20260912.json` recorded `unregistered_rolling` for then-LIVE `6bd45696…` vs ledger seq 78 — **historical**; seq 83 later closed that SHA in the human record. Not current.

## Staging topology (docs-only this pass)

From `staging-runbook.md` (Wave 1–3):

- Unit: Linux host + Docker/`openbot:rc` **or** host process; gateway loopback `:18789`; public only via nginx TLS
- State: `/var/lib/openbot/staging/{state,workspace}` + `env.staging.example`
- Compose entry: `docker-compose.prod.yml` with staging env file
- Smoke: `proxy/smoke.sh --local-only` / `--base-url`
- Local substitute: `scripts/staging-local-sim.sh` (does **not** replace live staging sign-off)
- Appendix “Live host (Plan A, 2026-07-12)” points at `8.217.93.71` / `*.openbot.love` — that host is now **HK Path B LIVE**, not a disposable staging lab. Do not treat staging runbook appendix as license to mutate LIVE.

Production README Gate 0: Managed Enterprise unit = **dedicated Gateway per tenant**; shared Gateway pre-prod until P1+P2+P4 + I3. HA controller profile `ha` exists, default **manual**, Auto Failover **NOT APPROVED**.

## Delivery / clean-build surface (inventory)

- Workflows: `.github/workflows/docker-release.yml`, `delivery-sot-alignment.yml` (alignment ≠ live SSH read)
- Scripts: `scripts/delivery/{ledger,ledger-audit,forward-guard,cutover-record,resolve-live-sha,sot-consistency,…}.ts`
- Host helpers: `cutover-from-ghcr.sh`, `verify-live-image-identity.sh`, `verify-forward-only.sh`, `verify-delivery-alignment.sh`, many `staging-*` probes under `deploy/production/scripts/`
- Root `Dockerfile` + `docker-compose.yml` exist; prod pack under `deploy/production/`

No clean rebuild executed in this pass (out of Batch C read-only; needs explicit build auth / DIGEST GO).

## Findings class

| ID | Class | Statement |
|---|---|---|
| C1 | 已证实对账 | LIVE + private soak + ledger seq 151 share `d37bed5117d6` / digest `09c9b4c0…`; R9 aligned |
| C2 | 配置风险 / 文档债务 | `RELEASE_RECORD.md` L3 still seq 107 / `bb72d034` — human SoT lag |
| C3 | 历史陈述 | 2026-09-12 unregistered_rolling evidence; later ledgered |
| C4 | 未覆盖 | Fresh staging host install / staging-local-sim execution; GHCR tag listing; clean `docker build` provenance replay |
| C5 | 环境阻断 | Org Actions billing API still HTTP 404 (see sibling billing note) — H1 minutes exhaustion still 待验证 |

## Next (not started)

- Refresh `RELEASE_RECORD.md` L3 from ledger tip (requires owner-authorized docs PR; out of Batch C mutate unless asked)
- Optional: run `pnpm delivery:ledger:audit` on Mac worktree for timeline-gap findings (read-only)
- Optional A3: minimal control experiment for empty-steps only after billing UI evidence or explicit auth

## Ledger machine audit (read-only)

Ran `pnpm delivery:ledger:audit` on the audit worktree → exit **30**.
Detail: `ledger-audit-2026-10-31.md`. Treat as delivery-debt inventory; tip LIVE identity remains aligned per SSH probe (C1).
