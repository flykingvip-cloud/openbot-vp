# 企业端现状盘点（Phase D3.0）

基线：`origin/main` `f00d2d09b`。本文件只记录读到的代码，不改变它们。行号以该基线为准。

## 1. 企业治理页面结构

- 渲染链：`ui/src/ui/app-render.ts` → `renderEnterprisePortShell`（`ui/src/ui/ports/enterprise/views/enterprise-shell.ts:135`）→ `renderEnterpriseSurface`（`enterprise-surfaces-core.ts:79`，页签 `switch` 在 `:176`）。
- 机巢治理：`case "enterpriseMesh"`（`enterprise-surfaces-core.ts:185-187`）调用 `renderMeshGovernanceSurface`（`enterprise-mesh-governance-surface.ts:2769`）。它是渲染函数，不是自定义元素。依次渲染：通知、模块头、对象总览 KPI、治理队列 KPI（待处置 / 待复核 / 待优化）、运营 / 绩效页签、页签内容（`governance-assets-page`、`governance-ranking-page`、关系图）、所有权转移编辑器。页签与筛选都从 URL query 读取（`meshTab`、`queue`、`rankView` 等）。
- `enterprise-workforce-governance-surface.ts` 只是 `renderMeshGovernanceSurface` 的别名，仅被未启用的 lazy loader 引用。
- 系统治理入口：设置 → 治理，`renderGovernanceSection`（`enterprise-access-control-surface.ts:1439`，分派在 `:2265`），已挂载记忆治理、保留策略和开发监督等 light DOM 卡片。
- `ui/src/ui/ports/enterprise/**` 目前没有任何进化 UI。`ui/src/ui/capability/ai-workforce-governance/` 下的 `governance-actions-page` 与 `evolution-lineage-panel` 存在，但没有端口挂载它们。
- 约定：正文为内联简体中文，`t()` 只用于模块标题；企业端自有元素使用 light DOM（`createRenderRoot() { return this; }`）；样式在全局 `ui/src/styles/components.css` 与 `enterprise-*.css`。

## 2. 企业管理员的服务端身份解析

- session 种类：`platform-super-admin`、`platform-admin`、`enterprise-admin`、`member`（`src/gateway/platform-auth/session-context.ts:181`）。
- `resolveStoredPlatformAuthSessionContext`（`:267`）：签名 cookie → session → membership 精确绑定（membershipId 属于该用户，enterpriseId 一致），企业未过期或暂停，`sessionKind` 必须等于 `membershipRole`。
- 租户来源：`toTrustedProxySession`（`:143`）令 `tenantId = enterpriseId = membership.enterpriseId`。
- `resolveEnterpriseAdminSessionContext`（`:202`）：membership 为 `enterprise-admin` 时直接返回；平台会话只有在本人持有 enterprise-admin membership 时才能提升，`enterpriseId` 参数只能在本人 membership 中选择。
- Gateway client：`sessionEnterpriseId` 与 `sessionMembershipId` 成对出现时是权威来源，`sessionTenantId` 只是提示。`src/gateway/server-methods/evolution-control.ts:83` 的 `trustedTenantId` 在缺少 `sessionEnterpriseId` 时回落到该提示。这是既有弱点，D3 不改。
- 写方法拒绝请求体里的 `principalRef`、`tenantId`、`role`、`approval`、`ownerId`、`grantId`（`requireOperatorApprovalSession`，`evolution-control.ts:109`）。

## 3. 企业可用的现有读入口

| 方法                                      | 位置                                         | Scope         | 租户过滤                                                                       |
| ----------------------------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `evolution.surfaces.list`                 | `evolution-control.ts:320`                   | operator.read | 无，返回静态目录                                                               |
| `evolution.proposals.list` / `.get`       | `evolution-control.ts:324`、`:331`           | operator.read | `visibleToCaller`（`:102`）：`tenantScope === tenantId`；tenantId 为空时不过滤 |
| `evolution.experiments.get`               | `evolution-control.ts:451`                   | operator.read | 经父提案租户                                                                   |
| `evolution.verifications.get`             | `evolution-control.ts:655`                   | operator.read | 经 application → proposal 租户                                                 |
| `evolution.ledger.query`                  | `evolution-control.ts:675`                   | operator.read | tenantId 非空时按 `event.tenantScope` 过滤；为空时返回全部                     |
| `evolution.delegation.get`                | `server-methods/evolution-delegation.ts:160` | operator.read | 只按 grantId 查询；`targetTenant` 为空或调用方无租户时不过滤；没有列表方法     |
| `evolution.perception.query` / `.project` | `server-methods/evolution-perception.ts:96`  | operator.read | 失败关闭：无可信租户或请求体租户不一致时拒绝，否则只保留该租户事件与提案       |

- 这些读方法都不按受众、所有者或员工过滤，也不脱敏：同租户调用方能看到该租户全部提案（含 `sourceEvidenceRefs`）与 Ledger 事件。
- 没有任何现有 RPC 列出“企业待决事项”。

## 4. Delegation / Grant

