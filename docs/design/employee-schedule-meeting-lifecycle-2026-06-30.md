# 员工首页“智能日程与会议生命周期” 设计评审稿（2026-06-30）

状态：**已评审（2026-06-30,专家团队）→ 按评审意见修订,待实施**。
延续：本稿是 `docs/design/employee-home-standing-duty-agents-2026-06-29.md`（员工首页四卡 M1–M4）的下一层,
复用其“确定性 actor 作用域读模型 → RPC → 卡片”范式与 steward（大白 `main`）表层。

## 评审记录（2026-06-30,专家团队）

**结论：方向正确、与现状吻合,关键判断准确**（今日日程卡现为 `cronNext + sessionCount` 占位信号,非真日程;
底层确实缺一个 actor 作用域确定性 `Schedule` 域）。**但实施必须更克制**——按以下意见已修订本稿：

1. **先“正名”,不要先做“智能会议系统”**：把 今日日程 卡从前端本地拼装升级为与 M1/M2/M3 同构的网关读模型链路
   （`schedule-read-model → workbench.schedule.list → 共载入 → home-model/signals`）。这是四卡里**唯一**还没
   actor 读模型化的一张,**最高优先级**。已据此把分期改为“两个真阶段优先”(§5)。
2. **`ScheduleEntry` 起步要小**：砍掉 `reminders[]` 数组、`provenance` 体系、`tentative`/`extracted`（留到 Phase C）。已改 §3.1。
3. **cron 先“双轨”不替换**：`workbench.schedule.list` 先把真实 `ScheduleEntry` 与一条虚拟 `cron-derived` 合并输出,
   前端 `cronLabel` 暂留作回退,日程写入来源稳定后再决定是否撤掉。已改 §3.1 / §5。
4. **不要急着把 `TaskAssignment` 改成“人类任务系统”**（最高风险,会把 M1 稳定性拖下水）：A/B 阶段会议/日程只写
   `ScheduleEntry`;纪要拆任务先产 `TaskCandidate`;真正 fan-out 到 `TaskAssignment` 推迟到计费/确认闭环成熟（Phase C）。已改 §3.4。
5. **会议先做“确定性壳”**：最小状态机 `draft → pending_approval → confirmed → reminded → cancelled` 即可;
   `in_progress → minuted → distributed`（纪要/拆任务/跨人写/用量归因）整段推迟到 Phase C。已改 §3.2。
6. **重要通知卡承接审核项 = 加法式**：只加两类固定 item（`会议邀请待审核`/`会议纪要待确认`）,在 `workbench.notices.list`
   读模型层 additive merge,**不动**现有知识治理计数,不建重型统一 store。已改 §3.5。
7. **steward 暂不消费日程明细文本**：只给它“今天 N 个日程 / 最近一条 HH:mm”的**结构化信号**,保持 M4a 计数+模板的稳态,
   不让建议条退化成半摘要器。已改 §3.5。

红线见 §7.2「最需要避免的坑」。

## 0. 背景与问题

产品诉求（三类“智能安排”,都要回流到员工首页“每日概览”四卡）：

1. **用户口述日程**：用户告诉机器人安排,机器人记录后同步进日程。
2. **对话自动提取**：机器人与协作小组沟通中确认的事项,被机器人自动提取并加入日程（管家代用户管理未来事项）。
3. **会议全生命周期**：用户请机器人召集会议 → 草拟邀请函 → 用户审核后向参会者发通知 → 记录会议提醒 → 会前再次提醒
   → 开会自动整理纪要 → 会后把纪要发给参会者 → 把纪要中分给每个人的不同任务分别同步进各自日程。

本稿目标：在**不破坏四卡可信性、不绕过商业闸口、不违反多租户隔离**的前提下,给出可分期、可验收、且**极度克制**的落地路径。

## 1. 结论（先行）

