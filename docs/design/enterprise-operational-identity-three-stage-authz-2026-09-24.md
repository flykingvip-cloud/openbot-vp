# 企业运营身份三阶段授权：现状对照与可执行优化方案

日期：2026-09-24

状态：设计文档。本轮不改运行时行为。

正式模型：企业身份准入 → Owner 授权委托 → 运行时执行裁决。

关键原则：前置校验限制授权如何产生；执行时校验确认授权现在仍有效。前置不能替代对可变安全状态的复验。

本文对照仓库当前实现，评估用户三阶段建议，并给出可落地的演进顺序。结论以代码为准，不把建议原文当作必须照抄的处方。

## 0. 结论

当前已经有两级对象，但第二级还不是可独立裁决的 Grant。

1. 企业上限是 `IdentityUsagePolicy`：按席位白名单动作，写在租户席位资产库。
2. 员工绑定是 `EmployeeEnterpriseIdentityEnrollment`：员工把某个企业身份启用给自己名下某个机器人。它有独立 id 和 `allowedActions`，但执行路径只检查「这个 identity 在不在 enrollment 列表里」，不拿 `allowedActions` 做交集。
3. 该机器人尚未有任何 enrollment 时，运行时明确退回「只看企业席位策略」。这就是未显式授权仍可执行的兼容语义，效果接近 `seat_inherit`，代码里没有这个枚举名。
4. 动作风险 `low | medium | high` 只存在于能力目录，执行路径不读它。
5. 协作 owner 是独立的 scope 来源，不是独立的委托对象。它复用 owner 席位上的同一套策略和 enrollment 门闩。
6. 席位解析、身份授权、模型与计费资格已经是不同模块。身份裁决本身不查账单或模型配额，但拒绝码把「没有策略」「动作不在白名单」「能力未发现」「员工没启用这个身份」折叠成同一个 `IDENTITY_ACTION_DENIED`。

立刻能提高安全边界、且不必推倒重来的改动只有两处，都应落在现有 `enforceOperationalIdentityRuntimeAccess`：

- 执行时对已存在的 enrollment 做动作交集，与列表路径对齐。
- 高风险动作在零 enrollment 时失败关闭，低、中风险暂时保留现有「未整理则席位策略生效」兼容。

不要在下一迭代把全租户默认改成 `explicit_owner_grant`。那会让今天靠席位策略直接跑通、且从未打开过绑定页的机器人全部失效。

## 1. 现状地图

### 1.1 数据流

```text
企业管理员
  HTTP  POST .../identity-policies/upsert
        requireEnterpriseAdminContext（membershipRole = enterprise-admin）
  写入  EnterpriseSeatAssetsStore.identityUsagePolicies
        类型 IdentityUsagePolicy
        校验 validateIdentityUsagePolicyInput
              席位属于本租户
              allowedActions 非空，且是 provider 的 operational 动作
              若身份已有 capabilities，动作必须落在已验证能力内
              data_sync 动作拒绝进入使用策略（改走 DataSourceIdentityBinding）

员工 / Owner
  UI    个人设置 → 授权 → 企业
        或机器人设置里的只读「企业身份绑定」+「前往授权页」
  RPC   enterprise-operational-identity.employee.authorize
        enterprise-operational-identity.employee.revoke
        enterprise-operational-identity.employee.enrollments
  写入  EnterpriseSeatAssetsStore.employeeIdentityEnrollments
        类型 EmployeeEnterpriseIdentityEnrollment
        前置  身份必须已对该席位开放、身份 status = active
        动作  整份复制席位策略的 allowedActions，员工不能再收窄

数字人执行
  入口  agents/tools/operational-identity-tool.ts
        action = list | resolve | execute
        身份来自回合 ExecutionIdentityContext，不读工具参数里的用户身份
  提示  auto-reply/reply/operational-identity-context.ts
        buildOperationalIdentitySystemPrompt
        → listOperationalIdentityRuntimeAccess
  裁决  enforceOperationalIdentityRuntimeAccess
        → executeEnterpriseOperationalIdentityRuntimeAction
        → executeEnterpriseOperationalIdentityAction
  协作  server-methods/chat.ts 在群回合写入
        CollaborationGroupOwnerEntitlement
        来源 resolveCollaborationGroupOwnerEntitlementScope
```

决策点按时间顺序是：

1. 企业策略能否被写出来（动作真实、席位存在、能力已发现）。
2. 员工能否创建 enrollment（席位目录里有这个身份，且身份仍 active）。
3. 回合能否解析出 tenant、seat、agent、employee（或协作 owner，或唯一 enrollment 回退）。
4. 当前策略是否仍允许这个 seat + action，身份是否仍 active，已发现能力是否仍包含该动作。
5. 若该机器人已有任意 enrollment，本次 identityId 必须在其中。零 enrollment 则跳过这一步。
6. 通过后才读凭证并调用 provider。凭证缺失和 provider 失败是执行错误，不是授权错误。

### 1.2 企业策略存什么、谁写、谁读

存储在 `EnterpriseSeatAssetsStore`（`src/gateway/enterprise-seat-assets-store.ts`）：

| 字段                          | 含义                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `enterpriseIdentities`        | 租户运营身份。`tenantId` 表示企业拥有该身份                                              |
| `identityUsagePolicies`       | 使用上限                                                                                 |
| `employeeIdentityEnrollments` | 员工把身份启用到机器人                                                                   |
| `dataSourceIdentityBindings`  | 数据源同步绑定，purpose 为 `source_authentication` / `source_collection` / `source_sync` |
| `credentialBindings`          | 凭证。steward 从这里解析，不在身份策略上                                                 |
| `auditEvents`                 | 身份注册、绑定、使用、拒绝                                                               |

`IdentityUsagePolicy`（`src/gateway/enterprise-operational-identity-types.ts`）字段：

