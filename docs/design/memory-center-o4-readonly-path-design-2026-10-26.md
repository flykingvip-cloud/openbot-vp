# Memory Center O4 只读路径设计（2026-10-26）

| 字段     | 值                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 文档 ID  | `memory-center-o4-readonly-path-design-2026-10-26`                                                   |
| 日期     | 2026-10-26（Asia/Shanghai）                                                                          |
| 关联契约 | [memory-center-candidate-view-plan-2026-10-26](/design/memory-center-candidate-view-plan-2026-10-26) |
| 关联处置 | [memory-system-o4-o5-disposition-2026-10-26](/design/memory-system-o4-o5-disposition-2026-10-26)     |
| 状态     | **O4 只读 foundation + 候选视图接线已授权实现**；产品契约已批准；DS/效果验收/事实级遗忘仍另批        |
| 工作树   | `/private/tmp/openbot-memory-batch1-rework`（`codex/openbot-memory-batch1-rework`）                  |

> **方向批准 ≠ 全栈接线授权。** 本文回答「如何兑现只读候选/已确认列表」。
>
> **2026-10-26 修订授权（基础能力）**：允许在本工作树落地窄只读 reader / 结果类型 / embedded 适配与隔离测试；**仍禁止**改 UI、`data.memory.list` RPC、候选按钮、主体自动绑定、晋升、召回默认、遗忘 lifecycle、扩索引或真实记忆写入。

---

## 1. 目标与非目标

### 1.1 目标（设计回答）

1. 在**已有**网关授权与**已存在**主体绑定下，只读列出精确状态 `active` 或 `tentative`。
2. 未绑定时**明确拒绝**（非空列表伪装），且**不**现场自动绑定。
3. 缺库 / 未初始化 / 快照过期时返回显式只读状态，查询入口**不**隐式建库、同步或迁移。
4. 状态过滤与 `limit` / `total` 语义一致，避免先截断再过滤造成漏项或计数不一致。
5. 保留默认 `active` 行为；候选查询不改变召回策略、原子状态或来源。

### 1.2 非目标（本轮明确不做）

- 实现候选视图 UI / RPC / manager 新入口代码。
- 重构整个记忆管理器或 CogniWeave runtime。
- 改 `includeTentative` 全局默认、晋升、遗忘 lifecycle、purge、migrate、reindex。
- 为可测性扩大 search 索引范围（见 Data Space 调查文）。

---

## 2. 现有调用链问题（源码核实）

### 2.1 当前 Memory Center 原子列表

```
UI render-model-memory-center
  → gateway data.memory.list  (src/gateway/server-methods/data.ts)
  → assertMemoryCenterAgentAccess
  → listAgentMemoryEntries + getMemorySearchManager
  → CogniWeaveMemoryManager.listMemoryCenterAtoms({ limit: 200 })
       (src/memory/cogniweave-manager.ts)
```

`listMemoryCenterAtoms` 实装（核实行序）：

1. `await this.syncScope(this.defaultScope, { reason: "memory-center" })`
2. `resolveLocalMemorySubject` → `engine.ensureMemorySubjectBinding({ scope, caller, scopeType: "agent" })`
3. `engine.queryAtoms({ scope, caller, filter: { limit } })` — **无**状态参数
4. `mapAtomToMemoryCenterRow`

### 2.2 为何「仅加 status 参数并透传现入口」不够

| 步骤                                       | 副作用                                                                                                                                                                                                                | 与契约冲突                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `syncScope`                                | `getOrCreateScopeState` → `buildRuntime` → `LocalMetadataStore` 构造会 `mkdirSync` + `bootstrapSchemaSync`；若 manifest 变化则 `rebuildScopeRuntime` → `replayDocumentIntoScope`/`writeBack` + `persistScopeSnapshot` | 打开候选视图可能建库、同步、写快照  |
| `ensureMemorySubjectBinding`               | 未绑定时 `createMemorySubjectBinding` + `saveMemorySubjectBinding`                                                                                                                                                    | 打开视图会自动绑主体                |
| `queryAtoms` + 仅 `includeTentative: true` | lifecycle-gate 在 tentative 放开后仍保留 active                                                                                                                                                                       | **非**精确状态过滤（会混入 active） |
| store `limit` 在 lifecycle 过滤之前        | `LocalMetadataStore.queryAtoms` 先 `LIMIT`，engine 再 `isAtomRetrievable` 丢弃                                                                                                                                        | 先截断再过滤 → 漏项 / 计数偏小      |

