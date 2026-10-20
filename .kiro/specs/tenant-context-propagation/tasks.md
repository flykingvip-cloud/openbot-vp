# Implementation Plan: Gateway 租户上下文传播（Tenant-Context Propagation）

## Overview

落地 `requirements.md` / `design.md`：把会话的**权威租户/用户上下文**接到寻址层，使共享 Gateway 请求期按租户解析 L1/L2 路径；对 local 零变化。**共享 Gateway 逻辑隔离**；dedicated 拓扑见 `docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md`（不在本 spec）。

## Agents

- kiro · role: owner · scope: tenant-context foundation (context + addressing layer) + spec + P1 lead (coordinates L1 conversion across domain owners, see handoff) + P1 task 2.2 调用点更新 (billing/supervisor resolve-agent-run-scope callers) · paths: .kiro/specs/tenant-context-propagation/\*\*, src/gateway/tenant-context.ts, src/gateway/tenant-context.test.ts, src/gateway/tenant-store-paths.ts, src/gateway/tenant-store-paths.test.ts, src/gateway/billing/resolve-billing-seat-for-commercial-run.ts, src/gateway/billing/resolve-enterprise-id-for-agent-run.ts, src/gateway/supervisor/execution-context.ts · since: 2026-07-11
- cursor-fable · role: owner · scope: P3–P5 gateway 主路径收口 + platform-auth L1 + collaboration-learning L3 + auto-reply + D7/L0 接缝 + R7.2 E2E · paths: src/gateway/**, src/auto-reply/reply/**, src/hooks/bundled/boot-md/\*\*, .github/workflows/ci.yml, .pre-commit-config.yaml, scripts/check-tenant-addressing.mjs · since: 2026-07-13

> **协作方须在动其面前签入并 `loom register`**：
>
> - L2 数据模块（`src/data/*`）→ `data-directory:cursor-data-directory`（P2）。
> - gateway 数据 handler（`src/gateway/server-methods/data.ts` 等）→ 无 task / 混合，取任务时协调（P1/P2）。
> - L1 控制面 store（`platform-auth-*`、`enterprise-seat-assets-store`）→ 企业/平台相关 owner（P1）。
> - 会话/凭证（`src/gateway/*session*`、auth-profiles）→ 另属（P3）。

### 已锁定决策（见 design §设计决策）

- **D1** 身份权威：tenant **仅**由 membership 推导（专用 membership-only resolver，**不复用** `resolveTrustedAttribution`——其 workbench 回退采信 hint，评审 高危2）；`sessionTenantId` 仅交叉校验；缺 membership fail-closed。
- **D2** 回退**仅按数据模式**：`!managed` → 逐字节等价 `resolveDataRoot(cfg)`；**managed + 无 ctx → 抛错 fail-closed**（评审 高危1，绝不回退全局）。
- **D3** 单一寻址出口 + 守卫扫描（含**默认全局 store loader**，评审 中5）。
- **D4** 分层激活；L0/L3（P3）按部署模型决定；agent-workspace / session-store 为 **D7** 独立决策（评审 中高3）。
- **D5** managed 多租户置于 `OPENBOT_MULTITENANT` 开关后灰度；**真正共享服务须 P3 完成**（评审 中高4）。
- **D6/D7** 见 design（membership-only 权威 / agent-workspace 独立决策）。
- **D8 ctx 线程（Q-B 裁决）**：**显式透传**——请求边界 `resolveTenantContext` 解析一次、向下传 `ctx`/预计算 `storePath`；首版**不用** `AsyncLocalStorage`（隔离边界要可审计/grep/leakage test）。
- **Q-A 裁决**：`platform-auth` 保持**全局 authority**（不进 per-tenant L1，避免 chicken-and-egg）；**per-tenant L1 = `seat-assets` + `enterprise-data`**；`organization` 派生自二者。

### 实施前置 / 归属

- **P1 owner = kiro**（本次指派）；owner 持基础层（`tenant-context.ts` / `tenant-store-paths.ts`），并与各领域 owner（`operational-identity-governance:codex-oig` 等，见 handoff §5）协调 ~30 调用点。
- 操作者开隔离 worktree；按 P0→P4 顺序 land，每阶段独立绿 + 跨租户测试门禁。首版云端走**单租户单实例**（今日可用），P0–P2 + P4 完成后单实例可用；**共享灰度须再加 P3**（D5/中高4）。

## Tasks

- [x] 1. P0 — 契约与基础（零行为变化）— 已合入 + 按评审 harden（membership-only + fail-closed，21 单测绿）— kiro
- [x] 2. P1 — L1 控制面 per-tenant — 已签收
- [x] 3. P2 — L2 每用户数据 — 寻址层已签收（D7 workspace 单列）
- [x] 4. P3 — L3 会话 / L0 凭证隔离 — gateway 主路径已接线（cursor-fable 2026-07-13）

- [x] 5. P4 — 守卫 + 门禁 + 收口（cursor-fable 2026-07-13）
  - [x] 5.1–5.5 守卫 / 灰度开关 / 寻址层 E2E / CI+pre-commit
  - [x] 5.6 platform-auth 已知 tenantId → per-tenant seat-assets（`seat-store-loader.ts`）
  - [x] 5.7 collaboration-learning + spaces RPC 会话路径透传
  - [x] 5.8 auto-reply directive/commands `agentDir` 租户感知
  - [x] 5.9 billing.backfill 租户 session index + seat path
  - [x] 5.10 D7 `resolveAgentWorkspaceDirForClient`（get-reply / sessions.delete）
  - [x] 5.11 L0 寻址接缝：user-oi secrets + connector OAuth per-tenant path
  - [x] 5.12 boot-md 在 shared multitenant 下跳过（无 per-tenant 启动 ctx）
  - [x] 5.13 R7.2 双租户 L1+L2+L3 磁盘隔离 E2E（`tenant-context.test.ts`）

### 验收签收（2026-07-13 · 专家团队 §6）

- **✅ A — 开发收口（有条件通过）**：`kiro/tenant-context-propagation`（B4）P0–P4 主路径实现完成；寻址层 + Gateway 主路径隔离门禁（`tenant-context.test.ts` 26 + 相关 14+）已绿；**允许进入 merge-to-RC 流程**。
  - 附带条件：① 守卫脚本无-`rg` 回退已修 + `pnpm check:tenant-addressing`；② `requirements.md` 状态头已同步；③ 分支 push `origin` 后走 RC 评审。
- **❌ B — 共享可灰度**：`OPENBOT_MULTITENANT=1` 生产开关 — **不签收**（Channel / OAuth callback / D7·L0 扫尾 / 真进程冒烟未过）。
- **❌ C — 生产共享上线**：RC/生产镜像未含 B4 — **不签收**。

### 残余（Channel / 全量 D7 扫尾 / HTTP OAuth callback）

- [ ] **Channel 路径** — D9：共享 v1 **不含** channel 入站多租户；设计见 `design.md` D9
- [ ] **D7 全量扫尾** — 非 RPC（cron/memory/server.impl 等）仍用全局 `resolveAgentWorkspaceDir`；RPC + user-OI runtime 已租户感知
- [x] **L0 user-OI HTTP callback** — per-tenant identity store scan + oauth RPC storePath（cursor-fable 2026-07-13）
- [x] **L0 user-OI RPC 接缝** — client-scoped handlers 经 `withUserOiStoreWriteLockForClient`（governance.overview 仍全局）— cursor-fable 2026-07-13
- [x] **connector OAuth HTTP callback** — `completeDataConnectorOAuthCallback` 按 state 二段解析 per-tenant oauth session store（cursor-fable 2026-07-13）
- [ ] **platform-auth 无 tenant** — `routes-trial` 公开申请保留全局（有意）
