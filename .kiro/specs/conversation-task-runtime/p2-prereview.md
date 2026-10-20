# ConversationTask Runtime — P2 前置评审材料

> Owner: `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./execution-plan.md`（§5 四层、§9 Ledger、§14 flag/可观测、§15 安全、§16 门禁）、`./p0-p1-acceptance.md`
> 状态: **P2（Activation Gate）尚未批准。本文仅为设计 / 评审材料,不含任何 runtime 实现。**

## 0. 范围与红线声明

本文回答专家要求的 7 项 P2 前置设计问题。以下动作在本轮**全部未发生**,均为 P2 提案,待书面批准:

- 未实现 Activation Gate、未创建正式 ConversationTask、未写 Progress Ledger;
- 未修改 `chat.send` / Cron、未打开任何生产 flag、未实施 Mission;
- 未接 gateway config schema、未接 tenant/employee/conversation ACL、未建任何 store。

文中出现的 `src/...` 路径均为**建议接线点**,供 P2 评审核对,当前代码并未接入。

## 1. Feature flag 接线与即时回滚

现状:5 个 flag 均 env-only、默认 OFF(`src/conversation-task/feature.ts`);`isShadowModeOnly` 保证 P0/P1 期间 activation/projection/authorization 恒为 OFF;读路径 `evaluateTurnGated` 在 detection=off 时返回 `null`(`src/conversation-task/replay.ts`,即 flag-off == 行为不变,已实现)。

P2 提案:

- config 接线:新增 `gateway.conversationTask.{detection,qualification,activation,projection,authorization}.enabled`,形态对齐 `gateway.progressLedger.enabled`(参照 `src/progress-ledger/feature.ts` 的 env+config 读取);env 覆盖优先。
- 分级开启顺序(与风险边界对齐):detection → qualification(影子) → activation(小范围灰度) → projection → authorization。禁止一个总开关跨越全部边界(§14)。
- 即时回滚:
  - 任一 flag 关闭立即回到上一形态;`activation` 关闭 ⇒ 停止新建任务,已存任务只读/冻结(不删除、不推进);
  - 建议**热读**(每个 turn 读取 flag)以实现无重启回滚;若选择重启读,回滚 = 落 config + `launchctl kickstart` 重启 gateway。热读 vs 重启由 P2 运维评审拍板。
- 可观测:每次判定落 `decisionVersion` + reason codes,回滚前后可对比;灰度指标见 §13(Upgrade Precision / Task Survival / 误升级率)。

## 2. Shadow 日志脱敏 / 保留 / 删除

现状:`ShadowDecisionLog`(`src/conversation-task/types.ts`)只含 `inputFingerprint`(FNV-1a,非可逆、非原文)+ reason codes + 8 布尔 signals + 类别 + `shadowOnly:true`,**不落任何原始用户文本或实体值**。

P2 强化提案:

- 脱敏:`inputFingerprint` 升级为**租户级 keyed HMAC**(防跨租户碰撞与字典还原);signals 为布尔无 PII;严禁落原文 / 手机号 / 金额 / 客户名等实体。
- 保留:shadow 日志设 TTL(建议 ≤ 30 天),仅用于离线评估与指标复盘;按 `tenantId` 分区存储(参照 `src/gateway/tenant-store-paths.ts` 的分区路径)。
- 删除:随 Conversation 生命周期级联删除(遵循现有 Conversation Lifecycle,§15);支持按 `conversationId` / `tenantId` 硬删除;跨境导出遵循现有数据策略。
- 访问:仅评估 / 审计角色可读,不进用户面 UI(§10 Projection 只读、禁显内部评分)。

待评审:HMAC 密钥管理与轮换、日志落盘位置与 tenant 隔离、与现有 memory/data 保留策略的一致性。

## 3. tenant / employee / conversation ACL 接线点

原则(§15):所有读写沿用现有 tenant / employee / conversation ACL;Candidate **不得扩大** Conversation 可见范围;`ConversationTask.ownerId` ≠ 外部系统授权主体。

建议接线点(P2 评审核对,当前未接):

| 边界                 | 建议接线点                                                           | 校验内容                                                    |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| tenant               | `src/gateway/tenant-context.ts`、`src/gateway/tenant-store-paths.ts` | Candidate/Task/shadow 日志按 tenant 分区;跨租户 fail-closed |
| conversation         | `src/gateway/server-methods/chat.ts` 的会话 ACL(读写同源)            | detection 输入仅来自本会话可见消息;不跨会话读取             |
| employee / workbench | `src/gateway/employee-workbench-scope.ts`                            | 任务 owner/requester 归属与可见性;不越员工可见域            |

Candidate 仅承载判定结果,不持有任何外部副作用权限(CT1);可见性完全继承来源消息的 ACL。

## 4. Authorization fail-closed 威胁模型

现状:`resolveAuthorization(sideEffect, granted)` fail-closed(`src/conversation-task/invariants.ts`,CT7 有测试);任一非 `none` 副作用在无显式授权时 ⇒ `human_gate_required`;副作用分类(broadcast/external_write/outbound_message)与时长判定正交。

