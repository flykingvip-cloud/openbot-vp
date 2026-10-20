# 现状盘点（Phase D0）

盘点日期以主干 `origin/main` 为准。本文件只记录已读到的代码与合同，不改变它们。

等级：下列能力凡已接到 Gateway 或 UI 的，现网等级最多是 **runtime-enabled**（代码与测试在仓库内，本任务未做生产探针）。本任务没有把任何一项升为 **production-proven**。

## 1. 员工进化履历（只读 Perception）

| 事实                                                                             | 位置                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置页「进化」区块                                                               | `ui/src/ui/ports/employee/views/employee-evolution-perception-section.ts`                                                                             |
| 只调用 `evolution.perception.query` / `evolution.perception.project`             | 同文件头注释；`ui/src/ui/ports/employee/evolution-perception/client.ts`                                                                               |
| 面板：时间线、学会了、周报、待决定、自动执行、观察中、已回滚、自治预算、事实溯源 | `ui/src/ui/ports/employee/evolution-perception/types.ts` 的 `EvolutionPerceptionPanels`                                                               |
| 合同                                                                             | Gateway `access = "read-only"`，`persisted: false`。见 `src/gateway/evolution-control/perception-runtime.ts` 的 `EVOLUTION_PERCEPTION_RUNTIME_ACCESS` |
| 租户来源                                                                         | `src/gateway/server-methods/evolution-perception.ts` 使用 `sessionEnterpriseId`，否则 `sessionTenantId`。请求体不能提供事实                           |
| Scope                                                                            | `operator.read`。`src/gateway/server-methods/packs/manifest.ts`                                                                                       |
| 投影实现                                                                         | `packages/evolution-core/src/timeline.ts`、`timeline-list.ts`、`perception.ts`、`perception-p2.ts`                                                    |
| 设计说明                                                                         | `docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md`；包说明见 `packages/evolution-core/README.md`                                 |

Perception 明确不写 Ledger、Proposal、Application、Verification，也不改自治预算。员工面板里的「待决定」是时间线投影，不是 Decision Surface。

`packages/evolution-core/src/decisions.ts` 的 `ExperimentDecision` 是实验接受门，不是本任务的 Decision Surface。D1 不得复用该文件充当新状态机。

## 2. 统一进化投影

事实源是控制面 Ledger 序列。`projectEvolutionTimeline` 生成只读 `EvolutionTimelineItem`。`system` 域进入 platform audience，不进入数字人员工「我学会了」。

本任务不建立第二套进化事实源。

## 3. 进化控制面（必须复用）

纯合同在 `packages/evolution-core`：

- Proposal v2 状态与命令：`src/types.ts` 的 `EVOLUTION_PROPOSAL_STATUSES`、`EVOLUTION_COMMANDS`
- 状态机：`src/state-machine.ts` 的 `transitionEvolutionProposal`
- Surface 目录：`src/surfaces.ts` 的 `listEvolutionSurfaces()`
- 授权门：`src/contracts.ts` 的 `evaluateAuthorityGate`
- Ledger 事件类型：`src/types.ts` 的 `EVOLUTION_LEDGER_EVENT_TYPES`

Gateway 运行时在 `src/gateway/evolution-control/`：

