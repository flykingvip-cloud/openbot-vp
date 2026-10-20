# Memory Distiller v1

## 一、模块定位

Memory Distiller 是 CogniWeave 的认知生成引擎，负责把原始输入转化为可写入 canonical truth layer 的结构化对象。

它必须输出：

- `EventSkeleton`
- `MemoryAtom[]`
- `Entity[]`
- `Scenario[]`
- `Problem[]`
- `Evidence[]`
- `RelationRecord[]`
- canonical keys 与 write metadata

## 二、系统位置

```text
Raw Input
  -> Memory Distiller
    -> Event Skeleton
    -> Memory Atoms
    -> Entities / Scenarios / Problems
    -> Evidence
    -> Relation Records
  -> Canonical Metadata Write
  -> Graph / Vector Derived Sync
```

## 三、核心原则

### 3.1 抽取认知，不做摘要

错误目标：

- 复述用户说了什么
- 摘要一段对话

正确目标：

- 在什么条件下
- 会发生什么机制
- 应该如何行动
- 在什么范围内适用

### 3.2 原文不进入热层

- 原文进入 `Evidence`
- 抽象结果进入 `EventSkeleton` 与 `MemoryAtom`

### 3.3 每个 Atom 必须可复用

每个 `MemoryAtom` 至少应具备：

- `trigger`
- `claim`
- `applicability`

### 3.4 多阶段 pipeline，禁止一次性黑箱抽取

Distillation 必须拆分为多个阶段，以降低：

- hallucination
- 结构错乱
- 类型混淆
- 误合并

## 四、Pipeline

```text
Raw Input
  -> Step 1: Segmentation
  -> Step 2: Event Construction
  -> Step 3: Context Understanding
  -> Step 4: Object Extraction
  -> Step 5: Normalization
  -> Step 6: Key Generation
  -> Step 7: Candidate Dedup & Merge Decision
  -> Step 8: Validation & Repair
  -> DistillationResult
```

## 五、Step 1：Segmentation

### 5.1 支持输入类型

- `chat`
- `tool_logs`
- `docs`
- `diff`

### 5.2 Event 定义

一个 `Event` 是一个目标驱动过程，不是任意固定长度文本块。

### 5.3 切分策略

- turn grouping
- intent shift detection
- tool boundary
- time window

### 5.4 边界规则

- 同一目标下的工具重试，默认归入同一 event
- 明显目标切换，必须切成新 event
- 长会话中断后恢复，若目标连续且上下文连续，可续写原 event
- 文档与 diff 输入按单个任务意图或单个变更主题切分

### 5.5 输出

```yaml
RawEventChunk:
  text:
  turns: []
  tool_calls: []
  metadata:
```

## 六、Step 2：Event Construction

### 6.1 目标

生成结构化事件骨架，而不是摘要。

### 6.2 输出对象

```yaml
EventSkeleton:
  id:
  goal:
  context:
  constraints: []
  decisions: []
  turning_points: []
  outcome:
  linked_atoms: []
  evidence_refs: []
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
```

### 6.3 必须同时生成

- `event_key`
- `ingestion_checksum`
- 最小 `provenance`

## 七、Step 3：Context Understanding

### 7.1 中间结构

```yaml
ContextFrame:
  problems: []
  signals: []
  environment: []
  entities: []
  scenarios: []
```

### 7.2 作用

为后续对象抽取提供统一语义视图，减少重复与漂移。

## 八、Step 4：Object Extraction

### 8.1 必须拆分抽取对象

Memory Distiller 不只抽 Atom，还必须正式产出：

- `MemoryAtom`
- `Entity`
- `Scenario`
- `Problem`
- `Evidence`
- `RelationRecord`

### 8.2 Atom Types

- `problem_pattern`
- `failure_pattern`
- `strategy`
- `success_pattern`
- `constraint`
- `decision_rule`
- `heuristic`
- `anti_pattern`
- `policy`
- `preference`

### 8.3 MemoryAtom 输出要求

```yaml
MemoryAtom:
  id:
  atom_type:
  claim:
    type:
    statement:
  trigger:
    conditions: []
    context_tags: []
  action:
  applicability:
    include: []
    exclude: []
  provenance:
    source_event_ids: []
    evidence_refs: []
  versioning:
    version:
    parent_version:
  state:
    status: active | tentative | conflicted | deprecated
    conflicts_with: []
  metrics:
    confidence:
    reuse_count:
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
```

### 8.4 抽取约束

- 必须可复用
- 不得复述原文
- 不得省略 trigger / claim / applicability
- 不得输出跨 scope 对象

## 九、Step 5：Normalization

### 9.1 目的

避免：

- 同义不同写法
- claim 漂移
- entity 别名碎片化
- dedup 失效

### 9.2 规范化内容

1. trigger 标准化
   `high latency` -> `high_latency`

2. entity 对齐
   `queue system` -> canonical entity `queue`

3. claim 抽象化
   去掉局部数字、实例和一次性上下文噪声

### 9.3 方法