- `policyId`、`tenantId`、`identityId`
- `seatIds`：开放到哪些席位
- `allowedAgentIds`：遗留字段。HTTP upsert 固定写成 `[]`。`resolveIdentityUsagePolicyForSeatAgent` 明确不再用它做运行时门闩
- `allowedActions`：显式非空白名单
- `enabled`、`createdAt`、`updatedAt`

没有 `delegationMode`、`collaborationMode`、`actionRules`、`policyVersion`，也没有部门或角色范围。组织范围就是席位 id 列表。

谁写：

- `handleEnterpriseOperationalIdentityHttpRequest` 中 `POST .../identity-policies/upsert`
- `requireEnterpriseAdminContext` 要求平台登录、租户成员、且 `membershipRole === "enterprise-admin"`
- 实现：`upsertIdentityUsagePolicy`

谁读：

- 管理端目录：`GET .../identities` 返回 policies、employeeEnrollments、bindingActivity
- 员工端席位目录：`enterprise-operational-identity.access.list-for-seat`
- 员工端某机器人：`enterprise-operational-identity.access.list-for-seat-agent`
- 执行：`resolveOperationalIdentityAccess` → `resolveIdentityUsagePolicyForSeatAgent`

策略是活数据。执行时重新读 store，不信任模型提示里的列表。策略被禁用、席位移出、动作被拿掉，下一次 execute 会失败。这是已经做到的执行期复验。

### 1.3 Owner 授权是不是显式 Grant

企业路径不是 Grant 对象。它是 enrollment。

`EmployeeEnterpriseIdentityEnrollment`：

- `enrollmentId`、`tenantId`、`employeeId`、`agentId`、`identityId`、`allowedActions`、时间戳
- 注释写明：只能在企业放行范围内按机器人启停，不能扩权
- 撤销是删除记录（`removeEmployeeEnterpriseIdentityEnrollment`），没有 `status` / `revokedAt` / `grantMode` / `policyVersionAtGrant`

创建时 `enrollEmployeeEnterpriseIdentity`：

- 禁止 enrollment 回退（`allowEnrollmentFallback: false`），必须有已认证员工上下文
- 用 `listOperationalIdentityAccessForSeat` 检查身份对该席位开放
- 把席位目录上的全部 `allowedActions` 复制进 enrollment
- 不校验调用者是否拥有该 agent，agent 来自已解析的 scope
- 注释写「席位 + agent 已放行」，实现只检查席位。`allowedAgentIds` 已不再参与门闩

员工 UI 也是身份级绑定，不是动作级委托：

- `ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts`：勾选机器人后调用 `onApplyEnterpriseIdentityRobots`
- `ui/src/ui/controllers/user-operational-identity.ts` 的 `applyEnterpriseIdentityRobotBindings` 对差集调用 `employee.authorize` / `employee.revoke`
- 机器人抽屉 `workbench-robot-operational-identity-panel.ts` 对企业身份只读，文案指向「个人设置 → 授权 → 企业」

个人运营身份是另一套，已经有显式 Grant，不要和本文的企业对象混名：

- `UserOperationalIdentityGrant`（`src/gateway/user-operational-identity-types.ts`）
- `grantMode`: `auto | explicit`
- `owned` 机器人强制 `auto`，非 owned 强制 `explicit`
- 运行时入口是 `enforceUserOperationalIdentityRuntimeAccess`，与企业 `enforceOperationalIdentityRuntimeAccess` 分开

所以：企业 Owner 授权「有独立记录」，但语义是「启用哪个身份给哪个机器人」，不是「代表我做哪些动作」的可版本、可部分撤销 Grant。

### 1.4 运行时实际检查什么

`resolveOperationalIdentityRuntimeScopeDecision` 的优先级：

1. 已钉住的员工会话（`hasPinnedEmployeeSessionContext`）。解析失败则直接拒绝，不降级到 enrollment，也不改用 owner 席位。
2. 显式 `collaborationOwnerEntitlement`（tenant、seat、employee、agent 都齐全）→ source = `collaboration-owner`。
3. 没有员工会话、且允许回退、且 agentId 唯一对应一个 tenant + employee 的 enrollment → source = `enrollment`。歧义则 `ENROLLMENT_AMBIGUOUS`。
4. 否则 `IDENTITY_CONTEXT_MISSING`。

scope 拒绝码（`OperationalIdentityScopeDenialCode`）已经分开：

- `IDENTITY_CONTEXT_MISSING`
- `TENANT_CONTEXT_MISSING`
- `MEMBERSHIP_INVALID`
- `TENANT_MISMATCH`
- `NO_CURRENT_SEAT`
- `AGENT_NOT_ENROLLED`
- `ENROLLMENT_AMBIGUOUS`

这些是主体和席位上下文，不是模型配额，也不是账单。

`resolveOperationalIdentityAccess` 在 scope 成功后检查：

- `seatId` 与 `agentId` 都非空，否则 `SEAT_AGENT_REQUIRED`
- 刷新身份状态；不存在或已撤销 → `IDENTITY_NOT_FOUND`
- `status !== active` → `IDENTITY_INACTIVE`
- 当前启用策略覆盖该 seat 且包含该 action，否则 `IDENTITY_ACTION_DENIED`
- 若 `identity.capabilities` 非空且不含该 action → 仍是 `IDENTITY_ACTION_DENIED`

然后 `enforceOperationalIdentityRuntimeAccess` 加 enrollment 门闩：

```text
若该 employee + agent 的 enrollment 数量为 0：
  企业策略单独生效
若数量 > 0 且没有任何一条的 identityId 等于本次身份：
  IDENTITY_ACTION_DENIED，「该机器人未被员工启用此企业身份。」
若 identityId 命中：
  不再看 enrollment.allowedActions
```

列表路径 `applyEmployeeEnrollmentGate` 更严：enrollment 为空则原样返回席位条目；非空则按 identity 过滤，并与 enrollment.`allowedActions` 求交。

