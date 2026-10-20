# OpenBot 录制工作流实施方案

## 1. 文档目的

本文是交付 Gork 团队实施的工程基线。目标是在 OpenBot 中提供“录制工作流”：用户演示一次稳定流程，OpenBot 捕获结构化事实，将其整理为可编辑的个人 Skill，并在后续任务中以新的参数重新执行。

该能力不是视频播放器、固定坐标宏或绕过 Agent 的 RPA 执行器。所谓 Replay，是以生成的 Skill 作为语义执行说明，重新进入 OpenBot 当前的 Agent、Tool、审批、Fabric 和审计链路。

## 2. 产品目标与边界

### 2.1 用户价值

- 把“会做但难描述”的流程通过演示沉淀为 Skill。
- 将一次性操作中的变量、个人偏好、依赖和成功标准显式化。
- 允许用户在保存前审查并修正模型生成的步骤。
- 后续执行适应输入、页面状态和环境变化，而不是机械复现坐标。
- 复用 OpenBot 的个人 Skill、团队分享、企业审核、版本和健康度能力。

### 2.2 第一阶段范围

- OpenBot 管理浏览器中的结构化动作。
- OpenBot Agent 的结构化工具调用。
- 录制事实脱敏、参数识别、步骤生成、用户审查和个人 Skill 保存。
- 从个人 Skill 发起 dry-run 与语义 Replay。
- 每次 Replay 重新进行权限判断、风险确认和审计。

### 2.3 非目标

- 第一阶段不支持任意 macOS 应用。
- 不承诺像素级、逐帧或固定时间间隔回放。
- 不保存密码、令牌、Cookie、OTP 或秘密明文。
- 不自动发布或共享录制生成的 Skill。
- 不把历史 Fabric 决策作为未来执行授权。
- 不把 `src/fabric/replay.ts` 改造成副作用执行器。

## 3. OpenBot 现状与差距

### 3.1 可直接复用的能力

| 能力            | 当前落点                                                          | 复用方式                                                               |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 浏览器动作      | `src/agents/tools/browser-tool.schema.ts`                         | 直接采集 click、type、press、drag、select、fill、navigate 等结构化调用 |
| 工具事件        | `src/agents/pi-embedded-subscribe.handlers.tools.ts`              | 关联工具开始、参数、结果、耗时与错误                                   |
| 会话记录        | `src/sessions/**`、JSONL transcript                               | 提供用户目标、Agent 解释、工具调用和结果上下文                         |
| Skill 生命周期  | `src/gateway/server-methods/skill-lifecycle.ts`                   | 复用草稿、个人保存、编辑、分享、审核、发布和健康度                     |
| Skill 存储模型  | `src/gateway/skill-lifecycle-store.ts`                            | 复用 profile、runtimeDefinition、版本、依赖和执行策略字段              |
| Fabric 审计     | `src/fabric/audit.ts`                                             | Replay 时记录新的请求、决策、结果、成本和 correlation                  |
| Fabric 决策回放 | `src/fabric/replay.ts`                                            | 仅用于策略 dry-run 与一致性验证，不执行历史副作用                      |
| Control UI      | `ui/src/ui/**`                                                    | 增加录制状态、时间线、草稿审查和运行报告                               |
| Mac 屏幕录制    | `apps/macos/Sources/OpenBot/NodeMode/MacNodeScreenCommands.swift` | 后续桌面阶段仅作为视觉证据来源之一                                     |

### 3.2 关键差距

当前 `skill-lifecycle.extract` 并未分析真实工作过程。`extractSkillPreview` 只根据 `contextId` 生成固定模板、固定摘要和固定置信度，见 `src/gateway/skill-lifecycle-store.ts:879`。因此本项目的核心不是新增 Skill 系统，而是增加一条从事实记录到 Skill 草稿的可信合成管线。

Mac 节点当前具备 `screen.record` 参数模型，但不具备完整的桌面动作观察、Accessibility 元素语义和可执行 Computer Use 协议。因此第一阶段选择浏览器录制，避免把录屏误当成可重放工作流。

## 4. 核心原则

