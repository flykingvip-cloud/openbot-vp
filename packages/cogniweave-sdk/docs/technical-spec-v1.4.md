# CogniWeave Technical Spec v1.4

## 一、文档定位

本文件是 CogniWeave 当前唯一有效的技术规格文档。

目标是给实现团队提供一个可直接落地的工程约束版本，重点解决：

- 多存储一致性
- 写入幂等与去重
- graph schema 与 template DSL 闭环
- reasoning 读取稳定性
- explainability 与 repair 可执行性

## 二、系统执行模型

### 2.1 Agent Loop

```text
Input
  -> Task Framer
  -> Reasoning Runtime
  -> CognitivePackage
  -> Agent Execution
  -> Distillation (write-back)
```

### 2.2 性能口径

| 模块                        | 是否计入 200ms |
| --------------------------- | -------------- |
| Task Framer（规则路径）     | ✅             |
| Task Framer（LLM fallback） | ❌             |
| Reasoner                    | ✅             |
| Graph Query                 | ✅             |
| Evidence 加载               | ❌             |

## 三、Storage Truth Model

### 3.1 Canonical Truth Principle

CogniWeave 的唯一真相层是 `Metadata DB`。

`Graph DB` 与 `Vector Index` 都是派生层，必须可从 canonical records 完全重建。

### 3.2 Storage Truth Table

| 对象                        | 主存（Source of Truth）    | 派生层                  | 说明                                                     |
| --------------------------- | -------------------------- | ----------------------- | -------------------------------------------------------- |
| MemoryAtom                  | Metadata DB                | Graph DB / Vector Index | Atom 的状态、版本、scope、provenance 以 Metadata DB 为准 |
| EventSkeleton               | Metadata DB                | Graph DB / Vector Index | Event 结构化信息主存于 Metadata DB                       |
| Relations / Edges           | Metadata DB                | Graph DB                | 关系 canonical record 在 Metadata DB，Graph 仅作查询镜像 |
| Entity / Scenario / Problem | Metadata DB                | Graph DB / Vector Index | 任务语义对象唯一真相                                     |
| Evidence                    | Object Store + Metadata DB | —                       | 原文在对象存储，权限与索引元数据在 Metadata DB           |
| Seed Index Docs             | —                          | Vector Index            | 纯派生索引，可重建                                       |
| Conflict Records            | Metadata DB                | Graph DB（可镜像）      | 冲突判定主记录在 Metadata DB                             |
| Version Links               | Metadata DB                | Graph DB（可镜像）      | 版本真相在 Metadata DB，Graph 仅为查询便利               |
| Write Journal               | Metadata DB                | —                       | 驱动 repair 与 derived sync 恢复                         |

### 3.3 事务边界

写入事务分两阶段。

#### Phase A：主写入事务（必须成功）

写入 `Metadata DB`：

- event
- atom
- entity
- scenario
- problem
- relation record
- provenance
- conflict record
- version record
- write journal

#### Phase B：派生写入（可重建）

异步或受控同步写入：

- graph nodes
- graph edges
- vector seed docs

如果 `Phase B` 失败：

- journal 标记为 `DERIVED_OUT_OF_SYNC`
- 后台 repair job 重建派生层

### 3.4 Required Recovery Interfaces

必须实现：

```python
write_journal(...)
rebuild_from_truth(...)
repair_derived_indexes(...)
```

## 四、Canonical Graph Schema Contract

### 4.1 Fixed Node Types

- `MemoryAtom`
- `EventSkeleton`
- `Entity`
- `Scenario`
- `Problem`
- `Evidence`

### 4.2 Atom Types

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

### 4.3 Relation Enums（唯一来源）

- `APPLIES_TO`
- `TRIGGERED_BY`
- `SOLVES`
- `MITIGATES`
- `CONSTRAINED_BY`
- `CAUSED_BY`
- `SUPPORTED_BY`
- `CONFLICTS_WITH`
- `SUPERSEDES`
- `INSTANTIATED_IN`
- `RELATED_TO`

### 4.4 Relation Record

```yaml
RelationRecord:
  id:
  relation_type:
  from_node_id:
  from_node_type:
  to_node_id:
  to_node_type:
  scope:
  status: active | deprecated
  provenance:
    source_event_ids: []
    evidence_refs: []
```

