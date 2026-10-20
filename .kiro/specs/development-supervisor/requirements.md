# Requirements Document

> Feature: Development Supervisor（开发监督者）

## Introduction

把 OpenBot 从「AI 助手」升级为「AI 监督者」：用户把一个开发任务交给机器人后**离场**，
OpenBot 自主驱动编程 Worker（Kiro / Claude Code / Codex CLI，经 **cli-backend** 接入）持续推进，
在每一轮产出后用 **Fabric** 受治理地运行验证（测试 / lint / build），失败则把验证证据反馈给
Worker 自动重试修复，直到达到**显式验收标准**或触达**有界停止条件**（迭代上限 / 预算上限 / 升级到人），
最终向用户渠道回报进度摘要与交付结果。

用户只看：**开始 → 过程摘要 → 最终结果**；全程无需打开 IDE、无需逐次盯守。

> **产品定位（CTO 评审定版）**：OpenBot 不是 AI Chatbot、也不是 Agent Framework，而是
> **Autonomous Supervisor Platform——「监督 AI 的 AI」**。Cursor/Claude Code/Codex/Devin 是「AI 做开发」；
> OpenBot 形成的是「AI 监督 AI 做开发」，差异化价值高于「再接一个新的编程 Agent」。

### 定位与既有能力的关系（落地依据，已核对代码）

| 层             | 职责                                         | 现状（复用）                                                                                                           |
| -------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Worker         | 执行（写代码）                               | **已建**：`cli-backend`（`runCliAgent` 在 workspaceDir spawn CLI；模型引用 `<backendId>/<model>`；凭证注入；会话续聊） |
| Fabric         | 受治理工具执行 + 审计                        | **已建**：`service.execute`（policy→execute→audit）+ `createProcessRunner`/`generic.git`/`shell` adapter 可真实跑进程  |
| 隔离           | 一任务一工作区                               | **部分**：loom-provisioning 提供 `git worktree`（在 `scripts/loom`，本 spec 不耦合，见 D-ISO）                         |
| 预算           | 成本上限                                     | **已建**：cost-budget-billing + Fabric `costLimit`                                                                     |
| 升级           | 失败转人工                                   | **已建**：daibai-super-steward 的 support-case 升级模式                                                                |
| **Supervisor** | **规划 / 跟踪 / 验证判定 / 有界重试 / 报告** | **本 spec 新增**                                                                                                       |

> 关键认知：终端对话 → Worker 是**模型授权链**路径（`isCliProvider`→`runCliAgent`），**不经 Fabric**；
> Fabric 是**工具执行控制面**，本 spec 用它做 **Validator**。两条面共享同一 **任务工作区**，这是机制支点。

> 专家评审采纳（修订）：在 cli-backend 之上**前置一层 Fabric Worker Runtime**（统一 `Worker` 接口 +
> Worker Adapter Registry，见 R10），Supervisor 消费统一接口而非直连 `runCliAgent`，接第 N 个 Worker 监督逻辑不变。
> **模型面与 Worker 面并存**：终端用户直聊 CLI 的「模型面」（已上线、经 entitlement）保留不变；本 spec 新增由
> Supervisor 驱动的「Worker 面」。两面共用同一份 cli-backend 配置与授权口径，仅运行时句柄不同（一次性模型 run vs 长时 Worker run）。

## Glossary

- **SupervisedTask（监督任务）**：一次受监督的开发交付单元。含 `taskId`、目标描述、**验收标准**、
  worker 后端引用、工作区、状态机、迭代记录、预算、报告。