1. **事实优先**：原始动作、页面状态、工具结果和用户目标分别保存，模型生成内容不得覆盖事实层。
2. **语义重放**：生成步骤描述意图、目标元素、等待条件与断言，不以坐标和固定延时作为主定位手段。
3. **草稿优先**：录制停止后只生成草稿，必须经过用户审查和明确保存。
4. **重新授权**：每次 Replay 都依据当前身份、租户、设备、权限、配置和策略重新判断。
5. **最少采集**：只记录完成目标所需的窗口、元素、动作和截图；原始证据设置短期保留。
6. **秘密不落盘**：敏感值在采集边界完成替换，后续模块只接触占位符或 secret reference。
7. **复用现有系统**：Skill 生命周期、工具执行、Fabric、审批、租户和 UI 协议均通过适配扩展，不建立平行系统。

## 5. 用户流程

### 5.1 创建

1. 用户选择“录制工作流”。
2. 输入目标、可能变化的输入和成功标准。
3. OpenBot 展示采集范围、权限和敏感信息提示。
4. 用户明确授权后开始录制。
5. 用户在 OpenBot 浏览器中完成操作；OpenBot 持续显示录制状态。
6. 用户停止录制。
7. OpenBot 脱敏、去噪、识别变量并生成 Skill 草稿。
8. 用户审查步骤、变量、风险确认点和成功断言。
9. 用户试运行或 dry-run。
10. 用户保存为个人 Skill；后续分享和发布走现有流程。

### 5.2 Replay

1. 用户在新任务中调用 Skill，并填写本次变量。
2. OpenBot 校验依赖、权限、环境和目标可用性。
3. Agent 按 Skill 语义步骤执行，而非读取历史事件逐条执行。
4. 高风险动作根据当前策略要求确认。
5. 每步检查成功断言，失败时按恢复策略重试、询问或停止。
6. 生成运行报告并更新 Skill 健康指标。

## 6. 总体架构

```text
Control UI / App
  | start, stop, review, save, replay
  v
Workflow Recording Gateway API
  |-- Recording Session State Machine
  |-- Consent And Tenant Guard
  |-- Retention And Deletion
  v
Capture Adapters
  |-- Browser structured actions
  |-- Agent tool lifecycle events
  |-- Session transcript context
  |-- Desktop accessibility events (later)
  v
Evidence Store
  |-- redacted event journal
  |-- snapshots and screenshots
  |-- content hashes and provenance
  v
Workflow Synthesizer
  |-- normalize and deduplicate
  |-- variable and secret classification
  |-- semantic step generation
  |-- assertions and recovery
  v
Reviewable Skill Draft
  |-- existing personal Skill lifecycle
  v
Replay Compiler
  |-- current environment resolution
  |-- Agent and Tool execution
  |-- Fabric policy and approval
  |-- audit and health metrics
```

### 6.1 新模块建议

```text
src/workflow-recording/
  contracts.ts
  recording-service.ts
  recording-store.ts
  redaction.ts
  event-normalizer.ts
  variable-classifier.ts
  workflow-synthesizer.ts
  skill-draft-mapper.ts
  replay-compiler.ts
  assertions.ts
  metrics.ts
```

模块通过窄端口接入 Browser、session、Skill lifecycle 和 Fabric。不要从新模块反向修改各工具内部数据模型；在工具事件边界映射为统一录制事件。

## 7. 数据模型

### 7.1 RecordingSession

```ts
type RecordingState =
  | "draft"
  | "awaiting_consent"
  | "recording"
  | "processing"
  | "review"
  | "saved"
  | "discarded"
  | "failed";

type RecordingSession = {
  id: string;
  schemaVersion: 1;
  tenantId?: string;
  userId: string;
  agentId: string;
  sourceSessionKey: string;
  state: RecordingState;
  goal: string;
  inputHints: string[];
  successCriteria: string[];
  captureScopes: Array<"browser" | "agent_tools" | "desktop">;
  consent: { grantedAt: number; scopes: string[] } | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};
```

### 7.2 RecordingEvent

