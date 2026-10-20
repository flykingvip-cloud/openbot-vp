# OpenBot 记忆架构规范及优化：第三方验收说明

> 文档日期：2026-08-28  
> 主干快照：`origin/main@b7ebb6b8937eba48d4c6f49b80581f599d6499a9`  
> 用途：帮助独立专家理解整改背景、目标架构、代码位置、实施范围、证据体系和剩余风险。  
> 重要声明：本文是审查导航，不是解锁凭证、部署授权或生产事实源。权威状态以本文列出的 canonical evidence、最新 `origin/main`、运行容器 build-info 和生产发布账本为准。

## 1. 项目背景

OpenBot 是多租户 AI 平台，组织模型包含企业租户、部门、员工、AI 数字人和协作小组。历史实现却没有形成一条稳定的“身份 -> 授权 -> 工作区 -> 记忆”管理链，而是并存多套目录解析、Catalog、员工隔离、host workspace、tenant workspace、memory root 和 SQLite 同步路径。

事故暴露出的核心风险是：业务文件位于租户工作区，但某些同步路径把空的 host canonical workspace 当作权威输入，随后对共享、未按 workspace 分区的 SQLite 执行 prune，导致其他数字人的索引记录被误删。

整改不是简单增加一个新 Resolver 或新 Catalog，而是用唯一治理链替换旧路径：

```text
TenantContext
  -> tenant 内 agentId/slug 到 agentAssetId 的权威映射
  -> Data Governance Catalog 中的 resourceId 与 lifecycle
  -> membership / binding / grant
  -> 授权裁决
  -> 唯一 StorageBinding
  -> 受限 Workspace Handle
  -> cwd / memory / continuity / artifact 能力
```

组织树与资源树保持分离。部门是授权 scope，不是工作区物理父目录。路径只是 binding，不是身份。

## 2. 总体目标

### 2.1 工作区治理目标

- Data Governance Catalog 是唯一持久化 SoT。
- 持久主键只使用 `resourceId`；`WorkspaceId` 仅可作为内存语义别名。
- 不新建第二套 `WorkspaceIdentity`、membership SoT 或 lifecycle。
- Workspace Resolver 通过 adapter 读取治理 Catalog；旧 `WorkspaceResourceCatalog` 只能作为受控兼容投影，不能独立写入。
- managed 环境发生 Catalog miss、多 canonical binding、租户不一致或授权不完整时必须 fail-closed，不得回退 host workspace。
- 工作区的 `memory` data role 与独立治理的 Memory Asset 必须区分；二者通过 `sourceWorkspaceResourceId` 关联。
- SQLite 的 `workspace_id` 是隔离分区键，不是 Memory Asset 的 `resourceId`。

### 2.2 统一记忆系统目标

长期目标已经冻结为：

- CogniWeave 是唯一认知记忆内核，负责 atom、认知索引、召回、强化和认知生命周期。
- OpenBot 是唯一平台治理与运行时接入层，负责租户身份、授权、Workspace Handle、Memory Asset、StorageBinding、审计、迁移、fencing 和运行时路由。
- OpenBot 中与 CogniWeave 重复的认知引擎能力逐步退役。
- schema v2 只承担 workspace 分区、文件/chunk 索引和治理隔离，不能成为第二认知事实库。
- U1 dark integration 不能被表述为生产切主；生产 Catalog、schema v2 写入和 LIVE 均需独立授权。

## 3. 权威设计与任务入口

第三方团队应优先阅读：

1. `docs/design/memory-workspace-identity-remediation-2026-08-14.md`
   - 平台工作区身份、Catalog、Binding、Resolver、schema v2、迁移和 I3 总方案。
   - 重点章节：§0.3、§0.5、§2、§3、§5、§6、§7、§8.6、§10、§14.1、§16。
2. `docs/design/openbot-cogniweave-unified-memory-remediation-2026-08-19.md`
   - OpenBot 治理层与 CogniWeave 认知内核的责任边界及 U0-U5 计划。
3. `.kiro/specs/memory-workspace-platform-remediation/tasks.md`
   - 执行台账、历史批次、owner 和当前阻断。
