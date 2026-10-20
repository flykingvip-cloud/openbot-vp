# 组织协作任务 / 组织通知统一业务逻辑

| 项       | 内容                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 文档状态 | 专家复审修订稿 → 可开发                                                                                   |
| 日期     | 2026-09-27                                                                                                |
| 适用范围 | OpenBot 员工工作台：会议召集、部署通知、组织内人员召集/广播类任务                                         |
| 关联现状 | `Meeting` 生命周期、`ScheduleEntry`、steward/大白确认票据、`TaskAssignment`、工作台 notices/pending-tasks |
| 非目标   | 会后纪要拆任务（Phase C4）、计费归因细节、跨租户外发                                                      |

---

## 1. 专家复审结论（针对上一版建议）

### 1.1 总体裁定

上一版「五步统一成一条组织协作链路」**方向正确，应采纳**；但原文有四处必须修订后再开发：

1. **不要立刻用一个新根实体替换 `Meeting`**  
   上一版 `OrgDispatch` 容易诱发大爆炸重构。复审结论：先定义**统一协议（CollabDispatch Protocol）**，`Meeting` / 部署通知 / 召集通知作为**适配器（adapter）**接入；会议域现有状态机与存储先保留，按协议改副作用时机。

2. **「确认后写全员日程」与产品五步冲突，必须改**  
   现状：`pending_approval → confirmed` 时对**全体 attendees** `fanOutMeetingScheduleEntries`。  
   产品要求：收件人先点「已知晓」，**ack 后**才写入**该人**日程/待办。  
   这是对既有 Phase B 设计的**有意修订**，不是小补丁；文档与实现需同步改。

3. **确认入口必须回到对话，但不能另起一套令牌**  
   复用现有 steward confirmation store / `DaibaiConfirmationEnvelope`（`proposalId` + `confirmationToken` 不回传模型）。  
   对话确认卡是主路径；工作台「待办/通知」是镜像入口。禁止把唯一确认口放在深层「日程/会议」页。

4. **收件人身份模型要先说清**  
   现状会议 attendees 已出现人类 userId 与机器人/席位标识混用。统一协议必须区分：
   - `human`：走知晓确认卡 + 个人日程/待办
   - `agent`：走内部总线/员工会话投递 + 可选自动 ack 策略（见 §5.4）
   - `space`：空间广播（默认关闭或需二次确认）

### 1.2 上一版仍应保留的部分

- 五步顺序：发起人确认 → 发信 → 写发起人日程/待办 → 收件人确认 → 写收件人日程/待办
- 模型不可自批自准
- 首页四卡只做投影，不另造第三套流程
- 幂等、撤销回收、租户/actor 隔离

### 1.3 复审红线

- 不在状态迁移里跑 LLM；LLM 只产草稿/通知文案候选。
- 不在未放行前外发或写权威日程。
- 不让发起人/模型代收件人 ack。
- 不把 `TaskAssignment` 人类受派大改绑进本阶段（避免拖垮 M1）；本阶段优先 `ScheduleEntry` + 待办投影项。
- 默认定向名单投递；「广播」必须显式 `audience=space|tenant` 且单独授权。

---

## 2. 问题陈述

### 2.1 产品诉求

凡部署、通知、组织召集人员类任务，统一经历：

1. **任务通知确认**（发起人确认通知稿可发出）
2. **向特定人员发信/通知/广播**
3. **将任务记录到发起人的今日日程/待办**
4. **被通知人点确认（已知晓）**
5. **对方确认后，自动记录到其今日日程/待办**

### 2.2 现状差距（据实）

| 步骤 | 现状                                     | 差距                               |
| ---- | ---------------------------------------- | ---------------------------------- |
| 1    | 会议有 `pending_approval` + 确认票据     | 确认主入口在工作台，对话内无法完成 |
| 2    | 发信/扇出不完整或与确认耦合不清          | 缺少统一 Delivery                  |
| 3    | 发起人日程未在「仅放行」时单独保证       | 与全员扇出绑在同一 `confirmed`     |
| 4    | 有 `rsvpStatus`，但未成为写日程前置      | 知晓确认未产品化                   |
| 5    | `confirmed` 时直接写全员 `ScheduleEntry` | 跳过收件人 ack                     |