`engine.queryAtoms`（`packages/cogniweave-sdk/src/runtime/in-memory-engine.ts`）未透传 store 已有的 `statuses?: AtomStatus[]`（见 `MetadataQueryFilter`）；仅透传 `atomTypes` / `limit`，再用 `includeTentative` / `includeConflicted` 做门闩。

未绑定今日行为：`authorizeQueryAccess` 失败时 `queryAtoms` **返回 `[]`**（防枚举）。产品候选契约要求对 Memory Center **显式拒绝**，与「空列表」需区分。

### 2.3 类型面

- `MemoryProvider.listMemoryCenterAtoms?(opts?: { limit?: number })`（`src/memory/types.ts`）无状态参数。
- Gateway 调用固定 `{ limit: 200 }`，错误时吞掉并 `atoms = []`。

---

## 3. 拟议只读入口 / 调用链

### 3.1 为何不复用现入口

现入口把「列表」与「同步 + 自动绑定」绑死。契约要求打开候选视图零写副作用 → 必须**旁路** `syncScope` 与 `ensureMemorySubjectBinding`，另建窄入口；默认 `data.memory.list` 行为可暂时不变，直至实现批准后显式接线。

### 3.2 拟议符号（名称实施时可微调）

| 层                    | 拟议                                                                                           | 职责                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Manager               | `listMemoryCenterAtomsReadonly(opts: { statusView: "active" \| "tentative"; limit?: number })` | 只读编排；**禁止**调用 `syncScope` / `ensureMemorySubjectBinding` |
| Engine                | 扩展 `queryAtoms` filter：`statuses?: AtomStatus[]`（精确）+ 既有 lifecycle 门闩               | 将 `statuses` 下推到 `metadataStore.queryAtoms`                   |
| Gateway（实现批准后） | `data.memory.list` 可选 `statusView`，或独立 `data.memory.listAtoms`                           | 先鉴权，再调只读入口；把 typed error 透出而非一律 `[]`            |
| UI（实现批准后）      | 已确认 / 候选切换                                                                              | 只读；不调晋升                                                    |

### 3.3 拟议调用链

```
assertMemoryCenterAgentAccess
  → listMemoryCenterAtomsReadonly({ statusView, limit })
       1. resolve caller subject（只读）
       2. openExistingMetadataStoreOrReject（见 §5）— 不 mkdir / 不 bootstrap / 不 sync
       3. listMemorySubjectBindings(liveOnly) + authorizeMemoryAccess
          - 未允许 → 返回错误 UNBOUND / OWNER_MISMATCH / TENANT_MISMATCH（不写绑定）
       4. metadataStore.queryAtoms({ scope, statuses: [statusView], limit, offset? })
          + 可选 count 查询（同 filter、无 limit）得 total
       5. lifecycle 复核：active 视图 includeTentative=false；tentative 视图仅 statuses=["tentative"]
          且 includeTentative=true（或对已精确 statuses 的行跳过 tentative 剔除）
       6. mapAtomToMemoryCenterRow；返回 { ok:true, atoms, total, statusView, indexHint? }
```

默认 `statusView` 缺省 = `"active"`，兼容今日「仅 active」观感。

---

## 4. 授权与绑定前置条件

### 4.1 仍须满足

1. Gateway：`assertMemoryCenterAgentAccess`（enterprise 拒；personal 须拥有 agent；managed 拒本机管理）。
2. Subject：partition 上已有 live binding，且 `authorizeMemoryAccess` 允许当前 caller。

### 4.2 未绑定 / 错主体拒绝语义（拟议返回形状）

与今日 `queryAtoms` 静默 `[]` 分离；Memory Center 只读入口返回：

