# Data Space 检索契约只读调查（2026-10-26）

| 字段    | 值                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| 文档 ID | `memory-data-space-search-contract-survey-2026-10-26`                                                            |
| 日期    | 2026-10-26（Asia/Shanghai）                                                                                      |
| 关联    | [memory-system-o4-o5-disposition-2026-10-26](/design/memory-system-o4-o5-disposition-2026-10-26) §2.4–§2.5、§6.3 |
| 状态    | **只读调查结论待审**；**禁止**为可测性新增索引                                                                   |
| 工作树  | `/private/tmp/openbot-memory-batch1-rework`                                                                      |

> 调查范围：Data Space 记忆文件是否被**产品承诺**参与 `manager.search` 检索；由谁写入；与 workspace `MEMORY.md` 关系；实际索引范围。不立项、不改代码、不 reindex。

---

## 1. 问题陈述

O5 双来源对照中，来源 A = Data Space `agents/<id>/memory/agent/*.md`（`forgetMemoryEntry` 删除目标），来源 B = agent workspace `MEMORY.md`。诊断结论多次归类为：

`not-confirmed-defect:source-A-never-indexed-search-indexes-workspace-not-data-space`

本调查核实：这是**已声明的能力边界**，还是**产品承诺与实现不一致的缺口**（若是后者 → 仅建议独立问题/方案，本轮不实现）。

---

## 2. 产品 / 文档承诺（只读引用）

### 2.1 Data Space 模型 v1（`docs/design/openbot-data-space-model-v1-2026-07-10.md` §4）

| 类        | 路径                                        | 内容                                               |
| --------- | ------------------------------------------- | -------------------------------------------------- |
| personal  | `{data.root}/memory/personal/`              | 用户跨 Agent 偏好                                  |
| agent     | `{data.root}/agents/<id>/memory/agent/`     | Agent 经验、反思                                   |
| workspace | `{data.root}/agents/<id>/memory/workspace/` | 项目/任务上下文                                    |
| index     | 各 memory 子树下 `index/`                   | **embedding 索引、检索元数据**（系统生成，可重建） |

补充：

- 「现有 `MEMORY.md` / `memory.md` 映射到 `memory/agent/` 或 `memory/workspace/`（bootstrap 时迁移）。」
- 生命周期：「用户『忘记这条记忆』→ **删除指定 memory 条目 + 更新 index**；写 audit。」

→ 模型层**承诺**：Data Space memory 子树是记忆资产，并与 **index / 检索元数据**关联；忘记应更新 index。

### 2.2 数据目录产品说明

`openbot-data-directory-product-spec-2026-07-10.md` 将 Memory 结构与生命周期纳入 Data Space，导出/迁移含 memory；**未**单独写明「Memory Center 可删的每个 DS 文件必须立即出现在 `manager.search` 命中」。

### 2.3 Memory Center / O5 处置已记录的实现契约

- UI 文件列表：`listAgentMemoryEntries` 扫描 DS 根下 `memory/agent`、`memory/workspace`、`workspace`。
- 忘记：`forgetMemoryEntry` 在 DS 候选路径 unlink/rm；**不**串联 search 索引撤回 / CogniWeave `forgetSource`。
- 原子列表 / 文件检索是不同路径（处置 §1.1 #3）。

### 2.4 API / 注释层

- `resolveIndexedMemoryLocators`（`src/memory/cogniweave-manager.ts`）注释原文：  
  **「Map a Data Space memoryKey onto already-indexed workspace-relative paths only.」**  
  → 实现者明确：DS key **只有**在已进入 workspace 索引树时才能映射；并非「DS 路径自动可检索」。
- `MemoryProvider` / search 类型未承诺索引 `data.root/agents/*/memory/agent`。

**承诺小结**：Data Space **模型**承诺 memory 子树 + index 更新；**运行时 search API** 未成文承诺「MC 可管理的每个 DS 文件 ∈ search 语料」。存在模型级期望与 search 实现之间的张力。

---

