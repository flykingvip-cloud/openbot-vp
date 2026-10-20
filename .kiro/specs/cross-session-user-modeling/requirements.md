# Requirements Document

> 中文名：跨会话用户建模（Cross-Session User Modeling）— **补齐 OpenBot 相对 Hermes/Honcho 的唯一真实短板：让 Agent 逐步"懂用户"**
> 状态：立项 · 交付执行 owner：Cursor
> 关联：`agent-growth-lifecycle`（Working DNA）、`evolution-runtime-closure`、`docs/design/openbot-evolution-roadmap-alignment-2026-07-12.md`

## Introduction

本规格新增一层**按"人类用户"持久化的偏好/风格画像**（`UserProfile`），使同一用户跨会话、跨渠道与 Agent 交互时，Agent 能逐步学习并适配"这个用户偏好怎样的沟通方式"（输出繁简、语气、语言、是否要事事确认），并把学到的偏好在下一次对话的系统提示词里生效。

### 定位修正（Scope Framing）

本规格**不是**"重做记忆系统"，也**不**替代已存在的三套机制，而是**嫁接**一层新的、正交的真相源：

- **Working DNA（已存在，不重做）**：`src/gateway/agent-growth/working-style-store.ts` + `genome.ts` 建模的是 **Agent 自身**的行为（由运营信号 `operationalScore` 驱动），键为 `agentId`。
- **RAG memory（已存在，不重做）**：`src/memory/*` 是内容向量检索，承载"聊过什么"，不承载"这个用户偏好怎样被对待"。
- **群体经验胶囊 / 学习资产（已存在，不重做）**：`packages/collaboration-core` 建模的是**组织知识**。

本规格新增的是第四类：**按用户键（不是 agentId）持久化的用户偏好画像**。它在架构上**完整复用 Working DNA 已验证的模式**（纯函数 `derive*Delta` → 每用户 store → `render*Instructions` 在 `get-reply-run.ts` 注入 → 二阶评估 → 自动回滚/抑制），只是把"主体"从 Agent 换成 User。

### 现状证据（Current State，代码级）

- Working DNA 已端到端打通并**按 agentId** 持久化：`resolveWorkingStyleInstructions(cfg, agentId)` 在 `src/auto-reply/reply/get-reply-run.ts:337` 注入（单聊 + 协作两分支各注入一次）。
- **无任何"按用户"建模**：`grep -rE "userProfile|persona|honcho"` 仅命中"个人技能库 / 个人知识"（资产归属），无用户行为/偏好模型。
- 用户身份**已可稳定解析**：DM 会话键编码 `agent:<agentId>:<channel>:<accountId>:direct:<peerId>`（`src/routing/session-key.ts:buildAgentPeerSessionKey`），并有身份联结（`resolveLinkedPeerId` + `identityLinks`）把多渠道身份归并到 canonical 身份——即"同一个人跨渠道"已有归并原语。

### 设计原则（强约束 / 非功能性需求）

1. **正交、不重写**：新增 `src/gateway/user-modeling/**` 模块；除注入点（`get-reply-run.ts`）与信号采集咽喉点外，不改既有真相源。
2. **确定性优先，LLM 后置**：默认只从**显式用户指令**（"简洁点"/"用英文回"/"别每次都问我"）与**可测量事实**（用户书写语言）确定性派生画像；LLM 推断画像属可选、opt-in、默认关闭。
3. **隐私 fail-closed**：按租户隔离；磁盘目录用用户键的哈希命名（不落明文 peerId/手机号）；**只存有界结构化偏好 + 计数，绝不存原始消息内容**；无法解析稳定用户键（匿名/无发件人）→ 跳过建模，不报错。
4. **控噪 + 向后兼容**：中性默认不产出提示词指令；未建模过的用户不注入（行为与今天一致）。
5. **可被遗忘**：用户/管理员可查看并清除自己的画像（RPC + UI）。
6. **二阶自纠**：画像变更后若用户摩擦不降反升（反复重复同一指令）→ 自动回滚并抑制该变更重放。

## Glossary

