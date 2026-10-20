# 大白管家对话返工要求（交接给 kiro-daibai）

- 日期：2026-06-27
- 提出方：kiro（评审会话）
- 任务：daibai-super-steward
- 性质：返工要求（rework spec）。这是对当前已落地提交的内容评审结论，不是对提交规范的否定——**提交规范、归属、测试都达标，问题在“做的东西没解决用户要的问题”。**

## 1. 评审结论（为什么要返工）

当前 `b322788bde..b1dafaf898` 这批提交，是对**现有 D1（独立 RPC 管家）架构的打磨**，不是用户要的对话重构。用户的核心诉求（“大白不正面回答、被开发监督绑架、关键词强路由、对话记录自动清零”）**基本未解决**，其中开发监督耦合反而更深。

逐项证据（仓库根相对路径）：

- **不正面回答（未达成）**：`src/gateway/server-methods/daibai.ts` 的 `buildAskResult` 里 `summary` 仍是模板化固定话术，全程无 LLM 调用。一般消息落到 `guide.headline`（“你现在有 N 个可用能力…”）。问“今天是星期几”仍得到能力摘要。
- **关键词强路由（未达成）**：`src/gateway/server-methods/daibai-intent-router.ts` 的 `classifyIntent` 仍是关键词三级路由，且本次还扩了关键词并新增 supervisor 早判分支。
- **开发监督被绑架（反向加深）**：本批新增 `supervisorTask.create` service（`daibai-services.ts`）+ action-catalog 条目（`daibai-action-catalog.ts`）+ `classifyIntent` supervisor 分支 + `buildAskResult` 的 supervisor 专属 summary/rationale 分支。监督逻辑被织进对话核心多处。
- **对话记录自动清零（未修）**：`ui/src/ui/controllers/daibai.ts` 的 `askDaibai` 仍每轮 `daibaiAskResult = null` 单轮覆盖；注释明确“普通消息只走 user.daibai.ask，不触发后台 chat agent”；不入 `chat.history`，刷新即空。

## 2. 阻断性前置决策（必须先拍板，否则别再打磨 D1）

1. **架构 D1 → D2**：大白成为**真正的对话 agent**（复用 agentId `main` 的 chat 链路：`chat.send → main agent(LLM) → 持久化 chat.history`），支持单/开发监督降级为**识别到才调用的工具/chip**。
2. **模型与额度归属**：大白对话用哪个模型、token 计费算到哪个 seat/tier（与 tier-credits / model-guardrails 对齐）。
   未定这两项前，**不要继续在 `user.daibai.ask` 的 canned 链路上加功能**。

## 3. 返工要求（逐条，含目标态与落点）

- **R1 正面对话（LLM 驱动）**：大白对一般消息必须产出**真实、贴题的回答**，而非 `guide.headline`。目标做法：员工端大白消息走 `main` chat agent 的真实推理链路；保留大白 system persona。退役 `buildAskResult` 把固定话术当默认回答的逻辑。
- **R2 开发监督降级为工具**：移除 `classifyIntent` / `buildAskResult` / summary / rationale 中的 supervisor 专属分支；开发监督仅作为大白**识别到“改代码/受监督执行”意图时**提供的一个工具/确认 chip（可保留 `supervisorTask.create` service 与 action-catalog 作为“工具实现”，但不得作为对话路由的一级分叉）。
- **R3 支持升级降级为工具**：升级支持单同样改为**判断需要时**才作为工具/chip 出现，去掉“0 单即常驻升级”的强制逻辑（`buildSuggestedActions` 里 `|| activeSupportCases.length === 0` 的兜底）。
- **R4 去关键词强路由**：`classifyIntent` 不再作为决定回答内容的主机制；由 agent 的语言理解驱动回复，关键词最多降级为轻量的“回复后建议 chip”的提示输入。
- **R5 对话历史持久化（修自动清零）**：废弃 `askDaibai` 的单轮 `daibaiAskResult = null` 覆盖模型；大白多轮对话必须累积、并在刷新/重连后仍在（走 `chat.history` 或持久化 steward thread）。
- **R6 保留大白独立身份与能力**：名称“大白管家”/ 🐳 / steward 人格 / 其专属能力（支持单、开发监督、能力引导等）必须保留，且**有别于普通机器人**。若走 D2 复用 `main`，需确保该 agent 携带大白 persona，身份不被泛化掉。

## 4. 验收口径（可直接逐条验，缺一不可）

1. 问“今天是星期几”→ 得到**正面、贴题**的回答，不是“你现在有 N 个可用能力…”。
2. 问“你应该正面回复我”→ 得到正常对话回应。
3. 普通闲聊消息 → **不出**开发监督卡、**不出**强制“升级给平台技术支持”chip；只有干净的回复。
4. 明确的“改代码/受监督执行”请求 → 开发监督作为**识别后**的工具/确认 chip 出现（带二次确认）。
5. 连发多条消息后刷新/重连 → **完整对话历史仍在**（不清零）。
6. 大白仍显示其独立身份（大白管家 / 🐳），其 steward 能力仍可达。

