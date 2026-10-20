# Bridge MVP（B1 + B2）

**版本**：2026-09-15 rev2.1  
**状态**：Bridge MVP specification = **ACCEPTED**；**B1/B2 runtime coding = NOT APPROVED**（P0 ACCEPTED ≠ 编码授权）  
**上级文档**：[CO-Chat 反馈环审阅报告（rev2）](/design/openbot-co-chat-feedback-loop-state-machines-2026-09-15)  
**关联**：[Completion Contract](/design/completion-contract)、[Event Mapping](/design/event-mapping)

---

## 1. 范围与准入

| 阶段    | 内容                                 | 运行时                           |
| ------- | ------------------------------------ | -------------------------------- |
| **P0**  | 三份 spec + schema + 测试向量 + 评审 | **禁止**改 Gateway/MCP/CT/Ledger |
| **P1**  | B1 + B2 只读/事件化                  | 评审 PASS 后                     |
| **P2a** | B4 Autopilot evidence                | 在 B1/B2 稳定后                  |
| **P2b** | B5 唤醒语义                          | 可观测先行                       |
| **P3**  | B3 Leader/round                      | 需漂移数据                       |

**P1 明确不改**：`chat.send`、CT activation 边界、CT projection/authorization flag、Autopilot 自动 close CT。

---

## 2. 架构原则

