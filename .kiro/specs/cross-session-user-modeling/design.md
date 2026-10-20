# 技术设计：跨会话用户建模（Cross-Session User Modeling）

> 状态：立项设计 · 交付执行 owner：Cursor
> 方法：完整复用 Working DNA 已验证的模式（`src/gateway/agent-growth/genome.ts` + `working-style-store.ts`），把"主体"从 Agent 换成 User。凡引用既有代码均给出 repo 相对路径，Cursor 据此逐一对照。

---

## 0. 设计总纲：镜像 Working DNA

本设计的核心是"**同构镜像**"——已上线的 Working DNA 是被生产验证过的闭环，我们按同一骨架建一层"用户版"，只替换主体键与信号来源。对照表：

| 关注点       | Working DNA（已存在，模板）                                         | 本规格（新建，镜像）                                                    |
| ------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 主体键       | `agentId`                                                           | `userKey`（canonical 用户身份，租户作用域，哈希落盘）                   |
| 真相类型     | `WorkingStyle`（`genome.ts`）                                       | `UserProfile`（新增 `user-modeling/types.ts`）                          |
| 纯派生器     | `deriveWorkingStyleDelta(signals)`                                  | `deriveUserProfileDelta(signals)`                                       |
| 信号源       | 运营信号 `operationalScore`（任务成功/接管率）                      | 显式偏好指令 + 用户书写语言（确定性）                                   |
| 每主体 store | `working-style-store.ts`（`{agentDir}/working-style.json`）         | `user-profile-store.ts`（`{userModelingDir}/<hash>/user-profile.json`） |
| 渲染器       | `renderWorkingStyleInstructions(style)`                             | `renderUserProfileInstructions(profile)`                                |
| 注入点       | `get-reply-run.ts:337` `resolveWorkingStyleInstructions`            | 相邻处 `resolveUserProfileInstructions`                                 |
| 采集咽喉点   | `agent-runner-execution.ts` `recordTaskOutcome`（fire-and-forget）  | 同一层 `recordUserInteractionSignal`（fire-and-forget）                 |
| 二阶反馈     | `evaluateWorkingStyleEffect` + change/suppression                   | `evaluateUserProfileEffect` + change/suppression（proxy=指令复发率）    |
| 治理 UI/RPC  | `agents.list-working-style-effects` + `working-style-effects-panel` | `user-modeling.get-profile` / `.reset` + 画像查看/清除 UI               |

**关键差异（务必理解）**：Working DNA 的信号是"聚合运营分"，本规格默认信号是"**用户显式说出口的偏好**"——这是最强、最安全、无需 LLM 的信号，也是与 Honcho"逐步了解你"最直接对应的确定性子集。

---

## 1. 目标架构

```
入站消息(user text) ──┐
                      │ (fire-and-forget, try/catch, 不阻塞回复)
                      ▼
        detectUserPreferenceDirectives(text)  ← 确定性纯函数（中英双语）
        + detectReplyLanguage(text)           ← 确定性
                      │  UserInteractionSignals
                      ▼
        deriveUserProfileDelta(signals)  ← 纯函数，仅返回需变更字段
                      │  Partial<UserProfile>
                      ▼
        applyUserInteractionSignals(cfg, userKey, signals)
                      │  锁内读改写 + 记 change(previousValues, baseline)
                      ▼
        {userModelingDir}/<hash(userKey)>/user-profile.json   ← 租户作用域

下一次对话组装系统提示词（get-reply-run.ts）：
        resolveUserProfileInstructions(cfg, userKey)
                      │  仅当已持久化画像
                      ▼
        renderUserProfileInstructions(profile)  ← 中性默认不产出（控噪）
                      │  并入单聊 / 协作两分支之一（各恰好一次）
                      ▼
                 系统提示词生效

后续 recompute / 下一次交互：
        evaluateUserProfileEffect(baseline, current)  ← proxy: 指令复发率
                      ├─ improved  → 保留
                      └─ regressed → 回滚 previousValues + 写 suppression（防振荡）
```