4. `.kiro/specs/memory-workspace-platform-remediation/phase1b-item7-implementation-execution-plan.md`
   - Item 7 调用点 wave、替代路径、rollback/quarantine 和退休前置条件。
5. `.loom/registry.yaml`
   - 当前任务 owner、IDE/agent sessions、精确路径归属和 shared-path lander。

## 4. 目标资源模型

### 4.1 逻辑层级

| 层级      | 责任                                | 工作区/资源示例                   |
| --------- | ----------------------------------- | --------------------------------- |
| 平台      | 租户隔离、全局策略、审计            | tenant envelope、global policy    |
| 企业租户  | 企业成员、席位、部门、数据边界      | tenant scope、enterprise registry |
| 部门      | 授权与管理 scope，不作为物理父目录  | department grant/scope            |
| 员工      | 私有资料、个人 continuity、岗位关系 | `users/<uid>/private/`            |
| AI 数字人 | 稳定 agentAssetId 对应的业务资源    | `agent-assets/<id>/...`           |
| 协作小组  | 多成员共享资源及 ACL                | `collaboration/groups/<id>/`      |

### 4.2 物理目标布局

```text
tenants/<tenantId>/
  users/<userId>/private/
  agent-assets/<agentAssetId>/
    workspace/
    memory/
    artifacts/
  collaboration/groups/<groupId>/
```

历史 `OpenBot/workspace-*`、host `~/.openbot/workspace-*` 和 steward 双根仅是迁移输入；不得继续成为 managed 写入口。

## 5. 主要代码组件位置

### 5.1 Catalog、Resolver 与授权

| 组件                     | 位置                                                          | 审查重点                                                               |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Workspace Catalog 兼容层 | `src/gateway/workspace-resolver/catalog.ts`                   | 是否只作为治理 Catalog adapter/受控投影；是否存在请求期合成            |
| 严格 Locator             | `src/gateway/workspace-resolver/strict-locator.ts`            | tenant/resource/agentAsset/grant/membership、唯一 binding、fail-closed |
| Resolver exports         | `src/gateway/workspace-resolver/index.ts`                     | 是否重新暴露 test-only helper 或旧入口                                 |
| Workspace resolve        | `src/gateway/workspace-resolver/resolve.ts`                   | Handle 与 binding 解析一致性                                           |
| membership SoT           | `src/gateway/platform-auth/memberships.ts`                    | user/seat/group 权威成员关系                                           |
| cutover 状态机           | `src/gateway/workspace-cutover/`                              | operationId、fencing、状态转换、rollback                               |
| steward provision        | `src/gateway/workspace-resolver/provision-steward-cutover.ts` | Catalog-first、source/target binding、test-only pilot 边界             |

### 5.2 记忆、索引与止损

| 组件               | 位置                                    | 审查重点                                           |
| ------------------ | --------------------------------------- | -------------------------------------------------- |
| Workspace Handle   | `src/memory/memory-workspace-handle.ts` | 完整身份，缺件结构化拒绝                           |
| U0 boundary freeze | `src/memory/u0-boundary-freeze.ts`      | 禁止第四后端和自解析身份                           |
| CogniWeave manager | `src/memory/cogniweave-manager.ts`      | 是否只消费治理 Handle；是否仍自解析 host workspace |
| Memory manager     | `src/memory/manager.ts`                 | 旧目录解析和索引入口                               |
| backend config     | `src/memory/backend-config.ts`          | backend 与 workspace 身份是否分离                  |
| sync/prune         | `src/memory/manager-sync-ops.ts`        | workspace 分区、prune 边界、v1 guard               |
| v1 多根止损        | `src/memory/v1-root-guard.ts`           | 多 workspace root 时禁止 sync/prune/reset/rebuild  |
| schema v2          | `src/memory/schema-v2.ts`               | `workspace_id` 分区、默认关闭、非第二认知库        |
| QMD 兼容路径       | `src/memory/qmd-manager.ts`             | 是否仍从 host agent workspace 推导索引根           |