| 能力           | 入口                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 控制面         | `control-plane.ts` 的 `EvolutionControlPlane`：`startExperiment`、`holdProposal`、`rejectProposal`、`verifyApplication`、`promoteProposal`、`rollbackApplication`、`applyWorkingDna` / `applyCapsule` / `applySkill` / `applyOrganization` / `applyRuntimeGovernance`、`recheckAuthority` |
| Surface 注册表 | `surface-registry.ts` 只转发 `listEvolutionSurfaces()`，没有第二份目录                                                                                                                                                                                                                    |
| 授权           | `authority-gate.ts` 调用 `evaluateAuthorityGate`                                                                                                                                                                                                                                          |
| Ledger         | `evolution-ledger.ts`                                                                                                                                                                                                                                                                     |
| 实验           | `experiment-manager.ts`                                                                                                                                                                                                                                                                   |
| Grant          | `evolution-grant.ts`                                                                                                                                                                                                                                                                      |
| Adapter        | `adapters/working-dna.ts`、`capsule.ts`、`skill.ts`、`organization.ts`、`runtime-governance.ts`、`fail-closed.ts`。只允许控制面内部调用                                                                                                                                                   |
| 幂等           | `control-plane.ts` 对重复 `commandId` 回放同一 Application；改绑则抛出 `duplicate command cannot retarget another object`。诊断提交见 `submit-diagnosis-candidate.ts` 的 `command_rebind`                                                                                                 |

已注册 Gateway 方法（`src/gateway/server-methods/packs/manifest.ts`）：

- 读：`evolution.surfaces.list`、`evolution.proposals.list`、`evolution.proposals.get`、`evolution.experiments.get`、`evolution.verifications.get`、`evolution.ledger.query`、`evolution.diagnosis.status`
- 写：`evolution.proposals.transition`、`evolution.experiments.create`、`evolution.experiments.evaluate`、`evolution.applications.apply`、`evolution.applications.verify`、`evolution.applications.rollback`、`evolution.diagnosis.submit`、`evolution.working-dna.verify-effect`、`evolution.working-dna.evaluate-promote`
- 写 scope 为 `operator.approvals`；读 scope 为 `operator.read`

D1 映射只引用这些名字，不新增 RPC。

## 4. 诊断确认路径

- `diagnosis.self-evolution.confirm`，scope `operator.approvals`（`src/diagnosis/report-query-api.ts`，`src/gateway/server-methods/packs/manifest.ts`）
- `confirmDiagnosisCandidatePreview`（`src/gateway/evolution-control/confirm-diagnosis-candidate.ts`）拒绝客户端自带 `candidate`，要求 `confirmedByUser`，再进入 `submitDiagnosisCandidate`
- `diagnose()` 保持只读。确认不是聊天文本，也不是 Decision Receipt

## 5. Delegation / Grant

- 角色：`src/diagnosis/delegation.ts` 的 `DAIBAI_ROLES = platform | enterprise | employee`
- 场景：`platform_to_enterprise`、`platform_to_employee`、`enterprise_to_employee`
- 命令：`request`、`approve`、`deny`、`revoke`、`suspend`、`resume`、`expire`、`consume`
- 进程内机器：`src/gateway/evolution-control/delegation-service.ts` 的 `getSharedDiagnosisDelegationMachine`
- RPC：`evolution.delegation.get`（`operator.read`）、`evolution.delegation.request` / `evolution.delegation.approve`（`operator.approvals`）

员工最终授权与企业 Canary 参与都复用这条委托，不新建 Grant 存储。

## 6. Verification / Recheck

- Verification 类型：`packages/evolution-core/src/types.ts` 的 `EvolutionVerification`
- 诊断回流：`diagnosis-recheck.ts`、`authority-recheck.ts`、`evaluation-policy.ts`
- Gateway：`diagnosis-recheck-observer.ts`、`authority-recheck.ts`、`effect-verification-audit.ts`
- 外部效果验证是控制面读后写证明。Decision Receipt 不能代替它

E5.2 仍是未完成项：`.kiro/specs/openbot-evolution-evaluation-closure/tasks.md` 中 E5.2 未勾选。本任务不切换 mutator，不把 `e52SwitchAllowed` 设为 true。

## 7. Evolution Surface Registry

`packages/evolution-core/src/surfaces.ts` 当前注册：