---

## 3. 统一业务对象：协作放行单（CollabDispatch）

> 命名说明：对外产品文案用「组织协作任务 / 组织通知」；对内类型名建议 `CollabDispatch`（放行单），避免与 agent `task_ledger`、工作台 `TaskAssignment` 混淆。

### 3.1 定义

`CollabDispatch` 是一次「需要发起人放行、再触达名单、并落到日程/待办」的确定性业务单据。

它不是聊天消息，也不是模型 task；它是可持久化、可审计、可投影到四卡的权威记录。

### 3.2 最小字段

```ts
type CollabDispatch = {
  id: string; // 幂等业务 id
  tenantId: string;
  kind: "meeting" | "deploy" | "notice" | "summon";
  title: string;
  body: string; // 通知正文（发起人确认的那一版）
  organizerUserId: string;
  timeWindow?: {
    // 可空：纯通知可不进时间轴
    startAtMs: number;
    endAtMs?: number;
    timezone: string;
  };
  audience: {
    mode: "roster" | "space" | "tenant"; // 默认 roster
    spaceId?: string;
  };
  recipients: Array<{
    id: string; // 稳定收件人 id
    kind: "human" | "agent";
    role?: "required" | "optional" | "organizer";
    deliveryStatus: "pending" | "sent" | "failed";
    ackStatus: "none" | "pending" | "acked" | "declined";
    ackedAtMs?: number;
    scheduleProjection?: "none" | "ok" | "failed";
  }>;
  status: "draft" | "pending_organizer_confirm" | "released" | "cancelled";
  confirmation?: {
    // 发起人确认票据引用（不含 token 明文落模型）
    proposalId: string;
    expiresAtMs: number;
  };
  sourceRef?: {
    // 适配器回指
    kind: "meeting" | "manual" | "deploy";
    id: string;
  };
  createdAt: string;
  updatedAt: string;
};
```

### 3.3 与现有实体关系

```
CollabDispatch (协议/外观)
  ├─ adapter: Meeting        （现有 meeting-store / lifecycle）
  ├─ adapter: DeployNotice   （新建或薄封装）
  └─ adapter: SummonNotice   （新建或薄封装）

投影：
  ├─ ScheduleEntry           （发起人 @ released；收件人 @ acked）
  ├─ Workbench notices/todos （发起人待确认、收件人待知晓）
  └─ Delivery records        （内部信道发信结果）
```

**本阶段不要求**把 `Meeting` 表物理合并进 `CollabDispatch` 表；允许 Meeting 继续存会议专有字段，但**副作用时机必须遵守本协议**。

---

## 4. 状态机与五步映射

### 4.1 主状态（单据级）

```
draft
  └─ submit ──► pending_organizer_confirm
                   └─ organizer_approve ──► released
                   └─ cancel ──► cancelled

released
  └─ cancel ──► cancelled   （回收投递与未 ack 投影）
```

说明：`released` 表示「发起人已放行」。单据不再等待全体 ack 才算完成；完成度用收件人回执进度表示。

### 4.2 收件人子状态（并行）

```
none ──(release 时投递成功)──► pending
pending ── ack ──► acked ──► 写该人 ScheduleEntry/待办
pending ── decline ──► declined（不写日程；回传发起人）
```

### 4.3 五步 ↔ 迁移

| 步骤                | 迁移/动作                                                    | 副作用                                                                       |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1 任务通知确认      | `pending_organizer_confirm → released`（消费发起人确认票据） | 锁定 body 指纹；禁止再静默改关键字段后沿用旧票                               |
| 2 发信/通知/广播    | `released` 后 Delivery                                       | 按 recipients 定向投递；写 `deliveryStatus`                                  |
| 3 写发起人日程/待办 | 与步骤 2 同事务或同批补偿                                    | 仅 `organizerUserId`；有 `timeWindow` 写 `ScheduleEntry`，无时间窗写待办投影 |
| 4 收件人确认        | recipient `pending → acked/declined`                         | 消费**收件人本人**确认票据                                                   |
| 5 写收件人日程/待办 | ack 成功后                                                   | 仅该收件人；幂等 upsert                                                      |

