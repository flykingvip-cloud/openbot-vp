# OpenBot 知识工作台：本地文件夹源与云端 Knowledge Runtime 增量方案

Date: 2026-07-14
Status: 草案待评审
作者: 架构评审（基于全量代码核实 + 专家团队反馈整合）
定位: 在“知识空间统一化 / Knowledge Runtime Core”已落地基础上的增量方案，不重写已交付主模型

关联文档:

- `docs/design/openbot-knowledge-runtime-core-execution-plan-2026-06-25.md`（Runtime Core / 5 域 / W0-W5）
- `docs/design/openbot-knowledge-space-unification-implementation-plan-2026-06-29.md`（知识空间 = KnowledgeBase.visibility；导入漏斗；plane）
- `docs/design/openbot-knowledge-space-unification-acceptance-report-2026-06-29.md`（W0-W9 + U4-U10 验收）
- `docs/design/openbot-knowledge-space-unification-known-issues-2026-06-29.md`（残留项 K1-K5 / U1-U10 / O1-O3）
- `docs/design/openbot-data-space-model-v1-2026-07-10.md`（Data Space 本地 / managed 边界）

---

## 0. 执行摘要

先纠正一个重要认知，避免重复造轮子：

> 专家愿景里的 Knowledge Space（知识空间）、Knowledge Runtime（Chunk / Embedding / Graph / Governance / Version）、Source（passive / active）统一模型、连接而非上传的导入漏斗、成果中心自动捕获，这些已经在 2026-06-29 的“知识空间统一化”批次落地并通过验收，不是待建能力。

因此本方案不是“把知识库从文档管理改造成知识运行时”，那一步已经完成。本方案只解决当前真正未落地的净新增能力：

1. 本地文件夹作为一种持久 passive source（`localFolder`），而不是一次性文件夹上传。
2. 本地文件夹的扫描 / 监听 / 墓碑删除回路，让“选择文件夹”变成“持续同步”。
3. 本地文件夹在 `managed` 模式下的本地 watcher -> 云端 Runtime 推送通道。
4. 基于 Obsidian 风格 Markdown 的显式图谱边增强、时间轴和 Feed 读模型。
5. 更细粒度的 chunk 级 delta，但它不再作为本地文件夹源落地的前置条件。

本次修订补充三个关键约束，作为评审基线：

1. **不要直接复用 `knowledge.source.bind` 处理 `localFolder`。**
   现有 RPC 明确只接受 active source（`api | external | capability`），而且当前 `SourceDescriptor` / `source-binding-store` 是“登记型”模型，不承载持续同步状态。
2. **不要把本地绝对路径直接持久化到 tenant 可见的 source descriptor。**
   在 `managed` 模式下，本地路径必须留在设备本地，不能进入云端 control-plane 主记录。
3. **本地文件夹源必须拆成三层模型。**
   `SourceDescriptor` 只表示逻辑来源；设备本地的 watcher / root path / scan cursor 是另一层；source 与 document 的归属关系还需要第三层运行时映射。

一句话：主模型已到位，当前缺的是“活的本地源 + 设备本地同步状态 + 云端传输通道”，而不是第二套 Knowledge Runtime。

---

## 1. 现状核对（已落地，禁止重复实现）

本节全部有代码或已验收方案佐证，用于圈定“不要再做一遍”的边界。

