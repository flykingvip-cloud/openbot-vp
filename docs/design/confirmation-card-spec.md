# OpenBot 确认卡 / 弹层（Confirmation Card）SPEC

> **状态：已接受草案（accepted draft）— 可进入实现规划**（落库 `docs/design/`；非 chat-only）  
> **决策记录：** 用户于 2026-10-02 选择 `accept-defaults-design-pr`，开放问题默认值已写入 §8。  
> 日期：2026-10-02  
> 动机：会议确认卡一度用「一次性 UX 补丁」复述助手气泡里的详情，并在腾讯会议 `joinUrl` 未就绪时仍发卡 → 用户拒绝补丁式修复，要求系统规则一次性定死。  
> 基线仓库：`openbot-fix-exec` @ `origin/main` (`7815b68995`)

---

## 0. 现状盘点（inventory，供对照）

| 能力             | 路径 / 符号                                                                                               | 现状要点                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Steward 确认票据 | `src/gateway/server-methods/steward-confirmation-store.ts` · `createConfirmation` / `consumeConfirmation` | 进程内 one-shot；默认 TTL 5min；`reason`: `not_found` \| `expired` \| `token_mismatch` \| `payload_mismatch` \| `action_mismatch` |
| 票据类型         | `src/shared/daibai-types.ts` · `DaibaiConfirmationEnvelope` / `DaibaiConfirmationDetail`                  | envelope 含 `proposalId`+`confirmationToken`+`payloadHash`+`expiresAtMs`；detail 含 title/impact/irreversible/…                   |
| 会议确认         | `src/organization/meeting-confirmation.ts` · `issueMeetingApprovalConfirmation`                           | payload 指纹含 title/time/roster/`joinUrl`；**工具不得把 token 回灌模型**                                                         |
| 会议网关         | `src/gateway/server-methods/meeting.ts` · `meeting.approve` / submit                                      | 无 token → `pending_confirmation`；有 token → consume →（可选）腾讯 provision → `confirmed`                                       |
| 会议 UI 卡       | `ui/.../workbench-stage-assistant.ts` · `renderMeetingConfirmationCard`                                   | **当前会渲染整段** `formatOrganizerMeetingNotice` + Confirm/Cancel；`organizerMeetingLinkPending` 时禁用确认                      |
| 链接未就绪       | `ui/.../meeting-notice-text.ts` · `organizerMeetingLinkPending`                                           | 线上地点且无 `joinUrl` → linkPending；**仍出卡**，仅藏确认按钮                                                                    |
| 大白通用确认卡   | 同文件 · `renderDaibaiConfirmationCard`                                                                   | title + message + impact/权限/不可逆/有效期 + 确认/取消（信息密度高）                                                             |
| 组织派发确认     | `src/organization/collab-dispatch-confirmation.ts`                                                        | 复用 steward store；blast radius 进 `confirmationDetail`（见 `docs/design/org-collab-dispatch-dev-2026-09-27.md`）                |
| 企业审批流       | `docs/design/approval-workflow-model.md`                                                                  | **另一条轨**：Grant/Scope 审批，非 chat confirm 卡；本 SPEC 不合并                                                                |

**用户已拒的方向：** 继续在会议卡上「补丁式」藏按钮 / 再堆详情文案。  
**本 SPEC 要定的方向：** 谁决定「何时出卡」、卡里「只能有什么」、失败「如何回传 agent / 气泡」，让会议 / 组织通知 / 破坏性动作共用同一规则。

---

## 1. 范围与非目标

### 1.1 范围内

1. **Chat / Workbench 内** 的发起人确认 UI（确认卡或等价弹层）。
2. **何时签发** `pending_confirmation`（服务端）以及 **何时渲染** 确认控件（客户端）。
3. **卡面内容契约：** 最小控件集；禁止复述线程已有事实。
4. **前置条件（preflight）：** 不满足则 **不出卡**，错误回 agent / 气泡。
5. **过期 / 重发 / 错误分类** 与 UI ↔ gateway ↔ agent 的回流。
6. **扩展点：** 会议放行、组织通知（CollabDispatch）、大白破坏性动作、未来同类「人闸」。