- **第一优先级 = 今日日程卡“正名”**：当前它是**前端代理信号**（`buildCronLabel(cronNext)` + `sessionCount`,前端本地拼装）,
  不是 M1/M2/M3 那样的**服务端权威投影**。先把它升级成 actor 作用域网关读模型链路,四卡的数据源范式才统一。
  这一步是后续一切场景能守住 actor 隔离与可信性的前提。
- **三场景的共同底层只有一个**：缺「按 actor 作用域的确定性日程（Schedule）域」（带时间的未来事项）;会议是它之上的
  一个生命周期实体,LLM 提取只是它的一类**候选来源**。四卡继续做确定性投影,**绝不**直接渲染模型输出。
- **确定性先行,LLM 等计费**：日程域、会议确定性壳、**会前提醒（纯定时,无 LLM）**都可在“企业→员工用量归属”落地前交付;
  而“自动提取 / 草拟邀请 / 生成纪要 / 拆任务”是计费 agent run,**依赖 `cost-budget-billing` 的按用户用量归因
  （`UsageReportedEvent`）**——与 M4b 暂缓（standing-duty §7.7）同一前置,且被放大（一次会议多步 LLM）。
- **不增殖常驻进程**：提醒/提取走 cron（`cron.add/update/remove`）+ `runCronIsolatedAgentTurn`（已过闸口）/ maintenance +
  broadcast,沿用 M3 §3.2“底座 B”。N 用户 × 多会议**不得**退化为 per-会议 LLM 循环。
- **LLM 只产结构化候选**,写入权威存储一律确定性 + 高风险/跨人需用户确认（防幻觉污染日历、防越权派任务）。

## 2. 现状勘误（务必据实,供评审对齐）

### 2.1 四卡当前真实数据源（今日日程是“前端代理信号”,其余三卡已“服务端权威投影”）

| 卡片              | 当前实际来源                              | 是否 actor 读模型 | 代码锚点                                                                                             |
| ----------------- | ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| 今日日程          | `cronNext` + sessionCount（前端本地拼装） | ❌ 前端代理信号   | `ui/src/ui/ports/employee/views/workbench-home-model.ts`（`buildCronLabel`）、`workbench-signals.ts` |
| 待处理任务（M1）  | task-assignment + 待治理成果 + 待确认邀请 | ✅                | `src/gateway/workbench/pending-tasks-read-model.ts`                                                  |
| 即将协作（M3）    | 协作 operating-state 的 `waitingForHuman` | ✅                | `src/gateway/workbench/upcoming-collaboration-read-model.ts`                                         |
| 重要通知（M2）    | 用户作用域知识治理冲突/待关注             | ✅                | `src/gateway/workbench/notices-read-model.ts`                                                        |
| 大白建议条（M4a） | 汇总以上计数的确定性模板（M4b LLM 暂缓）  | ✅                | `src/gateway/workbench/steward-suggestion-read-model.ts`                                             |

> 即:四卡里**只剩今日日程没完成“actor 作用域确定性读模型化”**——这正是本稿 Phase A0 要补的唯一一块范式缺口。
> 当前 `ui/src/ui/controllers/spaces.ts` 的 `refreshWorkbenchSignals()` 只共载入 `pending-tasks` / `notices` /
> `upcoming-collaboration` / `steward-suggestion`,**没有** `workbench.schedule.list`;`src/gateway/server-methods/workbench.ts`
> 也**没有** schedule handler。

### 2.2 关键缺口（决定本稿范围）

- **无日程/日历存储**：全代码无 schedule/calendar 实体;协作空间快照（`src/gateway/collaboration-learning/snapshot-types.ts`）无时间字段。
- **无“会议”可创建实体**：“meeting/会议” 仅卡 key `"meetings"`（即将协作）、一个“推荐发起会议”指令、知识成果里的“会议纪要”文档类别。
- **任务模型不足以承接“每人不同任务 + 进日程”**：`TaskAssignment`（`src/organization/task-assignment.ts`）是 **per-agent、组织作用域**,
  有 `status`/`ackRequired`,但**无时间/截止、无人类受派人**。