因此列表和执行不一致。员工或后台若把某 enrollment 的动作收窄，或策略事后扩大，UI 列表会变窄，execute 仍按当前策略放行。今天的授权 API 会在绑定时复制整份席位动作，所以「收窄」主要来自后续策略扩大，或直接改存储。这仍然是执行期漏洞：enrollment 上的动作字段不是执行裁决的输入。

工具入口 `createOperationalIdentityTool` 的 list / resolve / execute 都走上述函数。`resolve` 调用 `enforceOperationalIdentityRuntimeAccess`，`execute` 调用 `executeEnterpriseOperationalIdentityRuntimeAction`（内部再次 enforce，且 `audit: false`，避免授权审计和执行审计各写一条）。

### 1.5 未 enrollment 时的隐式继承

存在，而且是注释写明的兼容行为，不是疏忽遗漏的分支。

`enforceOperationalIdentityRuntimeAccess` 与 `applyEmployeeEnrollmentGate` 都写了同一句话：该机器人还没有任何企业身份 enrollment 时，企业策略单独治理。

触发条件是「这个 employee + agent 的 enrollment 数组长度为 0」，不是「这个身份没有 enrollment」。只要员工给该机器人启用过任意一个身份，其他未启用身份就会被关掉。从未打开绑定页的机器人，则席位策略中的全部身份和动作都可执行。

高风险动作没有例外。`publish_article`、`broadcast_article`、`schedule_meeting`、`cancel_meeting` 在能力目录里是 `high`，零 enrollment 时一样能过策略。

后台 cron / 只有 owner 邮箱、没有钉住成员关系的回合，不会走这条隐式继承，除非它能唯一解析到已有 enrollment（source = `enrollment`）。唯一 enrollment 一旦存在，门闩只放行已登记身份。隐式继承主要打击的是：交互式员工回合和协作 owner 回合里，席位持有人从未做过绑定。

### 1.6 席位、模型、计费有没有混进身份授权

混在「席位是谁」这一层，没有混在「能不能调用模型、有没有额度」这一层。

身份裁决使用席位的方式：

- 策略主体是 `seatIds`
- scope 必须解析出 `seatId`，否则 `NO_CURRENT_SEAT`
- 协作把群 owner 的 `positionId` 或空间资产绑定上的 seat 当作执行席位

身份裁决不调用账单、套餐、模型路由。`executeEnterpriseOperationalIdentityAction` 在授权通过后只检查凭证密钥（`IDENTITY_001`）和 provider 执行（失败 `IDENTITY_005`）。模型选择在 agent run 的其他路径。个人身份 Grant 与企业 enrollment 分 store、分 enforce 函数。

需要拆开的是错误语义，不是再造一套计费门闩：`NO_CURRENT_SEAT` 是成员席位解析失败；`IDENTITY_ACTION_DENIED` 今天同时表示策略拒绝和员工未启用。产品和排障不能从 code 判断该找管理员改策略，还是找员工去绑定。

### 1.7 协作路径

协作 owner 与普通身份授权是分开的 scope，不是分开的 Grant。

产生：

- `resolveCollaborationGroupOwnerEntitlementScope`（`src/gateway/collaboration-learning/steward-group-policy.ts`）
- 优先读 group 的 ownership 记录：`tenantId` + `positionId` 作为 seat，`currentManagerUserId` 作为 employee
- 没有 ownership 记录时，回退到该群空间资产的 active seat 绑定
- `server-methods/chat.ts` 把结果放进 `CollaborationGroupOwnerEntitlement`
- `get-reply-run.ts` 写入 `ExecutionIdentityContext.collaborationOwnerEntitlement`
- 文件头注释说明：群 bot 回合的 entitlement / credits 归属群 owner 席位。这是资源归属，不是一份动作委托

消费：

- `operational-identity-tool.ts`、`meeting-tool.ts` 把该字段传给企业身份 runtime
- 说话成员的成员关系会先被复验；成员无效时不允许改用 owner 席位（测试 `does not substitute owner entitlement after an invalid employee context`）
- owner 的席位和成员关系不在 scope 函数里再次查活。只要 entitlement 四元组非空，source 就是 `collaboration-owner`
- 之后的策略、身份状态、enrollment 门闩按 owner 的 tenant、seat、employee、当前 agent 再查一次

没有 `CollaborationIdentityDelegation`。群机器人能做的动作等于 owner 在该席位上的策略，再经过 owner 对该 agent 的 enrollment 门闩。owner 自己从未绑定过时，群回合同样吃到隐式席位继承。

协作模式字符串（`collaborationMode = task_driven | discussion_driven | ...`）属于协作空间配置，和运营身份策略无关。

### 1.8 风险等级

`OperationalIdentityActionRisk = low | medium | high` 定义在 `src/gateway/enterprise-operational-identity-providers/provider-capability-registry.ts`。

文件注释：供策略设计与后续审批扩展使用；v1 不强制 UI 展示。

P0 注册表里，公众号 `publish_article` / `broadcast_article`、腾讯会议 `schedule_meeting` / `cancel_meeting` 为 high。未单列的 provider 由 adapter 的 operational 动作回填，风险默认 `medium`。

`enrichOperationalIdentityCapabilities` 把 risk 放进管理端能力视图。`validateIdentityUsagePolicyInput`、`resolveOperationalIdentityAccess`、`enforceOperationalIdentityRuntimeAccess` 都不读 risk。运行时不存在按风险升级授权强度、要求审批、或失败关闭。

### 1.9 凭证维护者（steward）与所有权

企业身份的所有权是租户：`EnterpriseIdentity.tenantId`。

凭证维护者是另一字段，从 `credentialBindings.ownerType` 解析：