| 能力                                                                            | 状态                          | 证据                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| 知识空间 = `KnowledgeBase.visibility`（个人 / 团队 / 企业）                     | 已落地                        | `src/gateway/knowledge/knowledge-base-store.ts`                                                  |
| 统一 Source 模型（`SourceDescriptor` + `plane`）                                | 已落地                        | `src/gateway/knowledge/sources/source-descriptor.ts`                                             |
| Source kind = upload / web / dataset / api / external / enterprise / capability | 已落地                        | 同上（`KnowledgeSourceKind`）                                                                    |
| passive = 入 chunk 索引可检索；active = 仅登记、经能力运行时消费                | 已落地                        | `resolveSourcePlane`；`source-binding-store.ts`                                                  |
| 导入必须绑定到某空间（连接而非裸上传）                                          | 已落地                        | `knowledge.source.bind` / `knowledge.base.sources.list`                                          |
| RAG 内核（抽取 -> 指纹 -> 分块 -> 向量 -> FTS -> 治理）                         | 已落地                        | `kb-ingest.ts` / `kb-index-schema.ts`                                                            |
| 文档级增量去重（`unchanged` / `raw_only` / `new_semantic_version`）             | 已落地                        | `document-fingerprint.ts` `classifyContentVersionDelta`                                          |
| 单一 Runtime Cognitive Context（Agent 只消费 Runtime）                          | 已落地                        | `runtime/knowledge-runtime-context.ts` `resolveKnowledgeRuntimeContext`                          |
| 治理信号进 Agent 上下文（trust / freshness / conflict / claim）                 | 已落地                        | `resolve/context-builder.ts` + `KnowledgeEvidence`                                               |
| 成果中心自动归档回流 + 自动捕获                                                 | 已落地 / 进行中               | `deliverables/auto-archive-runtime.ts` / `auto-capture-runtime.ts`                               |
| 网页收藏（含快照 / 变更表 / refresh 调度）                                      | 已落地 / 预留                 | `knowledge.personal.collectWeb`；`web_source_snapshots` / `web_source_refresh`                   |
| 企业连接器主动源（目录 / 凭证 / 探测 / DataSource）                             | 已落地                        | enterprise-data 目录 + U8 连接器向导                                                             |
| 一次性文件夹上传（非持久）                                                      | 已落地                        | `personal-document-upload.ts` `readPersonalDocumentUploadFolder`（`webkitdirectory`）            |
| Data Space（`local` / `managed`，根 `~/OpenBot`）                               | 已落地                        | `ui/src/ui/ports/employee/data-space.ts`                                                         |
| watcher 基础设施（其他域）                                                      | 已落地，但 knowledge 域未复用 | `src/memory/manager-sync-ops.ts`、`src/agents/skills/refresh.ts`、`src/gateway/config-reload.ts` |

还要补充两条当前实现事实，这决定了本方案不能只“加一个 kind”：

1. `knowledge.source.bind` 当前是 **active-only contract**，会拒绝 passive source：
   - 只接受 `api | external | capability`
   - passive source 仍走上传 / 网页 / dataset ingest RPC
2. 当前 `SourceDescriptor.metadata` 是 `Record<string, string>`，`source-binding-store` 也是轻量 JSON 记录：
   - 适合登记式 active source
   - **不适合** 承载 `include[]`、`exclude[]`、scan cursor、设备本地 root path、同步状态

因此，“知识域未落地”的不是 watcher 这个技术词本身，而是以下能力在 knowledge/source/runtime 路径中仍然缺失：

- `localFolder` source kind
- source descriptor 与设备本地 folder binding 的分层
- source -> document 归属映射
- folder 级扫描 / 监听 / 墓碑删除
- `managed` 模式下本地 watcher -> 云端 Runtime 传输
- chunk 级 delta

---

## 2. 与专家愿景的差距映射

把专家反馈逐条对齐到现状，只把“净新增”纳入本方案范围。

