# CogniWeave（织忆引擎）PRD v1.1

## 一、产品定义（修订版）

### 1.1 产品名称

CogniWeave（织忆引擎）

### 1.2 产品本质（重要修订）

CogniWeave 是一个面向 AI Agent 的认知记忆运行时（Cognitive Memory Runtime），而不是传统意义上的“记忆 SDK”。

它运行在 Agent 执行循环中，负责：

- 认知抽取（Memory Distillation）
- 认知结构化（Cognitive Graph）
- 任务驱动检索（Task-driven Retrieval）
- 路径推理（Reasoning Paths）
- 记忆更新与治理（Memory Governance）

### 1.3 核心主张（不可弱化）

不是“记住历史”，而是“把任务转化为可复用认知”。

### 1.4 产品定位

| 维度               | CogniWeave                   |
| ------------------ | ---------------------------- |
| 类别               | Cognitive Memory Runtime     |
| 对比 RAG           | 从“找内容”升级为“用经验”     |
| 对比 Memory Plugin | 从“存偏好”升级为“存认知”     |
| 对比 KG            | 从“事实关系”升级为“决策支持” |

## 二、产品目标

### 2.1 核心目标

让智能体从：

`❌ 每次重新理解`

转变为：

`✅ 持续积累并复用认知`

### 2.2 系统能力目标

- 认知沉淀（Memory Distillation）
- 认知复用（Cross-task reuse）
- 路径推理（Graph reasoning）
- 可解释性（Traceable reasoning）
- 可纠错（Conflict-aware system）

## 三、核心原则（写入系统约束）

### 3.1 分层记忆原则

| 层级           | 作用     | 是否参与默认检索 |
| -------------- | -------- | ---------------- |
| Cognitive Atom | 主认知层 | ✅               |
| Event Skeleton | 语境层   | ✅               |
| Evidence       | 证据层   | ❌（仅按需）     |

### 3.2 强约束（必须执行）

默认检索路径只作用于：

- Memory Atoms
- Event Skeletons

Evidence Layer 不参与默认检索，仅在以下情况加载：

- 冲突
- 低置信度
- 用户要求解释

### 3.3 任务驱动原则

检索由 `TaskFrame` 决定，而不是由 embedding 相似度决定。

### 3.4 解释优先原则

所有输出必须包含“为什么”。

## 四、核心对象模型（重大升级）

### 4.1 Memory Atom（核心对象）

```yaml
MemoryAtom:
  id:
  atom_type:

  claim:
    type: causal | procedural | heuristic | policy | preference
    statement:

  trigger:
    conditions: []
    context_tags: []

  action: optional

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
```

### 4.2 Event Skeleton（增强）

```yaml
EventSkeleton:
  id:
  goal:
  context:
  constraints:
  decisions:
  turning_points:
  outcome:
  linked_atoms:
  evidence_refs:

  provenance:
    source:
```

### 4.3 TaskFrame（核心新增对象）

```yaml
TaskFrame:
  id:
  task_type:
  goals: []
  problems: []
  scenario_tags: []
  constraints: []
  entities: []
  required_atom_types:
  risk_level:
```

### 4.4 Scope（前瞻字段，MVP 必须预埋）

```yaml
scope:
  workspace_id:
  project_id:
  agent_id:
  visibility: private | shared
```

### 4.5 Evidence

```yaml
Evidence:
  id:
  type:
  uri:
  snippet:
  timestamp:
  trust_score:
```

## 五、核心系统模块（重构）

### 5.1 Memory Distiller

职责：

- 事件切分
- Atom 抽取
- 实体识别
- 证据关联

### 5.2 Cognitive Graph Engine

职责：

- 图构建
- 关系管理
- 冲突检测
- 版本控制

### 5.3 Task Framer（关键新增）

职责：

- 任务理解
- 结构化 TaskFrame
- 选择推理模板

API（必须）：

```python
task_frame = engine.frame_task(input)
```

### 5.4 Path Reasoner

职责：

- Seed retrieval
- 模板驱动扩展
- 路径评分
- 输出认知路径

### 5.5 Memory Governance

职责：

- 去重
- 合并
- 冲突检测
- 置信度更新
- 生命周期管理

### 5.6 Evidence Resolver

职责：

- 回溯
- 验证
- 解释支持

## 六、核心用户流程（修订）

### 6.1 写入流程

```text
Input
  -> Event Skeleton
  -> Atom Extraction
  -> Graph Insert
  -> Governance
```

### 6.2 推理流程（关键路径）

```text
User Input
  -> Task Framer
  -> Seed Retrieval
  -> Path Reasoning
  -> Cognitive Package
  -> Agent
```

### 6.3 回溯流程

```text
Atom
  -> Event
  -> Evidence
```

## 七、CognitivePackage（强制标准）

标准输出（必须）：

```yaml
CognitivePackage:
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

## 八、API 设计（修订）

### 8.1 写入

```python
engine.ingest(input)
engine.distill(event_id)
```

### 8.2 任务建模（新增）

```python
task = engine.frame_task(input)
```

### 8.3 推理

```python
result = engine.reason(task)
```

### 8.4 解释性 API（新增）

```python
engine.trace(atom_id)
engine.get_provenance(atom_id)
engine.get_conflicts(atom_id)
engine.get_version_history(atom_id)
```

## 九、MVP 交付物（修订）

必须交付：

- Python SDK
- REST API
- Graph + Metadata 默认存储适配器
- 本地开发环境
- 示例 Agent 工程
- 示例数据集
- 评估脚本
- 文档

## 十、评估体系（新增）

### 10.1 Atom 抽取评估

数据集：100-500 标注样本

指标：

- Precision
- Recall
- Schema correctness

### 10.2 推理评估

人工评审：

- 是否合理
- 是否可解释
- 是否优于 baseline

### 10.3 产品指标

- 记忆复用率
- 重复错误下降
- 任务连续性提升

## 十一、非目标（保持）

- 不做 UI
- 不做复杂权限系统
- 不做完整 KG
- 不做 orchestration

## 十二、版本规划（保持但明确）

### MVP（v0.1）

- 核心 pipeline
- 基础 graph
- 基础 reasoning

### v1

- 多模板
- Studio
- 多 Agent

### v2

- 自进化记忆
- 认知编译
- 联邦记忆

## 十三、最终产品定义（最终版）

CogniWeave 是一个面向智能体的认知记忆运行时，通过认知单元、事件骨架与认知图结构，将任务转化为可复用经验，并通过任务驱动路径推理实现跨任务认知复用，使 AI 从“重新理解一切”进化为“持续积累认知”。
