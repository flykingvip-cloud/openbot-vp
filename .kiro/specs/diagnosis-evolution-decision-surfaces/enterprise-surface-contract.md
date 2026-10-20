# 企业 Decision Surface 合同（Phase D3.1–D3.3）

实现：`packages/evolution-core/src/decision-surface/enterprise-surface.ts`。快照路径与员工端共用 `snapshot.ts`。边界落在 D1 的 `visibility.ts`、`authority.ts`、`dto.ts`、`idempotency.ts`、`judge.ts`。

等级：code-present。不是 runtime-enabled，也不是 production-proven。不打开 E5.2。

本文件冻结企业 UI（D3.3）开始前必须确定的四条边界：路由、委托、企业 Canary、员工个人资产脱敏。UI 只消费这里的视图，不自行推导权限、动作或状态。

## 1. 运行门

- `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false as const`。这是评审过的常量，不是设置。源码不读 URL、query、浏览器存储、表单或进程环境，测试会扫描源码确认。
- 视图恒带 `claimGrade: "code-present"`、`runtimeEnabled: false`、`productionProven: false`、`e52Open: false`。
- 员工端运行门 `EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED` 不变。
- 打开企业运行门需要：
  - 评审过的代码改动；
  - 服务端解析的企业主体；
  - Timeline/Ledger 只读快照；
  - 第 3 节服务端事实的生产来源；
  - 投影在服务端执行，只下发视图；
  - 独立缺陷 D3.R1 修复：`navigation` 的两个企业 Mesh 路由浏览器测试通过，不得豁免。

  以上都还没有做，运行门仍为 false。D3.3 只在关闭的运行门后挂载了组件（第 13 节）。

## 2. 主体与拒绝

投影和提交都把主体 audience 固定为 `enterprise`：audience 由端点决定，不由请求决定。`trustedTenantId`、`enterpriseAdmin`、`platformOperator` 必须是服务端解析结果。

| 条件                         | 投影                                                 | 提交（D1 judge）            |
| ---------------------------- | ---------------------------------------------------- | --------------------------- |
| `trustedTenantId` 为空或空白 | `phase: denied`，`denial: trusted_tenant_required`   | `tenant_mismatch`           |
| `enterpriseAdmin` 不为 true  | `phase: denied`，`denial: enterprise_admin_required` | `enterprise_admin_required` |

`denied` 视图没有任何行和 decisionId。`asOf` 为 null，`weekOverWeek` 为 `history-unavailable / access_denied`。

## 3. 事实合同

`EvolutionEnterpriseDecisionFact = { item, routeInput, authorityFacts, grant, createdAt, updatedAt }`。每个字段都是服务端事实，客户端不提供租户、Grant、委托或参与状态。

| 字段                                          | 含义                                            | 现有服务端来源（`enterprise-surface-inventory.md`） |
| --------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `item`                                        | 完整的 D1 Decision 事项                         | Proposal / Ledger 只读投影；没有企业待决列表 RPC    |
| `routeInput.ownership`                        | 所有权种类；`agent_enterprise.delegated` 为委托 | 没有读路径输出 `delegated`（§4）                    |
| `routeInput.touchesEmployeePersonalAsset`     | 企业变更触及员工个人资产                        | 无（只在测试夹具中出现）                            |
| `routeInput.platformFixAffectsEnterprise`     | 平台修复影响本企业                              | 无（§5）                                            |
| `routeInput.crossTenantRepeat`                | 跨租户重复问题                                  | 无（只在测试夹具中出现）                            |
| `authorityFacts.employeeFinalAuthorization`   | 员工本人已做最终授权                            | 无；`enterprise_to_employee` 未接线（§4、§6）       |
| `authorityFacts.enterpriseCanaryAcknowledged` | 本企业已确认参与 Canary                         | 无（§5）                                            |
| `grant`                                       | 该事项的 Grant 视图，或 `{ status: "missing" }` | `evolution.delegation.get` 只按 grantId 查询        |
| `createdAt` / `updatedAt`                     | 事项时间                                        | Proposal / Ledger 时间                              |

`grant` 与 `authorityFacts` 只交给 D1 judge，不进入行。

快照为 `{ asOf, facts }`，历史为 `{ current, prior }`，`prior` 可以为 null。快照只能来自现有 Timeline/Ledger 的只读投影，不建历史数据库。

## 4. 投影流程