- `src/diagnosis/delegation.ts`：角色 `platform | enterprise | employee`；场景 `platform_to_enterprise`、`platform_to_employee`、`enterprise_to_employee`；命令 request / approve / deny / revoke / suspend / resume / expire / consume。`AuthorizationGrant`（`:85`）绑定租户、`targetScope`（tenantId、targetType、targetId）、`allowedActions`、`allowedEvidence`、`expiresAt`。
- `enterprise_to_employee` 要求企业发起、员工审批并承接（`:367-378`、`:451-481`）。Gateway 没有接线。
- `evolution.delegation.request` / `.approve`（`evolution-delegation.ts:65-158`）固定使用 `platform_to_enterprise`，调用方自己请求、自己批准。
- 服务端判断“企业管理员对员工数字人有无委托”只在 apply / verify 写路径：`apply-authorization-live.ts:104` 用 agent registry 主所有者区分员工对象（`objectKind: "member"`，`:137`）与企业对象；`decideEvolutionApplyAuthorization`（`apply-authorization.ts:108`）要求企业管理员作用于员工对象时必须有覆盖的 grant（`:137`）。
- 没有读路径输出 `EvolutionDecisionRouteInput.ownership = { kind: "agent_enterprise", delegated }`。D3 把它当作服务端事实输入，本轮不实现产生它的读取器。

## 5. 平台变更影响企业时的 Canary 参与

- D1 router：平台端且 `platformFixAffectsEnterprise` 时给出 `participation: "enterprise_canary"`、`requiredAuthority: "platform_and_enterprise"`（`packages/evolution-core/src/decision-surface/router.ts:119-140`）。
- D1 authority：该约束下 `apply_canary`、`verify`、`promote` 需要 `enterpriseCanaryAcknowledged`；`participate_canary` 只允许企业主体，映射到 `evolution.delegation.approve`。
- D1 authority 的租户校验要求事项 `tenantScope` 等于企业租户。平台范围事项（`tenantScope: null`）企业不能参与，每个受影响企业需要一条本租户作用域的参与事项。
- D1 authority：跨租户重复路由只允许 hold / reject，`participate_canary` 为 `cross_tenant_mutation_forbidden`。
- D1 visibility 没有企业 Canary 参与视图：企业主体看平台端事项一律 `audience_mismatch` 省略。这是缺口，D3.2 处理。
- 控制面：canary 只是 application scope 与提案状态；诊断来源的 active apply 需要先有 canary（`evolution-control.ts:236-250`）。
- 服务端没有 `enterpriseCanaryAcknowledged`、`employeeFinalAuthorization`、`platformFixAffectsEnterprise` 的来源。

## 6. 员工最终授权在企业流程中的阻断点

- D1 router：企业侧所有权（`agent_enterprise`、`knowledge_enterprise`、`capability_enterprise_private`、`organization_enterprise`）在 `touchesEmployeePersonalAsset` 时给出 `participation: "employee_final_authorization"`、`requiredAuthority: "employee_and_enterprise"`。
- D1 authority：此类事项上 `start_experiment`、`apply_canary`、`promote`（以及不可用的 `authorize`、`approve_application`）在 `employeeFinalAuthorization` 为 false 时拒绝（`employee_authorization_required`）；hold / reject / rollback / verify 不受该门阻断。
- `employee_final_authorization` 不在企业端动作矩阵，企业不能代替员工授权（`endpoint_action_forbidden`）。
- 服务端对应：apply 写路径上员工对象需要 grant；`enterprise_to_employee` 场景要求员工审批，未接线。

## 7. 企业端可见性与脱敏边界（现状）

- D1 visibility：企业看企业端路由事项的完整 item（含 Evidence 引用、Finding、Case 与控制面 id），机密上限 `enterprise`；不校验 `enterpriseAdmin`，该校验在 authority。
- 员工最终授权路由到企业端时，D1 同样返回完整 item，没有企业侧脱敏视图。这与 D3 要求（员工个人事项只展示脱敏参与视图）不一致，D3.2 处理。
- 平台事项：企业不可见（见第 5 节）。
- 服务端读路径不脱敏。Gateway 进化生产者把 `confidentialityScope` 硬编码为 `enterprise`，没有生产者写 `personal`。

## 8. D3 明确不接 runtime 的范围

- 不新增 Gateway 读写 RPC，不接生产事实源。快照、授权事实与 Grant 视图由测试注入。
- 不调用控制面方法或 Adapter。提交只到 D1 judge：`writes = []`、`executed = false`、`effectProof = false`。
- `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED` 保持 false；不改 D2 运行门。
- 不修改 Perception、Mesh 页面行为、D4、E5.2、autoApply、`system.engineering-remediation`。

## 9. 拟挂载位置（D3.3 使用，本轮不编码）

- 首选：`enterprise-surfaces-core.ts:185-187` 的 `case "enterpriseMesh"`，在 `renderMeshGovernanceSurface` 之后按运行门追加独立元素 `<enterprise-evolution-decision-surface>`。Mesh 文件不改，做法与诊断页签挂载 light DOM 元素一致（`:188-198`）。
- 备选：设置 → 治理（`renderGovernanceSection`）的卡片区。
- 所有权：`enterprise-surfaces-core.ts` 与 `enterprise-mesh-governance-surface.ts` 由 `ops-decommission:kiro-enterprise-tsgo`（owner `cursor-daniel`）声明；`enterprise-access-control-surface.ts` 由 `enterprise-ai-model-governance:cursor-enterprise-model-gov`（owner `codex-enterprise-channels`）声明。D3.3 改挂载行之前，需要该 owner 移交路径或登记 sharedPaths，由人决定。2026-09-29 已决定，见 `enterprise-surface-contract.md` 第 10 节。
- 样式：企业全局样式文件由其他任务声明。D3.3 使用组件目录内的样式文件，由组件模块导入，不改共享 CSS。
- 新增路径（D3.3 提交时再签入）：`ui/src/ui/ports/enterprise/evolution-decision/**`、`ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.ts` 及其测试。
