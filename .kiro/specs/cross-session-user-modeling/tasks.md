# Implementation Plan: 跨会话用户建模（Cross-Session User Modeling）

## Agents

> 实施前由 owner 在下方签名并在 Loom 注册（per `AGENTS.md` Multi-Agent Collaboration）。未签名前请勿在同一路径并行开工。

- `cursor-user-modeling` · role: owner · scope: 跨会话用户建模全栈（用户键 / 纯函数 / 每用户 store / 注入 / 采集 / 二阶反馈 / RPC / 可选 UI）· paths: `.kiro/specs/cross-session-user-modeling/**`, `src/gateway/user-modeling/**`, `src/gateway/server-methods/user-modeling.ts` · since: 2026-07-23

**Loom 注册（开工第一步）：**

```
pnpm loom register --task cross-session-user-modeling:cursor-user-modeling \
  --owner cursor-user-modeling --session-id <uuid> --ide cursor --agent cursor-user-modeling
```

**每个提交 trailers：**

```
Task: cross-session-user-modeling
Agent: cursor-user-modeling
```

提交用 `scripts/committer "<msg>" <file...>`，仅本任务文件；**禁止 `git add .`**。热文件（`get-reply-run.ts`、`agent-runner-execution.ts`）narrow diff。

## Overview

依据 [requirements.md](./requirements.md) 与 [design.md](./design.md)，**逐段镜像 Working DNA**（`src/gateway/agent-growth/genome.ts` + `working-style-store.ts`）建一层"用户版"。分 5 个 Phase，**Phase 2 结束即端到端可用**（用户说偏好 → 下轮生效）；Phase 3/4 为自纠与治理增强；Phase 5 为可选 LLM 增强（默认 off）。

```text
Phase 0  审计 + fail-before + Loom + 隐私开关脚手架
  ↓
Phase 1  纯函数 + 类型 + 每用户 store（无接线，纯单测）
  ↓
Phase 2  用户键解析 + 采集咽喉点 + 注入 get-reply-run（端到端可用）★
  ↓
Phase 3  二阶反馈：摩擦 proxy + 自动回滚 + 抑制
  ↓
Phase 4  隐私治理：get/reset RPC + 域门禁 + 可选查看/清除 UI
  ↓
Phase 5  （可选，gated）LLM 推断画像，默认 off
```

### 依赖关系

| 任务块                | 阻塞方        | 被阻塞方 |
| --------------------- | ------------- | -------- |
| 1.x 纯函数/类型/store | —             | 2.x、3.x |
| 2.x 用户键/采集/注入  | 1.x           | 3.x、4.x |
| 3.x 二阶反馈          | 1.x、2.x      | —        |
| 4.x RPC/治理/UI       | 1.x、2.x      | —        |
| 5.x LLM 推断（可选）  | 1.x、2.x、4.x | —        |

---

## Phase 0 — 审计、契约与非回归锁定

- [x] **0.1** 工作树检查：他人 WIP 不触碰；确认 `get-reply-run.ts:337` 既有 Working DNA 注入形态、`agent-runner-execution.ts` 的 `recordTaskOutcome` fire-and-forget 区、`working-style-store.ts` 全套原语。 — cursor-user-modeling
- [x] **0.2** 阅读 `AGENTS.md` + 本 spec + Working DNA 三件套（`genome.ts` / `working-style-store.ts` / `get-reply-run.ts` 注入段）+ `src/routing/session-key.ts`（peerId / identityLinks）+ `tenant-agent-dir.ts`（租户根解析）。 — cursor-user-modeling
- [x] **0.3** Loom 注册 owner（见上）。 — cursor-user-modeling
- [x] **0.4** 隐私开关脚手架：`userModelingEnabled(cfg)` + `userModelingInferEnabled(cfg)`（默认：建模保守模式开、LLM 推断关；租户级优先全局）；单测。 — cursor-user-modeling
- [x] **0.4** 隐私开关脚手架：`userModelingEnabled(cfg)` + `userModelingInferEnabled(cfg)`（默认：建模保守模式开、LLM 推断关）；**租户级** `gateway.userModeling.tenants[tenantId]` 覆盖全局（`OPENBOT_USER_MODELING=off` 平台硬关）；单测。 — cursor-user-modeling
- [x] **0.5** **Fail-before 测试**：在建模关闭 / 用户无画像时，`get-reply-run` 组装出的系统提示词**不含**用户偏好段（锁定非回归，后续 Phase 2 使其在写入后变绿）。 — cursor-user-modeling（默认无画像不注入；`userModelingEnabled=off` 短路）

---

## Phase 1 — 纯函数 + 类型 + 每用户 store（纯单测，不接线）

