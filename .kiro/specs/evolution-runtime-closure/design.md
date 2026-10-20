# 技术设计：进化运行时闭环（Evolution Runtime Closure）

> 状态：Phase 0 审计完成 · 以生产代码证据为准（2026-07-19）  
> Owner agent：`grok-evolution-closure`  
> 关联：`skill-lifecycle-asset-system`、`agent-growth-lifecycle`、`docs/design/openbot-evolution-roadmap-alignment-2026-07-12.md`

---

## 0. Phase 0 现状复核（代码证据）

### 0.1 闭环 B — 技能资产 vs 真实执行

| 项              | 证据                                                                                                                                 | 判定                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 资产存储        | `src/gateway/skill-lifecycle-store.ts`：`RobotSkillRelation`（261–270）、`runtimeDefinition` 于 `StoredSkill`（251–259）、JSON store | 资产层真实              |
| 安装/启用       | `toggleRobotSkillAsset` / `installSkillToRobotAsset` 仅改 relation；install 可选 `syncInstallToRuntime`                              | 关系真实                |
| 运行时加载      | `src/agents/pi-embedded-runner/skills-runtime.ts:4–18` → `loadWorkspaceSkillEntries`                                                 | **FS SKILL.md**         |
| FS 源           | `src/agents/skills/workspace.ts` managed/workspace/`.agents/skills`                                                                  | 与资产 store **无桥**   |
| attempt 消费    | `src/agents/pi-embedded-runner/run/attempt.ts` ~786–806 `resolveSkillsPromptForRun`                                                  | 不读 lifecycle store    |
| runtime-binding | `src/gateway/runtime-binding-sync.ts:101–114` upsertBinding 仅 bookkeeping                                                           | **不进** skill snapshot |
| 结论            | **两套（实为三套：资产 / FS skills / runtime bindings）平行**                                                                        | **P0-High 断点**        |

### 0.2 闭环 B — 健康度

| 项            | 证据                                                                 | 判定                       |
| ------------- | -------------------------------------------------------------------- | -------------------------- |
| 窗口          | `skill-lifecycle-store.ts:1474–1524` `healthSampleWindows = new Map` | **进程内**                 |
| 折叠持久化    | `recordSkillHealthTelemetry` 1124–1149 写 store successRate          | 聚合后写盘，窗口本身不持久 |
| 生产调用      | 仅 `skill-health.sample` RPC + UI `skill-health.ts:142`              | **无 runner 钩子**         |
| lastInvokedAt | 类型 267；sanitize 629；init null 955/1410；**无赋值写入点**         | 永不更新                   |
| 结论          | 健康度非真实调用自动产生                                             | **P0-High**                |

### 0.3 闭环 B — 稳定模式

| 项         | 证据                                                                         | 判定                   |
| ---------- | ---------------------------------------------------------------------------- | ---------------------- |
| 前端启发式 | `ui/.../asset-suggestion-trigger.ts:64–123` 正则匹配即 `sampleCount: 3`      | **假证据**             |
| 热路径     | `ui/.../gateway-subscriptions/chat.ts` chat final → maybeOpenAssetSuggestion | 浏览器侧               |
| subscribe  | `pattern-detection.ts` 请求 `pattern-detection.subscribe`                    | **无 gateway handler** |
| extract    | `skill-lifecycle-store.ts:885–902` 固定中文模板 confidence 0.72              | stub                   |
| 结论       | 权威检测未在服务端                                                           | **P0-High**            |

### 0.4 闭环 A — 成果 vs 技能

| 项         | 证据                                                                                           | 判定             |
| ---------- | ---------------------------------------------------------------------------------------------- | ---------------- |
| 统一 store | `AssetType` 含 knowledge/capability（store:8）；`saveSkillAsset` 共用                          | 混合             |
| 自动捕获   | chat final → deliverable capture → `saveSkillAsset` knowledge + 可建 robot relation（948–960） | **语义混淆风险** |
| 结论       | 类型字段有，运行语义未硬隔离                                                                   | **P0-Med**       |

### 0.5 闭环 C — Working DNA

