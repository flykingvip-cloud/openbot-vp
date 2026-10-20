# WS-C Staging Deployment Review — v1 Root Guard

| 字段               | 内容                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| **review-id**      | `ws-c-staging-deploy-20260815`                                                                 |
| **status**         | Policy probe **Pass** · runtime dist **Pending #401 cutover**                                  |
| **scope**          | Independent deploy review for WS-C runtime stop-loss (**not** schema v2 / Resolver / migration |
| **trunk baseline** | `origin/main` · merge #401 `cursor-memory-wsc/memory-workspace-v1-stoploss-r2`                 |
| **verify script**  | `docs/design/evidence/memory-workspace-ws-c-staging-verify.mjs`                                |

## 1. 背景

WS-C 运行时止损已在 trunk 接线（`src/memory/v1-root-guard.ts` + `manager-sync-ops` operation boundary）。  
本评审 **不** 重复接线 PR；只验证 **staging/LIVE 部署后** `bot-2.sqlite` 不会因 sync/prune 误删 tenant 行。

> **注意：** trunk 上 guard **默认始终启用**（无 `OPENBOT_V1_ROOT_GUARD_ENABLED`）。该 env 仅用于 pre-#401 旧二进制。

## 2. 部署前检查

- [ ] 候选 SHA = 新鲜 `origin/main` tip（或已 merge #401 的 release 候选）
- [ ] `verify-forward-only.sh` 通过
- [ ] **停止**旧 gateway writer/watch（避免旧二进制绕过 guard）
- [ ] 备份 `{stateDir}/memory/bot-2.sqlite`（SQLite backup API 或文件 copy）
- [ ] **未**设置 `OPENBOT_V1_ROOT_GUARD_TOKEN` / maintenance token（默认验证须 refuse）

## 3. Staging 执行步骤

### 3.1 本地/CI fixture（无需 LIVE）

```bash
cd openbot-ws-c-phase0   # 隔离 worktree，基于 origin/main
pnpm install
node docs/design/evidence/memory-workspace-ws-c-staging-verify.mjs --mode fixture
```

**期望：** `ok: true`，`refuseReason: "known-conflict-preset-deny"`，`before` === `after`。

### 3.2 Staging LIVE（容器或 host）

```bash
# 在 staging gateway 主机 / 容器内（dist 已更新为含 #401 的二进制）
export OPENBOT_STATE_DIR=/root/.openbot   # 按实际调整

node docs/design/evidence/memory-workspace-ws-c-staging-verify.mjs \
  --mode live \
  --agent bot-2 \
  --out /tmp/ws-c-bot2-verify.json
```

**期望：**

| 检查                  | 断言                                                     |
| --------------------- | -------------------------------------------------------- |
| `syncRefused`         | `true`                                                   |
| `refuseReason`        | `known-conflict-preset-deny`（bot-2）或 fail-closed 同类 |
| `before.files/chunks` | 与 `after` **相等**（无 auto-prune）                     |
| `errors`              | `[]`                                                     |

### 3.3 回归测试（worktree / CI）

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/memory/v1-root-guard.test.ts \
  src/memory/manager-sync-ops.v1-root-guard.test.ts
```

## 4. 通过 / 失败裁决

| 结果                   | 动作                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Pass**               | 记录 `ws-c-staging-deploy-20260815` evidence JSON；可授权 LIVE cutover（仍须 SRE 回滚计划） |
| **Fail — sync 未拒绝** | **禁止** LIVE；回滚二进制；检查是否旧 dist / overlay                                        |
| **Fail — 行数减少**    | **立即**停止 gateway；restore sqlite backup； incident                                      |

## 5. 仍不授权（本评审）

- memory schema v2
- Resolver 写路径切换
- bot-2 heal / reindex / Binding cutover
- 撤 LIVE overlay

## 6. Evidence 归档

| 证据                | 路径                                                                        | 结果                 |
| ------------------- | --------------------------------------------------------------------------- | -------------------- |
| 本地 dev LIVE       | `docs/design/evidence/ws-c-staging-verify-20260815.summary.json`            | Pass                 |
| 生产 host LIVE 探针 | `docs/design/evidence/ws-c-staging-verify-20260815-production.summary.json` | Pass（policy probe） |

字段：`ok`, `sqlitePath`, `before`, `after`, `refuseReason`, `gatewaySha`, `reviewer`, `ts`.

### 6.1 SRE 签核（2026-08-15）

- [x] `bot-2.sqlite` 备份：`/root/.openbot/memory/bot-2.sqlite.bak-ws-c-verify-20260815`
- [x] LIVE 探针：`syncRefused=true`，`refuseReason=known-conflict-preset-deny`，行数 2/3 未变
- [ ] **运行时** dist 含 merge #401（当前 LIVE `gatewaySha=1d2c685` **不含** #401；`runtimeGuardPresentInDist=false`）
- [ ] forward-only cutover 至含 #401 的 `origin/main` tip 后复验 manager 路径

**裁决：** 策略探针通过，可归档 Phase 0 证据；**不得**宣称 LIVE 运行时 WS-C 已生效，直至 gateway cutover 完成。