### 5.3 运行时接入点

重点排查目录：

- `src/auto-reply/reply/`
- `src/gateway/server-methods/`
- `src/gateway/workspace/`
- `src/gateway/checkpoint-store.ts`
- `src/commands/agent.ts`

这些位置历史上存在 `resolveAgentWorkspaceDir`、`resolveAgentWorkspaceDirForClient`、steward helper、现场 Catalog 合成或 tool cwd 路径。

## 6. 已完成的主要工作

### 6.1 Phase 0 与 Phase 1A

- 完成多路径、根目录、SQLite 风险和 unknown/quarantine 的只读盘点。
- Freeze workflow、证据测试和治理规则已建立。
- §14.1 七方设计签署已完成：architecture、data-governance、resolver、memory、security、storage-cutover、SRE 全部 accepted。
- 冻结 Data Governance Catalog 为唯一 SoT、`resourceId` 为唯一持久身份、membership 复用 platform-auth。
- Phase 0 candidate 明确不是生产 Catalog SoT，历史 coverage=0% 未被伪造。

### 6.2 WS-C v1 止损与 schema v2 准备

- v1 SQLite 多根检测和破坏性操作止损已实现并配套测试。
- schema v2 DDL/类型和测试已准备，但生产写保持关闭。
- Resolver 写切换与 schema v2 被要求在同一发布单元执行，避免“新解析 + 旧共享库 prune”。

### 6.3 Catalog/Resolver 收敛

- 建立严格 locator contract，统一校验 tenant、resourceId、agentAssetId 和 user/seat/group grant。
- seat 通过 enterprise seat/membership SoT 校验；group 通过 tenant/group ACL/member 校验。
- Catalog miss、多 binding、跨租户、缺失 membership 均 fail-closed。
- 已逐批退休大量 host、ForClient、现场 Catalog 合成和 steward helper 路径。

### 6.4 Steward cutover provisioning

- 新增 `provisionEmployeeStewardCutoverWorkspace`：
  - 先建立 source `canonical/active` 与 target `compatibility/read_only` binding；
  - 生成 receipt、operationId 和 fencing；
  - Catalog 成功后才允许可选 mkdir/copy；
  - 失败进入 `recovery_required` 并停止；
  - 默认内存 Catalog/store，不是生产 Catalog 写入。
- S26/S27 的 test-only pilot 已改为消费 provision 结果，不再调用 host root helper。
- `runEmployeeStewardCutoverPilot` 已从公共 resolver barrel 移除，并增加 test-only 机器边界，防止生产 import/re-export/call。

### 6.5 OpenBot/CogniWeave 统一边界

- U0 边界合同、只读 inventory、Handle 完整性与后端冻结已完成。
- U1 dark producer/consumer integration 已收口为 `closed-dark-only`。
- dark integration 明确保持：生产 Catalog 写入 none、schema v2 disabled、LIVE forbidden、Phase 1B unlock not-issued。

## 7. 关键 GitHub 交付索引

以下 PR 是审查路径中的关键里程碑，不是完整 PR 清单：

| PR        | 内容                                                |
| --------- | --------------------------------------------------- |
| #401      | WS-C v1 SQLite 止损交付                             |
| #409      | Freeze workflow 与 CODEOWNERS 清洁交付              |
| #432      | Phase 1A §14.1 Loom 所有权移交                      |
| #439      | architecture + data-governance §14.1 签署           |
| #445      | WS-A 设计合同冻结                                   |
| #447      | WS-A 交付状态记录                                   |
| #448      | Phase 1A final readiness/handoff                    |
| #449      | Phase 1B admission gate，未打开写路径               |
| #528/#529 | U1 dark Handle producer/consumer owner 接受与实施链 |
| #592      | Item 7 strict locator contract                      |
| #593      | Item 7 retirement preflight                         |
| #599 起   | Item 7 单点受控退休批次                             |
| #672      | S25 target binding 退休                             |
| #677      | S26 Semantic Gate CR，识别 provisioning 因果问题    |
| #679      | steward provision command 实现包                    |
| #684      | S26 scan evidence 一致性修正                        |
| #696      | Batch 24 S26/S27 原子退休实现                       |
| #706      | G2 收尾与 Batch 24 独立 reviewer 分配               |
| #720      | Batch 24 test-only pilot boundary 修复              |
| #770      | 最新 Batch 24 remediation Loom 任务分配             |