| 项                | 证据                                                                    | 判定                  |
| ----------------- | ----------------------------------------------------------------------- | --------------------- |
| 任务信号          | `agent-runner-execution.ts:133–152` `recordTaskOutcome` fire-and-forget | **live**              |
| 分数刷新          | `operational-metrics-store.ts:5–8,178–192` 仅 operationalScore          | 部分自动              |
| DNA 变更          | `server-methods/agent-growth.ts:356–386` 仅 recompute-growth            | **UI/RPC 门闩**       |
| 注入              | `get-reply-run.ts:335–337` `resolveWorkingStyleInstructions`            | 有消费者              |
| 回滚/抑制         | `working-style-store.ts:185–286`                                        | 实现在 recompute 路径 |
| recordToolOutcome | 仅定义 `operational-metrics-store.ts:90`，**零调用点**                  | 信号空洞              |
| humanTakeover     | runner 永不传 true                                                      | 信号空洞              |
| 结论              | 架构半闭环；自动 DNA 未接后台                                           | **P0-Med**            |

### 0.6 闭环 D — 平台治理

| 项              | 证据                                                           | 判定                |
| --------------- | -------------------------------------------------------------- | ------------------- |
| Map stores      | `ai-assets/store.ts:18–22` 等全模块 Map                        | 内存原型            |
| runScheduledJob | `auto-governance/engine.ts:385–406`                            | **无 startup 注册** |
| pause           | `pauseAsset` 改 Map + console.log                              | 无 runtime 副作用   |
| 生产 RPC        | `server-methods/governance.ts` 投影 bindings + 假 execute 历史 | 分叉脑              |
| 结论            | 算法有、闭环无                                                 | **P0-High**         |

---

## 1. 目标架构（收敛，不平行建设）

```
┌────────────── 闭环 A 成果 ──────────────┐
│ run/chat final → deliverable capture     │
│ → knowledge asset (versioned)            │
│ → 成果中心读模型（非执行投影）            │
└──────────────────────────────────────────┘

┌────────────── 闭环 B 可执行技能 ─────────┐
│ samples (server) → pattern detector      │
│ → candidate (gated) → human approve      │
│ → published version → install/enable     │
│ → SkillExecutionBinding ──唯一投影──┐    │
│                                     ▼    │
│                         agent skills load │
│ → skill_invocation_* → health/usage      │
│ → gray / pin version / rollback          │
└──────────────────────────────────────────┘

┌────────────── 闭环 C Agent 行为 ─────────┐
│ task/tool/deliverable/takeover signals   │
│ → operational-metrics (persist)          │
│ → background recompute/DNA apply         │
│ → working-style.json → prompt inject     │
│ → 2nd-order assess / rollback / suppress │
└──────────────────────────────────────────┘

┌────────────── 闭环 D 平台治理 ───────────┐
│ durable metrics → anomaly → action       │
│ → approve / auto (kill switch)           │
│ → mutate real binding/runtime            │
│ → effect verify + audit                  │
└──────────────────────────────────────────┘
```

### 1.1 SkillExecutionBinding（设计要点）

**原则**：不新建资产库；在既有 `skill-lifecycle-store` 之上增加 **投影层**。

推荐实现（Phase 1 二选一，优先改动面小者，以 fail-before 测试锁定）：

**选项 A — 物化到 managed skills 目录**  
install/enable/upgrade → 将当前版本 `runtimeDefinition` 写成 agent managed `skills/<id>/SKILL.md`（或结构化等价物）；disable/remove → 删除/标记不可见。  
优点：复用现有 `loadWorkspaceSkillEntries`。  
风险：与用户手写 workspace skills 冲突需命名空间前缀（如 `ob-asset-<skillId>`）。

**选项 B — 运行时合并 snapshot**  
在 `resolveEmbeddedRunSkillEntries` / attempt 前合并：FS skills ∪ `projectEnabledLifecycleSkills(agentId)`。  
优点：无磁盘漂移。  
风险：改 pi-embedded 热路径（与 `daibai-super-steward` 等路径可能冲突，需协调）。

**选定策略**：Phase 1 先落地 **选项 A（物化）** 作为默认（不触碰 attempt.ts 所有权冲突面）；若物化无法表达 tools/workflow，再增量做 B 的过滤层。最终以测试锁定「禁用后下次运行不可见」。

### 1.2 调用事件契约