### 2.3 可复用底座（不要重造）

- **商业闸口**：`tryAcquireEnterpriseAgentRun` → `authorizeCommercialRun`（`src/gateway/billing/agent-run-governance.ts`）。
- **定时/隔离执行**：cron（`cron.add/update/remove/run`）+ `runCronIsolatedAgentTurn`（`src/cron/isolated-agent/run.ts`,已过闸口）。
- **协作上下文**：operating-state（`src/gateway/collaboration-learning/`）= 场景 2 对话来源。
- **成果体系**：知识成果（deliverables）可承载“会议纪要”。
- **推送**：`broadcast`;**周期收敛**：`server-maintenance.ts` tick。
- **计费/用量**：`cost-budget-billing` 的 `Usage_Service` / `UsageReportedEvent`（事件驱动、按用户归因）—— Phase C 前置。

## 3. 目标架构

### 3.1 新增「日程（Schedule）」确定性域（核心,三场景汇流处）

**起步最小 `ScheduleEntry`**（按用户/租户作用域;砍掉一切非必需字段,等真要用再加）：

- `id`、`ownerUserId`（actor）、`tenantId?`
- `title`、`startAt`、`endAt?`、`timezone`
- `kind`: `personal` | `reminder` | `cron-derived` | `meeting`
- `status`: `confirmed` | `cancelled` | `done`
- `sourceRef`: `{ kind: "manual" | "meeting" | "cron"; id }`

**起步不做**（推迟到接 cron 提醒 / Phase C 时再加）：`reminders[]` 数组、`provenance` 体系、`tentative` / `extracted`、`task-due` kind、`allDay`。

要点：

- **存储**：按 user/tenant 作用域（参考 task-assignment 的 per-org store + 索引,但主键到 user）;**绝不**回退到 install/全局视图（HYB 越权教训）。
- **读模型** `buildWorkbenchSchedule({ userId, userEmail, tenantId, window })` → 今日 + 临近条目 + 计数;
  **RPC** `workbench.schedule.list`（`resolveEmployeeWorkbenchActor` 作用域,无 actor 返回空,与 M1–M3 同构）。
- **cron 双轨（不立刻替换）**：`workbench.schedule.list` **合并输出**真实 `ScheduleEntry` + 一条虚拟 `kind:"cron-derived"`（由 `cronNext` 派生）;
  前端 `cronLabel` 暂作回退（卡片无真实日程时显示）。等真实写入来源稳定,再决定是否撤掉前端 `cronLabel`。
- **写入** `schedule.entry.upsert` / `schedule.entry.cancel`（供 bot 工具与 UI 共用）——**Phase A1 才引入**,A0 先只读投影 + cron 双轨。

### 3.2 「会议（Meeting）」实体 + 生命周期（确定性壳先行）

`Meeting`：`id`、`spaceId`、`organizerUserId`、`title`、`startAt/endAt`、`attendees[]`（`userId`+`role`+`rsvpStatus`）、`status`、`reminderJobIds[]`、
`inviteRef?`、`minutesRef?`（后半段才用）。

**Phase B 只做确定性壳**（无 LLM、无跨人任务写）：

```
draft ──(用户填写/确认要素)──► pending_approval
pending_approval ──(用户审核通过, 人工闸口)──► confirmed
   └─副作用: 通知参会者 + 为每位参会者建 ScheduleEntry(kind=meeting) + 建会前提醒 cron(纯定时)
confirmed ──(会前 cron 触发)──► reminded            // 纯确定性,无 LLM
(任意态) ──► cancelled                               // 撤销提醒 cron + 标记相关 ScheduleEntry cancelled
```

**Phase C 才接的后半段**（整段推迟,因都牵涉纪要/拆任务/跨人写/用量归因）：