| 专家主张                                 | 现状                                                 | 结论                                       |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| 用户“连接知识”而非“上传”                 | active 源已是连接式；被动文件仍是一次性上传          | 部分：补“本地文件夹 = 持久 passive source” |
| 知识库 = Source 管理中心，非文档堆       | 已是（`knowledge.base.sources.list` + plane）        | 已做                                       |
| 系统只存 Runtime，用户无感               | 已是（chunk / embed / graph / governance / version） | 已做，但仍需 lineage / 快照供出处与审计    |
| Agent 消费 Runtime 而非原始文件          | 已是（`resolveKnowledgeRuntimeContext`）             | 已做                                       |
| 成果中心 = 一种 Source，自动捕获         | 已是（auto-archive + auto-capture）                  | 已做                                       |
| 本地文件夹 Watch（监听 / 自动增量）      | knowledge 域无                                       | 净新增（本方案核心）                       |
| 同步 Knowledge Delta（只更新变化 chunk） | 仅文档级 delta，语义变化时整篇重切                   | 净新增，但不应阻塞 P1 / P3                 |
| 删除两模式（企业同步 / 个人快照）        | 有 `recycledDocumentIds`、web 快照先例               | 部分：需补 folder source 的专用 lifecycle  |
| 上传云端 / 调用云端                      | 索引在网关本机；云端无法直接读本地文件夹             | 净新增（本地 watcher -> 云端通道）         |
| 自动关系（无需 `[[...]]`）               | 推断图谱已在                                         | 已做；可补显式边增强                       |
| Knowledge Inbox / Timeline / Feed        | 隐式收件箱退役中；Timeline 未做；Feed 底座已在       | 净新增（读模型为主）                       |

---

## 3. 净新增能力设计（本方案范围）

### 3.1 三层模型：逻辑 Source、设备本地 Binding、运行时文档映射

`localFolder` 不能只表现为 `SourceDescriptor.kind` 的一个新枚举值，它至少需要三层模型：

```text
Knowledge Source Descriptor   (逻辑层，云端/控制面可见)
        |
        | 1:N
        v
Local Folder Binding         (设备本地运行层，仅拥有文件夹访问权的节点可见)
        |
        | 1:N
        v
Source Document Link         (运行时映射层，描述该 source 当前投影出的 doc 集合)
```

#### 3.1.1 逻辑层：`SourceDescriptor`

在统一 Source 模型上追加一个新 kind：

```ts
export type KnowledgeSourceKind =
  | "upload"
  | "web"
  | "dataset"
  | "api"
  | "external"
  | "enterprise"
  | "capability"
  | "localFolder";
```

约束：

- `localFolder` 仍是 `passive`，因此入 chunk 索引、可检索，不触碰消费边界。
- `SourceDescriptor` 只存**逻辑可见信息**：
  - `id`
  - `kind = "localFolder"`
  - `plane = "passive"`
  - `title`
  - `knowledgeBaseId`
  - `visibility`
  - `freshness`
  - 可选展示字段，如 `metadata.folderLabel`
- **不在此层存**：
  - 本地绝对路径
  - `include[]` / `exclude[]`
  - scan cursor
  - watcher 状态
  - 设备身份

原因：

- 当前 `metadata` 是 `Record<string, string>`，不适合承载结构化同步状态。
- `managed` 模式下本地路径属于设备私密信息，不应进入 tenant 可见 descriptor。

#### 3.1.2 设备本地运行层：`LocalFolderBinding`

新增设备本地持久模型，建议独立于 `source-bindings.json`：

```ts
type LocalFolderBinding = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  deviceId: string;
  mode: "local_index" | "managed_push";
  rootPath: string; // device-local only
  rootLabel: string; // cloud-visible friendly name
  includeGlobs: string[];
  excludeGlobs: string[];
  deletePolicy: "sync" | "snapshot";
  watcherEnabled: boolean;
  status: "idle" | "scanning" | "error";
  lastScanAt?: number;
  lastEventAt?: number;
  lastError?: string;
};
```

约束：

- `rootPath` 只能保存在**设备本地 store**。
- `mode = "local_index"` 时，scanner 与索引同机。
- `mode = "managed_push"` 时，scanner 在本地设备，Runtime 在云端。

#### 3.1.3 运行时映射层：`SourceDocumentLink`

新增 source 到 doc 的显式映射层：