```ts
type MemoryCenterReadonlyListResult =
  | {
      ok: true;
      statusView: "active" | "tentative";
      atoms: MemoryCenterAtomRow[];
      total: number; // 同 ACL+status 过滤后的全集计数（不受 limit 截断）
      truncated: boolean; // atoms.length < total
    }
  | {
      ok: false;
      code:
        | "MEMORY_SUBJECT_UNBOUND"
        | "MEMORY_SUBJECT_OWNER_MISMATCH"
        | "MEMORY_SUBJECT_TENANT_MISMATCH"
        | "MEMORY_STORE_MISSING"
        | "MEMORY_STORE_NOT_INITIALIZED"
        | "MEMORY_SNAPSHOT_STALE"
        | "MEMORY_CENTER_ACCESS_DENIED"; // 网关层亦可直接 errorShape
      message: string;
    };
```

- **禁止**在只读路径调用 `ensureMemorySubjectBinding` / `saveMemorySubjectBinding`。
- 绑定创建留在既有写入/首次同步路径（本设计不改）。

---

## 5. 缺库 / 未初始化 / 快照过期

| 条件                                                                  | 检测（只读）                                                                                                          | 返回                                                                                                         | 禁止                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 元数据库文件不存在                                                    | `fs.access(metadataStorePath)` 失败                                                                                   | `MEMORY_STORE_MISSING`                                                                                       | `LocalMetadataStore` 构造（其会 `mkdirSync`+schema bootstrap）             |
| 文件在但无 atoms/bindings schema 或无法打开                           | 只读 open 失败 / 缺表                                                                                                 | `MEMORY_STORE_NOT_INITIALIZED`                                                                               | `bootstrapSchema` / migrate                                                |
| 进程内无暖 scope，或快照文件缺失/版本不匹配，且产品要求「展示新鲜度」 | 读 `scopeSnapshotPath`；或读已有 `ScopeState.indexStatus`/`lastSyncAt` **不**调用 `loadScopeSnapshot` 的 rebuild 分支 | 可在 `ok:true` 附 `indexHint: "empty"\|"stale"\|"ready"`；若策略要求拒绝过期只读，则 `MEMORY_SNAPSHOT_STALE` | `syncScope` / `rebuildScopeRuntime` / `persistScopeSnapshot` / `writeBack` |

**原则**：查询入口不把「读列表」变成「修复索引」。过期提示由 UI 引导用户走既有同步入口（若有），不在候选切换时触发。

实现批准时需新增或复用「只读打开」工厂（例如 `openLocalMetadataStoreReadonly`）：`O_RDONLY`、不 `mkdir`、不跑 DDL；今日构造器不可直接用于该路径。

---

## 6. status 过滤 × limit × total / count

### 6.1 精确过滤

| `statusView` | store `statuses` | lifecycle 门闩                                                                        |
| ------------ | ---------------- | ------------------------------------------------------------------------------------- |
| `active`     | `["active"]`     | `includeTentative: false`（复核）                                                     |
| `tentative`  | `["tentative"]`  | 允许 tentative；**不要**用「`includeTentative: true` 且无 statuses」——那会混入 active |

不在本契约默认暴露 conflicted / deprecated / tombstoned。

### 6.2 limit 与 total

1. **过滤先于 limit**：`statuses` 下推 SQL（`LocalMetadataStore` 已支持），再 `LIMIT`/`OFFSET`。
2. **total**：同一 ACL + `statuses` 的 `COUNT(*)`（或等价无 limit 查询的长度，注意大库时优先 COUNT）。
3. 响应带 `truncated = atoms.length < total`。
4. 禁止：先 `limit` 再在内存按 status 滤；禁止用偏大 limit 碰运气。

### 6.3 与今日行为差异说明

今日默认列表已有「SQL limit 后 lifecycle 丢 tentative」的隐患；只读精确路径以 `statuses:["active"]` 修复该语义。**默认 active 观感保留**；修复属实现批准后行为收紧，需回归 C1/C4/C6。

---

## 7. 默认 active 兼容与无副作用证明点

### 7.1 兼容