- **Worker（执行者）**：编程 Agent（CLI 类如 Kiro/Codex/Claude Code，未来 Docker/GitHub/Browser），经统一 `Worker` 接口被驱动。
- **Fabric Worker Runtime（Worker 运行时）**：Fabric 新增层，暴露统一 `Worker` 接口（`start/status/cancel/logs`）+ Worker Adapter Registry；CLI Worker Adapter 复用 cli-backend spawn。Supervisor 只认此接口。
- **WorkerRun（运行句柄）**：一次 Worker 启动的长时句柄（`runId`），可查状态、流式日志、取消。
- **Validator（验证器）**：在任务工作区内、经 Fabric 受治理运行的验证步骤集合（test/lint/build/`loom check`/自定义命令），
  产出结构化 `ValidationReport`，并据 `AcceptanceCriteria` 判定通过/失败。**Fabric 不做判定，判定属 Supervisor。**
- **AcceptanceCriteria（验收标准）**：任务开始时**显式捕获**的可机检条件（哪些命令必须退出码 0 / 覆盖率阈值 / 必含产物）。
- **SupervisionLoop（监督回路）**：dispatch Worker → run Validator → 判定 → 失败反馈重试 的有界循环。
- **StopCondition（停止条件）**：`accepted` | `escalated`（升级到人）| `budget_exhausted` | `max_iterations` | `aborted`。
- **TaskWorkspace（任务工作区）**：Worker 写代码、Validator 验证共享的目录（理想为一任务一 `git worktree`）。
- **运行时 store**：监督任务状态的持久化（`~/.openbot/...`），**不写入 `.loom/registry.yaml`**（后者是开发树治理产物、生产安装不存在）。

## Requirements

### Requirement 1: 任务建立与验收标准捕获

**User Story:** 作为终端用户，我希望用一句话把开发任务交给机器人，并由系统在开始前确定「怎样算完成」，
这样我可以离场，且监督有明确的终止依据。

#### Acceptance Criteria

1. WHEN 用户在对话中提交一个开发任务 THEN 系统 SHALL 创建一个 `SupervisedTask`，分配 `taskId`，
   记录 `goal`、发起 `tenantId/userId`、归属 `agentId`、目标 `worker`（`<backendId>/<model>`）。
2. 系统 SHALL 在派发前确定 `AcceptanceCriteria`：至少包含一组**可机检命令**（如 `npm test`、`npm run build`、`npm run lint`）
   及其通过条件（退出码 0；可选覆盖率/产物存在）。验收标准 SHALL 来自（优先级）显式用户输入 → 任务模板默认 → 仓库探测（存在 `package.json` 的 `test`/`build`/`lint` 脚本即采用）。
3. IF 无法确定任何可机检验收标准 THEN 系统 SHALL NOT 进入自治重试，而 SHALL 以「需补充验收标准」提示用户或降级为单次执行（不声称"已验收"）。
4. `worker` 的 `<backendId>/<model>` SHALL 在该 `agentId`/席位的授权集合内（复用既有 entitlement）；越权 SHALL 拒绝建立任务。
5. 任务建立 SHALL 写运行时 store（持久、可重启恢复），SHALL NOT 写 `.loom/registry.yaml`。

### Requirement 2: 隔离任务工作区

**User Story:** 作为平台，我希望每个监督任务在隔离工作区内推进，避免多任务互相污染、且 Worker 与 Validator 看到同一份代码。

#### Acceptance Criteria

1. 系统 SHALL 为每个 `SupervisedTask` 解析一个 `TaskWorkspace`（绝对路径），Worker（`runCliAgent` 的 `workspaceDir`）
   与 Validator（Fabric 工具 `input.cwd`）SHALL 使用**同一** `TaskWorkspace`。
2. 默认 SHALL 为一任务一隔离工作区（git worktree 或独立子目录）；多任务并行 SHALL NOT 共享同一工作区。
3. WHEN 任务终止（accepted/abandoned）THEN 系统 SHALL 按策略回收或保留工作区（默认保留产物 + 标记可回收）。
4. 工作区解析 SHALL NOT 引入 `src → scripts` 耦合（不直接 import `scripts/loom/*`，见设计 D-ISO）。

### Requirement 3: Worker 派发（执行）