```ts
type RecordingEvent = {
  id: string;
  recordingId: string;
  sequence: number;
  occurredAt: number;
  source: "browser" | "agent_tool" | "user_marker" | "desktop";
  kind: "action" | "observation" | "result" | "error" | "checkpoint";
  action?: { name: string; args: unknown };
  target?: {
    url?: string;
    app?: string;
    window?: string;
    semanticRef?: string;
    role?: string;
    label?: string;
    coordinateFallback?: { x: number; y: number };
  };
  evidenceRefs: string[];
  risk: "read" | "write" | "external_send" | "destructive" | "financial";
  redaction: { status: "clean" | "redacted" | "blocked"; fields: string[] };
  correlation: { runId?: string; toolCallId?: string; sessionId?: string };
};
```

### 7.3 WorkflowVariable

```ts
type WorkflowVariable = {
  key: string;
  kind: "input" | "preference" | "secret_ref" | "constant" | "derived";
  valueType: "string" | "number" | "boolean" | "date" | "file" | "enum";
  description: string;
  required: boolean;
  defaultValue?: unknown;
  secretRef?: string;
  evidenceEventIds: string[];
  confidence: number;
  userConfirmed: boolean;
};
```

### 7.4 WorkflowStep

```ts
type WorkflowStep = {
  id: string;
  intent: string;
  executor: "browser" | "tool" | "desktop" | "agent";
  operation: string;
  arguments: unknown;
  preconditions: WorkflowAssertion[];
  successAssertions: WorkflowAssertion[];
  recovery: Array<{ condition: string; action: "retry" | "ask" | "stop"; limit?: number }>;
  risk: RecordingEvent["risk"];
  confirmation: "never" | "policy" | "always";
  evidenceEventIds: string[];
};
```

### 7.5 持久化分层

- `raw evidence`：短 TTL，包含脱敏后的事件、必要截图和 snapshot。
- `processed draft`：中期保存，包含变量、步骤、断言、证据引用和用户修改。
- `saved skill`：进入现有 Skill 存储与版本生命周期，不依赖原始截图才能执行。
- `run report`：保存 Skill 版本、输入摘要、每步状态、断言、审批和错误，不保存 secret value。

建议原始证据默认保留 7 天，未保存草稿默认保留 30 天；具体期限做成配置并允许企业策略收紧。

## 8. Gateway API

建议新增以下 RPC，并在 `server-methods-list.ts` 与 `method-scopes.ts` 分类：

| 方法                              | Scope | 说明                                           |
| --------------------------------- | ----- | ---------------------------------------------- |
| `workflow-recording.start`        | write | 创建 session、校验 capture scope、返回授权请求 |
| `workflow-recording.status`       | read  | 返回当前状态、时长、事件计数和暂停原因         |
| `workflow-recording.stop`         | write | 幂等停止并进入 processing                      |
| `workflow-recording.discard`      | write | 删除原始证据和未保存草稿                       |
| `workflow-recording.preview`      | read  | 返回脱敏时间线、变量和 Skill 草稿              |
| `workflow-recording.update-draft` | write | 保存用户对变量、步骤和断言的修改               |
| `workflow-recording.dry-run`      | write | 解析环境和权限，不提交副作用                   |
| `workflow-recording.save`         | write | 映射到现有个人 Skill 草稿并保存                |

所有接口必须从连接上下文推导 user、tenant 和 device，不接受客户端伪造所有者。状态变更接受 `idempotencyKey`，并通过预期版本避免多个 UI 同时覆盖草稿。

## 9. 捕获策略

### 9.1 浏览器动作

采集点放在 Browser Tool 的规范化动作边界，而不是监听系统鼠标。这样可以天然获得 action kind、targetId/ref、URL、结果和错误。

每个动作建议捕获：

- 动作规范化参数。
- 动作前 snapshot 的稳定元素引用。
- 动作后 URL、标题和目标区域变化摘要。
- 失败错误和实际重试。
- 只在页面发生关键变化或语义引用不足时保存截图。

录制生成步骤的定位优先级固定为：

1. 已有 OpenBot Tool 或服务 API。
2. DOM/ARIA 稳定 ref、role、label。
3. 文本与邻近关系。
4. 视觉定位。
5. 坐标回退，并标记低稳定性。

### 9.2 工具调用

