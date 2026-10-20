# Event Mapping（跨系统事件映射）

**版本**：2026-09-15 rev2.1  
**状态**：**ACCEPTED** — **无运行时依赖**；P0 ACCEPTED **不等于** B1/B2 编码授权  
**上级文档**：[CO-Chat 反馈环审阅报告（rev2）](/design/openbot-co-chat-feedback-loop-state-machines-2026-09-15)  
**关联**：[Completion Contract](/design/completion-contract)、[Bridge MVP](/design/bridge-mvp)

---

## 1. 目的

建立 MCP、Gateway、subagent、Supervisor、Progress Ledger、Autopilot 之间的**统一事件语义**与**可信 attribution 边界**。

**非目标（P0）**：统一消息总线、运行时双写、修改 `chat.send`、修改 CT activation 边界。

---

## 2. 术语：uiStatusProjection

| 术语                                   | 含义                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| **uiStatusProjection** / **readModel** | 只读 UI 状态合并（Ledger 事实 + Flow 展示 + Contract verdict）       |
| **ConversationTask projection phase**  | 业务执行/授权阶段；生产 **flag OFF**，与 uiStatusProjection **无关** |

文档与 flag 命名中避免单独使用 `projection` 指 UI 合并。

---

## 3. 映射表（逻辑事件 → 来源 → 消费者）

| 逻辑事件                      | 典型来源                               | 主要消费者                   | 备注                             |
| ----------------------------- | -------------------------------------- | ---------------------------- | -------------------------------- |
| `worker.assigned`             | MCP `send_to_session(task)`            | B2 绑定、round（观测）       | groupId + **server tenant** 必填 |
| `worker.result`               | MCP `send_to_session(result)`          | Leader COLLECT               | **非**完成证据                   |
| `flow.step.created`           | MCP `flow_step_create`                 | UI、B2                       | Leader only                      |
| `flow.step.updated`           | MCP `flow_step_update_status`          | UI                           | 展示态                           |
| `flow.substep.updated`        | MCP `flow_substep_update`              | UI                           | MCP owner 写入                   |
| `background.started`          | `sessions_spawn` / Supervisor dispatch | B2                           | 含 runId                         |
| `background.completed`        | subagent announce                      | B1 → MCP 消费                | push only                        |
| `background.failed`           | announce error / Supervisor fail       | Contract、MCP                |                                  |
| `validation.accepted`         | Supervisor                             | Contract P1                  |                                  |
| `validation.rejected`         | Supervisor                             | Autopilot REVALIDATING       |                                  |
| `ledger.seeded`               | CT binder                              | uiStatusProjection           |                                  |
| `ledger.step.updated`         | Ledger writer                          | uiStatusProjection、Contract |                                  |
| `conversation_task.activated` | CT path                                | Ledger、UI                   | 现有 canary                      |
| `conversation_task.closed`    | Contract accepted → control plane      | audit                        |                                  |
| `round.complete`              | `ROUND_COMPLETE`                       | Contract P3、观测            | 非 CT close                      |
| `user.decision`               | `[FLOW_DECISION]`                      | Leader                       |                                  |
| `signal.task_done`            | MCP Signal                             | Worker wake                  |                                  |
| `autopilot.candidate`         | Leader GOAL_CHECK                      | Contract pending             |                                  |
| `poll.tick`                   | `wait_message`                         | 心跳                         | ~180s                            |
| `user.cancel`                 | UI / control plane                     | Contract cancelled           |                                  |
| `force.off`                   | 目标 kill switch                       | 见 completion-contract §14   | **未统一实现**                   |

完整表同 rev1；Gateway **不**直接写 MCP Flow 存储。

---

## 4. 标准载荷（含必填 attribution）

### 4.1 Envelope（所有 bridge 事件共用）

```typescript
type BridgeEventEnvelope = {
  contractVersion: "2026-09-15.rev2";
  event: "background.completed" | "background.failed";
  idempotencyKey: string;
  recordedAt: string;
  tenantId: string; // group_tenant 必填
  scope: "group_tenant" | "personal_local";
  serverAttribution: string; // gateway 或 mcp-server 签发
  actorSessionId?: string;
  payload: BackgroundCompletionPayload;
};
```

### 4.2 BackgroundCompletionPayload

```typescript
type BackgroundCompletionPayload = {
  event: "background.completed" | "background.failed";
  subagentRunId: string;
  bindingId?: string;
  bindingVersion?: number;
  flowStepSeq?: number;
  flowSubStepId?: string;
  conversationTaskId?: string;
  supervisorTaskId?: string;
  exitCode?: number;
  errorSummary?: string;
  source: "gateway.subagent" | "gateway.supervisor";
  /** 拒绝原因；MCP 未应用时必填 */
  discardReason?: ReasonCode;
};
```