## 5. 保留、勿重做（本批已做好的部分）

- 轻量 inline chip（`DAIBAI_ACTION_CHIP_STYLES` 内联、避开共享 `workbench.css` 冲突）。
- 身份解析补 `employeeUserId`（`resolveDaibaiIdentity`）。
- 升级“近期问题”去重 + 过滤引导话术（`daibai-escalation.ts`）。
- 归属治理（tasks.md / `.loom/registry.yaml` 已收口，CONFLICT 无大白文件）。

## 6. 过程与治理约束

- **隔离执行**：大白对话链路涉及 `app.ts` / `app-render.ts` / `render-model.ts` 等多任务共享热文件，建议由操作者建独立 worktree 后再做 D2 重构，避免与并行任务互相覆盖。
- 提交按绿点分片：改动文件 `get_diagnostics` 干净 + 相关测试绿；只 scope 大白文件，带 `Task: daibai-super-steward` / `Agent: kiro-daibai` trailer；**不要 `git add .`**。
- **不得继续加深** supervisor 与对话核心的耦合（与 R2 冲突）。
- 共享 `workbench.css` 仍按“样式内联到自有组件”或与其 owner 协调，勿整文件提交。

## 7. 一句话给 kiro-daibai

先和操作者确认 **D2 + 模型/额度**；然后把 `user.daibai.ask` 这条 canned/keyword 链路改成**真正的对话**（R1/R4/R5），把开发监督与支持升级**收回成按需工具**（R2/R3），保留大白身份（R6）。按第 4 节验收口径自检通过后再请评审。

---

# 附录 B：Mode A 收口实现方案（无点名 IDE → agent 自执行）

- 追加日期：2026-06-27 · 提出方：kiro（评审/架构会话）
- 目的：把"员工与大白对话、未点名 IDE 时由 agent 自己在工作区改代码"做成**安全的默认路径**。
- **核心原则：三件改动全部 scope 到「员工 steward 会话」（sessionKey 形如 `agent:main:employee:<owner>`），不动全局默认**，将爆炸半径限制在员工大白路径，其它 agent/渠道行为逐字节不变。
- **决策已定（操作者 2026-06-27）**：item 2 采 **S1**（仅 `workspaceOnly=true`，**不**引入 docker sandbox）；S2 列为后续可选。落地采**方案 2**：由 owner 实现，kiro 逐件复检。
- **建议归属**：整个 Mode A 收口（item 1/2/3）作为 **kiro-daibai 的一个子任务**统一实现——因为 item 1/2 虽落在共享 reply 管线（`get-reply.ts`/`pi-tools.ts`/`attempt.ts`），但**改动全部 scope 到员工 steward 会话**，与大白功能同源。kiro-daibai 需把签入 `paths` 扩到这几个被触及文件（注明 scope=employee-steward-only），并与 `supervisor/*`（item 3 守卫，development-supervisor owner）协调那一处。

## Item 1 —— 按员工隔离的工作区接线（修"全员工共享全局 main 工作区"）

现状：`src/auto-reply/reply/get-reply.ts:107` `workspaceDirRaw = resolveAgentWorkspaceDir(cfg, agentId)` 只按 agentId="main" 解析 → 所有员工共享同一工作区；按员工隔离的 `resolveEmployeeBuiltinStewardWorkspaceDir` 只在 workspaceDir 为空时兜底（`src/agents/workspace-run.ts:108`），此路径不触发。

改法（`get-reply.ts:107` 前插入 steward 感知解析）：

```ts
// 已有 helper（src/agents/builtin-steward/employee-isolation.ts:50 / :141）
import {
  extractEmployeeStewardUserIdFromSessionKey,
  resolveEmployeeBuiltinStewardWorkspaceDir,
} from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";

const employeeOwnerId = extractEmployeeStewardUserIdFromSessionKey(agentSessionKey);
const workspaceDirRaw =
  employeeOwnerId && isBuiltinStewardAgent(agentId)
    ? resolveEmployeeBuiltinStewardWorkspaceDir(employeeOwnerId) // <stateDir>/agents/main/employees/<owner>/workspace
    : (resolveAgentWorkspaceDir(cfg, agentId) ?? DEFAULT_AGENT_WORKSPACE_DIR);
```

要点：仅员工 steward 会话改道；非 steward / operator 路径不变。`ensureAgentWorkspace` 会按目录创建，天然可写、按员工隔离。

## Item 2 —— 沙箱 / 工作区收口（员工自执行不直达宿主）