工具开始事件提供名称和参数，工具结果提供状态、摘要和产物。采集适配器必须在持久化前调用统一 redaction，并按工具类别标记风险。Messaging、发布、删除、付款和权限变更不能被模型降级为普通 write。

### 9.3 用户标记

录制期间允许用户添加“这是一个变量”“这个值是我的固定偏好”“到这里算成功”等标记。这些标记优先级高于模型推断，并在草稿中保留 provenance。

## 10. 脱敏与隐私

### 10.1 采集边界

- password input 不采集值。
- 命中 token、secret、password、cookie、authorization、session key 等字段时替换为 `secret_ref`。
- OTP 和恢复码不进入事件正文、截图 OCR 或 Skill 草稿。
- 剪贴板仅在明确属于当前操作且通过内容检查后使用；默认不记录剪贴板历史。
- 截图需应用敏感区域遮罩，无法可靠遮罩时阻止该证据持久化。

### 10.2 用户控制

- 录制期间持续显示不可伪造的系统级或 App 级指示器。
- 用户可随时停止、暂停或丢弃。
- 审查页展示实际保存了哪些窗口、截图、字段和工具参数。
- 提供删除原始证据、草稿、Skill 与运行历史的独立操作。

## 11. Workflow Synthesis

合成管线分为确定性处理和模型处理两部分。

### 11.1 确定性阶段

- 校验 sequence、schema 和 recording 所有权。
- 合并连续输入和重复 snapshot。
- 对齐 action、result、URL 变化与截图。
- 标记风险和秘密候选。
- 识别重复值、明显日期、文件和用户标记。
- 生成不可变 evidence hash 与 provenance。

### 11.2 模型阶段

- 根据 goal 和 success criteria 过滤无关清理步骤。
- 提炼步骤 intent。
- 将不同实例值抽象为变量。
- 区分输入、固定偏好、秘密引用和派生值。
- 为步骤生成前置条件、等待条件、成功断言与恢复策略。
- 输出严格结构化对象，经过 schema 验证后才能进入 review。

模型不能自行删除高风险步骤、改变风险等级、填入秘密默认值或声明权限已获批准。任何缺乏事实支持的生成字段必须携带低 confidence，并要求用户确认。

## 12. Skill 映射

生成草稿映射到现有 `EmployeeSkillProfile` 与 `SkillRuntimeDefinition`：

| 录制产物             | Skill 字段                                        |
| -------------------- | ------------------------------------------------- |
| 名称、摘要、使用场景 | `profile.name/summary/usageExamples`              |
| 输入变量             | `profile.inputDescription` + runtime input schema |
| 预期结果与断言       | `profile.outputDescription` + workflow assertions |
| 语义步骤             | `runtimeDefinition.workflow`                      |
| executor/tool 列表   | `runtimeDefinition.tools`                         |
| Skill 与插件依赖     | `runtimeDefinition.dependencies`                  |
| 风险与确认点         | `runtimeDefinition.executionPolicies`             |
| 路由与适用条件       | `runtimeDefinition.routingHints`                  |

建议扩展 `runtimeDefinition.workflow` 的版本化 schema，不在 profile 文本中编码执行逻辑。`skill-lifecycle.extract` 接受可选 `recordingId`；存在时调用真实 synthesizer，不存在时保留兼容路径，之后再单独评估是否移除固定模板。

## 13. Replay 执行模型

Replay Compiler 的输入是 Skill 版本、本次变量、当前会话与当前能力快照。输出是交给正常 Agent loop 的受约束执行上下文。

必须遵守：

- 不逐条执行 `RecordingEvent`。
- 不复用录制期间的 toolCallId、runId、approval 或 PolicyDecision。
- 不跳过工具可用性、租户、scope、allowlist、sandbox 和 Fabric 检查。
- 外部发送、删除、发布和财务动作保留当前确认要求。
- 每一步重新定位目标并验证前置条件。
- 坐标回退默认要求确认，且在窗口尺寸或目标应用变化时失效。

`src/fabric/replay.ts` 继续只负责历史策略重算和候选策略 diff。工作流 Replay 使用新的命名空间和正常执行路径，避免“replay”一词导致错误复用。

## 14. UI 方案