- `resolveEnterpriseIdentitySteward` 返回 `{ kind: "seat" | "employee", ownerId }`
- 管理端目录展示 `stewardLabel`，文案是「保存凭证时绑定的岗位及在岗成员」或「保存凭证的企业成员」

这还不是建议里的 ownership vs custodian 模型。steward 表示凭证绑在岗位还是员工，不表示「谁有权维护凭证、谁有权被委托使用」两套主体。使用范围仍只看 `IdentityUsagePolicy.seatIds`。

### 1.10 错误码与审计

授权与执行码今天混在一条链上，没有 stage、retryability、remediation。

| 层次       | 现状 code                                                                                                                                                                                              | 缺口                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 企业写策略 | `ENTERPRISE_IDENTITY_SEAT_REQUIRED`、`SEAT_NOT_FOUND`、`ACTIONS_REQUIRED`、`ACTION_UNSUPPORTED`、`ACTION_SYNC_ONLY`、`CAPABILITY_NOT_DISCOVERED`、`AGENT_NOT_IN_SEAT`、`NOT_FOUND`、`POLICY_FORBIDDEN` | 有 code，无 stage / 重试性 / 修复指引 |
| 管理 HTTP  | `ENTERPRISE_IDENTITY_ADMIN_REQUIRED`、`UNAUTHORIZED`、`TENANT_FORBIDDEN`                                                                                                                               | 仅管理面                              |
| 员工绑定   | `ENTERPRISE_IDENTITY_NOT_PERMITTED`、`IDENTITY_INACTIVE`、`IDENTITY_REQUIRED`，以及 scope 拒绝码                                                                                                       | 绑定失败和执行失败共用部分 code       |
| 执行主体   | 第 1.4 节的 scope 拒绝码                                                                                                                                                                               | 已分层，质量较好                      |
| 执行授权   | `IDENTITY_NOT_FOUND`、`IDENTITY_INACTIVE`、`IDENTITY_ACTION_DENIED`、`SEAT_AGENT_REQUIRED`                                                                                                             | `IDENTITY_ACTION_DENIED` 过宽         |
| provider   | `IDENTITY_001` 缺凭证，`IDENTITY_005` 执行失败                                                                                                                                                         | 与授权码命名体系不同                  |

审计事件类型（`EnterpriseAssetAuditEventType`）已有：

- `identity.registered` / `verified` / `reauthorized` / `revoked`
- `identity.bound` / `unbound`：策略绑定和员工 enrollment 共用。enrollment 靠 `metadata.scope = "employee-enrollment"` 区分
- `identity.used` / `identity.usage_denied`

事件字段：`auditEventId`、可选 `auditId`、`tenantId`、`actorEmployeeId`、`eventType`、可选 `seatId`、`policyId`、`resourceType`、`resourceId`、`metadata`、`createdAt`。

使用成功的 metadata 有 `agentId`、`action`、`result`。拒绝有 `code`、`message`。没有 `grantId` / `enrollmentId`、`policyVersion`、scope source、risk、stage。

scope 解析失败（还没进入 enforce 的审计分支之前的部分路径）不一定写 `identity.usage_denied`。`execute` 在 enforce 时把 `audit` 关掉，成功与 provider 失败由 `executeEnterpriseOperationalIdentityAction` 另记。授权拒绝若走 execute 入口，可能没有授权审计行，只有调用方拿到的 code。这是审计链缺口，不是「完全没有审计」。

### 1.11 能力真实性

这一段已经对齐建议，应保留。

- `isOperationalIdentityPolicyAction` 只接受 adapter 里 `kind === "operational"` 的动作
- `data_sync` 不能写入使用策略，必须走 `DataSourceIdentityBinding`
- 身份 verify 之后若带 `capabilities`，策略写入和执行都会再对这张清单求交
- `capabilities` 为空时执行放行（尚未发现过的历史身份）。这是兼容，不是「未验证即拒绝」

## 2. 可行性评估

对照用户三阶段建议。判定只使用：已对齐、部分对齐、缺口、建议调整。

### 2.1 第一阶段：企业身份准入

| 建议                                                                     | 判定     | 依据                                                                                                     |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| 企业管理员决定身份属于谁、开放到哪些组织范围                             | 部分对齐 | 管理员写入策略；范围是 `seatIds`，不是部门或角色                                                         |
| ownership（企业）与 custodian（凭证维护人）分离                          | 部分对齐 | 租户拥有身份；steward 已表示凭证绑定主体。二者未进入同一策略对象，也未限制「custodian 不能扩大使用范围」 |
| `allowedActions` 只能是 provider 真实支持的动作                          | 已对齐   | `validateIdentityUsagePolicyInput` + `isOperationalIdentityPolicyAction`                                 |
| 数据同步与运营动作分开                                                   | 已对齐   | `ENTERPRISE_IDENTITY_ACTION_SYNC_ONLY`                                                                   |
| 已验证能力作为上限                                                       | 已对齐   | 有 capabilities 时写入和执行都求交；空 capabilities 仍放行                                               |
| `delegationMode` / `collaborationMode` / `actionRules` / `policyVersion` | 缺口     | 类型上不存在。协作模式是另一个产品对象，不应塞进身份策略                                                 |
| 企业输出是后续只能缩小的上限                                             | 部分对齐 | 执行会重读当前策略，所以策略收紧立即生效。策略扩大也会立即生效，员工 enrollment 的动作快照挡不住 execute |

建议调整：第一阶段继续以席位为开放范围，不要在同一迭代引入部门、角色和 `actionRules`。席位已经是企业侧执行主体（见既有 V1 拆解里的原则：Seat 是权威执行主体，Agent 只是消费别名）。部门映射可以以后从席位反查，不必变成第二套主体。

`policyVersion` 值得加，但是单调整数即可，不必先做完整策略快照存储。

### 2.2 ownership 与 custodian 能否渐进引入

能，而且应该渐进。不要把 steward 重命名成 custodian 后当作新模型。

