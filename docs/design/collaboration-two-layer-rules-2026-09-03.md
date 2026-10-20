# 协作小组两层规则体系（2026-09-03）

> **已被 v1.1 替代为治理基线。** 本页的 S-xxx / G-xxx 清单不再扩张。  
> 现行协议：`docs/design/collaboration-governance-protocol-v1.1-2026-09-03.md`  
> L1/L2 原则保留，但 L1 拆成 Hard/Default；运行时以 Policy Compiler → EffectivePolicy 为真相源。

群运作只认两层，不允许第三套「隐藏政策」并行：

1. **L1 系统通用规则**：平台底线。群管不能关闭、不能削弱。调度器必须执行。
2. **L2 群管规则**：群主/管理员在设置里写的。写了就必须进入调度或明确标成「仅提示」。

叠加顺序：**L2 只能在 L1 允许的范围内收紧或定向，不能放宽 L1。**  
例：L1 可见回复硬顶 12；L2 可设 1–12，UI 现允许到 50 的部分必须被 L1 截断。

本文是运营口径，不是新功能清单。字段对应当前代码；「目标」列是规范化后应有的归属。

相关实现：

- 调度：`src/gateway/collaboration-dispatch/decision-engine.ts` `decideParticipants`
- 执行：`src/gateway/collaboration-dispatch/round-runtime.ts` `executeCollaborationRound`
- 系统默认政策：`src/gateway/collaboration-dispatch/policy.ts` `DEFAULT_COLLABORATION_POLICY`
- 群管写入：`collaboration.space.updateBasic` / `updateMission` / `updateRules`（`src/gateway/server-methods/collaboration-space-boundary.ts`）
- 设置 UI：`ui/src/ui/ports/employee/views/workbench-stage-module.ts`
- 章程注入：`src/gateway/collaboration-learning/group-charter.ts`、`group-runtime-profile.ts`

---

## 运营状态码

| 码          | 含义                      | 运营动作                               |
| ----------- | ------------------------- | -------------------------------------- |
| `dispatch`  | 已进选人/回合/ACL         | 按现行行为对外承诺                     |
| `prompt`    | 只进 system prompt / 章程 | 对外标明「靠模型遵守」，勿当硬规则承诺 |
| `ui-only`   | 只在设置或规则抽屉出现    | 从对外承诺中撤下，或接线到 dispatch    |
| `dead`      | 类型/默认值存在，无执行器 | 删除或接线，禁止继续当已生效宣传       |
| `overreach` | 执行过严，挡住了合法组    | 修投影/身份，不改规则语义              |

---

## L1 系统通用规则（不可被群管关闭）

这些是所有协作小组共用的底线。群管设置与之冲突时，以 L1 为准。