审查者应在 GitHub 上检查每个 PR 的：base/head SHA、required checks、非作者 approval、review threads、提交 trailers 和合并 SHA。

## 8. 当前权威状态快照

截至本文主干快照：

```text
Phase 1A §14.1: signed (7/7)
U1 dark integration: closed-dark-only
Batch 24: accepted by evidence
Item 2-6: met
Item 7: not-met
liveWriteWatchIndex: 10
remaining legacy sites: 10
i3Executed: false
Phase 1B full unlock: not-issued
phase1bExecutionBlocked: true
productionCatalogWrite: none
wiredToProductionResolver: false
deployAuthorized: false
LIVE: forbidden
```

权威文件：

- `docs/design/evidence/memory-workspace-phase1b-unlock-decision.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch24-s26-s27.json`
- `docs/design/evidence/openbot-cogniweave-u1-dark-integration-closeout-2026-08-20.json`

## 9. 当前剩余的 10 个旧路径

实时 retirement scan 仍列出：

| 类别        | 文件                                | 符号/行为                                   |
| ----------- | ----------------------------------- | ------------------------------------------- |
| P5 write    | `src/auto-reply/reply/get-reply.ts` | `resolveEmployeeBuiltinStewardWorkspaceDir` |
| P1 write    | `src/auto-reply/reply/get-reply.ts` | `resolveAgentWorkspaceDir`                  |
| P1 index x2 | `src/memory/backend-config.ts`      | `resolveAgentWorkspaceDir`                  |
| P1 index    | `src/memory/cogniweave-manager.ts`  | `resolveAgentWorkspaceDir`                  |
| P8 index x3 | `src/memory/manager-sync-ops.ts`    | `syncMemoryFiles`                           |
| P1 index    | `src/memory/manager.ts`             | `resolveAgentWorkspaceDir`                  |
| P1 index    | `src/memory/qmd-manager.ts`         | `resolveAgentWorkspaceDir`                  |

这些路径未归零前：

- Item 7 不能标记 met；
- 不得执行 I3；
- 不得签发 Phase 1B full unlock；
- 不得进行生产 Resolver 写切换、schema v2 生产写、迁库、重索引或 LIVE。

## 10. 证据与门禁体系

### 10.1 Freeze

- Phase 0 固定基线：`docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json`。
- 允许实时 scan 下降，但禁止改写 Freeze 基线伪造为 0。
- 新增 wrapper、dynamic import、Catalog 合成或旧 helper 必须被 Freeze 捕获。

### 10.2 Retirement

每批退休必须具备：

- 真实 call-site 删除/替换；
- replacement 已实现并通过定向测试；
- `rollbackProof=true`；
- `quarantineProof=true`；
- 独立 reviewer；
- `remaining == liveWriteWatchIndex == sites.length`；
- 保持 Item 7、Phase 1B、deploy 和 LIVE 锁。

### 10.3 发布与生产

合并到 `main` 不等于生产部署。最终部署必须额外满足：

- 候选 SHA 等于 freshly fetched `origin/main`；
- `is-ancestor(LIVE, candidate)`；
- `is-ancestor(LIVE, origin/main)`；
- `deploy/production/scripts/verify-forward-only.sh` 通过；
- `verify-delivery-alignment.sh` 通过；
- 生产镜像 build-info 与 release ledger 对齐；
- `pnpm delivery:check-sot -- --use-release-record-live` 通过；
- 明确、有效的部署授权，而非文档自报 `deployAuthorized=true`。

## 11. 第三方重点审查问题

建议专家组至少回答以下问题：