建议的渐进含义：

- ownership 保持 `EnterpriseIdentity.tenantId`。企业管理员管理目录和上限。
- custodian 保持现有 steward：谁的凭证绑定在维护这个外部账号。展示已经有了。
- 使用委托继续是席位政策 + 员工 enrollment，不把 custodian 自动变成可以使用该身份的人。
- 后续若需要「凭证维护人 ≠ 在岗使用者」，只给 steward 增加显式员工 id，并禁止该身份在策略写入时被 custodian 单独扩大 `seatIds`。这是管理面约束，不是运行时新对象。

现在就把 custodian 写成策略一等字段，会和 `credentialBindings.ownerType = seat | employee` 双写，迁数据时对不齐。

### 2.3 第二阶段：Owner 授权与 Grant 映射

| 建议                                                                            | 判定                   | 依据                                                                                                                                                |
| ------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 显式、可撤销、可审计、可版本化的 `AgentOperationalIdentityGrant`                | 部分对齐               | enrollment 可撤销、有审计，但删除即消失，无版本，执行不消费动作列表                                                                                 |
| 资格：认证用户、成员、租户、席位在范围内、允许自主委托、agent 归属、动作 ⊆ 策略 | 部分对齐               | 认证、租户、席位、身份 active、席位已开放已检查。没有「策略是否允许自主委托」。agent 归属依赖 scope，不单独证明。动作是整份复制，不是员工选择的子集 |
| 按风险决定授权强度                                                              | 缺口                   | risk 不参与绑定或执行                                                                                                                               |
| 默认 `explicit_owner_grant`，不要默认 `seat_inherit`，尤其高风险                | 缺口                   | 零 enrollment 等于席位策略直接生效，且不分风险                                                                                                      |
| 未 enrollment 时席位策略直接生效                                                | 已对齐（作为问题描述） | 见第 1.5 节。这是现状，不是目标                                                                                                                     |

`AgentOperationalIdentityGrant` 与现有结构的映射：

| Grant 字段（建议）   | 现有落点                  | 处理                                             |
| -------------------- | ------------------------- | ------------------------------------------------ |
| grant 身份           | `enrollmentId`            | 保留 id，不必立刻换存储键                        |
| subject              | `employeeId` + `tenantId` | 已有                                             |
| agent                | `agentId`                 | 已有                                             |
| identity             | `identityId`              | 已有                                             |
| actions              | `allowedActions`          | 已存储，执行未使用。P0 先使用它                  |
| status               | 无，删除即撤销            | P1 再加 `active \| revoked`，避免审计对不上历史  |
| grantMode            | 无                        | P1 增加。存量零 enrollment 不能直接当成 explicit |
| policyVersionAtGrant | 无                        | 依赖策略先有 `policyVersion`                     |
| risk ceiling         | 无                        | 执行时读能力目录，不必先存一份会过期的副本       |

不建议新建平行集合 `agentOperationalIdentityGrants` 再双写。下一迭代把 enrollment 扩展为 Grant 语义，读路径继续认 `employeeIdentityEnrollments`。新名字可以出现在类型别名和 API 文档里，存储键保持不动，避免迁移窗口里两份授权同时生效。

个人身份的 `UserOperationalIdentityGrant` 不要被这次企业改造复用。它的 `auto` 模式含义是「自有机器人自动授权」，和企业席位继承不是同一件事。硬合成一个类型会把个人邮箱和公众号企业号的撤销语义绑死。

### 2.4 默认改成 explicit_owner_grant 的兼容性

不适合作为无开关的默认切换。

今天依赖隐式继承的回合：

- 员工已登录、席位策略已开放、该机器人 enrollment 为空
- 协作群 owner 席位已开放、owner 对该机器人 enrollment 为空

这些回合现在返回允许。改成「没有 Grant 就拒绝」后，同一请求变成拒绝。没有数据迁移能把「从未绑定」补成「用户已经同意」，因为同意没有发生过。

可行的兼容策略：

1. 存量租户的委托模式记为 `seat_inherit_until_curated`（名字表达现状：一旦有过整理，就只认 enrollment）。这不是新的安全目标，是迁移档。
2. 高风险动作立即要求命中 enrollment，不受该档保护。这是行为变化，但是收紧，而且只覆盖目录里标为 high 的动作。
3. 新写入的策略或管理员显式切换，才使用 `explicit_owner_grant`。切换前给出「尚未绑定的机器人将不能再调用」的列表，数据已在 `employeeIdentityEnrollments` 和席位策略的差集里，可以算出来。
4. 低、中风险在管理员切换前保持现状。避免一次发布把查询类动作（`list_meetings`、`get_publish_status`）和发布类动作一起打断。

因此建议调整用户原文的「默认 explicit」：默认目标成立，落地顺序是「高风险先 explicit，其余按租户开关迁移」，不是下一次发布全局翻默认。

### 2.5 第三阶段：运行时四组条件

| 组                                    | 判定     | 说明                                                                                                                 |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| A. Grant / 主体                       | 部分对齐 | scope source 已区分 employee、collaboration-owner、enrollment。Grant 动作集合未参与 execute                          |
| B. 租户与成员状态                     | 已对齐   | 钉住的员工会话会复验；无效成员不会降级。协作 owner 本身不再次复验成员是否仍在职                                      |
| C. Seat / 模型 / 费用分开建模与错误码 | 部分对齐 | 模型与费用本来就不在这个函数里。席位同时是身份范围和执行主体。错误码未把「席位资格」和「身份动作」分开到可操作的程度 |
| D. 动作风险                           | 缺口     | 目录有风险，裁决没有                                                                                                 |

ALLOW 公式今天近似为：

```text
身份存在且 active
∧ 当前席位策略包含该 action
∧ （capabilities 为空 ∨ action ∈ capabilities）
∧ （该机器人无 enrollment ∨ identityId ∈ enrollments）
```