| ID        | 规则                                                                      | 现状                               | 目标                                                               | 权威符号                                                           |
| --------- | ------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| S-ACL-1   | 仅 active/paused 成员可发言；pending invite 不可 `chat.send`              | `dispatch`                         | L1                                                                 | `canEmployeeActorWriteCollaborationSpace`                          |
| S-ACL-2   | 非成员不可发言；机器人主人可旁观自己的 bot，不可代发                      | `dispatch`                         | L1                                                                 | `resolveCollaborationGroupWriteDenial`                             |
| S-ACL-3   | 归档 / 解散后对工作台隐藏                                                 | `dispatch`                         | L1                                                                 | `isArchivedCollaborationSpace`                                     |
| S-ACL-4   | 托管模式不回退旧 workspace；授权失败则本轮失败                            | `dispatch`                         | L1                                                                 | `resolveWorkspaceDirAfterAuthorization`                            |
| S-ACL-5   | 大白管家入群仅群主可加                                                    | `dispatch`                         | L1                                                                 | `assertBuiltinStewardGroupMembershipAllowed`                       |
| S-SKILL-1 | 群 `enabledSkills` 为空 = 不限制工具                                      | `dispatch`                         | L1                                                                 | `composeSkillPolicy` / `resolveRuntimeSkillPolicy`                 |
| S-SKILL-2 | 1:1 大白不得继承群 skill allowlist                                        | `dispatch`                         | L1                                                                 | `get-reply-run.ts` 仅 `useCollaborationAssembly && !applyChatLane` |
| S-TURN-1  | @ 机器人无法匹配则整轮不派发，并告警                                      | `dispatch`                         | L1                                                                 | `resolveMentionResolution` / `MENTION_UNMATCHED`                   |
| S-TURN-2  | 纯寒暄（短问候）机器人回复上限 = 0                                        | `dispatch`                         | L1                                                                 | `isCollaborationChitchat`                                          |
| S-TURN-3  | 低信号确认默认只 1 人回                                                   | `dispatch`                         | L1                                                                 | `visible-reply-limit.ts` `low_signal`                              |
| S-TURN-4  | 单轮可见回复硬顶 12                                                       | `dispatch`                         | L1                                                                 | `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT`                        |
| S-TURN-5  | 主答串行；补位等主答有结论后才开始                                        | `dispatch`                         | L1                                                                 | `executeCollaborationRound` `waitForPrimary`                       |
| S-TURN-6  | 同 bot 同 session 排队，禁止并行写同一 transcript                         | `dispatch`                         | L1                                                                 | `KeyedAsyncQueue` `groupBotQueue`                                  |
| S-TURN-7  | 群 `executeCollaborationRound` 不传 `inboundDepth`（depth=chat 会关工具） | `dispatch`                         | L1                                                                 | `chat.ts` 调用处                                                   |
| S-QUAL-1  | 补位必须增量；写不出增量应 `NO_REPLY`                                     | `prompt`+部分 `dispatch`           | L1 保持：prompt 强制 + cheap-gate                                  | `discussion-turn-prompt.ts` / `evaluateCheapGate`                  |
| S-QUAL-2  | 高度重复的补位可抑制展示                                                  | `dispatch`                         | L1                                                                 | `shouldSuppressHighlyRedundantReply`                               |
| S-QUAL-3  | 协调者默认不进补位（除非决策→执行）                                       | `dispatch`                         | L1                                                                 | `evaluateCheapGate` `role_mismatch`                                |
| S-QUAL-4  | 协调者收口（wrap）默认关闭                                                | `dispatch`                         | L1 默认关；L2 可打开                                               | `coordinatorSummarizeAfterRound`                                   |
| S-FAIL-1  | 主答超时且非寒暄：整轮 abort，无替补接管                                  | `dispatch`                         | 暂留 L1；接管未设计前不宣传「永不空轮」                            | `round-runtime.ts` abort                                           |
| S-ID-1    | 成员匹配应同时接受 userId 与邮箱别名                                      | 部分 `dispatch` / 部分 `overreach` | L1                                                                 | `humanRosterMemberMatchesActorIdentities`                          |
| S-CAT-1   | 托管列表只展示租户 ACL 可读的组                                           | `overreach`                        | L1 语义保留「无 ACL 不写入」；**列表不得把有 roster 的自建组藏掉** | `filterSpacesByManagedWriteAuthority`                              |

L1 里明确 **不是** 群管文案、不要写进「规则摘要」让管理员误以为能改：S-ACL-\*、S-SKILL-\*、S-TURN-5/6/7、S-FAIL-1。

---

## L2 群管规则（设置页可写）

管理员入口只有三条 RPC，必须与下表对齐。未出现在此表的字段，禁止再以「群规则」对外承诺。

### L2-A 身份与使命（`updateBasic` + `updateMission`）

| ID     | 字段                       | 群管能改 | 现状                       | 目标                                        |
| ------ | -------------------------- | -------- | -------------------------- | ------------------------------------------- |
| G-ID-1 | 群名 / 头像 / 协调者       | 是       | `dispatch`（协调者进选人） | L2                                          |
| G-ID-2 | 可见范围 `visibilityScope` | 是       | 存盘；列表过滤弱           | L2，列表必须遵守                            |
| G-MS-1 | 定位 `purpose`             | 是       | `prompt`                   | L2-prompt（允许）                           |
| G-MS-2 | 当前使命 `currentMission`  | 是       | `prompt`                   | L2-prompt；阶段切换仍可由系统建议           |
| G-MS-3 | 成功标准 `successCriteria` | 是       | `prompt`                   | L2-prompt；验收 gate 未做，不得承诺自动验收 |

### L2-B 治理（`updateRules` 决策区）

| ID      | 字段                                                 | 群管能改 | 现状                  | 目标                            |
| ------- | ---------------------------------------------------- | -------- | --------------------- | ------------------------------- |
| G-GOV-1 | 最终决策模式 `human_required` / `delegated_low_risk` | 是       | `dead`                | **必须进 dispatch / 发布 gate** |
| G-GOV-2 | 默认拍板角色 owner / admin                           | 是       | `dead`                | 随 G-GOV-1 接线                 |
| G-GOV-3 | 允许机器人发布提案                                   | 是       | `dead`                | 随 G-GOV-1 接线                 |
| G-GOV-4 | 保密等级                                             | 是       | 存盘，检索/分享约束弱 | L2；知识出口必须读              |

### L2-C 协作模式与回合（`updateRules` 协作规则区）

