# OpenBot 知识工作台 / Knowledge Runtime Core 落地执行方案 (2026-06-25)

## 0. 目的与定位

本方案把已评估为「可采纳」的建议整理成可直接排期、可验收的工程任务，作为落地依据。

- 用户面（对外名）：**知识工作台**（知识空间 / 成果中心 / 企业知识 / 数据能力 / 关系洞察）。
- 系统内核（内部名，不做大改名迁移）：**Knowledge Runtime Core**，沿用现有 `knowledge-universe` 模块名。
- 核心原则（贯穿所有工作流）：
  1. Agent 只消费 **Runtime Cognitive Context**，不直接面向知识库 / 成果中心 / 连接器编排。
  2. 数据能力（CRM/ERP/BI/API）**不进 chunk 索引**，只进能力运行时。
  3. 沿现有模块**渐进升级，不重写**。
  4. 新增字段一律 **optional**，保护既有测试与 surface 字面量。
  5. 多 agent 共享树：仅提交本工作流文件，不动他人 WIP，未经要求不提交。

### 工作流总览与依赖顺序

| 编号 | 工作流                                                                | 类型         | 风险 | 依赖                             |
| ---- | --------------------------------------------------------------------- | ------------ | ---- | -------------------------------- |
| W0   | Runtime Cognitive Context 收口（单一规范入口）                        | 后端·小      | 低   | 无（基础）                       |
| W1   | 产品语义收口（5 域 IA / 三通道 / 关系洞察降为增强层）                 | 前端·中      | 低   | 无（可与 W0 并行）               |
| W2   | 治理信号注入 Agent 上下文                                             | 后端·小      | 低   | W0                               |
| W3   | 成果自动捕获闭环（对话/Agent/协作产出 → 成果中心）                    | 后端·中      | 中   | 无（与已落地的自动归档回流衔接） |
| W4   | 多源输入补全（dataset 导入 / 外部 API 绑定 / 统一 source descriptor） | 后端+前端·中 | 中   | W1（入口）                       |
| W5   | 数据能力治理调用运行时（CapabilityNode + 受控 tool runtime）          | 后端·大      | 高   | W0、独立立项                     |

建议落地顺序：**W0 → W1 → W2 → W3 → W4 → W5**。W0/W1 可并行；W5 独立 track。

---

## W0. Runtime Cognitive Context 收口

### 目标

把当前并存的多个「Agent 知识消费入口」收敛为**单一规范契约**，对外只暴露一个 Runtime Cognitive Context，避免出现第二套 runtime。

### 现状（已验证）

当前存在 3 个并行入口，语义重叠但实现分散：

- 回复热路径：`src/auto-reply/reply/knowledge-universe-context.ts` → `buildAgentCognitiveKnowledgeBundle`（`src/gateway/knowledge/adapter/cognitive-runtime-adapter.ts`），由 resolve + context + memory 三个 adapter 组合。
- RPC：`knowledge.cognitive.bundle`（`src/gateway/server-methods/knowledge.ts` 的 `knowledgeCognitiveBundle`）。
- 统一上下文 facade：`resolveKnowledgeRuntimeContext`（`src/gateway/knowledge/runtime/knowledge-runtime-context.ts`）+ RPC `knowledge.runtime.context`（已组合 object context + 治理化 chunk evidence + governance summary）。

### 范围

- 做：审计三者关系，选定 `resolveKnowledgeRuntimeContext` 为**唯一规范构造器**；让回复路径与各 RPC 委托到它；其余为薄封装；统一返回契约 `RuntimeCognitiveContext`。
- 不做：删除既有 RPC 方法名（保留兼容，内部转调），不改 prompt 文案语义（W2 再补信号）。

### 详细改动点

1. 在 `src/gateway/knowledge/runtime/knowledge-runtime-context.ts` 固化导出类型 `RuntimeCognitiveContext`，字段（均沿用现有）：`promptBlock`、`evidence`、`primaryObjects`、`recommendedCapabilities`、`memoryHints`、`governance`（summary）、`sourceKnowledgeBaseIds`、`sourceChunkIds`。
2. 让 `buildAgentCognitiveKnowledgeBundle` 内部委托 `resolveKnowledgeRuntimeContext`（或反向：让 runtime-context 复用 cognitive bundle 引擎），二选一，**保证只有一套 resolve+context+memory 组合逻辑**。
3. `knowledge.cognitive.bundle` 与 `knowledge.runtime.context` 两个 handler 都转调同一构造器；标注 `cognitive.bundle` 为兼容别名。
4. 回复路径 `knowledge-universe-context.ts` 的 `buildKnowledgeUniversePromptContext` 输出改为从规范构造器取值（promptBlock / evidence / source ids 不变）。