```ts
type SourceDocumentLink = {
  sourceDescriptorId: string;
  docId: string;
  relativePath: string;
  state: "active" | "tombstoned" | "snapshotted_deleted";
  lastSeenAt: number;
  lastIngestedVersionId?: string;
  rawHash?: string;
  semanticHash?: string;
};
```

这层是本方案的关键，因为没有它就无法稳定实现：

- 墓碑删除
- 重扫文件夹后的“哪些文件已消失”
- 按 source 列出当前投影出的 doc 集合
- rename 识别
- UI 展示“该 source 当前同步了多少文件 / 最近同步状态”

### 3.2 合约拆分：不要重载 `knowledge.source.bind`

当前 `knowledge.source.bind` 是 active-only contract，继续让它只处理登记式 active source：

- `api`
- `external`
- `capability`

对 `localFolder` 新增专用 contract，避免破坏已落地语义：

1. `knowledge.local-folder.bind`
   - 创建逻辑 `SourceDescriptor`
   - 创建设备本地 `LocalFolderBinding`
   - 注册首次扫描任务
2. `knowledge.local-folder.scan-now`
   - 手动触发一次全量 / 增量扫描
3. `knowledge.local-folder.unbind`
   - 删除绑定，按 `deletePolicy` 决定是否清理投影内容
4. `knowledge.local-folder.status`
   - 返回本地 watcher / 上次扫描 / 最近错误 / 最近同步文件数

P3 再追加云端同步用 contract：

5. `knowledge.local-folder.sync.plan`
   - 客户端提交候选文件与 hash；服务端返回缺失版本清单
6. `knowledge.local-folder.sync.commit`
   - 客户端只上传服务端缺失的文件字节与元数据；服务端执行 ingest

这样做的好处：

- 旧调用方完全不受影响
- active / passive 语义继续清晰
- `managed` 模式下可以把“设备本地文件夹访问权”封装在专用 contract 内

### 3.3 文档身份与删除语义

#### 3.3.1 `docId` 规则

P1 建议使用 **source-scoped doc identity**：

```text
docId = hash(sourceDescriptorId + "::" + relativePath)
```

理由：

- 避免多个 folder source 绑定到同一 KB 时 `notes/index.md` 路径冲突
- 允许“相同内容来自不同 source”在运行时保持独立文档身份
- 跨 source 重复知识由现有 `semantic_hash` / governance / graph 去识别，不在 doc identity 层提前合并

#### 3.3.2 删除两模式

`deletePolicy` 语义应收紧为：

- `sync`
  - 文件从 folder 消失后：
    - `SourceDocumentLink.state = "tombstoned"`
    - 从知识空间解除该 doc 的活动投影
    - 删除索引行与版本行（可复用 `deleteKnowledgeDocumentFromIndex`）
  - 适用于企业“源文件即事实”的同步语义
- `snapshot`
  - 文件从 folder 消失后：
    - `SourceDocumentLink.state = "snapshotted_deleted"`
    - 保留当前 Runtime 快照，继续可检索 / 可回答
    - 停止后续 refresh，UI 明示“来源文件已删除，当前为快照”
  - 适用于个人知识沉淀

注意：`snapshot` 语义下**不应**调用 `detachDocumentFromKnowledgeBase`，否则文档会退出可检索集合，与“保留 Runtime 快照”目标冲突。

### 3.4 扫描 / 监听回路

新增 `src/gateway/knowledge/sources/local-folder-runtime.ts`，职责保持极薄：

1. 从 `LocalFolderBinding.rootPath` 遍历文件树
2. 按 `includeGlobs` / `excludeGlobs` + 复用 `personal-document-upload.ts` 的支持格式过滤
3. 生成 `relativePath` 与 source-scoped `docId`
4. 调用已存在的 `ingestKnowledgeDocument`
5. 记录 / 更新 `SourceDocumentLink`
6. 对“上次见过、本次没见到”的文件应用墓碑删除策略

实现约束：

- P1 复用现有文档级 delta 即可：
  - `classifyContentVersionDelta` 已能跳过未变文件
  - 不需要等 chunk 级 delta 才能交付本地文件夹源