### 4.3 事件丢弃 reason（Gateway / MCP）

| discardReason            | 条件                         |
| ------------------------ | ---------------------------- |
| `RC_TENANT_MISMATCH`     | tenant 缺失或与 binding 不符 |
| `RC_BINDING_STALE`       | bindingVersion 过期          |
| `RC_RUN_STALE`           | runId superseded             |
| `RC_RACE_LOST_TO_CANCEL` | cancel 已生效                |
| `RC_SOURCE_NOT_ALLOWED`  | 不可信 source                |

---

## 5. CO-Chat Signal ↔ 逻辑事件

（同 rev1 §3，略。）

---

## 6. Gateway 内部 ↔ 逻辑事件

（同 rev1 §4。subagent announce **仅**规范化为 `BridgeEventEnvelope`，**不**触发 MCP tool。）

---

## 7. 唤醒语义（P2b：B5）

| 机制                       | 频率     | 用途                    |
| -------------------------- | -------- | ----------------------- |
| `wait_message` / POLL_TICK | ~180s    | CO-Chat 心跳            |
| Autopilot Watchdog         | ~30s     | 仅 Autopilot budget     |
| Event burst                | on event | uiStatusProjection 重算 |

**P2 顺序**：P2a B4（Autopilot evidence）**先于** P2b B5（唤醒统一）。B5 可先观测重复唤醒，不必先改运行时。

---

## 8. 失败与超时

（同 rev1 §7；所有路径须输出 `reasonCode`。）

---

## 9. 观测与审计

每条 bridge 事件日志最小集：

```
{ event, idempotencyKey, tenantId, scope, serverAttribution,
  bindingId, bindingVersion, subagentRunId, discardReason?, recordedAt }
```

---

## 10. Tenant / ACL 合同

### 10.1 与现有 CT activation 的边界冲突

生产代码存在 **personal 域 fallback**（单机/个人助手历史原因）：

```68:77:src/conversation-task/gateway-activation-hook.ts
export function resolveActivationTenantId(
  tenantId: string | null | undefined,
  requesterId: string | null | undefined,
): string | null {
  const trusted = typeof tenantId === "string" ? tenantId.trim() : "";
  if (trusted) {
    return trusted;
  }
  const requester = typeof requesterId === "string" ? requesterId.trim() : "";
  return requester ? LOCAL_ACTIVATION_TENANT_ID : null;
}
```

**CO-Chat bridge 规则（P0 安全条件，B2 编码前必须满足）**：

| 规则      | 说明                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| **BR-T1** | CO-Chat group/tenant 事件 **必须**携带服务端可信 `tenantId` + `serverAttribution`                      |
| **BR-T2** | CO-Chat bridge **禁止**调用 `resolveActivationTenantId` 的 requester fallback 语义                     |
| **BR-T3** | `scope=group_tenant` 且 `tenantId` 缺失 → **fail-closed**（丢弃事件，`RC_TENANT_MISMATCH`）            |
| **BR-T4** | `scope=personal_local` 为**独立 scope**；不得与 group tenant 混用；`bindingScope` **缺省 fail-closed** |
| **BR-T5** | 跨 tenant 绑定 / 事件 → 硬拒 + audit；`bindingTenantId` **缺省不得跳过**比较（fail-closed）            |

### 10.2 Scope 对照

| scope            | tenant 来源                       | 适用                                      |
| ---------------- | --------------------------------- | ----------------------------------------- |
| `group_tenant`   | MCP server / gateway 签发         | CO-Chat group、B1/B2、Contract            |
| `personal_local` | `LOCAL_ACTIVATION_TENANT_ID` 路径 | 现有 CT 单机激活；**不**进入 group bridge |

### 10.3 ACL 检查点

| 检查点                  | 要求                                   |
| ----------------------- | -------------------------------------- |
| 创建 BindingRecord      | actor ∈ tenant；conversation ACL       |
| 消费 completion event   | **服务端签发校验通过**（前缀匹配不够） |
| uiStatusProjection 读取 | employee / conversation ACL            |
| Autopilot candidate     | groupId + tenant 一致                  |

### 10.4 employee / conversation

- `employeeId`、`conversationId` 须与 `tenantId` 同签发包
- 禁止从 `requesterId` alone 推导 tenant（Contract §5.1）

---

## 11. BridgeEventEnvelope Schema（P0 冻结）

文件：`docs/design/schemas/bridge-event-envelope.schema.json`

