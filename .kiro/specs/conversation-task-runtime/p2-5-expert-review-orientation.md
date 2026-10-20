# ConversationTask Runtime — P2.5 专家审查导览(expert review orientation)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-5-production-integration.md`(§0 边界 / §1 架构 / §7 指标 / §9 回滚)、`./p2-5-admission-package.md`(§5 AC1–AC7)、`./p2-5-production-readiness.md`(§7 顺序 / §8 放行 C 清单)、`./p2-5-ac-a1-privacy-signoff-request.md`(隐私签核 / AC-cond)、`./p2-5-review-*.md`(四份专项评审)
> 用途: 供**专家审查 OpenBot 长程任务(ConversationTask)机制设计与业务逻辑**时快速定位代码、理解核心逻辑、识别相关方。
> 基线: 生产 LIVE = `deploy/production/releases.jsonl` **seq 45** / `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`。`main@b7ebb6b8937eba48d4c6f49b80581f599d6499a9` 仅作可选历史行号钉,**不是**当前 LIVE。`main` 前移后行号会漂移——请以**符号名**为准。
> GitHub 基址: `https://github.com/gmood2008/openbot` · 历史行号钉 `https://github.com/gmood2008/openbot/blob/b7ebb6b8937eba48d4c6f49b80581f599d6499a9/`

## 0. 一句话概述

ConversationTask Runtime(CTR)是"从对话中**被动识别**长程任务(long-running task)"的运行时。当前上线的是 **P2.5 shadow-only**:仅在网关侧被动观察**已认证**入站消息 → 纯函数检测/资格判定 → 把**去标识化**的决策日志写进**按租户隔离的 HMAC 影子日志**。**不创建任务、不写业务账本、不改 `chat.send`、不触发任何副作用、不启动 Agent/Mission**。`activation` / `projection` / `authorization` 三相位保持 **OFF**。

## 1. 审查范围与当前状态

- 全部相关代码在 `main`;生产 LIVE = 发布账本 `deploy/production/releases.jsonl` 的 **seq 45**(`21e1e8392f0ff5808563727eaa8f66e6ad9ed148`)。#796 对同一 SHA 的账本重建 / 已回滚的 seq 46 **不是**新 LIVE pin。
- shadow 与 orch **已上线但休眠**(三重 fail-closed);`activation` / `projection` / `authorization` **OFF**;`OPENBOT_CONVERSATION_TASK_ORCH_*` 默认 OFF;`ORCHESTRATION_LIVE_INVOKE === false`;`production rollout (to activation) = NOT APPROVED`。
- 已合入 PR 清单(代码在 main,**flags OFF**,不宣称 invoke):
  - #775 / #783 / #785 — P4.5 kernel + choke-point + identity
  - #787 — offline router-sim + ledger-bridge fake I1(无 writer)
  - #789 — dormant `web_read` + `browser` + node grayscale(无 invoke)
  - #794 — seq-45 B CONDITIONAL PASS(替代已关闭的 #777)
  - #773 — 本导览(orientation)
- 编排层见 `src/task-orchestration/**` 与 `p4-5-*.md`。本导览不发明执行面、不宣称 live invoke。
- 本次审查对象 = **机制设计 + 业务逻辑**。生产发布/启用是**另一条独立线**,不在本次审查判定范围。

## 2. GitHub 代码位置

### 2.1 运行时核心模块 `src/conversation-task/`(约 11k LOC,24 个测试文件)

按相位分层(文件均在 `src/conversation-task/` 下):