1. Gateway **只发**标准化 completion event（[BridgeEventEnvelope](/design/event-mapping#41-envelope所有-bridge-事件共用)）。
2. **MCP owner** 决定是否更新 Flow；Gateway **不得**写 MCP Flow/TaskCard 存储。
3. completion 到达 **≠** 自动 `done`；须 MCP 侧 Worker/Contract 规则 + reason code。
4. 迟到 / 重复 / 不可信事件 → **丢弃 + discardReason**（audit）。
5. B1 是**事件适配器**，不是跨系统状态写入器。

---

## 3. B1：Background Completion Adapter

### 3.1 权限边界

| 角色          | 允许                                                        | 禁止                                       |
| ------------- | ----------------------------------------------------------- | ------------------------------------------ |
| **Gateway**   | 规范化 announce；查 B2；发 envelope；log discard            | 调用 MCP `flow_*`；写 flow.json；自动关 CT |
| **MCP owner** | 校验 ACL；幂等；**可选** `flow_substep_update`；Signal wake | 无 binding 时静默伪造 done                 |
| **Worker**    | 手动 Flow（兼容路径）；处理 inbound                         | 绕过 Contract 关 CT                        |

### 3.2 数据流（修订）

```
subagent announce
  → Gateway: validate tenant + binding + cancel generation
  → if fail: log discardReason, STOP
  → emit BridgeEventEnvelope(background.completed)
  → MCP owner:
       if idempotent: RC_DUPLICATE_REPLAY
       if Worker policy allows: flow_substep_update (NOT automatic on Gateway)
       optional: Signal task_done
  → Contract: 仅当 P1/P2 evidence 路径涉及 background 时 evaluate
```

**关键**：文档不再写「Gateway 自动推进 Flow」；改为 **「Gateway 发事件；MCP 在策略允许下推进展示态」**。

### 3.3 Gateway 责任

- 构造 envelope；**显式** `tenantId`（fail-closed，[BR-T3](/design/event-mapping#101-与现有-ct-activation-的边界冲突)）
- 查 B2：`bindingId` + `bindingVersion`
- 检测 cancel / stale run
- **不**调用 MCP

### 3.4 MCP owner 责任

- 验证 `serverAttribution`
- 幂等表（与 Contract idempotency 对齐）
- Flow 更新是 **显式策略**（feature flag + Worker 可达性），非默认
- 失败：`flow_substep_update(failed)` 或仅 inbound，**不** close CT

### 3.5 失败与 discard

（同 rev1 + 全部映射到 [ReasonCode](/design/completion-contract#4-reason-codereject过程码)）

---

## 4. B2：ID 绑定合同

### 4.1 主键与版本

```typescript
type BindingRecord = {
  /** 绑定主键 */
  bindingId: string; // uuid
  /** 单调递增；retry/correction 递增 */
  bindingVersion: number;
  idempotencyKey: string; // 创建幂等

  tenantId: string;
  scope: "group_tenant" | "personal_local";
  /** 任务逻辑主键 */
  primaryId: string;
  primaryGeneration: number;

  flowStepSeq?: number;
  flowSubStepId?: string;
  /** 一对多：一个 sub-step 可有多 run（retry） */
  subagentRunIds: Array<{
    runId: string;
    status: "active" | "superseded" | "terminal";
    spawnedAt: string;
  }>;
  supervisorTaskId?: string;
  ledgerTaskId?: string;
  conversationTaskId?: string;
  roundId?: string; // 观测 only，P3 前非权威

  status: "active" | "superseded" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  supersededBy?: string; // bindingId
};
```

**主键**：`bindingId`；**版本**：`bindingVersion`；**幂等**：`idempotencyKey`（创建时）。

### 4.2 生命周期

| 阶段           | 动作                                                 | 失败补偿                                |
| -------------- | ---------------------------------------------------- | --------------------------------------- |
| **Create**     | Worker Flow 四步后 / task assign                     | 失败则不发 B1 绑定字段；Worker 手动路径 |
| **Attach run** | spawn 时 append `subagentRunIds[-1].active`          | spawn 失败则无 run；无 binding 更新     |
| **Retry**      | 新 runId + **bindingVersion++**；旧 run `superseded` | 旧 run 完成 → `RC_RUN_STALE`            |
| **Terminal**   | run completed/failed                                 | MCP 可选更新 Flow                       |
| **Cancel**     | binding `cancelled`                                  | 迟到事件 discard                        |
| **Expire**     | TTL 到 → `expired`                                   | 同 stale                                |
| **Supersede**  | correction step → 新 bindingId                       | 旧 binding 只读                         |

### 4.3 规则问答（专家清单）

| 问题                         | 裁定                                                     |
| ---------------------------- | -------------------------------------------------------- |
| 哪个 ID 是主键？             | `bindingId` + `bindingVersion`；`primaryId` 为任务关联键 |
| 一 Flow step 多个 subagent？ | **允许**（retry / 并行 sub-step）；每 run 独立 attach    |
| retry 新 runId？             | **是**；旧 run **superseded**                            |
| stale run 完成？             | **拒绝**，`RC_RUN_STALE`                                 |
| cancel 后迟到事件？          | **拒绝**，`RC_RACE_LOST_TO_CANCEL`                       |
| TTL？                        | 默认 7d（可配置）；过期 `expired`                        |
| 审计？                       | create/attach/supersede/cancel 全量 append-only log      |
| 跨 tenant？                  | **硬拒**，`RC_TENANT_MISMATCH`                           |

### 4.4 部分绑定失败

- spawn 成功但 B2 attach 失败：event 仍发，但 **无** flowStepSeq；MCP inbound-only
- CT id 未知：允许 `primaryId=correlationId`；ledger 只读关联稍后可补

### 4.5 P0 冻结：绑定存储 SoT（不可推迟到编码阶段）

| 层级              | 角色                         | 说明                                                                    |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------- |
| **Primary SoT**   | **MCP server（co-chat）**    | `BindingRecord` 权威读写；Flow/group ACL 原生在此                       |
| **Derived index** | **Gateway（可重建）**        | `subagentRunId → bindingId` 内存/本地索引，仅供 announce 路径 O(1) 查表 |
| **非选项**        | 独立共享 DB / Gateway 双 SoT | **P0 否决** — 避免 ACL 分裂与幂等事务双写                               |

**写入路径**：

1. Worker Flow 四步 → MCP 创建 `BindingRecord`（`bindingId`, v1）
2. `sessions_spawn` → Gateway 暂存 runId；Worker/MCP 调用 **`binding.attachRun`** → MCP 更新 record + **推送** Gateway index
3. announce → Gateway 读 index → 发 `BridgeEventEnvelope` → MCP 消费

**Gateway index 规则**：

- 仅接受 MCP 签发的 attach 事件（`serverAttribution: mcp-server:binding`）
- 进程重启可全量从 MCP 重建；**丢失 index 不丢 SoT**
- TTL 清理以 MCP 为准；Gateway index entry TTL ≤ MCP `expiresAt`

**Schema**：`docs/design/schemas/binding-record.schema.json`  
**样例**：`docs/design/fixtures/b2-binding/sample-binding-active.json`

---

## 5. uiStatusProjection（只读，P1）

完整规则见 [ui-status-projection.md](/design/ui-status-projection)。

```
uiStatusProjection = mergeReadOnly(
  ledgerFacts,
  flowDisplay,
  latestContractVerdict
)
```

- **不**开启 ConversationTask projection phase flag
- Flag 建议名：`BRIDGE_UI_STATUS_PROJECTION`（**非** `PROJECTION` alone）

---

## 6. 权限与 ACL

（同 [event-mapping §10](/design/event-mapping#10-tenant--acl-合同)；B2 编码前 **BR-T1–T5** 必须 review PASS。）

---

## 7. P1 推荐实现顺序（只读/事件化）

1. Gateway 标准 `BridgeEventEnvelope` + discard log（schema: `bridge-event-envelope.schema.json`）
2. B2 binding **MCP SoT** + Gateway derived index + `binding.attachRun`
3. uiStatusProjection read API（不改 Ledger 写路径）
4. 事件去重 + 来源校验
5. MCP Flow 更新（**flag 默认 off**）
6. **不**改 chat.send / CT activation

---

## 8. 测试计划

（rev1 T1–T7 + 下列 P0 向量）

| #   | 场景                        | 期望                       |
| --- | --------------------------- | -------------------------- |
| T8  | retry 新 runId，旧 run 完成 | stale                      |
| T9  | partial attach 失败         | inbound-only               |
| T10 | group 事件无 tenant         | fail-closed                |
| T11 | Gateway 尝试写 flow.json    | **禁止**（静态/arch 测试） |
| T12 | MCP flag off                | 无 Flow 变更，event 仍审计 |

---

## 9. Feature flags

| Flag                           | 默认 | 说明                          |
| ------------------------------ | ---- | ----------------------------- |
| `BRIDGE_B1_COMPLETION_ADAPTER` | off  | Gateway emit                  |
| `BRIDGE_B2_ID_BINDING`         | off  | 绑定 CRUD                     |
| `BRIDGE_UI_STATUS_PROJECTION`  | off  | 只读 UI                       |
| `BRIDGE_MCP_FLOW_AUTO_UPDATE`  | off  | MCP 自动 Flow；**非** Gateway |

---

## 10. 明确不在 MVP

- B3、B4（P2a）、B5（P2b）运行时
- 统一 force-off 实现（[Contract §14](/design/completion-contract#14-force-offs8-目标合同非现有实现)）
- CO Flow ↔ Ledger 存储合并

---

## 11. 变更记录

| 日期              | 变更                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| 2026-09-15        | 初稿                                                                                   |
| 2026-09-15 rev2   | binding 生命周期、B1 权限边界、uiStatusProjection、准入 NOT YET、P1 实现顺序           |
| 2026-09-15 rev2.1 | §4.5 冻结 MCP SoT + Gateway derived index；schema/fixtures；准入 NOT APPROVED          |
| 2026-09-16        | P0 收官：specification **ACCEPTED** @ `da79ee8774`；runtime coding 仍 **NOT APPROVED** |