**User Story:** 作为监督者，我需要把当前这一轮工作派发给编程 Worker，并拿到其产出与失败信号。

#### Acceptance Criteria

1. WHEN 进入 `executing` THEN 系统 SHALL 经 **Fabric Worker Runtime** 的统一 `Worker.start` 在 `TaskWorkspace` 内驱动 Worker，
   prompt = 任务目标（首轮）或上一轮**验证失败证据 + 修复指令**（重试轮）；Supervisor SHALL NOT 直接 import `runCliAgent`。
2. Worker 必须以**非交互**方式运行（复用 cli-backend 的 watchdog 语义；交互式挂起→本轮失败，不无限等待）。
3. 系统 SHALL 记录每一轮的 Worker 结果摘要、退出码、用量、耗时到该任务的迭代记录。
4. Worker 凭证 SHALL 复用既有 SecretRef 注入（个人/企业），监督者 SHALL NOT 旁路凭证治理。
5. IF Worker 因缺凭证/鉴权失败 THEN 系统 SHALL 终止该任务并升级（不计入"修复重试"配额）。

### Requirement 4: 验证（经 Fabric，受治理）

**User Story:** 作为监督者，我需要在每一轮 Worker 产出后客观验证结果，且验证过程本身可治理、可审计。

#### Acceptance Criteria

1. WHEN 进入 `validating` THEN 系统 SHALL 通过 **Fabric `service.execute`** 在 `TaskWorkspace`（`input.cwd`）内
   逐条运行 `AcceptanceCriteria` 的命令，产出 `ValidationReport{ steps:[{cmd, exitCode, ok, stdoutHash, durationMs}], passed }`。
2. 验证命令 SHALL 受 Fabric 既有策略门控（allowlist/exec-approval/sandbox）与审计；被 Fabric DENY 的命令
   SHALL 标记为该步失败并附原因（不绕过策略）。
3. 判定逻辑（`passed = 全部 required step ok` + 阈值检查）属 **Supervisor**，SHALL NOT 写入 Fabric（Fabric 只执行+审计，不判定完成）。
4. 验证产出 SHALL 脱敏（不落明文密钥；stdout 以哈希/截断存储），与 Fabric 审计口径一致。
5. IF 某验证命令本身无法执行（二进制缺失/沙箱不满足）THEN 该步 SHALL fail-safe 记为失败并附可诊断原因，SHALL NOT 记为通过。

### Requirement 5: 有界重试与自动修复

**User Story:** 作为用户，我希望失败时系统自动让 Worker 修复并重试，但绝不无限循环或失控烧钱。

#### Acceptance Criteria

1. WHEN `ValidationReport.passed === false` 且未触达停止条件 THEN 系统 SHALL 进入 `fixing`，
   把失败步骤的脱敏证据（命令 + 退出码 + 关键 stderr 摘要）作为下一轮 Worker prompt，重新 `executing`。
2. 系统 SHALL 强制**迭代上限** `maxIterations`（默认有限值，如 5），达到即 `max_iterations` 停止并升级。
3. 系统 SHALL 强制**预算上限**：累计成本（复用 cost-budget / Fabric `costLimit` 估算 + Worker 用量）超限即 `budget_exhausted` 停止并升级。
4. 系统 SHALL 检测**无进展**（连续两轮验证失败集合相同/无改善）并提前升级，避免空转烧预算。
5. 重试 SHALL NOT 放宽 `AcceptanceCriteria`（只许更严或不变；任何放宽需人工确认，复用 Fabric replay 的 relaxation 标记理念）。

### Requirement 6: 停止、验收与升级

**User Story:** 作为用户/管理员，我需要任务以明确状态终止，且失败能干净地交给人接手。

#### Acceptance Criteria

1. WHEN `ValidationReport.passed === true` THEN 系统 SHALL 置 `accepted` 并产出最终交付报告（见 R7）。
2. WHEN 触达 `max_iterations` / `budget_exhausted` / 无进展 THEN 系统 SHALL 置 `escalated`，
   复用既有 support-case/升级链把任务上下文（目标、各轮验证证据、工作区位置）交给人，SHALL NOT 谎报完成。