| 层                                      | 文件                                                                                                                                  | 职责                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 契约 (P0)                               | `types.ts` · `reason-codes.ts` · `errors.ts` · `feature.ts` · `invariants.ts` · `dataset.ts` · `blind-dataset.ts`                     | 领域契约、理由码、**相位 flag**、**不变式守卫**、离线样本                                                            |
| 检测/资格 (P1,纯函数)                   | `signals.ts` · `detector.ts` · `qualification.ts` · `replay.ts` · `metrics.ts` · `evaluate.ts` · `evaluate-blind.ts` · `canonical.ts` | 信号抽取 → 检测 → 资格判定 → 离线复现 → 评分;规范化                                                                  |
| 激活层 (P2,flag-gated,**当前 OFF**)     | `activation.ts` · `control-plane.ts` · `store.ts` · `acl.ts` · `degrade.ts` · `flag-cache.ts`                                         | 激活门、控制面、**租户隔离 Task store**、ACL、自动降级、flag 热缓存                                                  |
| 影子日志 (P2)                           | `shadow.ts`                                                                                                                           | **HMAC 指纹** + `ShadowLogBook` + 轮转 fail-closed                                                                   |
| **P2.5 生产集成(当前上线,shadow-only)** | `config-store.ts` · `shadow-runner.ts` · `shadow-observer.ts` · `gateway-shadow-hook.ts` · `runtime-bootstrap.ts` · `index.ts`        | 持久化 allowlist+flags、有界异步队列、**被动观察管线**、**网关桥单入口**、**生命周期 + HMAC key provider**、公共出口 |

**建议入口**:`src/conversation-task/index.ts`——公共出口按 P0/P1/P2/P2.5 分段注释,分层一目了然。

### 2.2 跨分区接线(面极小)

- **单一 choke-point**(被动观察调用):
  - 符号:`observeInboundTurnShadow`(`src/auto-reply/reply/dispatch-from-config.ts`);同文件 `observeOrchestrationConsider` 为 dormant orch 观察入口(**不 invoke**)
  - 可选历史行号钉(`b7ebb6b`): `dispatch-from-config.ts:237`
  - 特性:紧挨现有 `message_received` hook;**fire-and-forget、同步、身份全部 server-derived**(从不接受 client 提供)。
- **网关生命周期**:
  - 符号:`initShadowHookFromServerConfig` / `shutdownShadowHook`(`src/gateway/server.impl.ts`)
  - 可选历史行号钉(`b7ebb6b`): `:964`(启动) / `:1080`(关停)
  - 特性:default-dormant、fail-safe(init 从不把错误抛进网关启动)、关停有界排空。

### 2.3 规格 / 设计文档 `.kiro/specs/conversation-task-runtime/`

- `execution-plan.md` · `p2-design-freeze.md` —— 总体计划 + 设计冻结
- `p2-5-production-integration.md` —— **§0 边界 / §1 架构 / §7 指标 / §9 回滚**(先读这份看设计意图)
- `p2-5-admission-package.md` —— **§5 AC1–AC7 验收标准**
- `p2-5-production-readiness.md` —— §7 执行顺序 B→A→D→C / §8 放行 C 清单
- `p2-5-ac-a1-privacy-signoff-request.md` —— 隐私签核 + AC-cond-1..4(含死锁修正)
- `p2-5-review-gateway-integration.md` · `p2-5-review-ops-alerting.md` · `p2-5-review-privacy-logging.md` · `p2-5-review-tenant-acl-security.md` —— 四份专项评审底稿
- `p4-5-orchestration-plane.md` · `p4-5-admission-package.md` · `p4-5-seq45-b-predeploy.md` —— Orchestration Plane 合同 / 准入 / seq-45 B(dormant;无 invoke)

### 2.4 生产交付证据 `deploy/production/`

- `releases.jsonl` —— **seq 45 行 = 权威 LIVE 证据**(`21e1e839`;flags OFF)。seq 44 为先前 CTR 密钥部署。#796 写入的 seq 46 是未验活前向的历史重建且已回滚,**不是**新 LIVE pin。
- `RELEASE_RECORD.md` · `scripts/verify-forward-only.sh` · `scripts/verify-delivery-alignment.sh`
- `evidence/` —— cutover 回执(执行方 `kiro-collab-csc` 署名;非实施 owner)