```ts
type SkillInvocationCompleted = {
  invocationId: string;
  skillId: string;
  skillVersion: string;
  agentId: string;
  tenantId: string | null;
  userId: string | null;
  startedAt: number;
  completedAt: number;
  outcome: "success" | "failure" | "cancelled";
  latencyMs: number;
  failureCategory: string | null;
  runId: string | null;
  sessionKey: string | null;
  businessOutcome: string | null; // null ok, never fake
};
```

持久化：事件 append-log（JSONL/store）+ 折叠到 relation/health；重启可重算窗口。

### 1.3 服务端模式检测

- 样本：独立 `runId`/`taskId` + 结构指纹（输入/输出/工具轨迹哈希）
- 阈值：独立任务次数 ≥ N、时间跨度、成功率、agent/tenant 边界
- 输出：`PatternCandidate` 持久化；UI 只读 list/subscribe
- **废弃真相源**：前端 `sampleCount: 3` 硬编码；保留 UI 展示

### 1.4 Working DNA 后台触发

在 `recordTaskOutcome` / 未来 tool 信号之后：

- 节流（如每 agent 最小间隔 / 每 N 次任务）调用与 `agents.recompute-growth` 同源的 **内部** `recomputeRobotGrowthAndDna(...)`
- 不依赖浏览器打开
- UI RPC 保留

### 1.5 治理持久化与生效

- 采用仓库已有原子 JSON 或 SQLite ensure-schema 模式（与 `agent-growth` class=D JSON 一致优先，避免未接线 SQL DDL）
- `runScheduledJob` 挂到 `server-maintenance` / cron tick
- pause → `agent-runtime-store` binding `disabled` 或 lifecycle drain（真实消费者已有 binding 状态投影）
- 幂等键：`actionKey = hash(assetId, ruleId, window)`

---

## 2. 迁移与兼容

| 场景                                      | 策略                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| 已有 lifecycle 技能无物化文件             | 首次 enable/install 或 maintenance backfill 物化          |
| knowledge deliverable 已挂 robot relation | 投影层 **排除** non-executable assetType；UI 仍可展示成果 |
| 旧 health Map 窗口                        | 重启后从事件日志重建；无日志则 successRate 保留盘上值     |
| 旧前端 pattern localStorage               | 降级为缓存；门槛以服务端 candidate 为准                   |
| governance Map                            | 冷启动空；首次调度从 runtime bindings 种子 assets         |

---

## 3. 安全与审批边界

| 动作                      | 门槛                                 |
| ------------------------- | ------------------------------------ |
| candidate → published     | 人工审批（企业/个人策略可配置）      |
| 自动 DNA 变更             | 允许；回归自动回滚 + suppression     |
| governance pause 生产 bot | human-gated 或严格规则 + kill switch |
| limit/redirect            | 未实现真实效果前不得标 executed      |

---

## 4. 测试策略

- Fail-before：安装 lifecycle 技能后 `resolveEmbeddedRunSkillEntries` 不含该技能
- Pass-after：binding 投影后包含；disable 后消失
- E2E：gateway install → 下一次 attempt 技能 prompt 变化
- 并发：双事件不双计 usageCount
- 重启：health 窗口可恢复

---

## 5. 所有权与路径（Loom）

Owner：`grok-evolution-closure`  
**优先拥有新建模块**（避免与 active owner 硬冲突）：

- `.kiro/specs/evolution-runtime-closure/**`
- `src/gateway/skill-execution-binding/**`（新建）
- `src/gateway/pattern-detection/**`（新建服务端）
- `src/gateway/skill-invocation/**`（新建事件/折叠）
- `src/gateway/evolution-governance/**`（新建持久化适配 / 调度接线，包装既有 ai-workforce 算法）

**协调触点**（他方 owner，实施时 narrow diff + 沟通/claim）：

- `src/gateway/skill-lifecycle-store.ts`（capability-lifecycle-closure:kiro-daibai）
- `src/gateway/agent-growth/**`（kiro-agent-growth）
- `src/auto-reply/reply/agent-runner-execution.ts`（多任务声称）
- `src/agents/pi-embedded-runner/**`（daibai-super-steward 等）
- `src/gateway/ai-workforce-governance/**`（registry 已有 glob）
- `ui/src/ui/controllers/asset-suggestion-trigger.ts`

热文件冲突时：不 `git add .`；用 `scripts/committer` 仅本任务文件；`--fail-on-conflict` 失败则拆提交或等 owner。