- **UserProfile（用户画像）**：按用户键持久化的有界结构化偏好集合（输出繁简 / 语气 / 语言 / 确认偏好），每字段带观察计数与置信度。本规格唯一新增的真相源。
- **用户键（UserModelingKey）**：跨会话稳定标识一个人类用户的规范键，由 canonical 身份（经 `identityLinks` 归并）或 `channel:peerId` 派生，并按 `tenantId` 作用域隔离。磁盘上以其哈希命名。
- **偏好指令（Preference Directive）**：用户在对话中显式表达的偏好（如"回复简洁点"、"reply in English"、"直接做别问我"），由确定性纯函数从入站文本识别。这是最安全、最强的信号。
- **画像变更（Profile Delta）**：一次由信号确定性派生的 `Partial<UserProfile>` 覆盖，仅含需变更的字段。
- **二阶反馈（Second-order Feedback）**：评估一次画像变更后用户摩擦是否下降（proxy：同类指令重复率）的机制；回归则自动回滚 + 抑制重放。
- **Working DNA（对照物）**：已存在的、按 agentId 建模 Agent 行为的机制；本规格的架构模板。

## Requirements

### Requirement 1: 稳定用户键解析（跨会话 / 跨渠道 / 租户隔离）

**User Story:** 作为用户，我希望 Agent 在我不同会话、不同渠道下都能认出"这是同一个我"，以便持续适配我的偏好；同时我的画像不与他人或其他租户混淆。

#### Acceptance Criteria

1. WHEN 一条入站消息带有稳定 `peerId`（DM 或可归属发件人） THEN 系统 SHALL 解析出规范用户键（优先经 `identityLinks` 归并为 canonical 身份，否则 `channel:peerId`），并按 `tenantId` 作用域隔离。
2. WHEN 无法解析稳定用户键（匿名 / 群聊无明确发件人 / 系统消息） THEN 系统 SHALL 跳过建模且不报错（fail-closed）。
3. THE 用户键 SHALL NOT 以明文（peerId/手机号/邮箱）落到磁盘路径；磁盘目录 SHALL 以用户键的哈希命名。
4. WHEN 两个不同用户或不同租户 THEN 系统 SHALL 使其画像在存储与读取上完全隔离（有隔离测试）。

### Requirement 2: UserProfile 真相源与确定性派生（纯函数 + 每用户 store）

**User Story:** 作为系统，我希望以与 Working DNA 同构、可单测的纯函数把用户信号确定性地映射为画像变更，并原子持久化。

#### Acceptance Criteria

1. THE 系统 SHALL 定义 `UserProfile` 类型（至少：`preferredReplyLanguage?`、`preferredOutputFormat`、`preferredTone`、`confirmationPreference`、`verbosity`）及安全默认 `DEFAULT_USER_PROFILE`（中性默认）。
2. THE 系统 SHALL 提供纯函数 `deriveUserProfileDelta(signals)`，仅返回需变更字段（空对象表示不变），规则保守且可解释。
3. THE 系统 SHALL 提供纯函数 `detectUserPreferenceDirectives(text)`，确定性识别显式偏好指令（中英双语关键词/意图），输出结构化信号；无指令返回空。
4. THE 系统 SHALL 提供每用户 store（`user-profile.json`），复用 `readJsonFile`/`writeJsonAtomic`/`createAsyncLock`（同 `working-style-store.ts`），读改写在锁内。
5. WHEN 派生的 delta 与当前画像无实际差异 THEN 系统 SHALL NOT 落盘（避免无谓写入）。
6. THE store SHALL 只持久化有界结构化偏好 + 观察计数，SHALL NOT 持久化原始消息文本。

### Requirement 3: 画像生效于对话（提示词注入，控噪 + 向后兼容）

**User Story:** 作为用户，我希望我表达过的偏好在下一次对话里自动生效，而不用每次重说。

#### Acceptance Criteria

