# 会议纪要拆任务 fan-out（Phase C4）设计评审稿（2026-06-30）

状态：待评审。延续 `docs/design/employee-schedule-meeting-lifecycle-2026-06-30.md` §3.4 / §7.1.2 的硬要求：
“真正 fan-out 到 TaskAssignment（含 dueAt / 人类受派人扩展）推迟到 Phase C，届时**单独评审任务模型扩展**”。
本稿即该单独评审；评审通过前不实施。

## 1. 范围与定位

- 目标：会议确认纪要后（minuted），把纪要里“分给每个人的不同任务”（已是 C0 校验过的 `TaskCandidate`）
  fan-out 成每位受派人各自的 `TaskAssignment`，回流到 M1“待处理任务”卡。
- 这是 Phase C 最高风险的一步：它**首次给 `TaskAssignment` 引入人类受派维度 + 时间维度**，并做**跨人写**，
  直接触碰 M1（四卡里最稳定、最关键的一条线）。
- 已就位的前置：C0 候选域（`TaskCandidate` 类型 + 校验）、C2/C3b 会议后半段状态机 + `meeting.minute`/`meeting.distribute`
  （minuted→distributed 已是 organizer 确认点）。

## 2. 现状模型（务必据实）

### 2.1 TaskAssignment（`src/organization/task-assignment.ts`）

- 字段：`id`、`organizationId`、`title`、`ownerAgentId`、`createdByAgentId`、`status`
  （pending / accepted / running / completed / rejected）、`ackRequired`、时间戳、`notes?`。
- **per-AGENT、org 作用域**：无 `dueAt`（时间）、无人类受派人（`assigneeUserId`）。
- 存储：按 `organizationId` 存在空间 memory 目录（workspace 侧 + managed `<stateDir>/spaces/<org>/memory`），按 id 去重。
- 确定性 id：`sha256(organizationId, title, ownerAgentId, createdByAgentId)` 前 16 位。

### 2.2 M1 如何消费（pending-tasks-read-model.ts）: 关键风险点

- M1 按**actor 的 seatSpaceIds**（所在空间）读各空间的 assignments，过滤 `status === "pending"`，
  以 `kind:"task"`、id `task:<assignmentId>` 计入。
- **M1 当前按空间过滤，不按受派人过滤**（因为现模型根本没有受派人）。
- 含义（C4 的核心约束）：若直接 fan-out 每人不同任务到同一空间，**该空间每个在座成员的 M1 都会看到所有人的任务**
  → 串号 + 计数膨胀 + 越权可见。这与“每人只读自己 / 不动既有计数”直接冲突。

## 3. 拟定扩展（全部加法式，不破坏既有 agent 任务）

### 3.1 TaskAssignment 扩展（additive）

新增三个可选字段，**不改既有必填字段、不改 status 枚举**：

- `assigneeUserId?: string`：人类受派人（新增的“人”维度）。缺省 = 既有的 per-agent 任务，行为不变。
- `dueAt?: string`（ISO 8601）：截止时间。
- `sourceRef?: { kind: "meeting"; id: string }`：来源会议（provenance + 取消回收时定位）。

`ownerAgentId` 仍必填、保持语义（“管理该任务的 agent”，会议场景 = organizer 的 `main`）；`assigneeUserId` 是
正交的“受派的人”。这样既有读写路径零改动，新字段纯增量。

### 3.2 M1 读模型：按受派人收敛（本稿最重要的安全改动）

`pending-tasks-read-model.ts` 增加一条过滤规则：

- assignment **有 `assigneeUserId`** → 仅当 `assigneeUserId === actor.userId` 时计入 / 呈现；
- assignment **无 `assigneeUserId`**（既有 agent 任务）→ 维持现状（空间作用域，行为/计数不变）。

效果：人类受派任务“每人只读自己”，既有任务计数**逐字节不变**（它们都没有 `assigneeUserId`）。这是 C4 能否
安全落地的闸门，必须与 fan-out 同批落地。

### 3.3 Fan-out（在 organizer 确认点触发，跨人写授权）

- 触发：`meeting.distribute`（minuted→distributed，organizer 主动确认）。**不自动 fan-out**，确认即分发。
- 来源：会议已确认的 `MinutesDraft.actionItems`（C0 校验过的 `TaskCandidate[]`，存于 `Meeting.minutes`）。
- 行为：对每个带 `assigneeUserId` 的 actionItem，创建一条 `TaskAssignment`：
  - `organizationId` = 会议 `spaceId`（见 §4 开放问题，无 spaceId 的处理）；
  - `assigneeUserId` = candidate 的受派人；`title`/`dueAt`/`notes` 来自 candidate；
  - `ownerAgentId` = organizer 的 agent；`createdByAgentId` 服务端盖章为 organizer 的 agent；
  - `sourceRef = { kind:"meeting", id: meetingId }`；`status="pending"`、`ackRequired=true`。