| surfaceId                           | domain       | authorityRole | autoApply |
| ----------------------------------- | ------------ | ------------- | --------- |
| `agent.working-dna`                 | agent        | enterprise    | false     |
| `knowledge.experience-capsule`      | knowledge    | enterprise    | false     |
| `knowledge.managed-memory`          | knowledge    | enterprise    | false     |
| `capability.skill-spec`             | capability   | enterprise    | false     |
| `capability.skill-installation`     | capability   | enterprise    | false     |
| `organization.task-routing`         | organization | enterprise    | false     |
| `organization.team-composition`     | organization | enterprise    | false     |
| `system.diagnosis-contract`         | system       | platform      | false     |
| `system.runtime-binding-governance` | system       | platform      | false     |

禁止标识：`system.model-weights`、`system.production-cutover`、`system.core-identity`、`system.security-authorization`、`system.secrets`。

`system.engineering-remediation` **不存在**。本轮不注册它。D1 仅把它当作未注册保留名，路由失败关闭。以后若要登记，必须走现有 `surfaces.ts`，并且只能描述受治理的工程修复生命周期，不能让 UI 改源码。

全部 `autoApply: false`。本任务不扩大自动 Apply。

## 8. 企业端

入口：`ui/src/ui/ports/enterprise/views/enterprise-mesh-governance-surface.ts`，由 `enterprise-workforce-governance-surface.ts` 引用。

已有 Mesh 运营与绩效、成本与用量、数字员工与组织对象、异常队列、所有权转移。检索该目录下的进化待决、进化履历、Canary 管理、数据衔接批准、委托后的进化操作中心，没有对应正式页面。

企业管理员会话：`src/gateway/platform-auth/session-context.ts` 的 `resolveEnterpriseAdminSessionContext`。会话种类包含 `platform-super-admin`、`platform-admin`、`enterprise-admin`、`member`。

## 9. 平台端

- `ui/src/ui/capability/ai-workforce-governance/pages/actions-page.ts`：治理动作、Kill Switch、限流、重定向、待审批、Skill-auto、人工 Hold/Resume
- `ui/src/ui/capability/ai-workforce-governance/pages/evolution-lineage-panel.ts`：谱系上的 hold / resume，调用现有 proposal hold 与 experiment resume

这些是治理操作页，不是本任务定义的平台 Decision Surface，也没有单独的 Engineering Remediation Surface。

## 10. 身份解析（服务端）

| 端       | 已有解析                                                                                                                                               | Decision Surface 用法                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 员工     | 工作台绑定本人 agent：`ui/src/ui/ports/employee/render-model.ts` 的 `bindOwnedEmployeeWorkbenchAgentScope`                                             | D1 只接受调用方传入的 `ownerAgentId`，不读 UI             |
| 企业     | `sessionEnterpriseId` / enterprise-admin membership                                                                                                    | D1 只接受 `trustedTenantId`                               |
| 平台     | `platform-admin` / `platform-super-admin`；进化恢复身份见 `src/gateway/evolution-governance/application-consumption-shadow.ts` 的 `resolveServerAdmin` | D1 的 `platformOperator` 由调用方填入，客户端命令不能自报 |
| 测试注入 | `src/gateway/evolution-control/rpc-test-identity.ts` 仅 Vitest                                                                                         | D1 不调用它                                               |

## 11. 大白

`src/gateway/server-methods/daibai.ts` 处理支持案例的 proposal 版本和用户确认令牌。`src/diagnosis/delegation.ts` 声明委托机器不调用活的大白或聊天。

大白聊天文本不是进化批准。D1 拒绝 `daibai_chat_approve` 以及命令上的 `messageText`。

## 12. 三端缺口（本轮不实现 UI）

| 端   | 已有                 | 尚无                                                                        |
| ---- | -------------------- | --------------------------------------------------------------------------- |
| 员工 | 只读履历             | 独立 Decision Surface                                                       |
| 企业 | Mesh 治理            | 进化履历、待决中心、Canary 管理、数据衔接批准、委托后的进化操作中心         |
| 平台 | 谱系与运行时治理动作 | 与员工履历闭环的 Decision Surface，以及正式 Engineering Remediation Surface |