1. Data Governance Catalog 是否确为唯一持久 SoT，是否仍有独立写入的 Workspace Catalog。
2. 是否存在任何请求期现场合成 Catalog 或 managed miss 后回退 host workspace。
3. user/seat/group 授权是否都基于权威 membership，且 tenant/resource/agentAsset 身份一致。
4. Workspace memory role 与 Memory Asset 是否保持两个身份层次，未错误合并。
5. CogniWeave 是否成为唯一认知内核；OpenBot schema v2 是否只承担平台分区和治理。
6. 剩余 10 个路径的 replacement 是否真实存在，而不是只靠测试 seed 或 evidence 改数。
7. prune/search/status/reset/rebuild 是否全按 workspace 分区并受 v1 多根止损保护。
8. source/target binding、cutover fencing、receipt、rollback 和 recovery_required 是否形成原子链。
9. test-only pilot 是否有机器门禁防止生产重新引用。
10. `unknown/conflict/quarantine` 是否始终禁止进入正常 Catalog。
11. 是否存在旧二进制读取 schema v2 后继续写 v1 的可能；是否真正 fail-closed。
12. 是否有人把 dark、shadow、proposed、submitted、implementation-unlocked 或 merged 错报为 LIVE/accepted。

## 12. 当前未完成任务清单

### P0：必须完成后才可能申请生产切换

- 逐项退休剩余 10 个旧 write/index call-sites。
- 对 `src/memory/**` 的退休重新确认 memory owner，不能由 data-governance 越界修改。
- 将 `liveWriteWatchIndex` 真实降至 0。
- 完成独立 Item 7 closeout review。
- 在 index=0 后执行并验收 I3；不得提前删除旧分支、模块或数据。
- 形成 Resolver 写切换 + schema v2 的同一发布单元，完整验证 rollback。
- 签发有效 Phase 1B full unlock receipt。

### P1：生产发布前

- 重采生产 Catalog、runtime、SQLite、root、membership 和 cloud tenant 快照。
- 运行生产 canary：跨 tenant/员工/数字人/小组隔离，错租户和错 grant 必须拒绝。
- 验证 CogniWeave cloud sync 的 tenantId 与 Handle.tenantId 完全一致。
- 验证迁移前后 Memory Asset、atom、文件/chunk 数量和 checksum。
- 验证旧二进制遇 v2 fail-closed。
- 验证至少一个稳定 runner 和 required checks 持续可用。

### P2：上线后稳定期

- 观察 fallback、catalog miss、multi-binding、quarantine、prune、rollback 指标。
- 达到稳定窗口后再退役兼容投影、overlay 和旧模块。
- unknown 数据只可继续 quarantine，不因项目结项自动删除。

## 13. 第三方验收建议结论格式

建议逐层签署，避免一个总的“通过”掩盖未完成项：

```text
Architecture contract: accepted | changes-required | rejected
Catalog/identity SoT: accepted | changes-required | rejected
Authorization/membership: accepted | changes-required | rejected
Resolver fail-closed behavior: accepted | changes-required | rejected
Memory partition/schema v2: accepted | changes-required | rejected
CogniWeave/OpenBot boundary: accepted | changes-required | rejected
Item 7 retirement: accepted | changes-required | rejected
Cutover/rollback/I3: accepted | changes-required | rejected
Production deployment readiness: accepted | changes-required | rejected
```

按当前证据，合理的总判断应为：

```text
架构方向：accepted
Phase 0 / Phase 1A 契约：accepted
U1 dark integration：accepted for dark-only
Item 7：changes-required（remaining=10）
Phase 1B full unlock：not-issued
生产部署：rejected / forbidden at current state
```

## 14. 验收资料真实性要求

- 不以 PR 描述、AI 说明或 tasks 勾选代替代码和运行证据。
- 不以测试预置 Catalog/binding 代替生产 SoT 存在证明。
- 不以 `retiredThisChange` 字段代替 real-code scan。
- 不以 `main` 合并代替生产镜像部署。
- 不以 branch 名、时间戳或文件 mtime 判断新旧，必须使用 Git ancestry。
- 审查时重新 `git fetch origin`；若 fetch、runner、production access 或 build-info 不可用，应 fail-closed。