- 监听实现可复用仓内现成 watcher 基础设施（`chokidar` seam 已在其他域验证过）
- 仍需周期性全量 reconcile：
  - watcher 负责近实时事件
  - 周期性全量扫描负责纠正丢事件、目录批量改名、跨进程状态漂移

### 3.5 调度状态不要直接照抄 `web_source_refresh`

`web_source_refresh` 的表结构可作为**结构灵感**，但不能生搬硬套进云端 knowledge index DB：

- `web_source_refresh` 成立的前提是：抓取器和索引在同一网关节点
- `localFolder` 在 `managed` 模式下不是这样：
  - 扫描器在本地设备
  - Runtime 在云端

因此建议：

- `LocalFolderBinding` store 承担设备本地调度状态
- 云端 `SourceDescriptor` 只存汇总态，如：
  - `freshness`
  - `lastSyncAt`
  - `lastSyncStatus`
  - `activeFileCount`

如果需要新增表，优先新增：

- `source_document_links`（运行时映射）

而不是在云端 index 先加一个误导性的全局 `folder_source_refresh` 表作为唯一真相。

### 3.6 本地模式与 `managed` 模式的部署拓扑

#### P1: `local` 模式

```text
本地网关
  watcher/scanner
      ↓
  ingestKnowledgeDocument
      ↓
  本机 knowledge index SQLite
```

特点：

- 零出网
- 零传输协议
- 最快兑现“选本地文件夹 -> 变成持续知识空间”

#### P3: `managed` 模式

```text
本地设备（Mac app / 本地 watcher 组件）
  读取文件夹
  计算 raw_hash / semantic_hash hint
  保存 device-local binding
      ↓
  调用云端 sync.plan / sync.commit
      ↓
云端网关
  ingestKnowledgeDocument
  建 chunks / embeddings / graph / governance
      ↓
Agent / UI 统一消费云端 Runtime
```

约束：

- 设备本地 watcher 应复用现有 device identity / 配对通道，不另造一套设备认证。
- P3 首版不要让客户端上传向量或 chunk：
  - 上传单位保持“文件字节 + relativePath + hash hint”
  - 抽取 / 分块 / 向量化全部由服务端完成
- 本地绝对路径只留在设备本地 binding store，云端只见 `sourceDescriptorId` 与 `rootLabel`

### 3.7 chunk 级 delta：独立轨道，不阻塞本地文件夹源

当前文档级 delta 已经足够支持：

- 持久 folder source
- watch / rescan
- 本地模式
- 云端 push transport

chunk 级 delta 仍然值得做，但应降为后续独立轨道，因为它至少需要补三个前提：

1. 稳定 chunk anchor（否则无法知道“哪个旧 chunk 对应哪个新 chunk”）
2. per-chunk hash 与 patch 规则
3. 局部重写 chunks / vectors / governance 的一致性路径

结论：

- `localFolder` 落地与 chunk delta **解耦**
- P1 / P3 继续使用现有文档级 delta
- P4 再做 chunk 级优化

### 3.8 Obsidian 语法到显式图谱边（增强）

现状图谱主要是推断式。当被摄取的是 Obsidian 风格 Markdown 时，用户已经显式写出了：

- `[[wikilink]]`
- `#tag`
- YAML frontmatter

这部分建议作为 P2 增强：

1. Markdown frontmatter 解析优先复用现有 frontmatter parser（如 `src/markdown/frontmatter.ts` 的能力），不要在 knowledge 域再造一套 YAML 解析。
2. `document-extract.ts` 对 Markdown 提取显式 link / tag / frontmatter 元数据。
3. `graph-builder.ts` 合并两类边：
   - 显式边（用户已写）
   - 推断边（现有 AI / heuristic 补全）

独立判断：不采用“纯自动、不看 `[[...]]`”的极端。显式边 + 推断边混合，精度和可解释性都更稳。