```
reminded ──► in_progress ──(LLM生成纪要)──► minuted(纪要 deliverable,待确认)
minuted ──(用户确认)──► distributed   // 发纪要 + (LLM)拆每人任务 → 候选 → fan-out
```

人工闸口（出现在 **重要通知** 卡,加法式两项,见 §3.5）：`会议邀请待审核`、`会议纪要待确认`。

### 3.3 LLM 提取/生成边界（过闸口,计费;Phase C,不早于计费归因）

- 输入：用户 NL（场景 1 增强）、群对话/operating-state（场景 2）、会议转写（场景 3 纪要）。
- 输出：**结构化候选**——`ScheduleEntryCandidate` / `TaskCandidate` / `InviteDraft` / `MinutesDraft`。
- **写入前**：确定性 schema 校验 +（跨人/高风险）用户确认。**LLM 永不直接写权威存储。**
- 每次调用：`tryAcquireEnterpriseAgentRun({ agentId: "main", modelGateInput })` + `finally release`;**非企业按 M4a 决策 B 不调模型**。
- **用量必须按用户归因**上报（`UsageReportedEvent`,见 §6）。

### 3.4 任务模型：A/B 阶段不改 `TaskAssignment`（最高风险隔离）

- **A/B 阶段**：会议/日程**只写 `ScheduleEntry`**;不给 `TaskAssignment` 加 `dueAt`/`assigneeUserId`,不碰 M1 那条线。
- **纪要拆任务**：先产出 `TaskCandidate`（结构化候选,不落 `TaskAssignment`）。
- **真正 fan-out 到 `TaskAssignment`（含 `dueAt`/人类受派人扩展）**：推迟到**计费 + 确认闭环成熟（Phase C）**再做,届时单独评审任务模型扩展。
- 跨人写授权（届时）：仅会议 `organizer`/空间 coordinator 可派;每人只读自己;租户隔离。

### 3.5 四卡 + 大白条演进后的读取口径（加法式,不动既有计数）

| 卡片       | 演进后来源                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 今日日程   | **新 Schedule 读模型**（今日+临近,actor 作用域;cron 双轨合并）—— Phase A 主战场                                  |
| 待处理任务 | **不变**（task-assignment;Phase C 成熟后才承接会议拆出的每人任务）                                               |
| 即将协作   | operating-state（不变）;会议的“需要你回应（RSVP/决策）”视情况并入,**不重复**呈现带时间的会议                     |
| 重要通知   | 知识治理（**计数不动**）+ **additive merge** 两类 meeting-derived item：`会议邀请待审核`、`会议纪要待确认`       |
| 大白建议条 | M4a 计数模板**不变** + 仅新增**结构化信号**：`今天 N 个日程 / 最近一条 HH:mm`（**不读日程明细文本**,不做半摘要） |

## 4. 三场景拆解（确定性写入 / LLM候选 / 卡片投影 / 落点）

| 场景           | 确定性写入                                   | LLM（过闸口,候选）                                | 回流的卡                                 | 落在哪个 Phase                          |
| -------------- | -------------------------------------------- | ------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| 1 用户口述日程 | `schedule.entry.upsert`                      | bot 普通 turn 解析 NL → 候选（低风险,可回显确认） | 今日日程                                 | **A1**（写接口）;解析增强在 C           |
| 2 对话自动提取 | 确认后 `schedule.entry.upsert`               | 群对话→候选行动项（带时间）→**待确认**            | 今日日程                                 | **C**（LLM,依赖计费）                   |
| 3 会议生命周期 | 会议实体/状态、每人 ScheduleEntry、提醒 cron | （后半段）草拟邀请/纪要/拆任务                    | 今日日程 / 重要通知（审核项） / 即将协作 | **B**（确定性壳+提醒）+ **C**（生成层） |

## 5. 分期与落地顺序

> 专家建议：拆成**两个“真阶段”优先**（A0 正名 + A1 写接口）,而非四个产品阶段并进。B/C/D 依次跟进,C 受计费阻塞。

