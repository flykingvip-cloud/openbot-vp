# Development Supervisor Chat Bridge

## Goal

**员工工作台**内的大白对话入口 → 用户确认 → `supervisor.task.create` → 开发监督看板双端可见；避免把「改仓库」留在不可审计的自由聊天路径。

> 本 bridge **不是**「任意 OpenBot 消息渠道（Telegram/WhatsApp/Slack…）上的通用开发能力」。它是 **Workbench / 员工开发场景** 的交付范式，与父 spec `development-supervisor` 的 M5 环境前置一致。

## 受众与渠道边界（验收前必读）

| 维度           | 工作台（本 bridge 目标）                                                   | 外部消息渠道（非目标）                                                 |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 交互           | `confirmation` / `confirmationDetail` 结构化确认卡 + 深链看板              | 纯文本，无法原样呈现建议卡/确认票据                                    |
| `repoRoot`     | `resolveDefaultAgentWorkspace` / `collaboration.defaults.workspace` 可配置 | 机器人 `process.cwd()` 通常不是用户仓库；无仓库概念                    |
| 建议卡出现条件 | 开发意图 + **有效 git `repoRoot`** + supervisor feature **ON**             | 默认部署下 `buildSupervisorTaskDraft` 返回 `null` → **不出卡（预期）** |
| Worker         | 宿主需安装/登录 `codex-cli` 等（见 `cli-backends`）                        | 典型消息机器人部署不具备                                               |
| 商业闸         | `assertSupervisorTenantCommercialCapacity` + feature gate 默认 off         | 付费/受控能力，非全量用户默认开放                                      |

**结论**：MVP 验收必须在 **员工工作台 → 大白助手 prelude** 上执行，且 dev 宿主具备 **真实 git 仓库 + supervisor 启用 + Worker 就绪**。在消费级消息渠道上「卡片不出现」不是 bridge bug，而是 **隐含前置未满足**。

## 与 OpenBot 产品形态的关系

- **大白（D1 RPC 管家）**：能力面 = `daibai-action-catalog` 注册的 READ/WRITE 动作；`user.daibai.execute` 只分发目录动作。**目录内无 `exec` / shell / 裸 codex**，结构上无法「聊天内裸 exec 改仓」。行为规则见 `src/agents/builtin-steward/behavior-rules.ts`（**不注入 chat prompt**，仅作意图路由/闸门策略）。
- **默认对话 agent（机器人本体）**：用户可将 **`codex-cli` 选为对话模型**，经 `isCliProvider` → `runCliAgent` 直接改代码 —— **绕过监督、不可审计、双端不可见**。这才是「禁止裸 exec」需治理的对象（见下方任务 6 决策）。
- **开发监督（路径 A）**：`supervisor.task.create` → Supervisor Engine → Fabric Worker Runtime → Worker CLI。本 bridge 把路径 B（大白意图）收敛到路径 A。

## Agents

- cursor-fable · role: owner · scope: chat bridge MVP · paths: `src/gateway/supervisor/task-create-service.ts`, `ui/src/ui/supervisor/supervisor-task-board.ts` · since: 2026-06-18
- codex-daibai-conflict · role: contributor · scope: daibai vs supervisor bridge 热文件 owner 收敛 · paths: `.kiro/specs/development-supervisor-chat-bridge/tasks.md`, `.kiro/specs/daibai-super-steward/tasks.md` · since: 2026-07-04

## Ownership Boundary

- `src/gateway/server-methods/daibai.ts`
- `src/gateway/server-methods/daibai-workspace-overview.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-assistant.ts`

以上大白热文件自 **2026-07-04** 起统一归 **`daibai-super-steward`** 单一 owner 维护。
本 bridge 仅通过：

- `src/gateway/supervisor/task-create-service.ts`
- `src/gateway/server-methods/daibai-supervisor-draft.ts`
- `src/gateway/server-methods/daibai-action-catalog.ts`
- `src/gateway/server-methods/daibai-services.ts`
- `ui/src/ui/supervisor/supervisor-task-board.ts`

完成集成，不再直接编辑上述 3 个热路径，避免阻塞 gateway 集成。

## Tasks

### Code-complete（MVP bridge）

- [x] Extract `createSupervisedTask` service shared by gateway RPC + daibai delegate — cursor-fable
- [x] Register `supervisor.task.create` in daibai action catalog + steward service — cursor-fable
- [x] Intent router + draft builder for `development.supervisor` domain — cursor-fable
- [x] Chat UI task card + deep-link to supervisor board — cursor-fable

### 集成 / 实机（任务 5 — 补证据，非补代码）

- [ ] **E2E on dev host**（与父 spec M5.5 场景 B 四件套同一笔账）— 操作见 **`e2e-checklist.zh-CN.md`**

### 护栏（任务 6 — 先决策，再实现）

**原任务表述**（「大白 system prompt 禁止裸 exec」）对 **D1 形态名不副实** —— 大白无 prompt 注入面、也无 exec 目录项。

**决策（2026-06-18，专家组对齐）**：

| 层级   | 对象           | 手段                                                                                                                                                         | 优先级     |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 结构   | 大白 RPC（D1） | 目录闸门：仅注册 `supervisor.task.create` 等 WRITE；无 exec 动作                                                                                             | ✅ 已满足  |
| 软     | 默认对话 agent | 系统提示 / steering：识别改仓意图时引导用户走开发监督或工作台                                                                                                | 辅助       |
| **硬** | 默认对话 agent | **exec-approval / tool-fs-policy**：对 repo 写副作用类 shell/cli 命令 fail-safe 或强制审批，与 `src/agents/bash-tools.exec*.ts`、`src/fabric/probes.ts` 对齐 | **主护栏** |

- [ ] **6a（硬闸，推荐先做）**：在 exec 策略层拦截/审批「改仓库」类 CLI 副作用（`codex`/`cursor`/`git` 等），错误信息引导 `supervisor.task.create` 或工作台入口 — **已落地** `src/gateway/supervisor/free-chat-cli-guard.ts`（`runCliAgent` + `exec` 工具）；待本清单实机验收
- [ ] **6b（软引导，可选）**：对话 agent 装配层增加 steering 文案（**非** `behavior-rules.ts` prompt 注入）
- [x] ~~6c 大白 prompt 护栏~~ — **取消**（D1 无注入点；重复劳动）

## MVP acceptance（仅员工工作台）

前置：supervisor ON + 有效 git `repoRoot` + Worker 就绪 + 操作者有 `operator.write`。

1. 在 **员工工作台 → 大白助手** 发送开发意图（如「用 codex 重构开发监督 Tab UI」）
2. Prelude 出现建议动作 **「创建开发监督任务」**
3. 确认后返回 `taskId` + 聊天卡片
4. **我的任务 → 开发监督** 可见该任务，深链自动选中

**非验收项**：Telegram/WhatsApp 等外部渠道出现同款卡片；无 repo 的默认机器人部署出卡。

## 相关文档

- 父 spec 验收：`../development-supervisor/acceptance-guide.zh-CN.md`（§12 场景 B/C 补证）
- 商业闸：`docs/design/openbot-tier-credits-model-guardrails-plan-2026-06-24.md`
- 大白形态：`src/agents/builtin-steward/behavior-rules.ts`（D1 vs D2）