威胁 → 缓解:

- T1 「激活即授权」误解 → CT7:授权与任务时长正交,激活 ≠ 授权;发送/写库/群发单独校验。
- T2 副作用分类漏判(新表述) → 分类保守 + 未知一律走授权;新表述进 allowlist 前默认 fail-closed;P2 补对抗测试集。
- T3 越权外发(broadcast / 写 CRM / 跨租户) → 强制 Human Gate + tenant ACL(§3);拒绝时进 `blocked_authorization`,只把「人的闸」放入 Pending Tasks(§10)。
- T4 授权重放 → 授权与「具体 side-effect 实例 + 幂等键(§5)」绑定,一次授权不可跨动作复用。
- T5 授权状态污染判定 → 授权状态不作为 detection/qualification 输入(纯判定,§5.2);授权变更走独立事件(§8 `authorization_change`)。

P2 需补:副作用分类对抗集、授权审计事件(可复用 Progress Ledger 的 evidence 白名单与 human_confirmation 类型)。

## 5. Candidate / ConversationTask 幂等键

- Candidate 幂等键(建议):`hash(tenantId, conversationId, sourceMessageId, decisionVersion)`。
  同一 `messageId` 重复投递 ⇒ 命中同键 ⇒ 复用同一 Candidate 与判定,不新建(CT8 已在离线以 messageId 一致性 + 逐字节日志相等验证)。
- ConversationTask 幂等键(建议):`hash(tenantId, conversationId, normalizedGoal, activationEpoch)`。
  同一目标在同一激活窗口内只建一个 `active` 任务;改目标走 Revision(不新建第二个任务,§8)。
- `decisionVersion` 纳入键:判定逻辑升级后,旧 Candidate 不与新判定混淆(便于灰度对比与回滚)。
- 落地:幂等键 → Candidate/Task 映射需事务 / CAS 保证唯一(见 §6)。

## 6. 重复投递与并发激活

- 重复投递:同 `messageId` ⇒ 幂等命中(§5),二次投递不产生新 Candidate / 事件(CT8);离线已保证,P2 在 store 层以唯一约束 / 幂等键落地。
- 并发激活(同一会话 / 目标同时触发 Activation)⇒ 需单飞(single-flight):
  - 方案 A:对 ConversationTask 幂等键做原子 `create-if-absent`(CAS);败者读已存任务。
  - 方案 B:每 `conversationId` 一个激活串行队列(参照 `src/progress-ledger/cron-binding.ts` 的绑定串行思路)。
- Ledger 绑定(P4)必须在任务 create 成功后**一次性**绑定,避免双账本(§9,复用 `src/progress-ledger`,不新建第二套进度系统)。

## 7. Candidate 保留 / 过期 / 清理

- 保留:Candidate 非任务,默认短 TTL(建议 ≤ 7 天或至会话活跃期结束);`observing` 可续,`classified` / `discarded` 进入清理。
- 过期:超 TTL 未升级 ⇒ 自动 `discarded`,不占长期任务额度、不发通知(CT1)。
- 清理:随 Conversation 归档 / 删除级联清理(遵循现有 Conversation Lifecycle,§15);tenant 删除时硬删。
- 上限:每会话活跃 Candidate 数设上限(防刷),超限丢弃最旧 `observing`。
- 审计:discard / expire 记 reason code + 时间,供 §13 指标(Candidate 创建 / 丢弃 / 激活率)。

## 8. P2 准入门禁对照(execution-plan §16）

| §16 条件                                        | 本文 / 证据                                 | 状态                  |
| ----------------------------------------------- | ------------------------------------------- | --------------------- |
| 1 Candidate/Task/Mission 边界测试+评审          | CT1/CT2/CT11 + `invariants.test.ts`;本文 §5 | 设计就绪,待评审       |
| 2 Qualification/Activation/Authorization 无重叠 | 合同分层 §5;本文 §4                         | 设计就绪,待评审       |
| 3 Reminder/Scheduled/Long-running 回放通过      | 原集 + 盲测(§ acceptance)                   | 通过,待确认           |
| 4 Upgrade Precision ≥ 95% 门槛                  | 原集 100% / 盲测 100%(n=166)                | 达标,待确认样本充分性 |
| 5 误升级/重复/改目标/副作用反例                 | 盲测覆盖 + CT7/CT8;本文 §5/§6               | 通过,待确认           |
| 6 flag/回滚/观测过运维评审                      | 本文 §1                                     | 提案,待运维评审       |
| 7 安全/tenant 隔离/授权边界专项评审             | 本文 §2/§3/§4                               | 提案,待安全评审       |

## 9. 明确不做(本轮)

未接 config schema、未接 ACL、未建 store、未写 Ledger、未启动 Agent、未改 `chat.send` / Cron、未开生产 flag、未实施 Mission。以上均为 P2 提案,须经书面批准后另阶段实施。
