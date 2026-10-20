# Authority 矩阵（Phase D0 / D1 合同，D3.2 补充）

主体、租户、Grant 和参与事实都由调用方以服务端已解析结构传入。纯函数不信任命令体里的同名字段。

## 客户端命令

允许字段：`commandId`、`decisionId`、`action`、`expectedVersion`。

出现以下任一字段即 `client_authority_forbidden`，`writes` 为空数组：

- `tenantId`、`enterpriseId`、`trustedTenantId`、`principalRef`、`role`、`audience`、`enterpriseAdmin`、`platformOperator`
- `ownerId`、`ownerAgentId`、`ownerAssetId`
- `approval`（无论 true 或 false）
- `grant`、`delegation`、`evidence`、`sourceEvidenceRefs`
- `adapter`、`adapterParams`
- `messageText`（大白或聊天文本）

其他未知字段为 `invalid_command`。

## 谁可以决定

| 主体 audience | 可以处理的路由                                                                       | 不能做                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| employee      | 路由端为员工；或参与约束为员工最终授权且目标是已证明所有者的个人 agent / knowledge   | 不能决定企业端或平台端事项；不能对 capability、organization、system 做员工最终授权；不能单靠事项 `allowedActions` 加 Grant 获得 apply / verify / promote；不能以聊天代替 `employee_final_authorization`                                                          |
| enterprise    | 路由端为企业，`enterpriseAdmin` 为 true，且 `trustedTenantId` 等于事项 `tenantScope` | 缺少 `enterpriseAdmin` 时为 `enterprise_admin_required`。不能审批 system 域、`authorityRole = platform` 或 `requiredApprovals` 含 `platform` 的核心变更（`enterprise_not_core_approver`）；不能在缺少员工最终授权时完成个人资产上的 experiment / apply / promote |
| platform      | 路由端为平台，且 `platformOperator` 为 true                                          | 缺少 `platformOperator` 时为 `platform_operator_required`。不能用平台角色代替 `enterpriseCanaryAcknowledged` 或 `employeeFinalAuthorization`；不能读取其他租户的个人或企业机密事项；跨租户重复只处理脱敏 Case，不能获得原租户 surface 的变更权                   |

租户：

- 事项 `tenantScope` 必须等于主体 `trustedTenantId`。
- 唯一例外：平台操作者查看或决定 `tenantScope = null` 且 `confidentialityScope = platform` 的系统事项。
- 两边都是 null 以外的跨租户组合为 `tenant_mismatch`。

可见性投影直接省略不可见事项，不返回其 `sourceEvidenceRefs` 或 `sourceFindingIds`。

机密等级沿用 `confidentialityRank`：员工只看 personal；企业看 personal 与 enterprise；平台看 platform 路由上的事项，但仍受租户规则约束。员工最终授权的参与事项可以让目标所有者看到一份参与视图，即使机密等级是 enterprise。该视图不包含 `sourceEvidenceRefs`、`sourceFindingIds`、`sourceCaseId`、`proposalId`、`experimentId`、`applicationId`、`verificationId`、`evidenceAccessGrantRef`、`delegationGrantRef`。员工在该视图上的动作也只保留员工端矩阵允许的动作。

企业参与视图（D3.2，`enterprise_participation`）同样不含上述字段：

- `employee_final_authorization`：企业端路由上触及员工个人资产的事项。企业仍是决定端，动作是事项动作与企业端矩阵的交集，去掉 `participate_canary`。员工最终授权之前，judge 对 experiment / apply / promote 返回 `employee_authorization_required`。
- `enterprise_canary`：平台端路由上影响本企业的事项。租户必须一致，所以平台范围事项（`tenantScope = null`）为 `tenant_mismatch`。跨租户重复不生成该视图。机密上限为 platform。动作只保留 `participate_canary`。

企业端投影不输出被省略事项的 id 或计数，完整合同见 `enterprise-surface-contract.md`。

路由入参的 target、surfaceId，以及路由成功时的 `requiredAuthority`，必须与事项一致，否则 `route_binding_mismatch`。

## 端点动作矩阵

员工端：`hold`、`reject`、`rollback`、`employee_final_authorization`。

企业端：`hold`、`reject`、`rollback`、`start_experiment`、`apply_canary`、`verify`、`promote`、`participate_canary`。

平台端：`hold`、`reject`、`rollback`、`start_experiment`、`apply_canary`、`verify`、`promote`。

矩阵之外的动作为 `endpoint_action_forbidden`。事项 `allowedActions` 和 Grant 不能把 apply / verify / promote 发给员工。

跨租户重复（`cross_tenant_repeat`）只允许 `hold` 与 `reject`。apply、verify、promote、rollback、start_experiment 为 `cross_tenant_mutation_forbidden`。

## Grant

除 `participate_canary` 与 `employee_final_authorization` 外，授权调用现有 `evaluateAuthorityGate`：

- surface 必须已注册
- Grant 必须 `APPROVED`，未过期、未撤销
- Grant 租户、机密上限、证据引用、`allowedActions` 与现有门一致
- 请求的 surface 操作来自命令映射，不是客户端自选的 Adapter 名

`participate_canary` 与 `employee_final_authorization` 离开各自参与路由时为 `participation_required`。该检查在端点动作矩阵之后。员工端因此不在本人事项上提供 `employee_final_authorization`。

参与只确认一次（D3.2 验收修复）：