- rule-based mapping
- alias normalization
- optional offline clustering

约束：

`embedding clustering` 只能用于离线治理或建议，不能作为在线 canonical write path 的唯一判定依据。

## 十、Step 6：Key Generation

### 10.1 必须生成的 canonical keys

- `event_key`
- `dedup_key`
- `entity_key`
- `scenario_key`
- `problem_key`
- `ingestion_checksum`

### 10.2 规则来源

所有 key 生成规则必须与 `technical-spec-v1.4.md` 保持一致。

## 十一、Step 7：Candidate Dedup & Merge Decision

### 11.1 流程

```text
new_atom
  -> compute dedup_key
  -> lookup existing atoms
  -> candidate similarity check
  -> merge decision
  -> merge / sibling / conflict / supersede
```

### 11.2 重要约束

相似度不能直接决定 merge。

相似度只用于筛选 candidate，不能直接成为最终行为。

### 11.3 Merge Decision 必查项

- `action` 是否兼容
- `applicability.include` 是否兼容
- `applicability.exclude` 是否兼容
- 是否存在 `policy / preference / constraint` 冲突

### 11.4 输出行为

| 条件                                          | 结果                                   |
| --------------------------------------------- | -------------------------------------- |
| claim/trigger 相同，action/applicability 兼容 | merge into latest version              |
| claim/trigger 相近，但 applicability 冲突     | create sibling atom + `RELATED_TO`     |
| claim 冲突                                    | create sibling atom + `CONFLICTS_WITH` |
| 新结论明确替代旧结论                          | create new version + `SUPERSEDES`      |

## 十二、Step 8：Validation & Repair

### 12.1 结构验证

必须检查：

- trigger 是否存在
- claim 是否明确
- applicability 是否合理
- canonical fields 是否完整

### 12.2 热层准入验证

必须额外检查：

- 是否过于贴近原文
- 是否缺少最小 explainability 载荷
- 是否跨 scope 泄漏
- 是否与已有 atom 明显冲突
- 是否应降级为 `tentative`

### 12.3 自动修复

示例：

- trigger 为空 -> 使用 `ContextFrame` 补全
- applicability 缺失 -> 从 event context 推断最小范围
- confidence 过低 -> 标记为 `tentative`

## 十三、Evidence Generation

### 13.1 规则

每个 `MemoryAtom` 必须关联：

- `source_event_id`
- `evidence_id`
- `evidence snippet`

### 13.2 最小 Evidence 结构

```yaml
Evidence:
  id:
  type:
  uri:
  snippet:
  timestamp:
  trust_score:
  locator:
    turn_range:
    message_ids: []
    tool_call_ids: []
```

### 13.3 Snippet 约束

必须截取支持 claim 的最小充分片段，而不是整段原文。

## 十四、最终输出结构

```yaml
DistillationResult:
  event_skeleton:
  atoms: []
  entities: []
  scenarios: []
  problems: []
  evidence: []
  relations: []
  keys:
    event_key:
    ingestion_checksum:
    atom_dedup_keys: []
    entity_keys: []
    scenario_keys: []
    problem_keys: []
  write_metadata:
    scope:
    source_type:
    source_session:
```

## 十五、调用与执行策略

### 15.1 调用策略

典型 LLM 调用次数：

- Event: 1
- Context: 1
- Atom extraction: 3-6

总计：5-8 次

### 15.2 降级路径

必须支持：

- 纯规则路径
- 仅产出 `EventSkeleton` 不产出 Atoms
- 跳过低价值 atom types
- partial distillation with explicit status

### 15.3 并行化

- Atom extraction 可并行
- candidate lookup 可并行
- derived dedup 决策不可绕过 canonical validation

### 15.4 缓存

- 相同输入缓存
- pattern cache
- normalization cache

## 十六、质量评估

### 16.1 Atom 指标

| 指标         | 说明       |
| ------------ | ---------- |
| precision    | 是否正确   |
| reuseability | 是否可复用 |
| clarity      | 是否清晰   |

### 16.2 自动评估

- schema validation
- rule checks
- merge safety checks

### 16.3 人工评估

- 标注数据集：100-500
- 抽样审核 distillation outputs

## 十七、关键风险

### 风险 1：过拟合原文

解决：

- 强制抽象
- evidence 与 atom 分层

### 风险 2：生成无用 atom

解决：

- validation
- hot-layer admission gate

### 风险 3：重复爆炸

解决：

- canonical keys
- merge decision，而不是相似即 merge

### 风险 4：错误抽象污染系统

解决：

- evidence
- conflict
- versioning
- tentative state

## 十八、结论

Memory Distiller v1 是把经历变成认知的结构化生成引擎。

它不只是抽取文本特征，而是负责生成可写入 CogniWeave canonical truth model 的认知对象集合。

## 十九、依赖版本

本设计对齐：

- `packages/cogniweave-sdk/docs/prd-v1.1.md`
- `packages/cogniweave-sdk/docs/technical-spec-v1.4.md`