---

## 2. 用户键解析（Requirement 1）

新建 `src/gateway/user-modeling/user-key.ts`：

```ts
export type UserModelingKey = {
  /** 规范化后的稳定用户标识（canonical，经 identityLinks 归并；否则 channel:peerId）。 */
  canonicalId: string;
  tenantId: string | null;
};

/** 从入站上下文解析稳定用户键；无法解析（匿名/群无发件人）→ null（fail-closed）。 */
export function resolveUserModelingKey(input: {
  channel?: string | null;
  peerId?: string | null; // 发件人稳定 id（DM 的对端；群内可归属发件人）
  accountId?: string | null;
  tenantId?: string | null;
  identityLinks?: Record<string, string[]>;
}): UserModelingKey | null;

/** 落盘用的目录名：SHA-256(canonicalId+tenantId) 截断，避免明文 PII 入路径。 */
export function hashUserKey(key: UserModelingKey): string;
```

- 复用 `src/routing/session-key.ts` 的 `resolveLinkedPeerId` 归并逻辑（可抽取共享；或在 user-key.ts 内以相同 `identityLinks` 契约实现），使"同一人跨渠道"归并到同一 canonicalId。
- **fail-closed**：`peerId` 缺失或为占位（"unknown"）→ 返回 null，调用方跳过建模。
- **租户隔离**：目录名含 `tenantId`，不同租户天然分区。

> 上下文来源：`get-reply-run.ts` 已持有 `ctx: MsgContext`（含 `OriginatingChannel`、发件人信息）与 `agentId`/`sessionKey`。Cursor 需确认 `MsgContext` 暴露的发件人字段（`src/auto-reply/templating.ts`），用其构造 `resolveUserModelingKey` 入参；若 DM 场景可直接从会话键 `parseAgentSessionKey` 还原 `direct:<peerId>` 段。**优先复用会话键里已编码的 peerId**，避免新解析路径。

---

## 3. UserProfile 类型与纯函数（Requirement 2）

新建 `src/gateway/user-modeling/types.ts`（镜像 `genome.ts` 的类型风格）：

```ts
export type OutputFormatPreference = "concise" | "detailed" | "structured" | "conversational";
export type CommunicationTone = "formal" | "neutral" | "friendly";
export type ConfirmationPreference = "proactive" | "confirm_first"; // proactive=别老问我，直接做
export type Verbosity = "terse" | "normal" | "verbose";

export interface UserProfile {
  preferredReplyLanguage?: string; // BCP-47 粗粒度，如 "zh" / "en"
  preferredOutputFormat: OutputFormatPreference;
  preferredTone: CommunicationTone;
  confirmationPreference: ConfirmationPreference;
  verbosity: Verbosity;
  /** 每字段观察计数，用于稳定性/置信度（避免一次口误就翻转）。 */
  observations: Partial<Record<keyof Omit<UserProfile, "observations">, number>>;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  preferredOutputFormat: "structured",
  preferredTone: "neutral",
  confirmationPreference: "confirm_first",
  verbosity: "normal",
  observations: {},
};
```

新建 `src/gateway/user-modeling/derive.ts`（纯函数，无 I/O，便于单测）：

```ts
export interface UserInteractionSignals {
  directives?: PreferenceDirective[]; // 来自 detectUserPreferenceDirectives
  replyLanguage?: string | null; // 来自 detectReplyLanguage
}

/** 确定性识别显式偏好指令（中英双语关键词/意图）。无指令 → []。 */
export function detectUserPreferenceDirectives(text: string): PreferenceDirective[];

/** 粗粒度语言检测（确定性；可用轻量启发式，不引 LLM）。 */
export function detectReplyLanguage(text: string): string | null;

/**
 * 确定性映射信号 → 画像变更（仅返回需变更字段）。规则保守可解释，示例：
 *  - directive "concise"/"简洁点" → outputFormat=concise, verbosity=terse
 *  - directive "reply in English"/"用英文" → preferredReplyLanguage="en"
 *  - directive "别老问我/直接做/just do it" → confirmationPreference=proactive
 *  - directive "详细点/更正式" → verbosity=verbose / tone=formal
 * 需累计 observations 达阈值（如 ≥1 次显式指令即可，因显式信号强）方翻转。
 */
export function deriveUserProfileDelta(
  current: UserProfile,
  signals: UserInteractionSignals,
): Partial<UserProfile>;
```