### 4.4 关键修订：会议 adapter

旧：

```
pending_approval → confirmed
  └─ fanOutMeetingScheduleEntries(all attendees)
```

新：

```
pending_approval → confirmed(=released)
  ├─ deliver invites/notifications to recipients
  ├─ upsert organizer ScheduleEntry / todo
  └─ recipients.ackStatus = pending

recipient ack
  └─ upsert that recipient ScheduleEntry / todo
```

`Meeting.status=confirmed` 语义改为「已放行」，**不再**表示「全员日程已落库」。可用 `scheduleProjections` / recipients 回执表达进度。

---

## 5. 确认、投递与投影规则

### 5.1 发起人确认（步骤 1）

- 入口：**对话确认卡（主）** + 工作台待办/重要通知（镜像）。
- 票据：复用 steward confirmation；payload 指纹包含 title/body/time/recipients。
- 工具/模型：**不得**返回 `confirmationToken`；只能引导用户点卡。
- 过期：重发新票，不复用旧票批准新内容。

### 5.2 投递（步骤 2）

- 默认 `audience.mode=roster`。
- `human`：员工会话 / 工作台通知 / 内部信道（按租户已接通渠道）。
- `agent`：组织内部 agent 总线或目标 agent 会话。
- `space|tenant` 广播：需显式标记 + 发起人确认文案中展示影响范围；默认关闭。
- 失败：记录 `deliveryStatus=failed`，允许重试；不阻塞已成功对象。

### 5.3 发起人投影（步骤 3）

- 有时间窗：`ScheduleEntry`（`kind` 按 adapter：`meeting` / 可扩展 `notice`）。
- 无时间窗：进入发起人「待办」投影（重要通知/待办卡），不硬塞今日时间轴。
- `sourceRef` 指向 dispatch/meeting id，支持撤销回收。

### 5.4 收件人确认（步骤 4）

- `human`：必须显式 ack（对话卡或待办卡）。
- `agent`：默认策略 **自动 ack**（机器人被召集即视为已受理），仍写投递回执；若产品要求人工席位确认，可配置 `agentAckMode=manual`。
- 发起人不能代 ack；模型不能造 token。

### 5.5 收件人投影（步骤 5）

- 仅 `ackStatus=acked` 后写入。
- 幂等 id：建议 `collab:<dispatchId>:<recipientId>`（会议可继续 `meetingScheduleEntryId`）。
- `declined`：不写日程；发起人侧可见拒绝。

### 5.6 取消

- `cancelled`：停止未完成投递；作废未消费确认票；软取消已写 `ScheduleEntry`；通知已 ack 用户「已取消」（若渠道可用）。

---

## 6. UX 规格（对话优先）

### 6.1 发起人侧

1. 大白整理通知稿（标题、时间、对象、正文、影响）。
2. 对话内出现确认卡：「确认发送组织通知」。
3. 确认后回复：已发送对象列表 + 发起人日程/待办已登记 + 回执进度（0/N）。
4. 工作台「会议邀请待审核」等计数作为镜像，点击应回到同一确认动作，而不是另一套流程。

### 6.2 收件人侧

1. 收到组织通知卡：「请确认已知晓」。
2. 确认后：个人今日日程/待办出现对应项。
3. 可拒绝（可选原因）；拒绝不写日程。

### 6.3 禁止的体验

- 仅提示「请去日程/会议深层页确认」而无对话卡。
- 未确认就出现在收件人日程。
- 模型声称「已替你确认」。

---

## 7. 工作台四卡投影

| 卡片     | 如何消费 CollabDispatch                                                  |
| -------- | ------------------------------------------------------------------------ |
| 今日日程 | 已落库且属于今日的 `ScheduleEntry`                                       |
| 待办事项 | 发起人：`pending_organizer_confirm`；收件人：`ackStatus=pending`         |
| 重要通知 | additive：组织通知待确认 / 知晓待确认（延续 meeting-invite-review 模式） |
| 即将协作 | 不重复展示纯时间会议（避免与今日日程双计）                               |