1. 主体固定为企业端，先做第 2 节拒绝判断。
2. current 与 prior 各自经 `projectEvolutionDecisionSnapshot`（与员工端共用）：同一快照内重复的 decisionId 全部省略，然后走 D1 router 与 visibility，用同一主体重新做租户、所有权与机密过滤。
3. 被省略的事项不在视图里留下 id、计数或字段：其他租户、员工专属、平台专属的事项，以及无法路由或重复的事实。省略代码只给服务端日志用，由 `projectEvolutionDecisionSnapshot` 返回。
4. 每个可见条目生成一行。员工参与视图不会到达企业主体；若出现则丢弃（失败关闭）。
5. 动作按企业端矩阵逐个判断：
   - 视图未提供的动作记为 `action_not_on_item`，不试探完整事项。
   - 视图提供的动作做一次 D1 judge 试算：`commandId = projection:<decisionId>:<action>`，`expectedVersion` 取事项版本，`now` 取快照 `asOf`，`prior` 为空。
   - 结果为 `admissible` 的进入 `allowedActions`，否则把代码写入 `actionReasons`。
   - judge 读完整服务端事项，行里只有它的判定代码。
6. `employee_final_authorization` 不在企业端矩阵，所以永远不出现在 `allowedActions` 或 `actionReasons` 中。

## 5. 企业状态推导

状态是投影，不是第二套控制面状态。按顺序取第一条命中：

| 顺序 | 条件                                                                                       | `uiStatus`                       |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 1    | 事项 `resolved`                                                                            | `completed`                      |
| 2    | 事项 `expired`                                                                             | `expired`                        |
| 3    | 事项 `blocked`                                                                             | `blocked`                        |
| 4    | 参与约束 `enterprise_canary`，且已 `enterpriseCanaryAcknowledged`（`allowedActions` 为空） | `watching`                       |
| 5    | 参与约束 `enterprise_canary`，judge 接受 `participate_canary`                              | `participate-platform-canary`    |
| 6    | 参与约束 `enterprise_canary`，列出 `participate_canary` 但不接受                           | `blocked`                        |
| 7    | 参与约束 `enterprise_canary`，其余                                                         | `watching`                       |
| 8    | 参与约束 `employee_final_authorization`，员工尚未最终授权                                  | `waiting-employee-authorization` |
| 9    | judge 接受至少一个动作                                                                     | `pending-enterprise-decision`    |
| 10   | 列出动作但 judge 全部不接受                                                                | `blocked`                        |
| 11   | 没有列出动作                                                                               | `watching`                       |

## 6. 可见性与脱敏矩阵

| 服务端事实                                                                                          | 企业看到                                         | 证据                                                 | 控制面 id                                       | `impactTarget.key`             | 可提供的动作                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 企业端所有权（委托有效的 agent、企业 knowledge、企业私有 capability、organization），不触及个人资产 | 完整行，`view: item`                             | 只有计数：`citationCount`、`findingCount`、`hasCase` | `proposalId`、`applicationId`、`verificationId` | 有                             | 事项动作与企业端矩阵的交集，再经 judge                                                                                                  |
| 企业端所有权，触及员工个人资产                                                                      | 参与行，`employee_final_authorization`           | `withheld`，计数为 0                                 | 无                                              | 有                             | 事项动作与企业端矩阵的交集，去掉 `participate_canary`。员工最终授权前 experiment / apply / promote 为 `employee_authorization_required` |
| 平台端，`platformFixAffectsEnterprise`，`tenantScope` 等于本租户，不是跨租户重复                    | 参与行，`enterprise_canary`                      | `withheld`，计数为 0                                 | 无                                              | 无（只有 domain 与 surfaceId） | 只有 `participate_canary`                                                                                                               |
| 平台范围 Canary（`tenantScope: null`）或其他租户                                                    | 不可见（`tenant_mismatch`）                      | —                                                    | —                                               | —                              | —                                                                                                                                       |
| 跨租户重复                                                                                          | 不可见（`audience_mismatch`），仍是平台脱敏 Case | —                                                    | —                                               | —                              | —                                                                                                                                       |
| 未委托的员工 agent、个人 knowledge、本人 agent                                                      | 不可见（`audience_mismatch`）                    | —                                                    | —                                               | —                              | —                                                                                                                                       |
| 平台公共 capability、不影响企业的 system                                                            | 不可见（`audience_mismatch`）                    | —                                                    | —                                               | —                              | —                                                                                                                                       |
| 未注册、禁止或不一致的 surface；重复 decisionId                                                     | 不可见（路由代码或 `duplicate_decision_id`）     | —                                                    | —                                               | —                              | —                                                                                                                                       |

说明：