新建 `src/gateway/user-modeling/render.ts`（纯函数，镜像 `renderWorkingStyleInstructions`）：

```ts
/**
 * 渲染为简短系统提示词指令。中性默认字段（structured/neutral/confirm_first/normal）不产出行（控噪）。
 * 无任何指令 → "".
 * 语言偏好务必渲染为"用 X 语言回复"这类可执行指令。
 */
export function renderUserProfileInstructions(profile: UserProfile): string;
```

> 参照 `genome.ts:renderWorkingStyleInstructions` 的输出风格：产出 `"Apply this user's learned preferences:"` 抬头 + `- ...` 列表；空则返回 `""`，调用方据此跳过注入。

---

## 4. 每用户 store（Requirement 2/5）

新建 `src/gateway/user-modeling/user-profile-store.ts`（**逐段镜像** `working-style-store.ts`）：

- 复用 `createAsyncLock` / `readJsonFile` / `writeJsonAtomic`（`src/infra/json-files.js`）。
- 目录解析：新建 `resolveUserModelingDir(cfg, userKeyHash, opts?)`，仿 `tenant-agent-dir.ts:resolveGrowthAgentDir`，落在租户作用域下（如 `{tenantRoot}/user-modeling/<hash>/`）。**Cursor 需按 `tenant-agent-dir.ts` 现有租户根解析范式实现**，不新造租户根。
- 文件：
  - `user-profile.json`（`UserProfile`）
  - `user-profile-change.json`（`UserProfileChangeRecord`，含 `previousValues` + `baselineFriction`）— 镜像 `WorkingStyleChangeRecord`
  - `user-profile-suppression.json`（`UserProfileSuppression`）— 镜像 `WorkingStyleSuppression`
- 导出（镜像命名）：
  - `readUserProfile` / `readUserProfileOrDefault` / `writeUserProfile` / `updateUserProfile`（锁内读改写）
  - `applyUserInteractionSignals(cfg, key, signals, baselineFriction?)` — 镜像 `applyOperationalSignalsToWorkingStyle`：派生 delta→无变化则不写；有变化则写 + 记 change + 解除抑制；命中抑制则跳过
  - `assessAndMarkUserProfileEffect(cfg, key, currentFriction)` — 镜像 `assessAndMarkWorkingStyleEffect`：inconclusive 保留；regressed 回滚 `previousValues` + 写 suppression；improved 保留
  - `resolveUserProfileInstructions(cfg, key)` — 镜像 `resolveWorkingStyleInstructions`：仅当已持久化画像才返回文本

> **不新增锁语义/存储范式**：全部复用 `working-style-store.ts` 的既有原语，保证与 growth store 一致的原子性与并发正确性。

---

## 5. 注入点（Requirement 3）

改 `src/auto-reply/reply/get-reply-run.ts`，**narrow diff**，紧邻既有 Working DNA 注入：

```ts
// 既有（get-reply-run.ts:~337）
const workingStyleInstructions = await resolveWorkingStyleInstructions(cfg, agentId);

// 新增（相邻一行）——仅当能解析用户键且建模开启
const userKey = userModelingEnabled(cfg)
  ? resolveUserModelingKey(/* 从 ctx/sessionKey 构造 */)
  : null;
const userProfileInstructions = userKey
  ? await resolveUserProfileInstructions(cfg, userKey)
  : undefined;
```