### 1.2 非目标

- 本 PR **仅落地 design-doc**（`docs/design/confirmation-card-spec.md`）；不改产品 / 会议 UI 代码。实现另开规划与 PR。
- 不替代 `ApprovalWorkflow`（企业数据导出等 Grant 审批轨）。
- 不规定模型「怎么写会议通知正文」（那是助手气泡职责）。
- 不规定腾讯会议 OAuth / bridge 内部实现；只规定 **provision 结果如何影响出卡**。
- 不统一所有 Lit 组件视觉（可复用 `employee-workbench__steward-confirm-card`，但文案与字段以本契约为准）。

---

## 2. 角色分工

```
┌─────────────────┐     事实叙述 / 草稿 / 解释      ┌──────────────────┐
│  Model / 助手气泡 │ ─────────────────────────────► │  用户阅读线程      │
└────────┬────────┘                                 └────────┬─────────┘
         │ 调用需人闸的工具/RPC                                │
         ▼                                                    │
┌─────────────────┐  preflight OK → pending_confirmation     │
│ Gateway 门禁     │ ───────────────────────────────────────► │
│ + steward store │  preflight FAIL → error（无卡）──────────►│ 错误进气泡/agent │
└────────┬────────┘                                          │
         │ envelope 仅 UI 持有（token 永不进模型上下文）         │
         ▼                                                    ▼
┌─────────────────┐  Confirm / Cancel only           用户点击
│ 系统确认卡/弹层  │ ◄────────────────────────────────────────
└────────┬────────┘
         │ Confirm → consume ticket → 副作用
         │ Cancel  → 丢弃 pending +（可选）invalidate tickets
         ▼
   成功 epilogue / 失败 error taxonomy → 回流 agent 续聊
```

| 角色             | 拥有什么                                                            | 禁止什么                                                                     |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **助手气泡**     | 会议/通知的完整事实（标题、时间、参会人、链接…）、解释、下一步建议  | 伪造「已确认」；展示或索要 `confirmationToken`                               |
| **系统确认卡**   | 可选短标题 + **确认** + **取消**；可选一行「动作后果」标签（见 §3） | 复述气泡已给出的详情；在 preflight 失败时出现                                |
| **Gateway 门禁** | 签发/校验票据、payload 指纹、TTL、执行副作用、错误码                | 把 token 放进工具返回给模型；在 precondition 失败时仍返回可渲染的 pending 卡 |

**单一所有权原则：** 「要不要出确认 UI」由 **Gateway preflight + 本 SPEC 的卡契约** 决定，**不是** 模型自由发挥，也不是 UI 事后用 `linkPending` 藏按钮来补救。

**详情源（已拍板）：** 业务详情的唯一叙述源是 **助手气泡**；允许 **系统 notice 气泡** 作为 sole detail source（非模型生成）。确认卡 **永不** 持有详情块。

---

## 3. 卡面内容规则（最小契约）

### 3.1 允许字段

| 字段              | 必选         | 说明                                                                                                                                                                         |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | 可选         | ≤ 1 行动作名，如「确认发送会议」「确认发布组织通知」。**不是**业务详情摘要。                                                                                                 |
| 主按钮 Confirm    | 是           | 文案动词化：`确认发送` / `确认执行`；不可逆时可用强调样式（沿用 daibai `irreversible`）。                                                                                    |
| 次按钮 Cancel     | 是           | `取消` / `取消，不发送`。                                                                                                                                                    |
| `consequenceHint` | 可选、≤ 1 行 | **仅**「确认后会发生什么」的闸语义（人数/广播半径/不可逆），**不**复制时间地点链接。可映射现有 `confirmationDetail.impact` 的**缩短版**。 **已拍板：允许一行；禁止详情块。** |
| 错误条            | 条件         | 仅展示本卡生命周期内的操作错误（consume 失败等），见 §5。                                                                                                                    |