### 14.1 入口

- Skills 页面增加“录制工作流”命令。
- Chat 工具栏可从当前任务上下文发起录制。
- 有活动录制时全局显示录制指示器、计时、暂停、停止和丢弃。

### 14.2 审查页

采用左侧步骤时间线、中央事实与草稿对照、右侧变量和风险检查的工作界面。核心操作包括：

- 删除无关步骤。
- 合并或拆分步骤。
- 将值标记为输入、偏好或秘密引用。
- 修改元素定位描述。
- 编辑成功断言和失败策略。
- 查看低稳定性坐标回退。
- dry-run、试运行、保存草稿。

不要把视频作为主要编辑器。视频或截图只作为某一步的辅助证据。

## 15. 安全模型

### 15.1 主要威胁

- 网页提示注入诱导录制恶意步骤。
- 模型把一次性敏感值误判为固定默认值。
- 截图或 snapshot 泄露其他窗口和租户内容。
- 恶意 Skill 借 Replay 绕过审批。
- 页面变化导致误点危险控件。
- 同一 recordingId 被其他用户或租户读取。
- 录制指示器被网页内容模仿。

### 15.2 控制措施

- 所有录制接口绑定服务端身份和 tenant。
- Evidence Store 使用每租户隔离的路径和访问检查。
- 统一秘密扫描在写盘前执行。
- 高风险分类由确定性规则设下限，模型只能提高风险，不能降低。
- Replay 生成全新的 Fabric correlation 与审批请求。
- 目标定位与成功断言不一致时 fail closed。
- 录制状态由 App chrome 或系统状态区显示，不放在网页内容区。
- 共享或企业发布继续经过既有 Skill 安全扫描和审核。

## 16. 可观测性与质量指标

每次录制记录：

- 事件数、截图数、原始与处理后大小。
- 被脱敏和被阻止的字段数。
- 合成耗时、变量数、低置信度项数。
- 用户删除、修改和确认了哪些生成项。

每次 Replay 记录：

- Skill ID 和版本。
- 每步耗时和断言结果。
- 定位策略类型与是否使用坐标回退。
- 人工确认和接管次数。
- 失败分类与恢复结果。

Skill 健康度建议由成功率、断言通过率、人工接管率和最近验证时间共同计算。不得仅根据 Agent 最终回复声称成功。

## 17. 分阶段交付

### Phase 0: 契约与测试资产，1 周

- 完成 Zod 契约、状态机、黄金 fixtures 和威胁模型评审。
- 不接 UI，不调用模型，不改执行路径。

退出条件：数据模型稳定，秘密测试、乱序事件测试和租户隔离测试通过。

### Phase 1: 浏览器录制 MVP，2 至 3 周

- Gateway RPC、录制状态机、Browser/Tool capture adapter、Evidence Store、录制指示器。
- 可展示脱敏后的事实时间线，但暂不生成 Skill。

退出条件：三个黄金流程的动作和结果能完整关联，录制停止/丢弃/重启恢复可靠。

### Phase 2: Skill 草稿生成，2 周

- 去噪、变量识别、语义步骤、断言、`skill-lifecycle.extract` 接线和审查 UI。
- 只保存为个人 draft。

退出条件：生成草稿通过 schema；用户能修正所有推断；不存在秘密明文。

### Phase 3: Dry-run 与 Replay，2 至 3 周

- Replay Compiler、环境解析、正常 Agent/Tool/Fabric 接线、运行报告与健康度。

退出条件：浏览器黄金流程连续运行 20 次成功率不低于 90%；高风险动作确认覆盖率 100%。

### Phase 4: 内部 Beta，2 周

- TTL、导出/删除、崩溃恢复、指标看板、回归集和安全复核。

退出条件：通过隐私、安全、租户和故障演练；具备明确回滚开关。

### Phase 5: macOS Desktop Preview，单独立项

- Accessibility 事件采集、结构化 Computer Use 协议、首批白名单应用。
- Screen Recording 作为证据，Accessibility 元素作为主要语义来源。

退出条件：逐应用验收，不以“任意应用通用”作为发布标准。

## 18. 测试计划

### 18.1 单元测试