### 测试

- 复用 `src/auto-reply/reply/knowledge-universe-context.test.ts` + `.reply.test.ts`：promptBlock 与 evidence/source ids 行为不变（回归）。
- `src/gateway/knowledge/runtime/knowledge-runtime-context.test.ts` 扩展：三入口对同一 taskContext 产出一致的核心字段。

### 验收标准

- 回复路径、`knowledge.runtime.context`、`knowledge.cognitive.bundle` 三者对同一输入返回一致的 primaryObjects/evidence/promptBlock 主体。
- 仓内对「Agent 知识消费」只剩一处实现引擎，其余为转调。

### 风险与回滚

- 风险：回复 prompt 文案细微变化导致快照/字面量测试失败。回滚：保留旧 `buildAgentCognitiveKnowledgeBundle` 实现于一次提交内，问题时直接还原委托关系。

---

## W1. 产品语义收口（Phase 1）

### 目标

把用户看到的「文档管理器 + 工作台」心智，升级为「知识运行工作台」：固定 5 域信息架构，关系洞察从主角降为增强层，「我的知识」从「只上传」改为三通道统一供给。**纯前端/文案/IA，不动后端主线。**

### 现状（已验证）

- UI capability 层：`ui/src/ui/capability/knowledge-universe/`（`facade.ts`、`gateway-client.ts`、`types.ts`、`endpoints.ts`、`workspace-endpoints.ts`、`source-labels.ts`）。
- 控制器族：`ui/src/ui/controllers/knowledge-universe-*.ts`（runtime / workspace / personal / deliverable-actions / action-runner）。
- 状态以 `knowledgeBases / workspaceDeliverables / kbSearchQuery / governance*` 为主，语义偏文档库。

### 范围

- 做：首页域结构、入口文案、关系洞察定位、三通道供给入口的**前端呈现与契约**；保留 `WorkbenchKnowledgeSurface` 契约形状（新增字段 optional）。
- 不做：后端数据模型变更；模块改名；删除既有 RPC。

### 详细改动点

1. 首页固定 6 区呈现：知识空间 | 成果中心 | 知识供给管理 | 我的资产 | 智能推荐 | 关系洞察。落点：知识工作台主视图与面板（`ui/src/ui/capability/knowledge-universe/facade.ts` 暴露的 surface + 对应 page/panels 视图）。
2. 「我的知识」入口由「上传」扩展为三通道：我的知识 / 企业知识 / 数据能力（数据能力标注为「可调用能力」而非文档）。仅做入口与分组呈现，数据来源沿用 `source-bundle` 三源聚合。
3. 关系洞察：保留首页卡片 + 独立页，但降为「增强层」呈现（问题流 + 子图为视图之一），不再作为默认主视图。
4. 文案与命名：对外统一「知识工作台」；服务/供给项按字母序（遵循 docs/UI 排序约定，运行时执行顺序除外）。
5. 搜索语义去重：延续既有重构约束，避免「顶部全局搜索 + 库内搜索」双语义并存（统一为一种语义入口）。

### 数据结构 / 契约

- `WorkbenchKnowledgeSurface` 新增的展示字段（如域分组、关系洞察增强标记）一律 optional，保护现有 surface 字面量与 `*.browser.test.ts` / `render-model` 测试。

### 测试

- 复用并扩展 UI 控制器与 render-model 测试（`ui/src/ui/controllers/knowledge-universe-runtime-messages.node.test.ts` 等）：新分组/入口存在性、关系洞察降级后仍可达、三通道入口渲染。
- 运行 UI 套件 + `get_diagnostics`；新字段缺省时旧测试不破。

### 验收标准

- 首页呈现 6 域；「我的知识」展示三通道入口；关系洞察为增强层但首页/独立页均可达；无双搜索语义。
- 后端无改动，全部 UI 套件通过。

### 风险与回滚

- 风险：surface/state 字面量测试因新增必填字段而破。规避：新增字段 optional。回滚：纯前端，按文件还原。

---

## W2. 治理信号注入 Agent 上下文

### 目标