目标公式应为：

```text
身份存在且 active
∧ 企业策略仍包含该 action
∧ （capabilities 为空 ∨ action ∈ capabilities）   // P1 再考虑空清单改为失败关闭
∧ owner grant 仍 active 且 action ∈ grant.allowedActions
∧ 以上三者交集非空
∧ 高风险还要求 grant 为显式，且成员/策略版本仍有效
```

企业身份 → 企业策略 → Owner Grant → 本次请求，只能缩小。今天策略扩大可以绕过 Grant 快照，所以「只能缩小」在 execute 上不成立。

### 2.6 身份授权与资源资格拆分

建议的拆分方向正确，而且大部分边界已经存在，缺的是拒绝码和产品文案，不是新的计费实现。

保持独立：

- 企业运营身份：本文的策略 + enrollment + `operational_identity` 工具
- 个人运营身份：`UserOperationalIdentityGrant`
- 企业数据调用：既有注释与 `assertNoOperationalIdentityExecutionElevation` 已经禁止把运营身份字段塞进数据 invoke。提示语也写明 operational identity access 不提升企业数据调用
- 模型与商业配额：不进 `resolveOperationalIdentityAccess`

P0 不要把 seat 配额、模型路由失败映射进 `IDENTITY_*`。若调用栈上游已经有商业拒绝，保持原 code。身份模块只对自己的拒绝负责。

### 2.7 policyVersion、EffectiveActions、TOCTOU

| 机制                                 | 判定     | 说明                                                                                                                           |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 执行时重读策略与身份状态             | 已对齐   | 每次 enforce 加载 store 并 `refreshEnterpriseIdentityStatus`                                                                   |
| 撤销优先于缓存                       | 部分对齐 | 策略禁用和身份撤销会在下一次 enforce 生效。模型系统提示里的列表是回合开始时的投影，真正执行不信它。enrollment 删除同样立即生效 |
| EffectiveActions = 交集              | 缺口     | 列表路径有交集，执行路径没有                                                                                                   |
| policyVersion / policyVersionAtGrant | 缺口     | 无法回答「授权时看到的是哪一版策略」                                                                                           |
| 高风险失败关闭                       | 缺口     | 高风险与低风险同一条路径                                                                                                       |
| 协作 owner 活体复验                  | 缺口     | 说话人会复验；owner 席位来自回合开始时的 entitlement，执行时不再核对 owner 是否仍是该群 owner、席位是否仍绑定该员工            |

TOCTOU 里已经做对的部分不要重做缓存层。权威复验应继续是短路径：execute 前再读策略、身份状态、grant。不要为了版本号引入授权结果缓存。

`policyVersion` 的最小用法：策略每次实质变更（seat、actions、enabled）加一。Grant 记录授权当时的版本。执行时若当前版本更高，EffectiveActions 仍取交集，不把旧 Grant 放大；若需要员工重新确认，只对高风险且动作集合变大时要求新 Grant。动作集合变小不需要重新确认。

### 2.8 错误分层与审计链

建议的三层（enterprise_policy / owner_grant / runtime）可以落在现有 code 上，不必换成新的传输信封。

建议调整：保留现有机器码，增加稳定的 `stage` 字段，而不是把已有 code 全部改名。Gateway 的 `details.code` 已被 UI 和测试使用（例如 `enterprise-operational-identity.denial-code.test.ts` 断言 `IDENTITY_ACTION_DENIED`）。

分层目标：

- `enterprise_policy`：身份不存在、未激活、策略未覆盖、能力未发现、管理员未开放
- `owner_grant`：未绑定、绑定已撤销、动作不在 Grant 内、高风险要求显式授权
- `runtime_subject`：现有 scope 拒绝码
- `runtime_execution`：`IDENTITY_001`、`IDENTITY_005`，以及 provider 业务失败

每条对外拒绝补三样，先从身份工具的 JSON 结果做起，不要求所有旧 HTTP 一次性改完：

- `stage`
- `retryable`：成员暂时解析失败可为 true；策略拒绝和未授权为 false
- `remediation`：短文案，例如「请企业管理员在身份策略中开放该席位」或「请在个人设置的企业身份里绑定此机器人」

审计补齐优先于新事件类型。沿用 `identity.used` 与 `identity.usage_denied`，metadata 增加 `stage`、`enrollmentId`、`policyVersion`、`scopeSource`、`risk`。策略写入与员工绑定继续共用 `identity.bound` 时，必须一直带 `metadata.scope`，否则无法分清是管理员改上限还是员工改绑定。

## 3. 最终可执行优化方案

优先级按「先收紧现有裁决，再扩展数据，最后再做委托模式和协作专用对象」。每一项都可以单独回滚。

### P0. 执行期与列表期使用同一套有效动作，高风险不再隐式继承

目标：不新增授权对象。已绑定机器人的动作以「当前策略 ∩ enrollment.allowedActions ∩ capabilities」为准。高风险动作在没有匹配 enrollment 时拒绝。

成功标准：

- 对已有 enrollment，execute 不再放行 enrollment 动作列表之外的 action，即使当前策略后来扩大了。
- 策略收紧后，execute 与列表现有行为一样立即收紧。
- `publish_article`、`broadcast_article`、`schedule_meeting`、`cancel_meeting` 以及注册表里其他 `risk === "high"` 的动作，在该 employee + agent + identity 没有 enrollment 时返回拒绝。
- 低、中风险且该机器人零 enrollment 时行为与现在相同。
- 个人身份 Grant、数据 invoke、模型路由的拒绝码不变。

拟改模块：

- `src/gateway/enterprise-operational-identity-runtime.ts`
  - `enforceOperationalIdentityRuntimeAccess`
  - 抽出与 `applyEmployeeEnrollmentGate` 共用的交集函数，避免列表和执行再分叉