- 参与视图（`enterprise_participation`）由 D1 visibility 生成。它不复制 `sourceEvidenceRefs`、`sourceFindingIds`、`sourceCaseId`、`proposalId`、`experimentId`、`applicationId`、`verificationId`、`evidenceAccessGrantRef`、`delegationGrantRef`。
- 企业 Canary 参与视图允许平台机密等级的事项，因为它已脱敏。平台范围事项企业不能参与，每个受影响企业需要一条本租户作用域的参与事项。
- 企业不能代替员工授权：`employee_final_authorization` 在企业端为 `endpoint_action_forbidden`。企业不能审批核心系统变更：对 Canary 事项的 apply / promote 为 `enterprise_not_core_approver`。
- `participate_canary` 与 `employee_final_authorization` 离开各自参与路由时为 `participation_required`。
- 参与只确认一次。本企业已确认 Canary 后，judge 对新的 `participate_canary` 返回 `participation_already_satisfied`，所以行上 `allowedActions` 为空，`actionReasons.participate_canary` 为该代码。员工最终授权同理（员工端）。

## 7. 周度变化

- 两份快照都按第 4 节投影，再比较每个事项的企业状态，给出各状态计数、差值与逐项变化。逐项变化只含两边可见的行。
- 以下情况结果为 `history-unavailable`，不输出任何计数：
  - `prior_snapshot_missing`：缺少 prior；
  - `snapshot_as_of_invalid`：`asOf` 无法解析；
  - `prior_not_before_current`：prior 不早于 current；
  - `prior_snapshot_not_weekly`：间隔不在 7 天 ± 1 天；
  - `snapshot_load_failed`：快照读取失败；
  - `access_denied`：主体被拒绝。
- 企业文案：「暂无足够历史数据，不能形成企业周度对比。」

## 8. 提交、幂等与零写入

- `submitEvolutionEnterpriseDecisionCommand` 只调用 `judgeEvolutionDecisionCommand`，audience 固定为企业端。
- 客户端只发 `commandId`、`decisionId`、`action`、`expectedVersion`。`payload` 是原始请求体，出现禁字段即 `client_authority_forbidden`（见 `authority-matrix.md`）。
- 同一 `commandId` 回放为 `idempotent_replay`，过期后也可以回放。改绑决策、动作或期望版本为 `command_rebind`。
- 已确认的参与不能用新的 `commandId` 再确认一次：`participation_already_satisfied`（`blocked`）。原 `commandId` 的回放不受影响。
- 回放必须绑定已存的租户、决策版本、目标、surface、所需权威与主体绑定。当前路由还必须与事项一致。记录带有路由端与参与约束时（记录时传入 `route`），当前路由也必须与之相同。任一不一致为 `replay_binding_mismatch`。
- 每个结果都是 `writes = []`、`executed = false`、`effectProof = false`。受理回执引用 `decision-plan:<commandId>`，它不是 Ledger 事件。

## 9. D3.3 使用的冻结文案

- 员工个人资产参与行：「等待本人最终授权」。
- 周度不可用：「暂无足够历史数据，不能形成企业周度对比。」
- UI 显示 `requiredAuthority`（需要谁处理）与 `allowedActions`（可执行动作），两者不混用，不显示 `requiredPermissions`。内部代码、claim grade 与 `decision-plan` 引用只留在类型、`data-*`、日志与测试。

## 10. 挂载所有权

- 2026-09-29 决定：`enterprise-surfaces-core.ts` 不登记为 sharedPaths；gated mount 由该文件当前 owner 落地，原任务已结束时先完成正式 Loom path takeover。
- 2026-09-29 已完成单文件正式接管：`enterprise-surfaces-core.ts` 从 `ops-decommission:kiro-enterprise-tsgo` 转入 `diagnosis-evolution-decision-surfaces`。接管前核对了开放 PR、未提交 WIP、在途分支与 `origin/main` 事实源；旧任务其余路径、sessions 与历史不变；没有登记 sharedPaths。
- D3.3 mount 随后由 D3 owner 在 #220 落地，见第 13 节。

## 11. 尚未做

- 独立缺陷 D3.R1：`navigation` 的两个企业 Mesh 路由浏览器测试失败，挂载前已存在。不阻挡 D3.4 code-present（U6 于 2026-09-30 满足全部标准），运行门打开前必须修复。
- Gateway 读写 RPC、控制面调用、Adapter、Perception 变更。
- 第 3 节服务端事实的生产来源。
- D4、E5.2、autoApply、`system.engineering-remediation`。

## 12. D3.3 独立组件（UI 合同）

文件在 `ui/src/ui/ports/enterprise/evolution-decision/`（types、client、runtime-gate、copy、display、组件本地样式、测试夹具）与 `ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.ts`。企业 Mesh 页在关闭的运行门后挂载该组件（第 13 节）。源码扫描测试确认，除组件目录与组件测试外，只有这个挂载点和它的挂载测试触达组件。