- 缺省 `statusView = "active"`；旧客户端不传参 → 仍只见 active。
- 不改 `includeTentative` 全局默认；不改 `manager.search` / 注入策略。
- 不提升原子状态；不改来源文件与 evidence。

### 7.2 候选查询无副作用证明点（实现批准后验收）

| ID  | 断言                                                                | 手段                     |
| --- | ------------------------------------------------------------------- | ------------------------ |
| NS1 | 只读入口未调用 `syncScope`                                          | spy / 包装计数           |
| NS2 | 未调用 `ensureMemorySubjectBinding` / `saveMemorySubjectBinding`    | spy                      |
| NS3 | 未调用 `writeBack` / `persistScopeSnapshot` / `rebuildScopeRuntime` | spy                      |
| NS4 | 未创建 DB 文件与 schema（缺库用例）                                 | 前后 `fs.access` / mtime |
| NS5 | 原子 `status` / 来源文件 checksum 不变                              | 前后快照对比             |
| NS6 | 同进程随后 `search` 命中集合与分数策略不变（对照夹具）              | 搜索前后对比             |
| NS7 | 未绑定 → `ok:false` + `MEMORY_SUBJECT_UNBOUND`，bindings 行数不变   | 矩阵                     |

**证据口径（必须写进测试说明）**：本批隔离测试验证真实处理函数在 mock 配置与身份数据下的分支行为，**尚未**验证真实连接认证或完整客户端请求链；合法删除成功用例使用 null client；员工自有 agent 用例验证的是通过所有权检查后返回 not found，不能写成员工完整删除流程已验收。候选只读用例同口径：mock 身份下分支行为 ≠ 完整客户端链。

---

## 8. 拟改文件清单（路径级 — **实现尚未授权**）