## 3. 由谁写入（代码路径）

| 路径 / 动作              | 代码                                                                                            | 写入目标                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Memory flush 追加        | `src/agents/pi-tools.read.ts` `appendMemoryFlushContent` / `wrapToolMemoryFlushAppendOnlyWrite` | **agent workspace** 下配置的相对路径（通常 `MEMORY.md`），不是 DS `memory/agent/` 扫描根                                                |
| Agent workspace 引导文件 | `src/agents/workspace.ts` `writeFileIfMissing`                                                  | workspace 模板文件                                                                                                                      |
| 列出可管理记忆           | `listAgentMemoryEntries`（`src/data/memory-list.ts` / gateway `memory-list.ts`）                | **只读**扫描 `{data.root}/agents/<id>/{memory/agent,memory/workspace,workspace}`                                                        |
| 忘记单条                 | `forgetMemoryEntry`（`src/data/memory-lifecycle.ts`）                                           | 删除 DS 候选：`memory/agent                                                                                                             | workspace/<key>`、`memory/personal/<key>`、`agents/<id>/<key>` |
| Agent 处置               | `applyAgentMemoryDisposal`                                                                      | 按模式 rm DS memory 子树或整个 agentRoot                                                                                                |
| CogniWeave 索引摄入      | `listWorkspaceMemoryDocs` ← `listIndexedDocuments` ← `syncScope` / `search`                     | **仅** `resolveAgentWorkspaceDir` 下 `MEMORY.md`/`memory.md` + `workspace/memory/**/*.md`（+ 配置允许的 sessions / collaboration docs） |

**观察**：生产路径上，**持续写入「可被 search 索引」语料**的主流是 workspace `MEMORY.md` / `workspace/memory`；DS `memory/agent` 主要由 Memory Center **管理面**（list/forget）与模型迁移叙事覆盖。本调查未发现独立的高频 writer 专门向 `agents/<id>/memory/agent/` 写入并登记进 `manager.search` 映射表。

---

## 4. 与 workspace MEMORY 文件的关系

| 维度                  | Data Space memory 文件                                                                                         | Workspace MEMORY                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 物理根                | `resolveDataRoot` → `agents/<id>/...`                                                                          | `resolveAgentWorkspaceDir(cfg, agentId)`（配置 workspace、defaults，或 `stateDir/workspace-<id>`） |
| 是否同一目录          | **不保证**。仅当配置把 workspace 放在 `data.root/agents/<id>/workspace` 且文件落在 search 扫描规则内时可能重叠 | 常为独立目录                                                                                       |
| Memory Center 文件 UI | 扫描 DS `MEMORY_SCAN_ROOTS`                                                                                    | 若 workspace 目录恰在 agentRoot/`workspace` 下，可能以相对 key 出现                                |
| `manager.search`      | **不**以 DS `memory/agent` 为根扫描                                                                            | **是**主索引语料                                                                                   |
| 模型迁移叙事          | `MEMORY.md` bootstrap 映射到 `memory/agent` 或 `memory/workspace`                                              | 历史主文件                                                                                         |

双来源对照合法：同文案可以同时存在于 A（DS）与 B（workspace）；删 A 留 B **符合**当前 per-source 文件删除契约，**不能**当作 A 残留。

---

## 5. `manager.search` 实际索引范围（加深证据）

### 5.1 调用链

`CogniWeaveMemoryManager.search` → `syncScope(..., reason: "search")` → `searchScope` → 命中后再 `isSourcePathRetrievable`。

`listIndexedDocuments`：

1. 若 sources 含 `"memory"`：`listWorkspaceMemoryDocs(this.workspaceDir)`
   - 文件：`MEMORY.md` / `memory.md`
   - 目录 walk：`{workspaceDir}/memory/**/*.md`
2. 同旗标下追加 collaboration markdown docs
3. 若 writeSync 非 disabled 且 sources 含 `"sessions"`：session 文件