原则：**四卡只读投影，不发明第二状态机**。

---

## 8. API / 工具边界（开发接口草案）

> 名称可在实现时微调；语义必须稳定。

### 8.1 网关 RPC（建议）

- `collab.dispatch.create` / `submit`
- `collab.dispatch.approve`（发起人，带 proposalId+token，UI 调用）
- `collab.dispatch.ack` / `decline`（收件人，带本人票据）
- `collab.dispatch.cancel`
- `collab.dispatch.get` / `list`（actor 作用域）

会议可继续暴露 `meeting.*`，内部转调同一副作用管线。

### 8.2 Agent 工具

- 允许：`create` 草稿、`submit` 进入待确认、查询状态、提醒用户确认。
- 禁止：无用户票据的 `approve`/`ack`。
- `confirmationToken` 永不进入模型上下文。

---

## 9. 分期实施（建议 Sprint）

### Sprint D1 — 协议与会议副作用纠偏（最高优先）

- 文档落地（本文）。
- 会议：`confirmed` 后改为「投递 + 写发起人日程」；移除/门禁「全员立即写日程」。
- 收件人 ack → 写该人日程。
- 发起人确认卡打通对话主路径（复用票据）。
- 验收：腾讯会议类任务可在对话确认；未 ack 收件人日程不出现。

### Sprint D2 — Delivery 统一

- 人类/agent 定向投递适配器。
- 失败重试与回执进度展示。

### Sprint D3 — 扩展 kind

- `deploy` / `notice` / `summon` 复用同一协议。
- 无时间窗走待办投影。

### Sprint D4 — 广播与治理

- `space|tenant` 广播授权、审计、撤销。
- 与用量/席位并发策略对齐（避免确认后因并发上限无法投递）。

---

## 10. 验收标准

1. 发起人仅在对话确认卡（或镜像待办）放行；无令牌不能放行。
2. 放行后：指定收件人收到通知；发起人日程/待办已有记录。
3. 收件人未 ack 前：其今日日程/待办**无**该事项。
4. 收件人 ack 后：其日程/待办出现；重复 ack 幂等。
5. 拒绝：不写其日程；发起人可见。
6. 取消：回收未 ack 与已写投影。
7. 会议/部署/召集三种 `kind` 走同一套步骤文案与状态语义。
8. 回归：既有四卡计数不因未放行草稿膨胀；租户隔离不破。

---

## 11. 测试清单

- 状态机合法/非法边（含重复 approve、过期票、指纹变更）。
- 发起人投影与收件人投影时序（released 前后对比）。
- 人类 ack / decline；agent 自动 ack 策略开关。
- Delivery 部分失败时的补偿与重试。
- 工作台 notices/todos additive merge 不破坏知识治理计数。
- 对话确认卡与工作台入口命中同一 proposal。
- 取消回收 ScheduleEntry。

---

## 12. 开放问题（实现前需产品拍板）

1. **agent 收件人**默认自动 ack，还是一律人工席位确认？
2. **无时间窗通知**是否允许写入「今日日程」还是只进待办？建议只进待办。
3. **拒绝原因**是否必填？建议选填。
4. **已 ack 后改期**：走「新 dispatch」还是「amend + 全员重确认」？建议改期需重新发起人确认，已 ack 用户需再次知晓确认。
5. **历史 `confirmed` 且已全员写日程的数据**：迁移时视为已 ack，还是回补 ack 状态为 acked？建议回补 `acked` 以保持兼容。

---

## 13. 结论

采用「**CollabDispatch 统一协议 + 现有 Meeting 等适配器**」落地组织内协作任务/通知：

- 产品五步成为唯一主路径；
- 对话确认是发起人闸口；
- 收件人知晓确认是写他人日程的闸口；
- 与现有确认票据、日程存储、四卡投影对齐，避免并行造轮子。

上一版建议在复审后保留骨架，但必须执行本文的四处修订后再进入编码。