1. THE 系统 SHALL 提供纯函数 `renderUserProfileInstructions(profile)`，把画像渲染为简短系统提示词指令；中性默认字段不产出行（控噪）；无任何指令返回空串。
2. THE 系统 SHALL 提供 `resolveUserProfileInstructions(cfg, userKey)`，仅当已持久化画像时返回文本，否则返回 undefined。
3. WHEN 组装系统提示词（`get-reply-run.ts`） THEN 系统 SHALL 在既有 `resolveWorkingStyleInstructions` 相邻处注入用户画像指令，并入单聊与协作两个互斥装配分支（各恰好注入一次）。
4. WHEN 某用户从未被建模 THEN 系统 SHALL NOT 注入任何内容（行为与今天一致）。
5. THE 注入 SHALL NOT 改动 867 行提示词构建器或热路径的既有结构（仅新增一次计算 + 并入现有分支，仿 Working DNA）。

### Requirement 4: 信号采集咽喉点（fire-and-forget，不阻塞热路径）

**User Story:** 作为系统，我希望在不影响回复延迟与稳定性的前提下采集用户偏好信号。

#### Acceptance Criteria

1. THE 系统 SHALL 在单一咽喉点以 fire-and-forget（try/catch 包裹、绝不抛出、绝不阻塞回复）采集入站偏好信号，仿 `recordTaskOutcome`（`src/auto-reply/reply/agent-runner-execution.ts`）。
2. WHEN 识别到显式偏好指令或可测量语言事实 THEN 系统 SHALL 调用 `applyUserInteractionSignals(cfg, userKey, signals)` 落盘画像变更。
3. THE 采集 SHALL 默认只消费**确定性信号**（显式指令 + 语言）；LLM 推断信号 SHALL 由 opt-in 开关（默认关闭）控制。
4. IF 建模被租户/全局开关关闭 THEN 系统 SHALL 完全跳过采集与注入（fail-closed）。

### Requirement 5: 二阶反馈与自动回滚（防止越学越差）

**User Story:** 作为用户，我不希望系统对我的"误解"被固化——如果它学错了，应能自我纠正。

#### Acceptance Criteria

1. WHEN 一次画像变更落盘 THEN 系统 SHALL 记录变更记录（含被覆盖旧值 `previousValues` 与基线摩擦度），仿 `working-style-change.json`。
2. THE 系统 SHALL 提供纯函数评估"变更后摩擦是否下降"（proxy：同类偏好指令的重复率/复发），阈值内变化视为 inconclusive（滤噪）。
3. WHEN 判定为 regressed THEN 系统 SHALL 自动回滚到 `previousValues` 并写抑制记录，防止同一 delta 重放振荡（仿 `working-style-suppression.json` + `sameWorkingStyleDelta`）。
4. WHEN 判定为 improved THEN 系统 SHALL 保留变更。

### Requirement 6: 隐私、治理与可被遗忘

**User Story:** 作为用户/管理员，我希望能看到并清除针对我的画像，且画像不越权可见。

#### Acceptance Criteria

1. THE 系统 SHALL 提供只读 RPC 让用户查看自己的画像、管理员按租户查看聚合（复用既有 scope/域门禁范式，如 `method-scopes.ts`）。
2. THE 系统 SHALL 提供清除画像的 RPC（用户对自己、管理员对本租户），清除后立即不再注入。
3. THE 系统 SHALL NOT 在日志/响应中回显原始用户键或 PII（按 key 名而非值引用）。
4. THE 画像可见性 SHALL 按会话域（platform/enterprise/employee）与归属解析，不跨用户/跨租户泄露（有隔离测试）。
5. THE 默认建模模式 SHALL 为保守模式（仅显式指令 + 语言）；启用推断/LLM 建模 SHALL 需显式 opt-in。

### Requirement 7: 非回归与可观测

#### Acceptance Criteria

1. WHEN 建模开关关闭或用户无画像 THEN 端到端回复行为 SHALL 与本规格实施前完全一致（fail-before 测试锁定）。
2. THE 系统 SHALL 为画像变更提供最小可观测性（结构化 verbose 日志，不含 PII；可选广播事件供治理 UI）。
3. THE 新增代码 SHALL 通过 `pnpm tsgo`（零 `any`）、`pnpm check`、相关 `pnpm test` 范围绿。