- 确定性 id：`meeting-task:<meetingId>:<assigneeUserId>:<sha(title)>` → 重复 distribute 替换而非重复。

### 3.4 跨人写授权（HYB 越权教训）

- 仅会议 **organizer**（= 当前 actor，服务端解析）可对**本会议 roster 内**的受派人创建任务；
- 受派人必须 ∈ 会议 attendees（bounded 到本会议名册）；越界的 candidate 受派人被丢弃 / 拒绝（不静默越权）；
- 租户隔离：`organizationId` / tenant 一致；每位受派人只通过 §3.2 的过滤读到自己的任务。

## 4. 开放问题（请评审定夺）

1. **无 `spaceId` 的会议如何落 org 作用域？** TaskAssignment 是 org 作用域、存于空间 memory 目录。会议 `spaceId` 可选。
   - 选项 A：C4 仅对**有 spaceId** 的会议 fan-out；无 spaceId 的会议暂不拆任务（最小风险，推荐）。
   - 选项 B：引入 tenant 级伪 org / 新的 per-user 任务存储（更大改动，推迟）。
   - 建议：A。
2. **取消已分发的会议是否回收任务？** 建议：distributed 后取消 → 将 `sourceRef` 命中的任务转 `rejected`（镜像
   ScheduleEntry 回收）。需确认。
3. **受派人 candidate 没有 `assigneeUserId` 怎么办？**（纪要里未明确归属的行动项）建议：不 fan-out（留作未分配候选，
   或归 organizer 自己）；不臆测受派人。需确认。
4. **dueAt 类型**：ISO 字符串（与 candidate `dueAt` 一致）vs ms（与 ScheduleEntry `startAtMs` 一致）。建议存 ISO，
   M1 解析为 ms 排序。需确认。
5. **人类 accept/complete 闭环**是否纳入 C4？建议拆出 C4b（`task.accept`/`task.complete` RPC + UI），C4 只做创建侧。

## 5. 分期

- **C4a（本评审实施项）**：§3.1 模型扩展 + §3.2 M1 受派人过滤 + §3.3 fan-out（distribute 触发）+ §3.4 授权 + 测试。
  纯加法、确定性；不动既有 agent 任务路径与计数。
- **C4b（跟进）**：人类受派人 accept/complete RPC + 候选/任务 UI（同 A1.3 交接式）。

## 6. 验收与测试

- 模型：扩展字段往返；既有任务（无 assigneeUserId）序列化/读取不变。
- M1：有 assigneeUserId 的任务仅对受派人计入；其他成员看不到；既有任务计数逐字节不变（快照对比）。
- Fan-out：每受派人一条；id 幂等（重复 distribute 不增殖）；roster 外受派人被拒；租户隔离。
- 授权：非 organizer 不能借本路径派任务；越界受派人被拒。
- 取消回收（若采纳开放问题 2）：distributed→cancelled 把 sourceRef 任务转 rejected。
- 命令：`pnpm tsgo`（过滤本域文件零错）、相关测试子集、`pnpm exec oxlint/oxfmt`、`node scripts/tsdown-build.mjs`。

## 7. 红线（沿用主设计）

- 不在确认前自动 fan-out；分发是 organizer 的确认动作。
- 不改既有 `TaskAssignment` 必填字段 / status 枚举 / 既有 agent 任务行为与 M1 计数。
- LLM 永不直接写 `TaskAssignment`：actionItems 已是 C0 校验过的候选，fan-out 是确定性写入 + 服务端盖章受派/作者。
- 跨人写 bounded 到本会议 roster；每人只读自己；租户隔离。

## 8. 关联

- 主设计：`docs/design/employee-schedule-meeting-lifecycle-2026-06-30.md`（§3.4 任务模型隔离、§7.1.2 身份与跨人 fan-out）。
- 代码锚点：`src/organization/task-assignment.ts`、`src/gateway/workbench/pending-tasks-read-model.ts`、
  `src/organization/meeting-lifecycle.ts`（distribute 落点）、`src/organization/lifecycle-candidates.ts`（TaskCandidate）。