### 5.0 推荐落地顺序（专家给定,Phase A0 = 步 1–6）

1. 新增 `src/gateway/workbench/schedule-read-model.ts`
2. 新增 `workbench.schedule.list` RPC,完全复用 `resolveEmployeeWorkbenchActor`
3. 在 `ui/src/ui/controllers/spaces.ts` 的 `refreshWorkbenchSignals()` 共载入 schedule
4. `WorkbenchSignalBundleInput` 新增 `schedule?: WorkbenchScheduleSummary | null`
5. 改 `ui/src/ui/ports/employee/views/workbench-signals.ts`：schedule 卡优先显示真实 schedule,缺省回退 `cronLabel + sessionCount`
6. 补 UI 测试 + RPC 测试
7. （Phase A1）引入 `ScheduleEntry` 写接口（`schedule.entry.upsert/cancel`）
8. （Phase B）最后才引入 `Meeting` 实体与 reminders

### Phase A0：今日日程卡“正名”（步 1–6,确定性只读 + cron 双轨,零 LLM）

- 交付：`schedule-read-model` + `workbench.schedule.list` + 共载入 + bundle 透传 + 卡片优先真实日程/回退 cron;cron 双轨合并。
- 验收：读模型纯投影单测;RPC actor 作用域 / 无 actor 空 / 跨租户隔离;UI 卡渲染真实日程 + 回退 + 共载入/失败清空（沿用 M1–M3 门禁）。
- 完成判据：**四卡数据源范式统一**（今日日程也成为服务端权威投影）。

### Phase A1：`ScheduleEntry` 写接口（步 7,确定性）

- 交付：`schedule.entry.upsert/cancel`（bot 工具 + UI 共用）。→ **落地场景 1**（用户口述,bot 确定性写入,回显确认）。
- 验收：写接口 actor 作用域/隔离;写后读一致;UI 手动增删。

### Phase B：会议确定性壳（步 8,确定性 + 人工闸口;提醒纯定时）

- 交付：`Meeting` 实体 + 最小状态机（`draft→pending_approval→confirmed→reminded→cancelled`）+ 会前提醒 cron + 确认后每人 ScheduleEntry +
  重要通知卡 additive 两项（邀请/纪要待审核）+ 取消回收。**不做** `in_progress/minuted/distributed`,**不改** `TaskAssignment`。
- 验收：状态机迁移单测;提醒 cron 触发→broadcast;每人 ScheduleEntry 的授权 + 隔离;通知卡 additive merge 不动既有治理计数;**全程无模型调用**。

### Phase C：LLM 提取/生成 + 会议后半段（过闸口,硬依赖计费归因）

- 交付：邀请草拟、群对话提取（场景 2）、纪要生成、纪要→`TaskCandidate`→确认后 fan-out 到（扩展后的）`TaskAssignment`;会议后半段状态。
- 验收：候选/确认闭环;闸口路径（企业过 / 非企业降级）;**用量按用户归因上报**（`UsageReportedEvent`）。
- **前置（硬依赖,不满足不开工）**：`cost-budget-billing` Phase 2「Usage 采集 / 按用户归因」落地（= M4b 暂缓同源前置）。

### Phase D：大白综合建议（复活 M4,结构化信号）

- 交付：steward 仅消费“N 个日程 / 最近一条 HH:mm”等**结构化信号**合成建议（确定性模板;LLM 润色随 Phase C）。
- 验收：确定性合成单测;复用 M4a 指纹去重/节流;**不读日程明细文本**。

## 6. 成本与治理

- **闸口复用是硬约束**：任何 LLM 步骤必须走 `tryAcquireEnterpriseAgentRun`;非企业按决策 B 不调模型。
- **计费归因（Phase C 前置,最大风险）**：草拟/提取/纪要/拆任务都是计费 run,必须以 `UsageReportedEvent` **按用户**上报,
  支持 `cost-budget-billing` 的“成本归因：总费用→Seat/Usage→用户”。在该归因链路落地前,**Phase C 不实施**。