### 4.5 DSL Closure Rule

模板系统必须严格绑定 graph schema。

必须明确区分：

- node type
- atom type
- relation type
- DSL 语法糖

例如：

```text
Scenario / Problem -> node type
failure_pattern / strategy / constraint -> atom type
TRIGGERED_BY / MITIGATES / CONSTRAINED_BY -> relation type
mitigates_inverse -> DSL alias for reverse(MITIGATES)
```

`inverse relation` 只允许作为 DSL 层语法糖存在，不允许新增物理 relation。

## 五、Canonical Data Models

### 5.1 MemoryAtom

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

### 5.2 EventSkeleton

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

### 5.3 Entity

```yaml
Entity:
  id:
  entity_type:
  name:
  aliases: []
  tags: []
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
  provenance:
    source_event_ids: []
```

### 5.4 Scenario

```yaml
Scenario:
  id:
  name:
  tags: []
  summary:
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
  provenance:
    source_event_ids: []
```

### 5.5 Problem

```yaml
Problem:
  id:
  statement:
  normalized_statement:
  tags: []
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
  provenance:
    source_event_ids: []
```

### 5.6 Evidence

```yaml
Evidence:
  id:
  type:
  uri:
  snippet:
  timestamp:
  trust_score:
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
```

### 5.7 TaskFrame

必填字段：

```yaml
TaskFrame:
  id:
  task_type:
  goals: []
  problems: []
  scenario_tags: []
  constraints: []
  entities: []
  required_atom_types: []
  scope:
    workspace_id:
    project_id:
    agent_id:
    visibility:
```

选填字段：

- `risk_level`
- `priority`
- `time_horizon`

## 六、Idempotency, Deduplication, and Merge

### 6.1 Canonical Keys

#### event_key

```text
hash(
  workspace_id +
  project_id +
  agent_id +
  source_session +
  turn_range +
  fingerprint
)
```

#### dedup_key（Atom candidate）

```text
hash(
  atom_type +
  normalized_claim +
  normalized_trigger +
  scope
)
```

#### entity_key

```text
hash(entity_type + normalized_name + scope)
```

#### scenario_key

```text
hash(normalized_name + sorted(tags) + scope)
```

#### problem_key

```text
hash(normalized_statement + scope)
```

#### ingestion_checksum

```text
hash(raw_input + metadata)
```

### 6.2 Upsert Rules

| 对象     | 条件                | 行为                |
| -------- | ------------------- | ------------------- |
| Event    | `event_key` 相同    | update              |
| Atom     | `dedup_key` 相同    | run merge decision  |
| Entity   | `entity_key` 相同   | update aliases/tags |
| Scenario | `scenario_key` 相同 | merge tags/summary  |
| Problem  | `problem_key` 相同  | update              |
| Evidence | checksum 相同       | skip                |

### 6.3 Merge Decision Rule

`dedup_key` 相同不等于必然 merge。

必须额外校验：

- `action` 是否兼容
- `applicability.include` 是否兼容
- `applicability.exclude` 是否兼容
- 是否存在显著冲突的 `policy / preference / constraint`

### 6.4 Merge Outcomes

| 条件                                          | 结果                                   |
| --------------------------------------------- | -------------------------------------- |
| claim/trigger 相同，action/applicability 兼容 | merge into latest version              |
| claim/trigger 相近，但 applicability 冲突     | create sibling atom + `RELATED_TO`     |
| claim 冲突                                    | create sibling atom + `CONFLICTS_WITH` |
| 新结论明确替代旧结论                          | create new version + `SUPERSEDES`      |

### 6.5 Write State Machine

```text
RECEIVED
  -> EVENT_BUILT
  -> OBJECTS_EXTRACTED
  -> METADATA_COMMITTED
  -> GRAPH_SYNCED
  -> VECTOR_SYNCED
  -> COMPLETED
```

## 七、Task Framer Contract

### 7.1 Execution Strategy

1. rule-based
2. cache lookup
3. LLM fallback（仅在低置信度时）

### 7.2 Output Guarantee

Task Framer 必须输出：

- `task_type`
- `goals` 或 `problems`
- `scenario_tags`
- `constraints`
- `scope`