- 已有 `enterpriseCanaryAcknowledged` 时再次 `participate_canary`，或已有 `employeeFinalAuthorization` 时再次 `employee_final_authorization`，结果为 `participation_already_satisfied`（`blocked`，零写入）。
- 该检查排在主体、租户、路由与所有者检查之后，只有本来会被受理的主体才会得到这个代码。
- 同一 `commandId` 的回放在 authority 之前处理，仍按幂等合同返回 `idempotent_replay`。
- 两端投影与 judge 一致：企业行和员工行都不再提供已完成的参与动作。

`participate_canary` 只允许企业主体，且路由参与约束必须是 `enterprise_canary`。它映射到 `evolution.delegation.approve`，不要求 Grant 已经是 APPROVED（该命令本身是参与确认）。

`employee_final_authorization` 只允许员工主体，参与约束必须是 `employee_final_authorization`，且目标是个人 agent（`ownerAgentId` 等于 `agentId`）或个人 knowledge（`ownerAssetId` 等于 `assetId`）。其他域，或所有者标识为空，为 `owner_unproven`。所有者标识存在但不匹配时为 `owner_mismatch`。它映射到 `evolution.delegation.approve`，surface 操作是 `observe`，不是 suggest。

## 命令与现有控制面

| Decision action                | surface 操作 | 现有控制面                           | 现有 Gateway 方法                            |
| ------------------------------ | ------------ | ------------------------------------ | -------------------------------------------- |
| `authorize`                    | 无           | 现有 RPC 不接受该动作                | 失败关闭：`control_plane_action_unavailable` |
| `start_experiment`             | experiment   | `startExperiment`                    | `evolution.experiments.create`               |
| `hold`                         | hold         | `holdProposal`                       | `evolution.proposals.transition`             |
| `reject`                       | reject       | `rejectProposal`                     | `evolution.proposals.transition`             |
| `approve_application`          | 无           | 现有 RPC 不接受该动作                | 失败关闭：`control_plane_action_unavailable` |
| `apply_canary`                 | apply        | 控制面 apply（由控制面选择 Adapter） | `evolution.applications.apply`               |
| `verify`                       | verify       | `verifyApplication`                  | `evolution.applications.verify`              |
| `promote`                      | promote      | `promoteProposal`                    | `evolution.proposals.transition`             |
| `rollback`                     | rollback     | `rollbackApplication`                | `evolution.applications.rollback`            |
| `participate_canary`           | observe      | `DiagnosisDelegationMachine.approve` | `evolution.delegation.approve`               |
| `employee_final_authorization` | observe      | `DiagnosisDelegationMachine.approve` | `evolution.delegation.approve`               |

`evolution.proposals.transition` 只接受 `reject`、`promote`、`hold`。在出现真实授权 RPC 之前，`authorize` 与 `approve_application` 不得映射为 suggest，也不得当成已有权限。

映射结果 `callsAdapter` 为 false，`perceptionWrite` 为 false。

拒绝：

- Adapter 标识：`working-dna`、`capsule`、`skill`、`skill-installation`、`organization`、`runtime-governance`、`managed-memory`、`diagnosis-contract`
- Perception：`evolution.perception.query`、`evolution.perception.project`
- 大白聊天批准：`daibai_chat_approve`

## 状态投影

`projectEvolutionDecisionStatus` 不写 Proposal：

1. `expiresAt <= now`，或无法解析的 `expiresAt`，或 Proposal 为 `EXPIRED` → `expired`
2. 没有 Proposal，或调用方标记授权阻塞 → `blocked`（Decision Surface 不发明提案）
3. Proposal 为 `REJECTED`、`ROLLED_BACK`、`PROMOTED`、`REVOKED` → `resolved`
4. 其余现有非终态 → `pending`

新鲜命令只接受 `pending`，且事项 `decisionVersion` 非空。`expired` 的新鲜命令结果为 `rejected`。`resolved` / `blocked` 的新鲜命令结果为 `blocked`。

改变状态的命令必须带非空 `expectedVersion`。省略或空白为 `version_required`，不会被规范成空字符串。只有 `participate_canary` 与 `employee_final_authorization` 可以省略版本。

已接受记录在过期之后仍可按同一 `commandId` 回放为 `idempotent_replay`，但回放接受前必须核对已存的租户、决策版本、目标、surface、所需权威，以及服务端解析的主体绑定（audience、租户、所有者、`enterpriseAdmin`、`platformOperator`）。任一不一致为 `replay_binding_mismatch`，不重新执行。回放不修改 prior 数组。

回放不重新走 authority，所以还要核对路由（D3.2）：当前路由的 target、surfaceId 与 `requiredAuthority` 必须与事项一致。记录带有 `routeEndpoint` 与 `routeParticipation` 时（记录时传入 `route`），当前路由也必须与之相同。

## Perception 边界

D1 模块不得导入员工 Perception 组件，不得把 `evolution.perception.*` 映射为写命令，不得修改 `employee-evolution-perception-section.ts`。

## 效果证明

`judgeEvolutionDecisionCommand` 始终返回 `writes: []`、`executed: false`、`effectProof: false`。`auditReceiptRef` 在可受理结果上是 `decision-plan:<commandId>`，它不是 Ledger 事件。拒绝结果的引用是 `decision-refusal:<commandId>:<code>`，同样不是效果证明。