- `src/gateway/enterprise-operational-identity-providers/provider-capability-registry.ts`
  - 只读 `listOperationalIdentityCapabilityRegistry` 的 `risk`
  - 不把默认 `medium` 的回填动作误判成 high
- 测试：
  - `src/gateway/enterprise-operational-identity-runtime.scope.test.ts`
  - `src/gateway/enterprise-operational-identity-runtime.identity-context.test.ts`
  - `src/gateway/enterprise-operational-identity-access.test.ts`
  - 补一条「策略扩大后 execute 仍受 enrollment 动作限制」
  - 补一条「high 且零 enrollment 拒绝，low 且零 enrollment 仍允许」

数据模型：无。不改 `IdentityUsagePolicy` 与 enrollment 的持久化形状。

API 与文案：

- 新增拒绝码，不要复用笼统的 `IDENTITY_ACTION_DENIED`：
  - `OWNER_GRANT_ACTION_DENIED`：identity 已绑定，但动作不在 enrollment 与策略的交集里
  - `OWNER_GRANT_REQUIRED`：高风险且没有 enrollment
- `stage` 先只加在工具 JSON 与 gateway respond 的 details 里，旧 code 仍保留给非高风险的策略拒绝
- 员工端文案：高风险拒绝时指向「个人设置 → 授权 → 企业」。不要写成「未登录」或「席位为空」
- 管理端不必改策略编辑器

测试与审计：

- 高风险拒绝写 `identity.usage_denied`，metadata 带 `risk: high` 与新 code
- 交集拒绝同样写 usage_denied，带 `enrollmentId`
- 回归：协作 owner 在说话人成员无效时仍不能替换席位；唯一 enrollment 歧义仍是 `ENROLLMENT_AMBIGUOUS`

风险与回滚：

- 风险：已经在用高风险动作、但从未绑定的机器人会开始失败。这是有意收紧。发布说明要列出这四个已注册 high 动作，以及「未在注册表中的动作默认 medium，不受这条新规则影响」。
- 回滚：恢复 enforce 里的门闩条件即可，无数据迁移。

这就是「先改什么能立刻提高安全边界而不推倒重来」。

### P1. 把 enrollment 补成可版本的显式 Grant，并用租户开关退出隐式继承

目标：新的委托默认显式；存量租户不因升级被一次性打断。Grant 仍存储在 `employeeIdentityEnrollments`。

成功标准：

- 策略具备单调 `policyVersion`。只在 seatIds、allowedActions、enabled 变化时增加。
- enrollment 增加可选字段：`status`、`grantMode`、`policyVersionAtGrant`。旧记录缺字段时，`status` 视为 active，`grantMode` 视为存量兼容，不视为 explicit。
- 员工重新保存绑定会把 `grantMode` 写成 `explicit`，并记下当时的 `policyVersion`。
- 租户级 `delegationMode` 缺省为 `seat_inherit_until_curated`。管理员切到 `explicit_owner_grant` 后，低、中风险也同样要求 enrollment。
- 切换前 API 能返回「策略已开放但没有任何 enrollment 的 agent 列表」，供管理端确认。

拟改模块：

- 类型：`src/gateway/enterprise-operational-identity-types.ts` 的 `IdentityUsagePolicy`、`EmployeeEnterpriseIdentityEnrollment`
- 写入：`upsertIdentityUsagePolicy`、`upsertEmployeeEnterpriseIdentityEnrollment`、`enrollEmployeeEnterpriseIdentity`
- 存储归一：`src/gateway/enterprise-seat-assets-store.ts` 的加载路径。缺字段只在读取时补默认，不强制重写全部租户文件
- 管理 HTTP：`src/gateway/enterprise-operational-identity.ts` 的 policy upsert 与 identities 列表
- 员工 RPC：`src/gateway/server-methods/enterprise-operational-identity.ts`
- 执行：`enforceOperationalIdentityRuntimeAccess` 读取 `delegationMode`
- 管理 UI：企业身份策略区增加委托模式，不在本文件展开视觉稿
- 员工 UI：仍可先保持「按身份选机器人」。动作级勾选不是 P1 的门槛；P1 的 explicit 指「必须有绑定记录」，不是「每个动作单独勾选」

数据模型与迁移：

- 全部新字段可选，旧 JSON 仍可加载
- 不新建第二份 grant 表
- 不把历史删除的 enrollment 重放为 revoked。没有墓碑就不要编造
- `allowedAgentIds` 继续只读忽略，不要在这次又把它接回运行时

API 与文案：

- 策略响应增加 `policyVersion`、`delegationMode`
- 员工 authorize 响应增加 `enrollmentId`、`grantMode`
- 管理端文案用「开放范围」和「允许员工自行绑定」，不要引入 seat_inherit 这个内部词
- 员工端继续用「绑定」，内部字段可以叫 grant

测试与审计：

- 版本增加只发生在实质变更
- 显式模式租户：零 enrollment 的低风险动作也被拒绝，code 为 `OWNER_GRANT_REQUIRED`
- 兼容模式租户：P0 的高风险行为保持，低风险零 enrollment 仍允许
- 审计 metadata 写入 `policyVersion` 与 `grantMode`
- 策略扩大后，旧 explicit grant 的 EffectiveActions 不得变大

风险与回滚：

- 风险在开关本身。默认保持兼容档，则未点击开关的租户只有 P0 的高风险变化。
- 回滚开关值即可回到兼容档。已写入的可选字段留在记录里无害。
- 不要用一次全局迁移把空 enrollment 写成拒绝。

### P2. 主体复验补齐、错误分层收口、协作委托与身份对象分开

目标：执行时对可变安全状态再确认一次；协作若需要比 owner 日常使用更窄的动作，用独立委托，不把群策略塞进普通 enrollment。

成功标准：