### 3.2 禁止字段

- 会议通知全文、参会人列表、议程、`joinUrl`、会议号、地点、时间段（这些属于助手气泡 / 系统 notice 气泡 / 通知正文）。
- 任何 `proposalId` / `confirmationToken` / `payloadHash` 的可见展示。
- 用卡面再讲一遍模型刚说过的话（反模式：当前 `renderMeetingConfirmationCard` 内嵌 `formatOrganizerMeetingNotice`）。
- 详情块、长 message、整段 meta `dl`（新功能不得再扩）。

### 3.3 与现有 daibai 卡的收敛

- `renderDaibaiConfirmationCard` 中的 impact / 权限 / 不可逆 / 有效期：**权限与不可逆可保留为 consequenceHint 的一部分或一行徽标**；长 message、整段 meta `dl` 视为过渡态，新功能不得再扩。
- 会议卡与 daibai 卡最终应共用同一「ConfirmChrome」契约；会议先迁移（§7）。

### 3.4 UI 形态（已拍板）

- 默认 `uiChrome: "inline_card"`。
- 不可逆（`irreversible`）或广播类动作 **可以** 使用 `modal`；非强制，由 `ConfirmActionDescriptor` 声明。

---

## 4. 出卡前置条件（Preconditions）

**规则：** Gateway 在返回 `status: "pending_confirmation"` **之前**跑完 preflight；失败则：

1. **不**创建 steward ticket（或立即作废）；
2. **不**让 UI 进入 `*PendingConfirmation`；
3. 向调用方返回结构化错误（见 §5），由 **agent 气泡** 解释并建议下一步。

### 4.1 会议放行（`meeting.approve` / submit → 待确认）

| 前置                                                                                                        | 失败时                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 会议存在且状态允许进入确认                                                                                  | `precondition_failed` / `illegal_transition`            |
| 发起人 = actor                                                                                              | `forbidden`                                             |
| **若判定为线上会议**（见下 **meetingMode**）：**必须已有可用 `joinUrl`**（腾讯 provision 已成功写入 store） | `provision_required` 或 `provision_failed` — **不出卡** |
| payload 可指纹化（title/time/attendees 等齐全）                                                             | `invalid_draft`                                         |

**线上会议判定（已拍板）：**

- 草稿强制显式字段 `meetingMode: "online" | "offline"`。
- `location` 正则（`meeting-notice-text.ts` 的 `ONLINE_LOCATION`）**仅用于旧数据兼容**；新写入路径必须带显式 `meetingMode`。
- `meetingMode === "online"` 且无可用 `joinUrl` → preflight 失败，**不出卡**。
- `meetingMode === "offline"`（或兼容路径判定为线下）→ 不要求 `joinUrl`。

> 纠偏现状：今天 UI 用 `linkPending` **出卡但禁用确认**；本 SPEC 改为 **服务端不出 `pending_confirmation`**。客户端若仍收到无 joinUrl 的线上草稿，视为协议违规，只显示错误，不渲染确认控件。

### 4.2 组织派发（CollabDispatch）

| 前置                                               | 失败时                       |
| -------------------------------------------------- | ---------------------------- |
| dispatch 处于 `pending_organizer_confirm` 可签发态 | `illegal_transition`         |
| audience / blast 已解析且发起人有权                | `forbidden` / `authz_failed` |
| body 指纹字段齐全                                  | `invalid_draft`              |

（广播半径文案进可选 `consequenceHint`，详情仍在气泡。）

### 4.3 大白需确认写动作

保持现有 `requiresUserConfirmation` 门禁；新增动作必须登记 `actionId` + payload 指纹字段 + 是否 irreversible；**不得**只靠模型文案「请点确认」。

### 4.4 Provision 失败策略（已拍板）