| 约束                                     | 实现                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `serverAttribution` 必填                 | 模式 `^(gateway:\|mcp-server:)[…]+$` — **拒绝 client:**                  |
| `scope=group_tenant`                     | **强制** `tenantId`（`oneOf`）；**禁止** `requesterId` 顶替              |
| `bindingId` / `bindingVersion`           | **成对**（`dependentRequired`）                                          |
| `cancelGeneration` / `primaryGeneration` | 可选整数，供 Contract 竞态                                               |
| 额外字段                                 | `additionalProperties: false`（根对象不得出现 `requesterId`）            |
| `event`                                  | P0 **仅准入** `background.completed` / `background.failed`               |
| `payload`                                | 事件级 discriminated：`BackgroundCompletionPayload` + §11.1 键拒绝名单   |
| 可信身份                                 | 前缀 **≠** 不可伪造；须服务端签发并在消费前校验（HMAC/签名在服务端持有） |

### 11.1 PII / HMAC / 原始身份拒绝名单（冻结）

Envelope **根**与 `payload`（含嵌套对象/数组）**均不得**出现下列键（schema `$defs.deniedPayloadName` **大小写不敏感**，`_` / `-` 可省略；`$defs.noPiiObject` 递归 + 根 `additionalProperties: false`）：

`email` · `employeeEmail` / `employee_email` · `phone` · `phoneNumber` / `phone_number` · `password` · `token` · `accessToken` / `access_token` / `AccessToken` · `refreshToken` / `refresh_token` · `hmac` / `HMAC` · `hmacSecret` / `hmac_secret` · `rawIdentity` · `requesterId` / `requester_id` · `privateKey` / `private_key` · `idCard` · `ssn`

**HMAC**：校验密钥只存在于 gateway / mcp-server；envelope **不**包含 `hmac` 字段。`serverAttribution` 前缀只是发送者声明，**必须**另经服务端校验（`EvaluateStore.attributionVerified === true`）后才能进入 `evaluateCandidate`。

否定 fixture：`envelope-invalid-payload-pii.json`、`envelope-invalid-requester-fallback.json`、`envelope-invalid-nested-pii.json`、`envelope-invalid-nested-array-pii.json`、`envelope-invalid-pii-aliases.json`、`envelope-invalid-unlisted-event.json`、`envelope-invalid-freeform-payload.json`。

### 11.2 事件级 payload 边界（P0 诚实范围）

P0 **不**做内容级 DLP：`errorSummary` 等已准入字符串可以包含看起来像 email/token 的值。当前保证只覆盖：

1. **字段名**拒绝名单（§11.1，大小写/snake/kebab）。
2. **事件级结构**：未列入 P0 的 `event` fail-closed；已准入事件的 `payload` 必须通过 `background-completion-payload.schema.json`（`additionalProperties: false`），禁止 `value` / `secret` 这类自由字段。
3. `payload.event` 必须与 envelope `event` 一致。

未冻结 payload schema 的逻辑事件（如 `worker.result`）**不得**进入 bridge。内容扫描或全量事件 schema 是后续项，不是本轮 PASS 条件。

样例：`docs/design/fixtures/bridge-events/`  
CI：`docs/design/scripts/completion-contract-p0-schema.test.ts`

---

## 12. P0 完成标准（本映射）

| #   | 项                         | 状态                                            |
| --- | -------------------------- | ----------------------------------------------- |
| 1   | BridgeEventEnvelope schema | done                                            |
| 2   | BR-T1–T5 文档              | done                                            |
| 3   | discard reason ↔ Contract  | done                                            |
| 4   | 独立安全 reviewer 签署     | **PASS @ `da79ee8774`**（2026-09-16T06:54:21Z） |

---

## 13. 变更记录

| 日期                 | 变更                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| 2026-09-15           | 初稿                                                                                          |
| 2026-09-15 rev2      | tenant ACL、fail-closed、scope 分离、uiStatusProjection、B1 丢弃码、P2 顺序                   |
| 2026-09-15 rev2.1    | §11 envelope schema 冻结；P0 清单诚实化                                                       |
| 2026-09-16           | BR-T5 缺省 binding fail-closed；签发≠前缀；PII/HMAC 拒绝名单；**未 ACCEPTED**                 |
| 2026-09-16 follow-up | BR-T4 `bindingScope` 缺省 fail-closed；`$defs.noPiiObject` 递归嵌套 PII；**A 仍 CONDITIONAL** |
| 2026-09-16 aliases   | 敏感键大小写不敏感 + camel/snake；嵌套数组 fixture；**A 仍 CONDITIONAL**                      |
| 2026-09-16 calendar  | 严格日历日期；P0 仅准入 background.\* payload schema；**不承诺内容级 DLP**                    |
| 2026-09-16 accept    | R14 授权代理 PASS @ `da79ee8774`；Event Mapping **ACCEPTED**；B1/B2 **NOT APPROVED**          |