| ID       | 字段                                | 群管能改                | 现状                                       | 目标                                                |
| -------- | ----------------------------------- | ----------------------- | ------------------------------------------ | --------------------------------------------------- |
| G-MODE-1 | 协作模式 discussion / task / review | 是                      | `ui-only`（调度用关键词猜 `responseMode`） | **调度默认值必须读此字段**；关键词只作缺省          |
| G-PART-1 | 开放讨论（无需 @）                  | 是                      | `dispatch`                                 | L2，已生效                                          |
| G-PART-2 | 每轮最大可见回复                    | 是（UI 1–50）           | `dispatch`（再被 L1 顶 12）                | L2，UI 改为 1–12                                    |
| G-PART-3 | 规则摘要 `systemInstructions`       | 是                      | `prompt`                                   | L2-prompt；不得伪装成硬闸                           |
| G-PART-4 | @ 机器人必须回应                    | 默认 true，设置页无开关 | `dispatch`                                 | 上收 L1（建议），设置页只展示只读                   |
| G-PART-5 | 新一轮由人类发起                    | 默认 true，无开关       | `ui-only` / charter `prompt`               | 若保留：L2 开关 + dispatch 禁 bot 自开轮            |
| G-PART-6 | 机器人低风险自推进                  | 默认 false，无开关      | `ui-only`                                  | 并入 G-GOV-1，禁止两套开关                          |
| G-PART-7 | 达上限后等人类                      | 默认 true，无开关       | `ui-only`                                  | L2 开关 + `waitingForHuman` 进 `decideParticipants` |
| G-PART-8 | 协调者本轮收口                      | 默认 false，无开关      | `dispatch`（默认关）                       | L2 显式开关（打开才 wrap）                          |

### L2-D 成员角色（成员表，非规则摘要）

| ID       | 字段                     | 群管能改 | 现状                                 | 目标                                                |
| -------- | ------------------------ | -------- | ------------------------------------ | --------------------------------------------------- |
| G-ROLE-1 | 人类 governanceRole      | 是       | ACL 只用 status，**observer 不禁言** | observer 必须禁言（L1 底线 + L2 指定谁是 observer） |
| G-ROLE-2 | 机器人 collaborationRole | 部分     | 空角色时阶段引擎失效                 | 空角色降级为「协调者 + 被 @」，禁止假装按阶段运转   |

---

## 两套体系对照（规范化后）

```
L1 系统底线          永远执行，设置页只读说明
  ACL / 技能隔离 / 回合骨架 / 硬顶 / 失败策略

L2 群管配置          写入 updateBasic / updateMission / updateRules / members
  ├─ 使命（prompt）
  ├─ 模式（dispatch）     discussion | task | review
  ├─ 治理（dispatch）     终裁 / 提案 / 保密
  ├─ 回合旋钮（dispatch） 开放讨论 / 每轮人数 / 等人类 / 收口
  └─ 自定义条文（prompt） systemInstructions
```

群管规则摘要抽屉的展示顺序必须是：先 L1 只读底线（短），再 L2 本群已设项。  
`ui/src/ui/collaboration/collaboration-rules-summary.ts` 现在把若干 **未接线** 的默认布尔值渲染成「已生效规则」，这是运营口径错误，规范化后要改。

---

## 禁止再并行的第三套

| 来源                                                       | 为什么不能当第三套                       |
| ---------------------------------------------------------- | ---------------------------------------- |
| `CollaborationPolicyV1.quality.*`（自检/跑题/周复盘）      | 默认 true 但无执行器，属 `dead`          |
| `CollaborationPolicyV1.conflict.*`                         | 未接线                                   |
| `CollaborationPolicyV1.fallback.allowSecondaryTakeover`    | 与 S-FAIL-1 冲突                         |
| `packages/collaboration-runtime` `canPublishFinalDecision` | 未接 `chat.send`                         |
| 消息关键词 `responseMode`                                  | 只能做 G-MODE-1 的缺省，不能覆盖群管模式 |
| 托管 ACL 漏投影                                            | 运营故障，不是规则                       |

---

## 接线优先级（运营，不是实现排期承诺）

1. **口径**：规则抽屉拆 L1/L2；未接线字段停止写成已生效。
2. **L2 已写未跑**：G-MODE-1、G-GOV-1/2/3 进 `decideParticipants` / 发布路径。
3. **L2 角色空**：G-ROLE-2 降级策略。
4. **L1 过严**：S-CAT-1 租户 ACL 投影，让自建组能运行 L2。
5. **UI 越界**：G-PART-2 上限改为 12，与 S-TURN-4 对齐。

未完成 2 之前，对外只承诺：L1 底线 + 已生效的 G-PART-1/2 + 使命/自定义条文为提示层。