**不包含**：`{data.root}/agents/<id>/memory/agent/**`、`memory/workspace/**`、`memory/personal/**`（除非碰巧与 `workspaceDir` 路径重合且满足上述相对规则）。

### 5.2 与 forget 路径对照

```
forgetMemoryEntry 候选:
  agents/<id>/memory/agent/<key>
  agents/<id>/memory/workspace/<key>
  memory/personal/<key>
  agents/<id>/<key>

search 索引:
  <workspaceDir>/MEMORY.md|memory.md
  <workspaceDir>/memory/**/*.md
  (+ sessions / collaboration)
```

`resolveIndexedMemoryLocators(memoryKey, indexedPaths)` 只在 **已有 indexedPaths** 上做 basename/后缀匹配 → DS-only 文件在 `indexedPaths` 为空匹配时映射结果为 `[]`。

### 5.3 既有诊断结论（仍成立）

`src/memory/memory-batch1-o4-o5-diagnose.test.ts` 记录：

- Source A via forget 路径从未进入 search hits → 无法证明「删除后同来源残留」。
- 「manager.search indexes workspace MEMORY.md；forgetMemoryEntry deletes Data Space paths — different source trees」。

Qmd/builtin 默认 collection 同样以 `workspaceDir` + `MEMORY.md` / `memory/**` 为基（`src/memory/backend-config.ts` `resolveDefaultCollections`），与 CogniWeave 工作区扫描同构，**不是** DS `memory/agent` 扫描根。

---

## 6. 结论：承诺 vs 能力

| 层面                                                           | 判断                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Memory Center **文件管理**（list/forget DS 路径）              | 与实现**一致**（管理面）                                                                             |
| `manager.search` **可检索语料**                                | 与 workspace（+ sessions/collaboration）**一致**；**不**覆盖 DS `memory/agent` 管理面集合            |
| Data Space **模型 §4**（memory 子树 + index + 忘记更新 index） | 与当前 forget/search **不一致**：忘记不更新 search 索引；DS agent memory 文件默认不进 search mapping |
| O5「删 A 后同来源残留」可证伪条件                              | **当前不具备**（A 常从未索引）；不得为单测可证伪而扩索引                                             |

### 6.1 总判

**产品模型承诺与运行时 search 能力不一致（缺口）**，但该缺口属于 **索引范围 / 忘记-索引一致性** 的独立产品问题，**不是**本批 O5「未证实缺陷」的修复开关，也**不是** O4 候选视图前置。

### 6.2 建议（仅建议，不立项实现）

1. 独立问题草案标题建议：  
   **「Data Space memory 管理面与 manager.search 索引范围对齐」**  
   覆盖：是否将 `MEMORY_SCAN_ROOTS` 纳入 search；或将 MC 文件 UI 收敛到已索引 workspace 语料；忘记是否必须调用索引/lifecycle 撤回；与 bootstrap「MEMORY.md → memory/agent」迁移的单一事实来源。
2. 方案前必须做影响面：召回扩大、权限（personal vs agent）、多租户、embedding 成本、与 CogniWeave evidence locator 稳定性。
3. **禁止**「仅为 O5 同来源残留可测」而新增索引或映射（Owner 已否决）。
4. 在缺口立项前，对外/对内表述应保持：  
   **能力边界（现状）**：search ≠ DS 文件管理面；同时在架构债登记中保留 **模型承诺未兑现** 条目（O5-gap-index）。

### 6.3 证据口径侧注

本批隔离测试验证真实处理函数在 mock 配置与身份数据下的分支行为，尚未验证真实连接认证或完整客户端请求链；合法删除成功用例使用 null client；员工自有 agent 用例验证的是通过所有权检查后返回 not found，不能写成员工完整删除流程已验收。本调查为源码/文档只读结论，不构成生产召回验收。

---

## 7. 未做之事（本调查）

- 未改索引、mapping、forget、search、晋升。
- 未 migrate / reindex / 写真实记忆。
- 未开独立 GitHub issue（仅设计侧建议）。
- 未批准或实施任何「对齐」方案。