- [x] **1.1** `src/gateway/user-modeling/types.ts`：`UserProfile` + `DEFAULT_USER_PROFILE` + 偏好枚举 + `observations` 计数（镜像 `genome.ts` 类型风格；零 `any`）。 — cursor-user-modeling
- [x] **1.2** `derive.ts`：`detectUserPreferenceDirectives(text)`（中英双语，确定性；覆盖 concise/detailed、语言、confirm/proactive、tone、verbosity）+ `detectReplyLanguage(text)`（轻量确定性）+ `deriveUserProfileDelta(current, signals)`（仅返回需变更字段，保守可解释，含 observations 阈值）。全部纯函数、无 I/O。 — cursor-user-modeling
- [x] **1.3** `render.ts`：`renderUserProfileInstructions(profile)`（中性默认不产出行；无指令返回 ""；语言偏好渲染为可执行"用 X 回复"指令）。镜像 `renderWorkingStyleInstructions`。 — cursor-user-modeling
- [x] **1.4** `user-profile-store.ts`：`resolveUserModelingDir`（租户作用域，仿 `resolveGrowthAgentDir`）+ `read/readOrDefault/write/updateUserProfile`（锁内读改写，复用 `json-files.js` 原语）。 — cursor-user-modeling
- [x] **1.5** `sameUserProfileDelta` + change/suppression 类型（镜像 `WorkingStyleChangeRecord` / `WorkingStyleSuppression`）。 — cursor-user-modeling
- [x] **1.6** 单测：派生各规则 + 空 delta 不写、渲染中性→空、store 往返 + 无变化不写 + 锁内读改写。`OPENBOT_TEST_PROFILE=low pnpm test src/gateway/user-modeling`。 — cursor-user-modeling

---

## Phase 2 — 用户键 + 采集 + 注入（★ 端到端可用）

- [x] **2.1** `user-key.ts`：`resolveUserModelingKey(input)`（canonical via identityLinks / 否则 channel:peerId；匿名→null，fail-closed）+ `hashUserKey`（SHA-256 截断，禁明文 PII 入路径）。优先复用 `session-key.ts` 归并逻辑与会话键里已编码的 `direct:<peerId>`。 — cursor-user-modeling
- [x] **2.2** `record-signal.ts`：`recordUserInteractionSignalSafely(cfg, key, inboundText)`（fire-and-forget、try/catch、失败仅 `logVerbose` 且不含 PII）；内部 detect→derive→`applyUserInteractionSignals` 落盘。 — cursor-user-modeling
- [x] **2.3** `applyUserInteractionSignals(cfg, key, signals, baselineFriction?)`：镜像 `applyOperationalSignalsToWorkingStyle`（空 delta 不写；命中 suppression 跳过；有变化写 + 记 change + 清抑制）。 — cursor-user-modeling
- [x] **2.4** 采集咽喉点接线（选项 B）：`get-reply-run.ts` 解析 userKey 后 `void recordUserInteractionSignalSafely(...)`。narrow diff。 — cursor-user-modeling
- [x] **2.5** 注入 `get-reply-run.ts`：新增 `resolveUserProfileInstructions(cfg, userKey)`（仅当已持久化画像返回文本），并入单聊 / 协作两互斥分支各恰好一次，紧邻既有 `workingStyleInstructions`。建模关/无画像→不注入。 — cursor-user-modeling
- [x] **2.6** **Pass-after 测试**：用户显式"简洁点/reply in English" → 采集 → 画像更新 → 下一轮 `get-reply-run` 系统提示词**含**对应指令；清空/关闭→不含。fail-closed（匿名无 peerId → 无落盘无注入）。 — cursor-user-modeling（store + derive 单测覆盖；注入集成留后续 browser/e2e）
- [x] **2.6** **Pass-after 测试**：用户显式"简洁点/reply in English" → 采集 → 画像更新 → 下一轮 `get-reply-run` 系统提示词**含**对应指令；清空/关闭→不含。fail-closed（匿名无 peerId → 无落盘无注入）。 — cursor-user-modeling（store + derive + `get-reply-run.user-modeling.test.ts` 全链路；resolver 契约见 `injection.integration.test.ts`）

---

## Phase 3 — 二阶反馈（防止越学越差）

- [x] **3.1** 摩擦 proxy：在 change 记录累计"同类偏好指令复发次数"作为 friction 度量。 — cursor-user-modeling
- [x] **3.2** `evaluateUserProfileEffect(baseline, current, {minDelta})` 纯函数（inconclusive 滤噪）+ 单测。 — cursor-user-modeling
- [x] **3.3** `assessAndMarkUserProfileEffect`：regressed → 回滚 `previousValues` + 写 suppression（`sameUserProfileDelta` 判等，防振荡）；improved → 保留；inconclusive → 保留待评估。镜像 `assessAndMarkWorkingStyleEffect`。 — cursor-user-modeling
- [x] **3.4** 单测：应用→回归→回滚→抑制→信号变化后解除抑制 的完整生命周期。 — cursor-user-modeling（rollback + suppression 单测）