- 状态机合法和非法迁移。
- schema 版本与事件序列。
- secret redaction 与 screenshot mask。
- 动作归一化、变量分类和步骤映射。
- 风险等级不可被降低。
- Skill runtime definition 映射。
- Replay 不携带历史授权和 correlation。

### 18.2 集成测试

- Browser action 到 Evidence Store。
- transcript/tool event 到 recording 的关联。
- recording 到 Skill draft，再到个人 Skill 保存。
- dry-run 不产生外部写副作用。
- Replay 重新触发当前审批和 Fabric 审计。
- 跨 tenant、跨 user 和过期 recording 访问被拒绝。

### 18.3 E2E 黄金流程

1. 从网站下载指定日期范围的周期报表。
2. 根据模板创建包含标签、负责人和验收标准的 Issue。
3. 获取网页数据，使用 OpenBot 工具生成文件，再上传到目标页面。

每个流程覆盖正常、元素轻微变化、权限不足、元素缺失和秘密输入场景。

## 19. 发布与回滚

- 使用独立 feature flag，默认关闭。
- Browser capture、Skill synthesis、Replay 和 Desktop capture 分开控制。
- 关闭 Replay 不影响查看或导出已保存 Skill。
- schema 升级采用只增版本的迁移器，不静默重写原始 evidence。
- 出现安全问题时可全局关闭 capture，并继续允许用户删除已有数据。

建议配置形态：

```json5
{
  workflowRecording: {
    enabled: false,
    capture: { browser: true, agentTools: true, desktop: false },
    retention: { rawEvidenceDays: 7, draftDays: 30 },
    replay: { enabled: false, coordinateFallback: "confirm" },
  },
}
```

## 20. 团队分工建议

| Workstream      | 主要职责                                    | 依赖                   |
| --------------- | ------------------------------------------- | ---------------------- |
| Core/Gateway    | 契约、状态机、RPC、存储、租户和 retention   | 无                     |
| Browser Runtime | 结构化动作与 snapshot capture adapter       | Core contracts         |
| Agent Runtime   | tool/transcript capture 与 Replay Compiler  | Core contracts、Fabric |
| Skill Platform  | synthesizer、draft mapper、版本和健康度     | Evidence Store         |
| Control UI      | 录制入口、指示器、时间线和审查页            | Gateway RPC            |
| macOS           | Accessibility 与桌面 Computer Use           | Browser Beta 完成后    |
| Security/QA     | 威胁模型、秘密 fixtures、黄金流程和发布门禁 | 全程参与               |

Gork 团队应指定一名跨 Workstream owner，负责契约和 Replay 安全边界。Browser、Skill 与 UI 可以并行，但 Replay 接线必须在数据契约和风险分类冻结后开始。

## 21. 验收定义

功能完成必须同时满足：

- 用户能明确开始、观察、停止、审查、试运行和保存录制。
- 录制事件具备来源、顺序、证据、风险、脱敏状态和关联 ID。
- Skill 草稿中的每一步和变量能追溯到录制证据或用户标记。
- 用户可修改模型生成的所有执行相关字段。
- Replay 不读取或复用历史授权，所有副作用走当前执行控制面。
- 原始证据、草稿、Skill 和运行报告均可按权限删除。
- 黄金流程达到发布门禁，失败不会误报成功。
- feature flag 关闭时既有 Browser、Agent、Skill 和 Fabric 行为不变。

## 22. Gork 团队启动清单

1. 评审并冻结 `RecordingSession`、`RecordingEvent`、`WorkflowVariable`、`WorkflowStep` 四个契约。
2. 指定 Core owner 和各 Workstream owner。
3. 在真实实现前提交三套去标识化黄金录制 fixtures。
4. 完成秘密处理和风险等级评审，再开始持久化实现。
5. 先交付“事实时间线”，验证捕获完整性后再接模型合成。
6. Skill 合成只产出 draft，审查 UI 完成后再启用保存。
7. dry-run 验证无副作用后再接真实 Replay。
8. Browser Beta 验收后，另开 macOS Desktop Preview 设计评审。

任务级拆解与 release gates 见 `.kiro/specs/workflow-recording/tasks.md`。