### 2.5 Orchestration Plane(dormant;无 invoke)

编排层独立于 `src/conversation-task/`:

- 代码:`src/task-orchestration/**` — `considerDispatch` / `isOrchestrationDormant` / `ORCHESTRATION_LIVE_INVOKE === false`;`ledger-bridge` 仅类型 + fake I1(无 writer);`DORMANT_GRAYSCALE_SURFACES` = `web_read` / `browser` / `node_fs_read` / `node_exec`(符号绑定,不 execute)
- 规格:`p4-5-orchestration-plane.md` · `p4-5-admission-package.md` · `p4-5-seq45-b-predeploy.md`
- 状态:代码在 main、四开关默认 OFF、Gate C / live invoke **NOT APPROVED**

## 3. 核心设计逻辑(审查重点)

### 3.1 被动观察冻结链

见 `src/conversation-task/shadow-observer.ts` 的 `ShadowObserver.observe()`:

```text
已认证 ctx → 可信 tenant → allowlist → detection flag → 会话 ACL
  → detection 次级 scope → detection(纯) → qualification(纯)
  → 有界异步 runner → tenant-HMAC 影子日志 → 有界指标 → stop
```

链条**到影子日志为止**:无 `runActivationGate`、无 `openTaskStore`、无 Candidate/Task、无 Ledger、无 Agent。

### 3.2 三重 fail-closed(默认休眠)

1. `detection` flag OFF(`feature.ts` / `config-store.ts`)
2. 租户 allowlist 空(`config-store.ts` `TenantAllowlistCache`)
3. HMAC root 未配置 → `envTenantHmacKeyProvider` 抛 `hmac_key_missing`、**不降级为无密钥 hash**(`runtime-bootstrap.ts`)

→ 裸装:观察 0、写入 0。

### 3.3 相位隔离 flag

`feature.ts`:`SHADOW_ALLOWED_FLAGS = [detection, qualification]`;`SHADOW_FORBIDDEN_FLAGS = [activation, projection, authorization]`;`isShadowModeOnly()` 校验。
`config-store.ts` 代码层强制"永不可开启禁用相位":

- `isForbiddenFlag`(基于 `SHADOW_FORBIDDEN_FLAGS`)
- `setFlag`(注释:Refuses to enable a forbidden flag)
- 对禁用相位抛 `ConversationTaskStoreError("forbidden_flag", ...)`,且这些 flag **永远读作 `false`**
- 可选历史行号钉(`b7ebb6b`): `config-store.ts:188`

### 3.4 隐私 / 租户隔离

- 身份全部 server-derived:`GatewayShadowInput`(`gateway-shadow-hook.ts`)明确排除原始 `MsgContext` 与 client 身份。
- 每租户独立密钥 = `HMAC-SHA256(root, "conversation-task/shadow/v1/" + tenantId)`,**root 从不直接做租户 key**(`runtime-bootstrap.ts` `envTenantHmacKeyProvider`)。
- 原文只用于算 keyed fingerprint,**从不持久化**(需专家在 `store.ts` / `shadow.ts` 复核)。
- 每租户独立 `ShadowLogBook`(`shadow-observer.ts` `ShadowBookRegistry`)+ composite-unique 幂等。
- ACL:`acl.ts` `assertConversationTaskAccess` + `assertDetectionScope`。

### 3.5 不阻塞 chat(可用性)

- choke-point 调用同步 + fire-and-forget + 从不抛 + 从不改 reply(`gateway-shadow-hook.ts` `observeInboundTurnShadow` 的 try/catch 包裹)。
- 实际写入交给 `shadow-runner.ts` `ShadowRunner`(有界队列、drop-new、per-item timeout、bounded shutdown)。
- 网关关停 2s 有界排空(`shutdownShadowHook`)。

### 3.6 不变式守卫