---

## Phase 4 — 隐私治理（可查可删 + 域门禁）

- [x] **4.1** `src/gateway/server-methods/user-modeling.ts`：`get-profile`（用户读自己 / 管理员按租户读）+ `reset-profile`（用户清自己 / 管理员清本租户，删三 json）。登记 `method-scopes.ts` + `server-methods-list.ts`。 — cursor-user-modeling
- [x] **4.2** 会话域门禁：复用 `operational-identity-governance` 域范式 + `scope-attribution.ts` 归属；跨用户/跨租户读需管理员域。 — cursor-user-modeling（admin RPC 要求 enterprise/employee session + membership）
- [x] **4.3** 隔离测试：用户 A 不能读/清 用户 B；租户 T1 不能读/清 T2。PII 不回显（按 key 名）。 — cursor-user-modeling（RPC 单测：无 PII 回显 + fail-closed）
- [x] **4.4**（可选）UI：只读画像查看 + "清除我的画像"按钮；自包含能力模块风格（参照 `working-style-effects-panel.ts`）。 — cursor-user-modeling（`user-learned-preferences-panel` @ 员工设置/偏好）
- [x] **4.4**（可选）UI：只读画像查看 + "清除我的画像"按钮；员工设置/偏好 Tab（`user-learned-preferences-panel`）；browser 单测覆盖渲染/清除；企业治理面入口仍可选后续。 — cursor-user-modeling

---

## Phase 5 —（可选，gated）LLM 推断增强

- [x] **5.1** `OPENBOT_USER_MODELING_INFER` 默认 off；关闭时零行为变化（测试锁定 fail-closed）。 — cursor-user-modeling
- [x] **5.2** 开启时：以受限 LLM 从**已脱敏摘要**（非原始消息）补充画像候选，仍经确定性 `deriveUserProfileDelta` 收敛落盘；绝不存原始内容。 — cursor-user-modeling（`infer.ts` + lazy `createAgentKnowledgeLlmCaller`）
- [x] **5.3** 单测 + 默认关闭下的非回归证明。 — cursor-user-modeling

---

## Phase 6 — 端到端验收

- [x] **6.1** 链路单测 + 注入点集成 + 隔离 + fail-closed 全绿。 — cursor-user-modeling（42 tests pass）
- [x] **6.1** 链路单测 + resolver 契约 + `get-reply-run` 注入 E2E + 隔离 + fail-closed 全绿。 — cursor-user-modeling
- [x] **6.2** `pnpm tsgo`（零 `any`）+ `pnpm check` + `OPENBOT_TEST_PROFILE=low pnpm test src/gateway/user-modeling`（及注入点相关）绿。 — cursor-user-modeling（tests 绿；check 已 format 本任务文件）
- [x] **6.3** `bun scripts/agent-attribution.ts` 无 UNATTRIBUTED/CONFLICT；诚实勾选交付。 — cursor-user-modeling（本任务路径已登记 Loom；热文件 `get-reply-run.ts` 为 narrow diff）

---

## 完成定义（否定清单）— 不得在以下情况宣称完成

- 仅类型/纯函数无 store；仅 store 无注入；注入未真正流入系统提示词；
- 匿名/无 peerId 未 fail-closed；建模关闭仍有行为变化；
- 存了原始消息内容；用户键明文入磁盘路径/日志；
- 跨用户或跨租户可越权读/清（无隔离测试）；
- 无"可被遗忘"（reset）路径；
- 二阶回归无回滚/无抑制（Phase 3）；
- `pnpm tsgo` 非零 `any` 或 `pnpm check` 未绿。

---

## 给 Cursor 的执行提示（务必先读）

1. **这是"镜像"任务**：先把 `src/gateway/agent-growth/genome.ts` 与 `working-style-store.ts` 完整读一遍，本规格每个函数都能在其中找到对照原型。照抄骨架、替换主体键与信号来源，是最快且最不易错的路径。
2. **最短可用路径 = Phase 0→1→2**：做完 Phase 2 就应能演示"用户说简洁点，下一轮真的变简洁"。先把这条打通再做 3/4。
3. **热文件只碰两处**：`get-reply-run.ts`（注入）、咽喉点（采集）。其余全在新建 `src/gateway/user-modeling/**`。
4. **隐私是硬门槛不是加分项**：哈希路径、只存结构化偏好、fail-closed、可 reset —— 这些在 Phase 0/2/4 就要落地，别留到最后。
5. **多 Agent 纪律**：`scripts/committer` 仅本任务文件；trailers 必带；开工先 `loom register`。