- execute 前对协作回合重新解析 owner 席位。owner 不再是该群 owner，或席位绑定已失效，则拒绝，code 属于 `runtime_subject`，不得落到 `IDENTITY_ACTION_DENIED`。
- 身份工具与 `enterprise-operational-identity.execute` 的拒绝体都带 `stage`、`retryable`、`remediation`。旧 `code` 保持。
- `identity.usage_denied` 覆盖 scope 失败和授权失败，而不只覆盖已经进入 `resolveOperationalIdentityAccess` 的失败。
- 只有在产品要求「群机器人的动作小于 owner 本人绑定」时，才新增协作委托记录。在那之前，协作继续走 owner 的 Grant，外加 P2 的活体复验。

拟改模块：

- `src/gateway/collaboration-learning/steward-group-policy.ts`：抽出可在执行期再调用的 owner 解析
- `src/gateway/enterprise-operational-identity-runtime.ts`：协作 source 上强制复验
- `src/gateway/server-methods/enterprise-operational-identity.ts` 与 `src/agents/tools/operational-identity-tool.ts`：统一拒绝体
- `src/gateway/enterprise-operational-identity-access.ts`：审计 metadata
- 协作委托若开工，新类型放在企业身份类型文件旁，并单独存储键，例如 `collaborationIdentityDelegations`。不要给普通 enrollment 加 `groupId` 可选字段，否则一条记录会同时表示两种委托

数据模型：

- P2 的主体复验和错误分层可以零结构变更
- 协作委托一旦存在，字段至少包括：`delegationId`、`tenantId`、`groupId`、`ownerEmployeeId`、`agentId`、`identityId`、`allowedActions`、`status`、`policyVersionAtGrant`
- 它的 EffectiveActions 仍是企业策略 ∩ owner 自己的 Grant ∩ 协作委托。协作委托不能超出 owner 本人已被允许的动作

API 与文案：

- 拒绝文案按 stage 分流。主体失败不提示去改身份策略；策略失败不提示重新登录
- 员工端机器人页继续区分「企业身份」和「我的个人身份」。协作委托如果出现，入口在群设置，不在个人授权页

测试与审计：

- 回合中途撤销群 ownership 后，下一次 execute 失败
- 说话人成员失效的现有测试保持
- 审计能用 `scopeSource = collaboration-owner` 过滤
- 不把模型错误、额度错误写入 `identity.usage_denied`

风险与回滚：

- owner 复验可能让长会话在群主变更后失败。这是目标行为。回滚即不再二次解析。
- 协作委托对象可以整段不做。P0 和 P1 不依赖它。

### 明确不做

- 不把个人 `UserOperationalIdentityGrant` 和企业 enrollment 合并成一个集合
- 不把 `allowedAgentIds` 重新接回运行时
- 不把部门、角色、`actionRules` 放进第一期策略
- 不在身份裁决里调用计费或模型路由
- 不把运营身份执行权扩展到企业数据 invoke
- 不把空的 `capabilities` 在 P0 改成失败关闭。那会拒绝所有尚未 verify 的历史身份，范围大于授权模型本身。放进 P1 之后单独评估

## 4. 与用户建议的差异说明

1. 默认 `explicit_owner_grant` 作为目标保留，不作为下一步的全局默认。存量行为是「未整理则席位策略生效」，没有同意记录可迁移。高风险先切断隐式继承，其余用租户开关。
2. 不新建平行的 `AgentOperationalIdentityGrant` 存储。现有 enrollment 就是 Grant 的前身。先让执行消费它的 `allowedActions`，再补状态和版本字段。
3. ownership vs custodian 用现有租户所有权 + steward 渐进表达，不在策略对象上再定义一套同义字段。
4. `collaborationMode` 不放进企业身份策略。那个字段已经是协作空间的运行模式。身份侧只在确实需要更窄动作集时增加独立的协作委托。
5. 组织范围继续用席位，不在本期改成部门或角色。席位已经是执行主体。
6. 错误分层采用新增 `stage` 与少量新 code，不重命名现有 `IDENTITY_ACTION_DENIED` 与 scope 拒绝码，避免打断已有断言和 UI。
7. EffectiveActions 的交集在 P0 就做，不等待 policyVersion。版本号解决的是「要不要重新确认」，交集解决的是「能不能做」。后者更急。
8. 模型与费用已经在身份模块之外。本期不实现新的资格服务，只禁止把它们的失败写进身份审计。

## 5. 建议的下一迭代实现清单

下一迭代只做 P0，评审通过后再开 P1。

1. 在 `enterprise-operational-identity-runtime.ts` 抽出「策略动作 ∩ enrollment 动作 ∩ 已发现能力」的纯函数，列表与 execute 共用。
2. `enforceOperationalIdentityRuntimeAccess`：enrollment 命中 identity 后，动作不在交集内则 `OWNER_GRANT_ACTION_DENIED`。
3. 同一函数：动作在能力注册表中为 `high`，且不存在对应 enrollment，则 `OWNER_GRANT_REQUIRED`。注册表没有的动作保持 medium，不触发这条。
4. 零 enrollment 的 low / medium 保持现有允许路径，并加测试锁住，防止下一次重构顺手改掉兼容档。
5. 高风险拒绝与交集拒绝写入 `identity.usage_denied`，metadata 含 `code`、`risk`、`enrollmentId`（若有）、`agentId`、`action`。
6. 工具与 `enterprise-operational-identity.execute` 的失败 payload 带上新 code。暂不改管理 HTTP 的策略错误码。
7. 员工可见文案只改拒绝消息：高风险指向企业身份绑定页。不改页面结构。
8. 测试至少覆盖：策略扩大不放大已绑定动作、策略收紧立即生效、high 零绑定拒绝、low 零绑定仍允许、协作成员无效不降级、enrollment 歧义仍拒绝。
9. 不做 `policyVersion`、租户 `delegationMode`、协作委托新表、steward 重命名。那些属于 P1 / P2 的独立变更。