### 3.9 Timeline / Feed / Inbox

#### Timeline

基于现有底座拼读模型：

- `knowledge_lineage`
- `chunk_governance.reference_count`
- `chunk_governance.last_hit_at`
- discovery event projector

用于回答：

- 最近新增了哪些知识
- 哪些知识最近频繁被引用
- 哪些知识刚产生冲突 / 重复 / stale 提示

#### Feed

对首页现有 discovery / nextActions / recommendations 做日报聚合，而非另起主模型。

#### Inbox

Inbox 应被定义为：

- 一个显式可见的私有知识空间
- 带 AI 归类建议的待分拣区

不得复活“未选空间即静默落库”的隐式个人收件箱兜底。

---

## 4. 消费边界与安全红线

1. **消费边界不破**
   - `localFolder` 是 passive，入 RAG
   - `api` / `external` / `capability` 仍是 active，登记后经治理运行时消费
   - `knowledge-consumption-boundary.test.ts` 需纳入新模块扫描

2. **本地路径不出设备**
   - `managed` 模式下，绝对路径只能留在设备本地 binding store
   - tenant 级 / 云端 descriptor 不得记录 `C:\...`、`/Users/...` 之类路径

3. **隐私与出网必须显式**
   - 文件夹监听默认会扫到 `.env`、密钥、合同、财务表
   - 需提供：
     - `exclude` 规则
     - 类型白名单
     - 密钥 / 凭证扫描
     - 出网明示
     - 可选本地 embedding / 本地抽取策略

4. **文件夹越权访问需显式授权**
   - 当绑定目录位于 Data Space 之外时，应走显式授权路径
   - 不允许“扫描任意本机目录”的宽松默认行为

5. **保留 lineage / 快照用于引用与合规**
   - “用户无感 Runtime”不等于“系统不保留出处”
   - `snapshot` 删除模式下尤其需要保留版本 / 快照链路

---

## 5. 对专家愿景的修正（独立判断）

1. **命名不要硬改**
   - `KnowledgeBase` / `knowledge-universe` 是已交付主模型与内部代号
   - 用户面继续使用“知识空间”即可，无需做持久实体大改名

2. **不要重载 `knowledge.source.bind`**
   - 当前 contract 已稳定服务 active source
   - `localFolder` 是另一类对象：它附带设备本地访问权与持续同步状态

3. **不要把 `SourceDescriptor.metadata` 当万能兜底**
   - 它当前是 string map
   - 不适合表达 globs、cursor、状态机、设备本地路径

4. **云端通道是独立高风险轨道**
   - 本地 watcher -> 云端 Runtime 不是“顺手加一层上传”
   - 它需要 transport、auth、去重协商、状态回传

5. **文档级 delta 已足够支撑第一版价值**
   - chunk 级 delta 很重要
   - 但不该成为 `localFolder` 交付前置

6. **图谱应采用显式 + 推断混合**
   - 现有推断图谱保留
   - 对 Obsidian 风格知识再补显式边

---

## 6. 分期实施路线（复用优先、风险后置）

| 阶段 | 目标                                                                                                                         | 部署形态                    | 风险  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----- |
| P0   | 定义 `localFolder` 逻辑 kind、三层模型、专用 RPC；UI 被动导入区补“连接本地文件夹”入口                                        | 纯类型 + 纯前端 + 合约      | 低    |
| P1   | `local` 模式 durable folder source：设备本地 binding store、全量 / 增量扫描、`SourceDocumentLink`、删除两模式、手动 scan-now | 本地网关本地索引，零出网    | 低-中 |
| P2   | Obsidian 显式边、Timeline、Feed 读模型                                                                                       | 同上                        | 低    |
| P3   | `managed` 模式：设备本地 watcher + 云端 `sync.plan/commit` + 同步状态回传                                                    | 本地 watcher + 云端 Runtime | 高    |
| P4   | chunk 级 delta（稳定 chunk anchor + 局部重嵌 / 重治理）                                                                      | 本地 / 云端均适用           | 高    |
| P5   | 其他 passive connector（云盘 / Git / Mail 附件等）复用同一三层契约                                                           | 依源而定                    | 中    |