- 把 `userProfileInstructions` 并入**与 `workingStyleInstructions` 完全相同的两个互斥装配分支**（`useCollaborationAssembly` 的 if/else 各一次），紧邻 `workingStyleInstructions`，使其自然流经 run params → attempt/compact，跨压缩仍在。
- 中性默认/未建模 → undefined → 不注入（向后兼容）。
- **不改** 867 行提示词构建器；不改热路径结构。仿件事三c（见 `docs/design/openbot-evolution-roadmap-alignment-2026-07-12.md` 件事三c 段的做法）。

---

## 6. 信号采集咽喉点（Requirement 4）

新建 `src/gateway/user-modeling/record-signal.ts`：

```ts
/** fire-and-forget：绝不抛出、绝不阻塞回复。镜像 recordExecutionOutcomeCapsuleSafely 的包裹风格。 */
export async function recordUserInteractionSignalSafely(
  cfg: OpenBotConfig,
  key: UserModelingKey,
  inboundText: string,
): Promise<void>;
```

**咽喉点选择（Cursor 二选一，优先改动面小者，以 fail-before 锁定）**：

- **选项 A（推荐）**：在入站处理层、与 `recordTaskOutcome` 同源的收尾处（`src/auto-reply/reply/agent-runner-execution.ts` 现有 fire-and-forget 区）追加一次 `recordUserInteractionSignalSafely(cfg, key, inboundText)`。优点：与既有运营信号采集同构、同一 fire-and-forget 纪律。
- **选项 B**：在 `get-reply-run.ts` 解析出 `userKey` 后就地 fire-and-forget 采集（因为偏好指令就在本轮入站文本里）。优点：无需下探 runner；缺点：注入点与采集点耦合在同一函数。

无论 A/B：`try/catch` 包裹、`void` 调用、失败仅 `logVerbose`（不含 PII）。

**开关（fail-closed）**：新增 `userModelingEnabled(cfg)`（读配置/env，如 `OPENBOT_USER_MODELING`，**默认保守模式=开启但仅确定性信号**；`OPENBOT_USER_MODELING=off` 全关；LLM 推断另有 `OPENBOT_USER_MODELING_INFER` 默认 off）。租户级开关优先于全局。

---

## 7. 二阶反馈（Requirement 5）

- **摩擦度 proxy（friction）**：同类偏好指令的**复发**。直觉：如果我们已把该用户设为 concise，但他后续又反复说"简洁点"，说明变更没生效或方向错——记为 regressed。
- `evaluateUserProfileEffect(baselineFriction, currentFriction, {minDelta})` 纯函数，镜像 `evaluateWorkingStyleEffect`（阈值内 inconclusive 滤噪）。
- `assessAndMarkUserProfileEffect` 在下一次采集/recompute 时对比，regressed → 回滚 `previousValues` + 写 suppression（`sameUserProfileDelta` 判等，仿 `sameWorkingStyleDelta`），improved → 保留。
- **Phase 3 才做**（Phase 2 已可端到端可用）；friction 计数在 change 记录里累计。

---

## 8. 隐私 / 治理 / RPC / UI（Requirement 6）

- **RPC**（新建 `src/gateway/server-methods/user-modeling.ts`，登记 `method-scopes.ts` + `server-methods-list.ts`）：
  - `user-modeling.get-profile`（用户读自己；管理员按租户读，走既有域门禁范式）
  - `user-modeling.reset-profile`（用户清自己 / 管理员清本租户；清后删除三个 json）
  - （可选）`user-modeling.list`（管理员按租户聚合，只读）
- **可见性/域门禁**：复用 `operational-identity-governance` 已建立的会话域范式（platform/enterprise/employee）与 `scope-attribution.ts` 归属解析；**不新造**权限模型。
- **UI**（可选，Phase 4）：在设置/治理面新增只读画像查看 + "清除我的画像"按钮；参照 `ui/src/ui/capability/ai-workforce-governance/pages/working-style-effects-panel.ts` 的自包含能力模块风格。
- **PII 纪律**：日志/响应按 key 名引用，不回显 canonicalId 原文；store 只存结构化偏好 + 计数。