| 路径                                                      | 拟议变更                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/memory/cogniweave-manager.ts`                        | 新增 `listMemoryCenterAtomsReadonly`；**不**改现 `listMemoryCenterAtoms` 直到接线批准 |
| `src/memory/types.ts`                                     | 扩展可选只读 API 类型与结果联合类型                                                   |
| `packages/cogniweave-sdk/src/contracts.ts`                | `QueryAtomsOptions.filter.statuses?: AtomStatus[]`                                    |
| `packages/cogniweave-sdk/src/runtime/in-memory-engine.ts` | 透传 `statuses`；只读授权探测 helper（list bindings，不 create）                      |
| `packages/cogniweave-sdk/src/adapters/local-metadata.ts`  | 只读 open 工厂（不 mkdir/bootstrap）；可选 COUNT                                      |
| `src/gateway/server-methods/data.ts`                      | （批准后）透传 `statusView` / typed error                                             |
| `ui/src/ui/ports/employee/views/memory-center-page.ts` 等 | （批准后）筛选 UI                                                                     |
| `src/memory/*o4*readonly*.test.ts`（新）                  | NS1–NS7 无写入探针                                                                    |
| **不改**                                                  | 索引范围、`forgetMemoryEntry`、lifecycle 串联、晋升 API、主工作树                     |

---

## 9. 无写入验证方法（测试 / 探针策略）

1. **单元**：engine + local-metadata 只读 open；缺文件 → `MEMORY_STORE_MISSING`；构造器路径不得跑。
2. **Manager 隔离**：临时目录预置 store+bindings+atoms；spy `syncScope` / binding save / writeBack；active/tentative 精确性与 total。
3. **ACL 矩阵**：未绑定 / 错主体 / 跨租户 → 错误码，非 `[]` 伪装成功。
4. **回归**：现有 `listMemoryCenterAtoms` 默认行为测试保持至接线；`includeTentative` 默认不被产品路径改写。
5. **口径标签**：测试名/注释标明 `evidence: mock-config-identity-branch` vs `evidence: full-client-chain`（后者本批不声称）。

---

## 10. 风险与开放问题

| ID  | 风险 / 问题                                | 备注                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------ |
| R1  | 只读 open 与现有 `DatabaseSync` 写连接并存 | 需确认 SQLite 锁与 WAL；实现时验证                     |
| R2  | Gateway 今日吞异常变 `[]`                  | 接线时需区分 UNBOUND vs 空列表，避免 UI 误示「无候选」 |
| R3  | `data.memory.list` 混合 files+atoms        | 候选筛选只影响 atoms；files 列表语义另定               |
| R4  | 精确 `statuses` 与 lifecycle-gate 双层     | 避免误用 `includeTentative` 宽放                       |
| R5  | 大库 COUNT 成本                            | 可接受上限或缓存；开放                                 |
| O1  | 绑定创建产品时机                           | 不在只读路径；实现批准时文档化 UX                      |
| O2  | `MEMORY_SNAPSHOT_STALE` 是硬拒绝还是 hint  | 建议默认 hint + 仍可读已落盘 atoms；产品可再定         |
| O3  | 参数最终命名 `statusView` vs `status`      | 契约倾向 `statusView`                                  |

---

## 11. 本轮关闭记录（文档态）

- O5 文案修正 + 本批隔离验证：**已关闭**（见处置文续轮结论）。
- O4 候选视图：**实现暂缓**；本文供审核。
- 事实级全来源遗忘：仍待评估，不进入本设计实施面。

---

## 12. 修订节 — O4 隔离只读基础能力（2026-10-26 实施批）

### 12.1 本轮授权范围

| 允许                                                                       | 禁止                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 更新本设计；实现窄只读 reader、结果联合类型、embedded 已有存储适配         | 替换/改默认 `data.memory.list`；候选 UI 按钮；现场 `ensureMemorySubjectBinding` |
| 复用 `authorizeMemoryAccess` + `isAtomRetrievable`（不复制简化授权）       | 改正常 `search` / `queryAtoms` **默认**行为（缺省 filter 语义不变）             |
| 仅 CogniWeave **embedded** + 已存在 local metadata SQLite                  | 其他后端：明确 `unsupported` / `unknown`；不建库、不迁移旧 schema               |
| 过滤下推 `statuses` 后再 `limit`；`total` 与 ACL+status+lifecycle 过滤一致 | 与 WAL 写连接冲突时静默升级为写打开；真实生产记忆写入                           |
| 单元/集成隔离证据（mock 身份 / 临时夹具）                                  | 声称真实连接认证全链已验收；push / PR / merge / deploy                          |

### 12.2 实现符号（落地名）

| 层      | 符号                                                                       | 说明                                                                                             |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Store   | `openLocalMetadataStoreReadonly`                                           | `O_RDONLY` / `readOnly:true`；不 `mkdir`；不 `bootstrapSchema`；缺库/缺表/schema≠当前 → 显式失败 |
| Store   | `countAtoms`（可选）或等价同 filter 计数                                   | 与 `queryAtoms` 同一 status/scope 谓词                                                           |
| OpenBot | `listMemoryCenterAtomsReadonly`（manager）+ `memory-center-o4-readonly.ts` | 旁路 `syncScope` / `ensureMemorySubjectBinding`；映射 auth reason → typed `ok:false`             |
| 类型    | `MemoryCenterReadonlyListResult`                                           | 见 §4.2；另增 `MEMORY_BACKEND_UNSUPPORTED` / `MEMORY_STORE_SCHEMA_UNSUPPORTED`                   |

### 12.3 非嵌入 / 未知后端

- `memory.backend !== "cogniweave"` 或 CogniWeave `mode !== "embedded"` → `ok:false` + `MEMORY_BACKEND_UNSUPPORTED`（或 `unknown`）。
- 不尝试打开 postgres / remote REST 元数据作本路径替代。

### 12.4 与 `queryAtoms` 关系

- **默认** `engine.queryAtoms` 调用方不传 `statuses` 时行为保持今日语义（本轮不改默认召回/列表入口）。
- 只读基础能力优先走 store `statuses` 下推 + 既有 lifecycle 复核；**不**用「仅 `includeTentative: true`」冒充 tentative 精确视图。

### 12.5 验收口径标签

`evidence: mock-config-identity-branch` — 本批声称范围。  
`evidence: full-client-chain` — **本批不声称**。