把治理信号（trust / freshness / conflict / claim-conflict / governanceStatus）从「仅影响检索重排」升级为「显式进入 Agent 上下文」，让关系洞察真正成为 Agent 消费侧的认知中枢。

### 现状（已验证）

- `KnowledgeEvidence`（`src/retrieval/types.ts`）**已携带** `governanceStatus`、`governanceConflict`、`governanceClaimConflict`。
- 治理仅用于检索重排：`src/gateway/knowledge/governance/retrieval-scoring.ts`（`applyGovernanceMultiplier` / `shouldFilterGovernanceHit`）。
- prompt 注入 `src/gateway/knowledge/resolve/context-builder.ts` 注入证据行，但**未把治理状态作为显式信号呈现**。

### 范围

- 做：在证据/对象的 prompt 呈现中标注治理状态；在 RuntimeCognitiveContext 增加结构化 `governanceSignals`；确保到达 context-builder 的 evidence 已填充治理字段。
- 不做：新增治理检测算法（复用既有 MVP）。

### 详细改动点

1. 校验数据通路：确认知识 RetrievalSource 返回的 `KnowledgeEvidence` 已填 `governanceStatus/governanceConflict/governanceClaimConflict`（若未填，在知识 source 检索处补挂，复用 `ChunkGovernanceFactors`）。
2. `src/gateway/knowledge/resolve/evidence-format.ts`（`formatKnowledgeEvidencePromptLines`）：为冲突/待确认/已确认/疑似过期证据加简洁标注（如 `[冲突]`/`[待确认]`/`[已确认]`），并附「冲突项以低置信处理」提示。
3. `src/gateway/knowledge/resolve/context-builder.ts`：`KnowledgeAgentContext` 增加 optional `governanceSignals`（计数：openConflicts / suppressed / staleHints / confirmed），并在 promptBlock 增加一行汇总。
4. W0 的 `RuntimeCognitiveContext.governance` 已有 summary，这里补充「逐证据级」标注，保持二者一致。

### 数据结构 / 契约

- `KnowledgeAgentContext.governanceSignals?: { openConflicts: number; confirmed: number; suppressedFiltered: number; staleHints: number }`（optional）。

### 测试

- `src/gateway/knowledge/resolve/` 下新增/扩展测试：含冲突证据 → promptBlock 出现冲突标注；suppressed 证据不出现在 prompt；confirmed 证据带标注。
- 回归 `knowledge-universe-context.reply.test.ts`：无治理信号时 prompt 主体不变。

### 验收标准

- Agent 上下文中冲突/过期/已确认证据有显式可读标注；suppressed 不泄漏到 prompt；治理汇总行出现且与 governance summary 一致。

### 风险与回滚

- 风险：prompt 文案变化触发快照测试。规避：标注为附加行，不改既有行结构。回滚：移除标注分支。

---

## W3. 成果自动捕获闭环（Phase 3 前半段）

### 目标

补齐「完成/发布 → 自动**捕获** → 自动分类 → 自动建议归档 → 自动入库 → 写 lineage → 进检索」中缺失的**自动捕获**环节，使成果中心几乎无需人工维护。后半段（自动归档回流）已落地。

### 现状（已验证）

- 自动**归档回流**已实现：`src/gateway/knowledge/deliverables/auto-archive-runtime.ts`（approved/published → 入收件箱库 → 写 lineage → 入索引，幂等），接入治理 tick。
- 成果读取/聚合：`src/gateway/knowledge/deliverables/read-model.ts`（协作成果 + skill 资产成果）。
- 发现投影 `src/gateway/knowledge/discovery/event-projector.ts` 只**读取**既有 deliverable，不创建。
- 协作成果持久化：`src/gateway/collaboration-learning/state-machine.ts` 经 `objectStorage.writeObject(groupId, "deliverable", ...)`；Agent 产出当前以 skill 资产（`skill:` 前缀）体现；**对话回复产出无自动落库**。

### 范围

- 做：定义统一捕获入口，把「对话/Agent 高价值产出」自动落为 `WorkspaceDeliverable`（或 skill 资产成果），打 `sourceType/artifactKind`，再交由既有自动归档回流闭环。
- 不做：复杂的自动摘要/打分模型（先用规则 + 既有分类）。

### 详细改动点