现状：默认 `tools.fs.workspaceOnly=false`（`src/agents/tool-fs-policy.ts` `resolveEffectiveToolFsWorkspaceOnly`）、sandbox opt-in → 员工 agent 的 write/exec 默认直达宿主、不限工作区。

**分叉决策：采 S1（已定 2026-06-27）；S2 后续可选、本次不做。**

- **S1（推荐，低风险）**：仅对员工 steward 会话强制 `workspaceOnly=true`，把 read/write/edit/apply_patch 限制在该员工工作区内；exec 仍由 exec-approval 兜底。不依赖 docker。
- **S2（更重，可后置）**：在 S1 基础上对员工 steward 会话默认开 docker sandbox（进程级隔离），需宿主有 docker、改动更大。

S1 落点（不动全局默认，按会话注入 override）：给 `createOpenClawCodingTools`（`src/agents/pi-tools.ts:198`）选项加可选 `forceWorkspaceOnly?: boolean`，在 `src/agents/pi-embedded-runner/run/attempt.ts:847` 调用处对员工 steward 会话传 `forceWorkspaceOnly: true`；`createToolFsPolicy` 处取 `workspaceOnly = forceWorkspaceOnly || fsConfig.workspaceOnly`。判定复用 `extractEmployeeStewardUserIdFromSessionKey(sessionKey)`。
（可选）exec：对员工 steward 会话把 `exec.ask` 默认设为 `always`，确保 shell 必经审批。

## Item 3 —— 路由拆分：仅"点名 IDE"才走 Fabric/监督（owner: kiro-daibai + supervisor owner）

现状：`src/gateway/server-methods/daibai-supervisor-draft.ts` 的 `isDevelopmentSupervisorIntent` 把"泛开发（重构/改代码/改 UI/界面/布局/现代化/开发任务）"与"点名 IDE（codex/cursor/devin）"混为一组，全部默认 `workerBackendId:"codex-cli"` → 推向监督/CLI。

改法：

1. 新增 `isExplicitIdeRequest(message)`：仅当**点名外部 IDE 工具**（codex / cursor / cursor-agent / devin / kiro / claude code / windsurf）或**显式启动语**（"启动/打开/用 …(IDE) 跑"）才为 true。
2. `buildSupervisorTaskDraft` 改为**仅 `isExplicitIdeRequest` 命中才返回 draft**；泛开发（无点名）返回 null → 不再生成监督 chip → 落到 Mode A（大白用自己的工具在工作区做）。
3. `daibai.ts` 的 supervisor 建议 chip 随 `buildSupervisorTaskDraft` 收敛（无点名即不出 chip）。
4. 守卫收窄：`src/gateway/supervisor/free-chat-cli-guard.ts` 的 `assertFreeChatSessionsSpawnAllowed` 去掉/替换 `isDevelopmentSupervisorIntent(task)` 这一拦截分支（改用 `isExplicitIdeRequest` 或仅保留"governed CLI backend / ACP runtime"判定），避免误伤 Mode A 的泛开发自执行；保留"未监督拉起被点名 IDE CLI"的拦截。

## 验收口径（在附录前 6 条基础上新增）

1. 员工 A、B 分别与大白对话改文件 → 各写入各自 `…/employees/<ownerA|B>/workspace`，互不污染。
2. 员工大白 write/edit 越出工作区被拒（S1：workspaceOnly 生效）。
3. "帮我改下这个 UI 布局"（未点名 IDE）→ 大白**自己改**并正面回复，**不**出现开发监督卡。
4. "用 Cursor 改这个模块" / "启动 codex 跑一下"（点名 IDE）→ 出现开发监督确认 chip（Mode B）→ createSupervisedTask → Fabric/IDE CLI。
5. 泛开发的 subagent spawn 不再被 `free-chat-cli-guard` 拦；未监督拉起点名 IDE CLI 仍被拦。
6. 全套 daibai/steward + reply-pipeline 相关测试绿；改动文件 `get_diagnostics` 干净。

## 落地与治理

- item 1/2（`get-reply.ts` / `pi-tools.ts` / `attempt.ts` / `tool-fs-policy.ts`）= 共享核心 reply 管线，**改动 scope 到员工 steward 会话**，建议隔离 worktree + 指定 lander，带 `Task` / `Agent` trailer。
- item 3（`daibai-supervisor-draft.ts` / `daibai.ts` / `free-chat-cli-guard.ts`）= 各自 owner 落地（kiro-daibai / supervisor owner）。
- **决策已定**：item 2 = S1（`workspaceOnly`，无 docker）。落地 = 方案 2（owner 实现 + kiro 逐件复检）。建议 kiro-daibai 统揽 item 1/2/3 并扩签入 paths（scope=employee-steward-only），item 3 守卫处与 supervisor owner 协调。