---

## 9. 迁移与兼容

| 场景                         | 策略                                                      |
| ---------------------------- | --------------------------------------------------------- |
| 老用户无 `user-profile.json` | 读时返回 `DEFAULT_USER_PROFILE`；不注入（等价于今天行为） |
| 建模开关关闭                 | `resolveUserModelingKey` 之前短路；采集与注入全跳过       |
| 匿名/群无发件人              | `resolveUserModelingKey` 返回 null → 跳过                 |
| 用户请求清除                 | `reset-profile` 删三 json；下轮起不注入                   |
| 跨渠道同一人                 | 经 `identityLinks` 归并到同一 canonicalId → 共享同一画像  |

---

## 10. 安全与审批边界

| 动作                              | 门槛                                              |
| --------------------------------- | ------------------------------------------------- |
| 确定性偏好学习（显式指令 + 语言） | 默认开启（保守模式）；租户可关                    |
| LLM 推断画像                      | opt-in，默认 off（`OPENBOT_USER_MODELING_INFER`） |
| 存原始消息内容                    | **禁止**（只存有界结构化偏好 + 计数）             |
| 跨用户/跨租户读画像               | 需管理员域 + 租户归属；有隔离测试                 |
| 画像目录命名                      | 必须哈希，禁止明文 PII                            |

> 隐私提示（务必保留）：跨会话用户建模天然触及用户行为画像。本设计的安全立场是"**只学用户自己对自己 Agent 说出口的偏好，租户内隔离，可查可删**"，这是正当的产品个性化（对标 Honcho），**不是**跨用户/跨租户的画像聚合或行为追踪；LLM 推断与任何内容级画像默认关闭。

---

## 11. 测试策略（fail-before / pass-after）

- **纯函数单测**：`detectUserPreferenceDirectives`（中英指令样例 + 无指令）、`deriveUserProfileDelta`（各规则 + 空 delta）、`renderUserProfileInstructions`（中性默认→空 / 各偏好→指令）、`evaluateUserProfileEffect`（improved/regressed/inconclusive）。
- **store 测**：写读往返、无变化不写、锁内读改写、change/suppression 生命周期、跨用户/跨租户隔离。
- **注入测（fail-before）**：建模关闭或用户无画像时，`get-reply-run` 组装出的系统提示词**不含**用户偏好段（锁定非回归）；建模并写入后**含**；清除后**再次不含**。
- **端到端**：用户说"简洁点" → 采集 → 画像 concise → 下一轮系统提示词含"keep replies concise"。
- **fail-closed**：匿名/无 peerId → 无落盘、无注入。
- 运行：`OPENBOT_TEST_PROFILE=low pnpm test src/gateway/user-modeling`（+ 注入点相关测试）；`pnpm tsgo`；`pnpm check`。

---

## 12. 所有权与协调（Loom）

**优先拥有新建模块（冲突面最小）**：

- `.kiro/specs/cross-session-user-modeling/**`
- `src/gateway/user-modeling/**`（全新）
- `src/gateway/server-methods/user-modeling.ts`（全新）

**协调触点（他方 owner，narrow diff + claim + 沟通）**：

- `src/auto-reply/reply/get-reply-run.ts`（回复管线；注入 2~4 行，紧邻既有 workingStyle 注入）
- `src/auto-reply/reply/agent-runner-execution.ts`（若选咽喉点 A；追加一次 fire-and-forget）— 与 `evolution-runtime-closure` / growth 多任务共享，务必 narrow
- `src/gateway/method-scopes.ts` / `server-methods-list.ts`（登记新 RPC）
- `src/routing/session-key.ts`（若抽取 `resolveLinkedPeerId` 复用；优先只读复用，不改签名）

热文件冲突时：不 `git add .`；用 `scripts/committer` 仅本任务文件；`--fail-on-conflict` 失败则拆提交或等 owner。