1. 新增捕获模块 `src/gateway/knowledge/deliverables/auto-capture-runtime.ts`：
   - 入口 `captureAgentOutputDeliverable({ ownerId, sessionKey, agentId, title, content, sourceLineageId? })`。
   - 复用 `enrichWorkspaceDeliverableArtifactFields`（`deliverables/artifact-fields.ts`）推导 sourceType/artifactKind/governanceStatus。
   - 写入：对话/Agent 产出落 skill 资产成果（复用 `saveSkillAsset`，与现有 `skill:` 成果一致）或协作 deliverable（群组内）。
2. 捕获触发点（择一，先做 1 个）：
   - 回复完成 hook：`src/auto-reply/reply/get-reply-run.ts` 回复生成完成处（已有 lineage generation 写入点）旁挂「高价值产出捕获」（带阈值/开关，默认仅捕获显式标记/长产出）。
   - 协作发布：在 `state-machine.ts` deliverable 进入 approved/published 时确保成果可被 read-model 聚合（已具备）。
3. 分类/建议：捕获即打 `artifactKind` + 初始 `governanceStatus=pending`；归档建议沿用 auto-archive 回流（approved/published 才入库），形成「捕获→建议→入库」链。
4. 幂等：按 `sessionKey + messageId`（或内容 hash）去重，避免重复捕获。

### 数据结构 / 契约

- `WorkspaceDeliverable` 沿用既有类型；捕获产物经 `enrich*` 标准化。捕获去重键持久化（轻量 JSON，置于 `CONFIG_DIR/knowledge/`）。

### 测试

- 新增 `auto-capture-runtime.test.ts`：模拟一次 Agent 产出 → 生成 deliverable（带正确 sourceType/artifactKind/pending）→ 去重再触发不重复 → approved 后被 auto-archive 回流入库且可检索。
- 守护消费边界：捕获只写成果/知识层，不触发连接器实时调用（`knowledge-consumption-boundary.test.ts` 覆盖新模块）。

### 验收标准

- 标记为高价值的对话/Agent 产出自动出现在成果中心（无需人工 attach）；approved/published 后经回流入库并可被检索消费；重复触发幂等。

### 风险与回滚

- 风险：误捕获噪声产出污染成果中心。规避：默认保守阈值 + 开关；只捕获显式标记或满足长度/结构条件的产出。回滚：关闭捕获触发点开关（捕获模块为附加）。

---

## W4. 多源输入补全（Phase 2 余量）

### 目标

让「知识空间」成为真正的多源输入层，补齐个人侧仍缺的输入通道。网页收藏已落地（`knowledge.personal.collectWeb`）。

### 现状（已验证）

- 个人输入：上传、摘录、网页收藏（`src/gateway/knowledge/personal-knowledge-ingest.ts` + `knowledge.personal.collect/upload/collectWeb`）。
- 源聚合与能力 feed：`src/gateway/knowledge/sources/*`、`src/gateway/knowledge/feed/*`、`source-bundle.ts`。
- 仍缺：dataset 导入、外部 API 数据源绑定、统一 source descriptor、source binding to space。

### 范围

- 做：dataset 导入（CSV/JSON/markdown 批量）、外部 API/数据源绑定描述、统一 `SourceDescriptor`、把 source 绑定到知识空间。
- 不做：把外部 API 实时数据塞入 chunk 索引（属 W5 能力运行时）。

### 详细改动点

1. 统一描述符：在 `src/gateway/knowledge/sources/` 定义 `SourceDescriptor`（kind: upload/web/dataset/api/enterprise/capability；passive/active 标记；owner/visibility/freshness）。
2. dataset 导入：`knowledge.personal.importDataset`（批量文件/记录 → 复用 `ingestKnowledgePayloadToBase` 管线，passive）。RPC 注册写权限组（`server-methods-list.ts` + `method-scopes.ts`）。
3. 外部数据源绑定：`knowledge.source.bind`（声明式登记 source 到某知识空间；**active 源仅登记不入 RAG**，转交 W5）。
4. 前端：W1 三通道入口下补 dataset 导入 / 外部源绑定表单（`ui/src/ui/capability/knowledge-universe/` + 控制器）。

### 数据结构 / 契约

- `SourceDescriptor`（统一）；空间-源绑定记录（轻量持久化，沿用 KB store 或新增 binding store）。

### 测试

- dataset 导入 → 入库可检索；api/外部源绑定 → 仅登记、不进 chunk 索引（边界测试）；统一 descriptor 快照。

### 验收标准

- 个人可经上传/摘录/网页/dataset/外部绑定五类入口供给知识；passive 入库可检索，active 仅登记并标记交由能力运行时。