P1 就可以兑现用户原始诉求：

> 选择一个本地文件夹，不再是一次性导入，而是持续同步、可被 Agent 检索 / 消费的知识空间。

P3 才是“本地文件夹 -> 云端 Runtime”的真正完成态。

---

## 7. 验收红线

1. `knowledge.source.bind` 旧行为不回归；active source 调用链保持兼容。
2. `localFolder` 新增字段一律 optional，不破既有 surface / UI 字面量测试。
3. `managed` 模式下绝对路径不进入 tenant 可见 store。
4. `SourceDocumentLink` 必须存在，不能靠“重扫时现算”替代。
5. `snapshot` 删除模式下文档仍可检索，且 UI 明示为快照态。
6. `local` 模式必须在无网络条件下可用。
7. 消费边界测试持续通过，knowledge plane 不因新增 source 而调用 enterprise-data live action。
8. 不复活“未选空间静默落库”的隐式 Inbox 兜底。
9. 隐私红线必须同时满足：白名单 / 排除规则 / 密钥扫描 / 出网明示。

---

## 8. 涉及文件（建议落点）

- `src/gateway/knowledge/sources/source-descriptor.ts`
  - 新增 `localFolder` kind
- `src/gateway/knowledge/sources/local-folder-binding-store.ts`
  - 新增：设备本地 folder binding 持久化
- `src/gateway/knowledge/sources/local-folder-runtime.ts`
  - 新增：扫描 / watcher / tombstone
- `src/gateway/knowledge/kb-index-schema.ts`
  - 新增：`source_document_links` 之类的运行时映射表
- `src/gateway/server-methods/knowledge.ts`
  - 新增 `knowledge.local-folder.*` methods；保持 `knowledge.source.bind` 现有 contract
- `src/gateway/knowledge/knowledge-base-sources-list.ts`
  - 汇总 folder source 的同步状态 / 文件数 / 生命周期
- `src/gateway/knowledge/personal-document-upload.ts`
  - 抽出可复用的格式白名单 / 目录遍历 helper
- `src/markdown/frontmatter.ts`
  - 复用 frontmatter parser 到 knowledge Markdown 摄取
- `src/gateway/knowledge/document-extract.ts`
  - P2：显式边元数据抽取
- `src/gateway/knowledge/graph-builder.ts`
  - P2：显式边并入图谱
- `ui/src/ui/views/knowledge-universe-space-import.ts`
  - P0：被动导入区“连接本地文件夹”
- `ui/src/ui/ports/employee/data-space.ts`
  - P3：本地 watcher 与 `local | managed` 模式衔接
- `src/infra/device-identity.ts` / `ui/src/ui/device-identity.ts`
  - P3：复用设备身份进行本地 watcher -> 云端 sync auth
- 测试：
  - `knowledge-consumption-boundary.test.ts`
  - 新增 folder-binding / folder-runtime / sync-plan / snapshot-delete / explicit-graph 测试

---

## 9. 最终结论

知识工作台已经完成从“文档管理”到“知识运行时”的主体转变。真正把专家愿景推到“用户连接一个本地文件夹，AI 持续构建 Runtime，Agent 只消费 Runtime”终局的，还缺四块硬骨头：

1. `localFolder` 作为 first-class passive source；
2. 逻辑 source、设备本地 binding、运行时 doc 映射三层模型；
3. `managed` 模式下本地 watcher -> 云端 Runtime 的传输通道；
4. 更细粒度的 chunk delta（后续性能优化项）。

其余能力，如显式图谱边、Timeline、Feed、Inbox，都应建立在这四块基础之上渐进演进，而不是先于它们另起体系。