- **节流/去重**：事件优先于轮询;静默时段不跑;候选未变不重复生成;借鉴 maintenance in-flight guard 与 M4a 指纹去重。
- **多租户隔离**：日程/任务/会议全部 actor + 租户作用域;跨人写仅限召集人授权;读只见自己。

## 7. 风险 / 开放问题

### 7.1 开放问题（评审重点）

1. **计费用量归属（阻塞 Phase C）**：与 M4b 同源,被会议多步 LLM 放大;需先与 `cost-budget-billing` 对齐 `UsageReportedEvent` 按用户口径。
2. **身份与跨人 fan-out**：任务现为 per-agent,需引入人类受派人;跨 actor 写授权边界（HYB 越权教训）。Phase C 单独评审。
3. **时间/时区**：日程与提醒按用户时区;跨时区会议;夏令时。
4. **通知渠道与同意**：“发给参会者”走哪条 messaging 渠道、是否已配对、避免骚扰（主动通知 consent）。
5. **幻觉/信任**：自动提取一律“候选 + 一键撤销”,不静默写权威日程。
6. **会议 vs 协作“待回应”边界**：带时间的会议进今日日程;需要你回应的协作进即将协作;避免重复呈现。
7. **新用户 freshSurface**：空日程保持引导优先,不主动起例程。

### 7.2 最需要避免的坑（红线）

- **不要**让今日日程卡继续在前端做业务拼装——否则后面所有场景都绕不过 actor 隔离与可信性。
- **不要**在 Phase A 把 LLM 候选写入权威 store。
- **不要**在计费归因明确前接任何自动提取 / 邀请草拟 / 纪要生成。
- **不要**把 `TaskAssignment` 一次改成“会议任务中心”,会把现有待处理任务卡一起拖进重构。
- **不要**让会议提醒变成 per-meeting 常驻 agent;必须复用 cron / isolated turn。

## 8. 关联规格 / 文档（评审请并读）

- `docs/design/employee-home-standing-duty-agents-2026-06-29.md`（四卡 M1–M4 + steward 模式;本稿延续之,M4b §7.7 计费暂缓）。
- `.kiro/specs/cost-budget-billing/`（Phase C 计费归因前置：`Usage_Service` / `UsageReportedEvent` / 成本归因到用户）。
- `.kiro/specs/daibai-super-steward/`（大白身份/运行时;本稿不改其契约,仅复用 `main` 表层）。
- `.kiro/specs/model-entitlement-chain/`（模型闸口链,LLM 调用走它）。
- 协作 operating-state（`src/gateway/collaboration-learning/`）与知识成果（纪要承载）。

## 附：关键代码锚点

- 四卡构建/数据：`ui/src/ui/ports/employee/views/workbench-home-model.ts`、`workbench-signals.ts`
- 现有读模型：`src/gateway/workbench/{pending-tasks,notices,upcoming-collaboration,steward-suggestion}-read-model.ts`
- 新增读模型（Phase A0,步 1）：`src/gateway/workbench/schedule-read-model.ts`
- 共载入接线：`ui/src/ui/controllers/spaces.ts`（`refreshWorkbenchSignals`）
- RPC 注册：`src/gateway/server-methods/workbench.ts`、`src/gateway/method-scopes.ts`、`src/gateway/server-methods-list.ts`
- 任务模型（**A/B 不改**）：`src/organization/task-assignment.ts`
- 闸口：`src/gateway/billing/agent-run-governance.ts`、`src/gateway/billing/authorize-commercial-run.ts`
- 定时/隔离执行：`src/cron/isolated-agent/run.ts`、cron RPC（`cron.add/update/remove/run`）
- actor 作用域解析：`src/gateway/employee-workbench-scope.ts`（`resolveEmployeeWorkbenchActor`）