### 风险与回滚

- 风险：active/passive 边界被误用导致外部数据进 RAG。规避：descriptor 强制标记 + 边界测试。回滚：RPC 为新增，停用即可。

---

## W5. 数据能力治理调用运行时（Phase 5，独立 track）

### 目标

把「数据能力」从展示/推荐项，升级为「Agent 可经受控 tool runtime 治理调用」的能力，且不进 RAG。

### 现状（已验证）

- 数据能力是 descriptor/hint：`src/gateway/knowledge/feed/data-capability-feed-adapter.ts`、`src/gateway/knowledge/sources/capability-catalog.ts`、`src/gateway/knowledge/seat-capability-access.ts`。
- prompt 仅「推荐能力」+ 硬边界「禁止直连 CRM/ERP/Connector」。
- 知识域**无**能力调用运行时（`runCapability` 仅属 media-understanding，与数据能力无关）。

### 范围

- 做：`CapabilityNode`（visibility/auth/freshness/owner）、运行时能力推荐、受控 tool runtime（Agent 经治理网关调用，记审计/配额/lineage）。
- 不做：把 API/DB 数据写入 chunk 索引。

### 详细改动点

1. 能力模型：基于 `capability-catalog.ts` 扩出 `CapabilityNode`（id/title/owner/visibility/authState/freshness/inputSchema/scopes）。
2. 受控调用网关：新增能力调用 RPC（如 `knowledge.capability.invoke`），强制经 `seat-capability-access.ts` 鉴权 + 配额 + 审计；调用结果写 lineage（`knowledge-lineage-store.ts`），可选回流为成果（接 W3）。
3. 运行时推荐：把能力 hint 升级为「可调用能力 + 调用条件」进入 RuntimeCognitiveContext（W0/W2 的 capability 段）。
4. 边界：Agent 仍**不直连**外部 API，只能经该受控 runtime；更新/扩展 `knowledge-consumption-boundary.test.ts`。

### 数据结构 / 契约

- `CapabilityNode`；调用审计与配额记录；调用结果 evidence/lineage。

### 测试

- 鉴权拒绝/通过、配额、审计写入、lineage 关联；边界测试：直连被禁、仅 runtime 通路可用。

### 验收标准

- Agent 可经受控 runtime 调用已授权数据能力并留审计/lineage；未授权被拒；外部数据不进 RAG。

### 风险与回滚

- 风险：受控调用涉及鉴权/配额/外部副作用，属高风险。规避：默认 dry-run/只读能力先行，写能力需显式授权；逐能力灰度。回滚：关闭 invoke RPC，能力退回「仅推荐」。

---

## 全局：测试与验收命令

- 作用域测试：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run <paths> --reporter=dot`
- 诊断：对改动文件用 `get_diagnostics`
- 格式：`pnpm exec oxfmt --write <files>`
- 类型：`pnpm tsgo`；Lint/格式：`pnpm check`
- 后端主套件（知识域）：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/knowledge/ src/gateway/server-methods/knowledge.test.ts`
- UI 套件：按 `ui/` 下 vitest 配置运行知识工作台相关测试

## 全局约束（验收红线）

1. 消费边界不破：Agent 不直连连接器；`knowledge-consumption-boundary.test.ts` 持续通过，新模块纳入扫描。
2. 新增 surface/state/context 字段一律 optional。
3. 不重命名迁移、不重写；新增能力以附加模块/字段实现，复用既有 seam（禁 "V2" 拷贝）。
4. RPC 新增需同时注册 `server-methods-list.ts` 与 `method-scopes.ts`（读/写组正确归类）。
5. 多 agent 共享树：仅 `scripts/committer` 范围化提交本工作流文件，带 `Task:`/`Agent:` trailer，未经要求不提交。

## 里程碑建议

- M1（W0 + W1）：单一 Runtime Cognitive Context 收口 + 产品语义收口上线（低风险，立即可感知）。
- M2（W2 + W3）：治理信号进上下文 + 成果自动捕获闭环（认知中枢 + 自动沉淀闭环成形）。
- M3（W4）：多源输入补全。
- M4（W5）：数据能力治理调用运行时（独立 track，灰度）。

## 关联文档

- 可行性与治理评估：`docs/design/openbot-knowledge-governance-relationship-intelligence-feasibility-2026-06-25.md`
- 首页改版验收：`docs/design/openbot-knowledge-universe-homepage-redesign-acceptance-2026-06-24.md`