3. 用户 SHALL 能随时 `abort` 任务；abort SHALL 停止后续派发与验证并置 `aborted`。
4. 所有终止 SHALL 是确定性、可审计的状态迁移（非法迁移被拒绝）。
5. 高风险/不可逆动作（如对外推送、删除）SHALL 不在自治回路内自动执行；如需要，SHALL 经显式人工确认（复用 daibai 确认票据理念）。

### Requirement 7: 进度跟踪与报告

**User Story:** 作为离场的用户，我希望只收到「开始 / 过程摘要 / 最终结果」，不被过程噪音淹没。

#### Acceptance Criteria

1. WHEN 任务建立 THEN 系统 SHALL 向用户渠道发一条「已创建任务 `taskId`，执行者 `<worker>`，阶段：规划/执行中」。
2. 系统 SHALL 在每个里程碑（每轮验证完成 / 进入修复 / 升级 / 完成）发**简洁进度摘要**（通过项 ✓、失败项 ✗、当前阶段），
   SHALL NOT 把 Worker/Validator 的原始流式输出直发到外部消息渠道（仅最终/摘要；对齐既有"外部渠道只收最终回复"约束）。
3. 最终交付报告 SHALL 含：状态、迭代次数、修改文件数、验证通过项、关键指标（如覆盖率，若可得）、工作区位置、耗时与成本。
4. 报告投递 SHALL 复用既有消息投递；内部 UI 可看更细的迭代/审计明细。
5. 报告 SHALL NOT 含明文密钥或敏感值。

### Requirement 8: 可观测、审计与归因

**User Story:** 作为企业管理员，我需要知道每个监督任务谁发起、用哪个 Worker、花了多少、做了什么，以支撑治理与计费。

#### Acceptance Criteria

1. 每个任务 SHALL 记录归因 `{ tenantId, userId, agentId, worker(backendId/model), taskId }`，复用既有 UsageAttribution/计费口径，SHALL NOT 新建并行计费引擎。
2. 每轮 Worker 用量与每次 Validator 执行（经 Fabric 审计）SHALL 可追溯到 `taskId`（correlation）。
3. 验证与执行的审计 SHALL 复用 Fabric 审计存储与脱敏规则。

### Requirement 9: 配置、特性门与零回归

**User Story:** 作为平台，我希望监督者可控开关、默认安全，且不影响既有对话/执行路径。

#### Acceptance Criteria

1. Development Supervisor SHALL feature-gated（默认 off）；off 时既有终端对话→Worker、Fabric、cli-backend 路径**逐字节不变**。
2. 启用与默认参数（`maxIterations`、预算上限、默认验收命令、工作区策略）SHALL 经平台配置；写操作受控并审计。
3. 监督者 SHALL 仅在已授权的 `<backendId>/<model>` + 已配置凭证前提下运行；前置不满足 SHALL 给出可操作引导（复用 cli-backend 对话引导），不在回路内反复失败。
4. 监督者 SHALL NOT 引入对 `scripts/**` 的运行时耦合；Loom 仅作静态责任/归属记录（可选）。

### Requirement 10: 统一 Worker 抽象与适配器注册（Fabric Worker Runtime）

**User Story:** 作为平台，我希望 OpenBot 不感知 Kiro/Codex/Claude 各自怎么工作，只认一个统一 Worker 接口，
这样接入第 5、第 100 个开发 Agent 时监督逻辑零改动（决定未来商业化扩展）。

#### Acceptance Criteria

1. 系统 SHALL 提供 **Fabric Worker Runtime**：统一 `Worker` 接口 `{ start(input):WorkerRun, status(runId), cancel(runId), logs(runId) }`
   - `WorkerAdapterRegistry`（`register/resolve(workerId)`，schema 校验 + 去重；与既有 tool `AdapterRegistry` 平行）。