- **运行门**：`enterpriseEvolutionDecisionSurfaceMountEnabled()` 没有参数，只返回 `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED`。URL、query、hash、浏览器存储、cookie、表单、页面全局变量、环境变量和 Gateway 自报字段都打不开它。
- **数据源**：`EvolutionEnterpriseDecisionHistorySource = { loadHistory() }`，只读，本阶段只由测试夹具实现。没有企业身份的主体不读取数据源；读取失败为 `load-fail`，显示「状态未知」，不显示为空或健康。
- **提交上下文**：`EvolutionEnterpriseDecisionSubmitContext = { item, routeInput, principal, grant, facts, prior, now }`，全部是服务端事实，按 decisionId 注入。组件只构造 `commandId`、`decisionId`、`action`、`expectedVersion`，并以原始请求体交给 D1 judge，其他字段一律被拒绝。
- **接线**：属性为 `principal`、`historySource`、`submitContexts`、`commandIdFactory`。缺主体、缺数据源或主体没有可信租户与企业管理员身份时，组件不渲染任何内容：没有占位面板、徽标、开发说明或空白卡片。
- **动作**：只渲染 `row.allowedActions`，并再用企业端命令矩阵过滤。按钮正文为中文业务标签，原始动作只在 `data-action`。未在行上的动作、矩阵外动作、缺提交上下文或缺命令编号时，组件自己拒绝（`action_not_allowed`、`endpoint_action_forbidden`、`submit_context_unavailable`、`command_id_unavailable`），零写入。
- **展示**：企业自有事项只显示证据计数。员工个人资产参与行显示「相关依据由员工本人或授权系统保管，这里不展示明细。」。平台 Canary 参与行显示「平台变更将影响本企业，需要确认是否参与灰度。」，已确认后为「平台变更将影响本企业，本企业已确认参与灰度。」且没有动作。参与行不显示计数、案例、控制面 id、目标键或其他租户信息。
- **周度变化**：七个分类加事项总数，逐项状态变化只含两边都可见的事项。`history-unavailable` 时只显示第 7 节的固定句子。
- **回执**：受理为「请求已通过规则校验，但尚未执行。」；回放为「重复请求已识别；原请求尚未执行。」；拒绝为「请求未通过规则校验：<中文原因>。没有执行任何变更。」。`executed`、`effectProof`、`writes`、`commandId`、`auditReceiptRef` 与原始代码只在 `data-*`。
- **文案**：状态、周度分类、动作、事项类型、需要谁处理、对象域、surface、依据状态、原因码都有中文映射。未知值降级为「未知操作」「暂不可执行」「进化事项」「负责的管理员」「相关对象」「未登记对象」「状态未知」，不回显原值。
- **样式**：组件本地 `enterprise-evolution-decision.css`，使用现有设计变量，不改共享样式文件。
- **运行时导入边界（UI Build Repair，#214）**：UI 非测试代码只经 `ui/src/ui/evolution-decision-contract.ts` 运行时导入 Decision Surface；该文件只 `export *` decision-surface 入口。不得运行时导入 `@openbot/evolution-core` 根入口或 `packages/evolution-core/src/index.ts`，根入口会重导出 Node-only 模块。`import type` 只保留给边界不提供的类型（`AuthorityGrantView`、`EvolutionTarget`）。源码合同测试覆盖已挂载的 D2 与 D3 代码；企业挂载点只导入组件模块与运行门，不导入根入口。

## 13. D3.3 挂载（#220）

- 位置：`enterprise-surfaces-core.ts` 的 `case "enterpriseMesh"`，在 `renderMeshGovernanceSurface` 的结果之后。其他企业页面与主入口不挂载该组件。
- 运行门：只看 `enterpriseEvolutionDecisionSurfaceMountEnabled()`。门关闭时返回 Mesh 模板本身：不渲染标签、不读取数据、不显示占位，Mesh 输出与挂载前相同。生产构建中门控分支被压缩器裁掉，只留下组件定义。
- 接线：挂载的是裸元素，不接 `principal`、`historySource`、`submitContexts`、`commandIdFactory` 或 client。即使门打开，组件也不渲染、不读取。
- 不调用 Gateway、控制面或 Adapter。Mesh 文件与 Mesh 行为不变。
- 测试：`enterprise-evolution-decision-mount.node.test.ts` 锁定唯一挂载点、门控写法、无接线与无根入口导入，并确认 URL、存储、cookie、表单与页面 props 都打不开运行门。
- 等级：D3.3 mount Go / Landed（`bb72d0340`）。运行门为 false；runtime-enabled 与 production-proven 均为 No-Go。