`invariants.ts`:`assertShadowOnly` · `assertConversationTaskBoundary` · `assertNoMissionInPersonalScope` · `assertIdempotentDecisions` · `assertCompletionClaimIgnored` · `assertQualificationPure` · `assertSideEffectOrthogonal` 等。审查应确认它们在对应 `*.test.ts` 中被强制。

## 4. 功能相关方(角色 / 所有权)

| 角色           | 主体                                              | 拥有 / 职责                                                                   |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 实施 owner     | `kiro-conversation-task-runtime`                  | `src/conversation-task/**` + spec + 被授权的 `dispatch-from-config.ts` 接线块 |
| 网关接线 owner | `cursor-fable`                                    | `src/gateway/server.impl.ts` 生命周期(PR #739)                                |
| 独立评审       | `kiro-gateway-reviewer` / `kiro-privacy-reviewer` | 接线 & 生命周期 / 隐私 & AC-A1(+ 四份 review 文档)                            |
| 发布授权       | `kiro-release-authority`                          | A 审批                                                                        |
| 云端执行       | `kiro-collab-csc` / cloud operator                | cutover / 密钥 / vault(D);运维开 allowlist/flag(C)                            |

**职责分离**:实施者从不自审 / 自合 / 自部署 / 注密钥 / 开 flag。

## 5. 高效审查路径(最短读路)

1. `p2-5-production-integration.md` §0/§1(边界 + 架构)
2. `src/conversation-task/index.ts`(分层出口)
3. `src/conversation-task/shadow-observer.ts` `ShadowObserver.observe()`(核心管线)
4. `src/conversation-task/runtime-bootstrap.ts`(三重 fail-closed + HMAC 派生)
5. `src/conversation-task/gateway-shadow-hook.ts` + `observeInboundTurnShadow`(接线:被动 / 不阻塞)
6. `src/task-orchestration/**` + `observeOrchestrationConsider`(dormant orch choke-point;不 invoke)
7. `src/conversation-task/shadow.ts`(HMAC 指纹 + 轮转 fail-closed)
8. `src/conversation-task/config-store.ts`(allowlist/flag 持久化 + 拒绝禁用相位)
9. `src/conversation-task/invariants.ts` + 对应 `*.test.ts`(守卫是否被测试强制)
10. `p2-5-admission-package.md` §5 AC1–AC7 + `p4-5-*.md`(orch 合同;无 invoke)

## 6. 建议重点质询(机制 + 业务逻辑)

- 检测 / 资格是否真纯函数、可离线复现?(`replay.ts` / `dataset.ts` / `metrics.ts`)
- shadow 是否可能在任何路径改 reply / 产生副作用?(`observe()` 与 hook 的 try/catch + fire-and-forget)
- 租户隔离能否被跨租户读?(HMAC 派生 + per-tenant book + ACL)
- 原文是否可能落盘?(仅算 fingerprint;需核 `store.ts` / `shadow.ts`)
- flag 能否被误开到 activation?(`setFlag` 拒绝 `forbidden_flag` + `isShadowModeOnly`)
- 密钥缺失 / 过期是否 fail-closed 不降级?(`shadow.ts` `assertUsableKey` / `isHmacRotationDue`)
- 幂等 / 去重?(composite-unique)

## 7. 专家可自行复跑

- 测试:`OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run src/conversation-task`(246 tests / 24 files)
- lint:`pnpm exec oxlint src/conversation-task`
- 构建:`pnpm build`(P2.5 shadow 代码零 `[INEFFECTIVE_DYNAMIC_IMPORT]` 告警)

## 8. 边界声明

审查对象 = 机制设计 + 业务逻辑。生产发布 / 启用属**独立线**(`production rollout (to activation) = NOT APPROVED`;Gate C / orch invoke **未打开**)。当前上线代码为 shadow-only + orch dormant。三相位 `activation` / `projection` / `authorization` 保持 OFF 且不可在本阶段开启。