2. 系统 SHALL 提供 `CliWorkerAdapter`，把统一接口映射到既有 cli-backend spawn（复用 process supervisor / cli-runner 内核 + 凭证注入），
   SHALL NOT 重写 spawn 逻辑。
3. cli-backend 配置 SHALL 可选追加 `worker` 元数据：`{ taskCapabilities[], control[], statusParser, timeoutMs, retryableExitCodes[] }`
   （两条正交能力轴：`taskCapabilities` ∈ coding|edit|terminal|git|test = 能干什么；`control` ∈ streaming|checkpoint|cancellable|interactive = 怎么被监督）；additive，缺省即仅模型面，向后兼容。
4. Supervisor 引擎 SHALL 仅依赖统一 `Worker` 接口与 `WorkerAdapterRegistry`，SHALL NOT 依赖任何具体 Worker（CLI）实现细节。
5. 新增一类 Worker（如 Docker/GitHub）SHALL 只需实现 `Worker` 接口并注册，SHALL NOT 改动 Supervisor 引擎与 Registry。

### Requirement 11: 实时监督（流式进度，能力依赖）

**User Story:** 作为离场的用户，我希望在 Worker 支持时看到「编码中 → 验证中」的实时阶段，但系统不能为此卡死或假造进度。

#### Acceptance Criteria

1. WHEN Worker **支持流式输出**（`control` 含 `streaming`，如 `codex/kiro exec --json` 逐行 jsonl）THEN Worker Runtime 的 `logs(runId)` SHALL 增量解析并
   发 `ExecutionEvent`（复用 `src/fabric/streaming.ts` + `tool-events`），Supervisor 据此**实时**更新阶段（progress）。
2. WHEN Worker **不支持流式**（`control` 不含 `streaming`，如 `claude -p` 单 json）THEN 系统 SHALL 退化为**轮询监督**（周期 `status` 拉取，回合级阶段），
   SHALL NOT 假造逐步进度。
3. `cancel`/abort 的即时性 SHALL 依 `control` 含 `cancellable`；不含时 abort 置位但等本轮自然结束/超时。
4. 实时进度事件 SHALL 走内部 UI / 控制面；外部消息渠道仍 SHALL 仅收里程碑摘要/最终结果（对齐既有约束）。
5. 进度事件 SHALL 脱敏（不含明文密钥）。

## Non-Functional / Constraints

- **复用优先**：Worker=cli-backend、Validator=Fabric、隔离=worktree、预算=cost-budget、升级=daibai、报告=消息投递+agent-growth report 形态；本 spec 只写「编排 + 验收判定 + 有界重试 + 报告」。
- **安全**：自治回路内只跑验证类（读/测试/构建）命令；写副作用属 Worker 在隔离工作区内，外部副作用需人工确认。
- **确定性**：状态机迁移、验收判定、停止条件全部可机检、可复算；无进展检测防空转。
- **隔离边界**：运行时状态进运行时 store；不写 `.loom/registry.yaml`；不 `src→scripts` 耦合。
- **TypeScript（ESM）/ Node 22+ / Bun**；测试 Vitest（+ fast-check 用于判定/停止条件不变量）。

## 验收门（spec 级）

- M0：Fabric Worker Runtime（统一 `Worker` 接口 + `WorkerAdapterRegistry` + `CliWorkerAdapter` + cli-backend `worker` 配置）就绪。
- M1：任务建立 + 验收标准捕获 + 隔离工作区 + 单轮 dispatch→validate→判定（无重试）端到端打通（feature-gated，Worker 经 M0）。
- M2：有界重试 + 自动修复 + 停止条件（迭代/预算/无进展）+ 升级。
- M3：进度摘要 + 最终交付报告 + 归因/审计。
- 全程零回归（R9.1）+ 自治回路只跑验证类命令（安全约束）。