- Provision 失败时：**立即**向 agent / 用户返回错误（`provision_failed` / `provision_required`）。
- **禁止**在同一轮工具调用内静默重试 N 次（除非后续产品明确改口）。
- 重试由模型 / 用户在后续轮次显式发起。

---

## 5. 过期 / 重发 / 错误分类

### 5.1 票据生命周期

| 事件     | 行为                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 签发     | `createConfirmation`；TTL 默认 5min（可按 action 覆盖）；UI 只存 envelope                                         |
| 确认成功 | `consumeConfirmation` → one-shot；跑副作用；清 pending；可选 epilogue（会议：`MeetingConfirmResumeContinuation`） |
| 用户取消 | 清 UI pending；`invalidateConfirmationsByActionId`（会议应对齐 collab 已有 invalidate）                           |
| 过期     | consume → `expired`；清卡；**错误回气泡**，引导「重新发起确认」（重发 = 再走工具/RPC，新 ticket）                 |
| 草稿变更 | payload hash 变 → 旧票 `payload_mismatch`；须重签发                                                               |

### 5.2 错误 taxonomy（建议稳定 `code`，中文 `message` 给用户）

| code                           | 谁产生                   | 是否曾出卡     | 用户侧处理                                                                                |
| ------------------------------ | ------------------------ | -------------- | ----------------------------------------------------------------------------------------- |
| `provision_required`           | gateway preflight        | 否             | 气泡：需先完成线上会议开通 / 绑定                                                         |
| `provision_failed`             | gateway / tencent bridge | 否             | 气泡：开通失败原因 + 重试建议（**立即失败，无同轮静默重试**）                             |
| `invalid_draft`                | gateway                  | 否             | 气泡：缺字段，引导补全                                                                    |
| `expired`                      | consume                  | 曾出卡，现拆掉 | 短错误 +「请重新确认」；agent 可自动提示重发                                              |
| `token_mismatch` / `not_found` | consume                  | 拆卡           | 同 expired 类，勿重试同一 token                                                           |
| `payload_mismatch`             | consume                  | 拆卡           | 「内容已变，请重新确认」                                                                  |
| `action_mismatch`              | consume                  | 拆卡           | 协议/串单，重拉流程                                                                       |
| `confirm_exec_failed`          | 确认后副作用             | 卡已消费       | 气泡报告部分失败（如投递 partial）；可走 replay，**不**回滚「已确认」语义 unless 产品另定 |
| `cancelled`                    | 用户取消                 | 拆卡           | 静默或一句「已取消发送」                                                                  |

**回流原则：** 所有「不能点确认」的原因优先进 **agent 可见错误**（工具结果 / `meetingConfirmationError` 升级为会话消息），而不是冻在半残卡上。

---

## 6. 扩展性（未来确认类型）

新增一种确认 = 登记一张 **ConfirmAction 描述符**（逻辑层，不必一次做配置中心）：

```text
ConfirmActionDescriptor {
  actionIdPattern:  "meeting.approve:<id>" | "collab.dispatch.approve:<id>" | "daibai.<action>" | …
  buildPayload(entity): Record<string, unknown>   // 指纹
  preflight(entity, actor): Result<ok, ErrorCode> // §4
  consequenceHint?(entity): string                // ≤1 行，可选（已拍板允许）
  irreversible: boolean
  onConfirm(entity, ticket): Result               // 副作用
  onCancel?(entity): void
  uiChrome: "inline_card" | "modal"               // 默认 inline_card；irreversible/广播可 modal
}
```

约束：

1. **一律**走 `steward-confirmation-store`（或其后继）；禁止模型 boolean / 本地「假确认」。
2. **token 永不进模型上下文**（已有会议 / collab 注释，升格为全局不变式）。
3. UI 只实现一个 `ConfirmChrome`；按 descriptor 填 title / hint / 按钮危险态。
4. 企业 `ApprovalWorkflow` 不挤进此表；若某动作两条轨都要，先 Approval 再 ConfirmChrome（顺序在专用设计里写，本 SPEC 只声明正交）。