## 八、Reasoning Runtime

### 8.1 Seed Retrieval Objects

- `MemoryAtom`
- `EventSkeleton`
- `Entity`
- `Scenario`
- `Problem`

### 8.2 Seed Index Payload

#### Atom

- `claim.statement`
- `trigger.conditions`
- `trigger.context_tags`

#### Event

- `goal`
- `context`
- `decisions`

#### Entity

- `name`
- `aliases`
- `tags`

#### Scenario

- `name`
- `tags`
- `summary`

#### Problem

- `statement`
- `normalized_statement`
- `tags`

### 8.3 Read Policy

#### Version rule

- 只读取 latest version
- 被 `SUPERSEDES` 指向的旧版本均视为 `superseded`
- `superseded` 是读取期派生状态，不是物理状态字段

#### Status rule

| 状态         | 行为                   |
| ------------ | ---------------------- |
| `active`     | 正常参与               |
| `tentative`  | 可参与，降权           |
| `conflicted` | 可参与，降权并显式标注 |
| `deprecated` | 不参与                 |
| `superseded` | 不参与                 |

#### Final-answer rule

Reasoning 主路径只使用：

- latest objects
- non-deprecated objects

其中 `tentative` 与 `conflicted` 可以进入候选集，但如果进入最终 `CognitivePackage`，必须显式解释。

### 8.4 Path Scoring

所有值归一到 `[0,1]`。

```python
score = (
    w1 * semantic_match +
    w2 * relation_strength +
    w3 * confidence +
    w4 * task_fit +
    w5 * reuse_score
) - conflict_penalty
```

约束：

- 仅用于单 reasoning session 内排序
- 不跨 session 比较

### 8.5 CognitivePackage

```yaml
CognitivePackage:
  id:
  answer:
  why:
    summary:
    matched_patterns: []
  supporting_atoms: []
  reasoning_path: []
  confidence:
  risks: []
  constraints: []
  conflicts: []
  evidence_refs: optional
```

## 九、Explainability System

### 9.1 Required Interfaces

```python
engine.trace_package(package_id)
engine.trace_reasoning_session(session_id)
engine.resolve_evidence(atom_id)
```

### 9.2 Trace Payload

必须可返回：

- TaskFrame
- 所有候选路径
- 选中路径
- 被淘汰路径与原因
- supporting_atoms
- conflicts
- evidence_refs

## 十、Scope Model

### 10.1 Mandatory Scope

所有对象必须包含：

```yaml
scope:
  workspace_id:
  project_id:
  agent_id:
  visibility:
```

### 10.2 Access Rule

访问范围必须满足：

```text
evidence visibility ⊆ atom visibility ⊆ event visibility
```

实现要求：

- Evidence 不能比其关联 Atom 更宽
- Atom 不能比其来源 Event 更宽
- 跨 scope merge 必须显式禁止

## 十一、Repair Journal

### 11.1 Journal Schema

```yaml
WriteJournal:
  id:
  event_key:
  object_ids:
    event_ids: []
    atom_ids: []
    entity_ids: []
    scenario_ids: []
    problem_ids: []
    relation_ids: []
  derived_plan:
    graph_node_ids: []
    graph_edge_ids: []
    vector_doc_ids: []
  status:
  phase:
  retry_count:
  last_error:
  updated_at:
```

### 11.2 Repair Semantics

```python
repair_job():
    for journal in failed_records:
        rebuild_from_truth(journal.object_ids, journal.derived_plan)
        repair_derived_indexes(journal.object_ids, journal.derived_plan)
```

## 十二、System Invariants

### Invariant 1

Metadata DB 是唯一真相。

### Invariant 2

所有写入必须幂等。

### Invariant 3

Graph / Vector 必须可从 Metadata DB 完全重建。

### Invariant 4

Evidence 不进入热路径。

### Invariant 5

Reasoning 仅使用 latest 且 non-deprecated 的对象。

### Invariant 6

任何 `tentative` 或 `conflicted` 结论如果进入最终 package，必须显式解释。

## 十三、工程结论

CogniWeave v1.4 是一个带 canonical metadata truth、幂等写入、可重建派生索引、模板约束推理与 package-level explainability 的认知图运行时系统。