---

## 7. 会议流迁移说明（相对现状）

| 步骤 | 现状                                                                     | 目标                                                                          |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| A    | `meeting.approve` 无 token 即发 `pending_confirmation`，哪怕缺 `joinUrl` | preflight：`meetingMode=online` 且无 `joinUrl` → `provision_*` 错误，**无卡** |
| B    | `renderMeetingConfirmationCard` 渲染 `formatOrganizerMeetingNotice`      | 卡内删除通知正文；通知只留在助手气泡（或独立 system notice 气泡，非确认卡）   |
| C    | `organizerMeetingLinkPending` 藏确认按钮                                 | 降级为防御性断言 / 遥测；主路径不再依赖                                       |
| D    | 确认成功 epilogue（`meetingConfirmRelease`）                             | **保留**（这是结果反馈，不是详情复述）                                        |
| E    | 取消不 invalidate meeting tickets                                        | 对齐 `invalidateCollabDispatchApprovalConfirmations`                          |
| F    | 助手与卡双写同一段通知                                                   | 单一叙述源：助手（或系统 notice 气泡）；卡只做人闸                            |
| G    | 线上判定靠 location 正则                                                 | 新路径强制 `meetingMode`；正则仅 legacy compat                                |

**本 PR 仅落地本文件。** 实现可分后续 PR：gateway preflight → UI 削肉 → meetingMode 字段；本 design-doc **不**改会议 UI 代码。

---

## 8. 已拍板默认值与仍开放项

### 8.1 已拍板（accept-defaults-design-pr，2026-10-02）

| #   | 问题              | 决定                                                                    |
| --- | ----------------- | ----------------------------------------------------------------------- |
| 1   | 线上会议判定      | 显式 `meetingMode: online \| offline`；location 正则仅 legacy compat    |
| 2   | `consequenceHint` | **允许**一行后果提示；**禁止**详情块                                    |
| 3   | provision 失败    | **立即**失败回 agent/user；**禁止**同轮静默 N 次重试（除非产品后改）    |
| 4   | UI 形态           | 默认 `inline_card`；irreversible / 广播 **可以**用 `modal`              |
| 5   | 详情源            | 助手气泡（或系统 notice 气泡可作为 sole detail source）；卡永不持有详情 |
| 6   | 本稿落地          | 本 PR 落到 `docs/design/confirmation-card-spec.md`                      |

### 8.2 仍开放（实现规划时再定，不阻塞本 SPEC）

| #   | 问题         | 备注                                                                                                                             |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| A   | TTL          | 全局 5min 是否够用？广播类 CollabDispatch 是否要更长并在 hint 中提示剩余时间（不展示在卡上也可）？                               |
| B   | partial 投递 | `confirm_exec_failed` / schedule replay 是否仍算「已确认」语义（与 CollabDispatch D1「confirmed=已放行」一致）？需否二次确认卡？ |

---

## 附录 A — 一句话验收标准

> 任意需人闸的写动作：要么 **不出卡** 并把原因交给 agent 气泡，要么出一张 **只有确认/取消（+ 可选一行后果）** 的系统卡；卡上 **永不** 复述线程事实，**永不** 在缺前置（如线上无 `joinUrl`）时出现。

## 附录 B — 关键引用

- `src/gateway/server-methods/steward-confirmation-store.ts`
- `src/organization/meeting-confirmation.ts`
- `src/organization/collab-dispatch-confirmation.ts`
- `src/gateway/server-methods/meeting.ts`
- `ui/src/ui/controllers/meeting-confirmation.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-assistant.ts` (`renderMeetingConfirmationCard`, `renderDaibaiConfirmationCard`)
- `ui/src/ui/ports/employee/views/meeting-notice-text.ts`
- `docs/design/org-collab-dispatch-dev-2026-09-27.md`
- `docs/design/approval-workflow-model.md`（正交轨）
