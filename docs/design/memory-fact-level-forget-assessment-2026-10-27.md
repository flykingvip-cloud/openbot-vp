# 事实级全来源遗忘 — 评估报告（仅评估，不实施）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-27 Asia/Shanghai |
| 评估 tip | `b8ff8ea4`（`origin/main`；含 O4 #108 及后续 #107/#110/#109） |
| 相对 O4 合入 tip | `5fb3cf92` 仍为祖先；其后另有 platform-models / task-outcome 合入 |
| 授权范围 | **仅步骤 1：评估报告**；不改产品代码；不部署；不写真实记忆 |
| 后续另批 | DS 路径 1 收敛管理面；效果验收矩阵 |
| 状态 | **评估完成；产品实施建议见 §7（默认 no-ship）** |

> 依据：`memory-system-o4-o5-disposition-2026-10-26`、`memory-center-candidate-view-plan-2026-10-26` §事实级遗忘、`memory-system-review-report-2026-10-26` M08 / §5.2、O5 文案、gateway `data.memory.forget` 与 CogniWeave source lifecycle 源码。

---

## 1. 评估目标与非目标

### 1.1 目标

回答：当前各面遗忘契约是什么；同一内容多来源时实际会发生什么；与「事实级全来源遗忘」差在哪；风险与是否立项产品实施。

### 1.2 明确非目标（本评估与任何默认跟进均不含）

- 不改 RPC / UI / lifecycle 串联 / purge / migrate / reindex。
- 不在真实网关或真实权威库执行 forget / 写入。
- 不开启 D4「forget 串联默认 on / best-effort 先删文件」。
- 不把 O5「文件删除」文案改成「事实已清除」类承诺。
- 不把本报告当作 DS 路径 1 或效果验收矩阵的实施授权。
- 不把「同文本仍可召回」自动判为遗忘故障（须同来源 identity/locator 对照，见 O5 契约）。

---

## 2. 当前遗忘契约（按表面）

### 2.1 总览

| 表面 | 入口 | 实际动作 | 触达 CogniWeave `forgetSource`？ | 产品文案承诺 |
| --- | --- | --- | --- | --- |
| **A. Memory Center / 数据目录「删除此记忆文件」** | UI → `data.memory.forget` → `forgetMemoryEntry` | 在 Data Space 候选路径上 **unlink/rm 一个文件或目录**；找到第一个命中即返回 | **否** | 仅删所选文件；**不**清其他来源相同内容；**不**保证立即停召回 |
| **B. Gateway RPC `data.memory.forget`** | `rejectWhenManaged` → `assertMemoryCenterAgentAccess` → `forgetMemoryEntry` | 同 A | **否** | 无独立文案；错误：`memory entry not found` |
| **C. CogniWeave artifact lifecycle API** | `CogniWeaveMemoryManager.applyMemoryArtifactLifecycle` | 按 `memoryKey` 匹配 **已索引** locator → 逐 locator `forget`（默认再 `purge`） | **是**（经 `applyTranscriptSourceLifecycle`） | **无产品入口**；生产路径 **无人调用**（仅类型/wrapper/单测） |
| **D. 会话 / transcript 源生命周期** | `applyTranscriptSourceLifecycle`；conversations bridge；revoke-outbox → `forgetSource` | 按 `sourceIdentityId` 或 `sourceLocator` **单源** archive/restore/forget/purge | **是** | 会话归档/撤销语义，非 Memory Center「忘记事实」 |
| **E. Agent 处置** | `applyAgentMemoryDisposal` | 按 mode 删 agent 下整树或子集；`soft_unbind` 不删 | **否** | 处置策略，非单条事实遗忘 |
| **F. 原子详情** | — | **无删除按钮**（O5 明确） | — | 无 |

### 2.2 表面 A/B — `forgetMemoryEntry` 契约（现行产品路径）

源码：`src/data/memory-lifecycle.ts`、`src/gateway/server-methods/data.ts`。

- 入参：`{ agentId, memoryKey }`。
- 路径候选（按序尝试，**命中第一个文件/目录即删并返回**）：
  1. `{dataRoot}/agents/{agentId}/memory/agent/{key}`
  2. `.../memory/workspace/{key}`
  3. `{dataRoot}/memory/personal/{key}`
  4. `{dataRoot}/agents/{agentId}/{key}`
- 成功：`{ deletedPath }`；失败：RPC `memory entry not found`。
- **不做**：索引撤回、atom/evidence soft-unlink、syncScope、restart 后一致性、跨路径「同内容」扫描。
- 授权：managed 拒绝；enterprise Memory Center access 拒绝；personal workbench 须拥有 agent（O5 gateway isolation 已覆盖）。

### 2.3 表面 C — `applyMemoryArtifactLifecycle`（引擎能力，未接线）

- 只对 **当前 manager 已索引路径**（`docsByPath`）做 basename/后缀启发式匹配；匹配 0 → `skipped: true`（不发明 locator，避免污染 SourceBinding）。
- 默认 `purgeAfterForget !== false` → forget 后 purge。
- **关键缺口**：Gateway / UI **从未调用**；与 `data.memory.forget` 并行存在 → 即 M08「入口分叉」。

### 2.4 表面 D — 引擎 `forgetSource`（单源生命周期）

- 选择器 **fail-closed 单选**：`sourceIdentityId` | `sourceLocator` | `sourceBindingId`（`resolveSourceLifecycleSelector`）。
- `forgotten` / `purged`：对该 binding 的 live `source_object_links` **soft-unlink**；对象是否仍可检索取决于 **是否还有其他 active binding 的 live link**（`isEvidenceRetrievable`：有 live link 时，任一 active 即仍可检索）。
- 幂等：同 `operationId` 已完成且状态一致则重放收据；冲突抛 `IdempotencyConflictError`。
- 会话 bridge / revoke-outbox 走此路径；**按源 identity 列表逐个 forget**，不是按 claim 文本扫全库。

### 2.5 O5 文案（已关闭，与后端对齐）

| 位置 | 文案 |
| --- | --- |
| 按钮 | 删除此记忆文件 |
| 提示 | 仅删除所选文件，不会清除其他来源中的相同内容，也不保证立即停止相关召回 |
| 成功 | 已删除所选记忆文件 |

入口：Memory Center 文件详情、数据目录同类入口。原子详情不加删除。

---

## 3. 多来源相同内容时的实际行为

### 3.1 产品已断言的对照（O5）

隔离设定：短语相同；来源 A = Data Space `memory/agent/*.md`；来源 B = workspace `MEMORY.md`。

- 删 A 后 B **合法保留** → **不得**判遗忘故障。
- 仅当删后命中仍映射到 **同一来源 A**（或其应撤销派生），且已排除其他有效来源 → 才可重开「同来源残留」缺陷。
- 现状常见分类：`source-A-never-indexed-...` 或 `control-source-B-retained-per-source-contract`（Data Space 文件往往进不了现行 `manager.search` 索引面）。

### 3.2 引擎层多源语义（若走 `forgetSource`）

- Atom / evidence 通过 `source_object_links` 可挂多个 source binding（CW2-P1-00「Normalized multi-source membership」）。
- Forget **一源**：soft-unlink 该 binding 下的 links；**其他源仍 active 时，对象仍可检索**。
- Purge：仅在无剩余 live links 等条件下才可能硬删对象（引擎设计如此；产品 UI 未暴露）。

### 3.3 现行 UI 路径下的多源行为

1. 用户删 Data Space 文件 A → 仅文件系统删除。
2. Workspace / transcript / 其他 Data Space 副本中的相同语句 **原样保留**。
3. 若 B 已索引 → 召回仍可命中 B（**符合**现行文案与 O5 契约）。
4. 权威库中由 A 派生、且仅链接 A 的对象：因 RPC **未**调 lifecycle，可能 **索引/原子残留**（M08 风险；**尚未**用「删前 A 已索引 + 删后同源命中」闭环证实为线上故障）。

### 3.4 「事实」在模型中的近似物

| 候选身份 | 现状 | 能否支撑「事实级全来源」 |
| --- | --- | --- |
| 文件路径 / `memoryKey` | 产品唯一操作键 | 否（单文件） |
| `sourceIdentityId` / `sourceLocator` | 引擎生命周期键 | 否（单源） |
| `MemoryAtom.id` | 原子主键 | 否（无产品删除；且一事实多原子可能） |
| `claim.statement` / `dedupKey` | 文本/去重键存在 | **未**接到任何 forget API；归一化/跨源去重未产品化 |
| content hash | 无统一「事实 ID」产品契约 | 否 |

结论：栈内是 **按源 / 按文件** 遗忘；**没有**「选定一条事实 → 枚举并撤销全部来源」的一等公民 API。

---

## 4. 与「事实级全来源遗忘」的差距

期望（登记用语）：忘记一条事实及其 **全部来源**，含多来源定位、权限、完成态、恢复与召回验收。

| 能力块 | 现状 | 差距 |
| --- | --- | --- |
| 操作对象 | 文件 key 或单 source selector | 缺「事实」选择器（atom / claim / 归一化指纹） |
| 多源枚举 | 引擎有 multi-source links，但 UI/RPC 不用；文件 forget 不读 links | 缺：由事实 → 全部 sourceBinding / 文件路径 / transcript 区间 |
| 执行面统一 | 文件 RPC ⊥ artifact lifecycle ⊥ transcript lifecycle | 缺：单一编排与完成态 |
| 权限 | 文件 forget 有 Memory Center ACL；lifecycle 走 manager/会话治理 | 缺：跨源、跨 agent/workspace 的统一授权矩阵 |
| 完成态 | 文件：有 `deletedPath` 即成功；引擎：有 lifecycle receipt | 缺：跨源 all-or-nothing / 可查询部分失败 |
| 恢复 | 文件 unlink 无产品恢复；引擎有 restore（archived→active），forgotten 为终端态之一 | 缺：事实级恢复 UX 与备份策略 |
| 召回验收 | O5：同来源对照；A 常未进索引 | 缺：事实级「所有来源召回=0」金标与 harness |
| 文案 | 已诚实声明「不清其他来源」 | 若立项必须 **新入口新文案**，不可覆写 O5 文件删除文案 |

`disposition` §2.5 缺口 ID `fact-level-forget`：**未实现**；独立需求。

---

## 5. 风险

| ID | 风险 | 严重度 | 说明 |
| --- | --- | --- | --- |
| R1 | 用户期望「忘掉这件事」但只删一文件 | 中（产品误解） | 文案已缓解；原子视图仍可能展示同源派生 |
| R2 | 文件已删、索引/原子仍在（入口分叉） | 中（一致性） | M08；需隔离「索引后 forget RPC」才能定性故障 |
| R3 | 误上线「串联 forget」无完成态/补偿 | 高 | 优化方案 **D4 明确未批准** |
| R4 | 事实级误伤独立合法来源 | 高 | 同文本 ≠ 同事实；跨租户/主体权限 |
| R5 | purge 不可恢复 | 高 | artifact API 默认 purgeAfterForget；事实级更需显式分阶段 |
| R6 | 无稳定 sourceId 的召回断言 | 中 | O5：same-source-map 仅部分；扩索引另批 |
| R7 | 把评估当实施授权 | 高（流程） | 本文件 **不授权** 编码 |

---

## 6. 若未来立项，最小设计要素（仍不实施）

仅作评估备忘，**非**批准范围：

1. **选择器**：显式 `factRef`（建议 atomId 或规范化 claim 指纹 + scope），禁止静默「同字符串全库删」。
2. **枚举**：经 `source_object_links` + 文件路径解析列出来源；输出预览供确认。
3. **权限**：逐源 + 聚合授权；enterprise / managed / 主体绑定与现网一致 fail-closed。
4. **编排**：分阶段 forget（可恢复）→ 可选 purge；禁止默认 best-effort 半删；可查询 receipt。
5. **验收**：隔离金标——多源同事实；完成后 **每一** 来源召回=0；对照源（不同事实）保留。
6. **UX**：独立于「删除此记忆文件」；不得削弱 O5 诚实文案。
7. **依赖**：可能依赖 DS 检索映射 / 索引范围另批；不可为测事实级而默默扩生产索引。

---

## 7. 建议（ship / no-ship）

### 7.1 产品实施：**建议 no-ship（本阶段不立项编码）**

理由：

1. O5 文件删除契约与文案已对齐并关闭；双来源对照下「删 A 留 B」是 **预期**。
2. 引擎已有 **单源** lifecycle + multi-source soft-unlink，但产品要的是 **跨源事实编排**，缺口在选择器/枚举/完成态/验收，不是再挂一个按钮。
3. `applyMemoryArtifactLifecycle` 未接线；在无隔离 E2E、无恢复方案下串联 = 踩 D4。
4. 「事实」身份未产品化；过早实施易变成危险的全库文本删除。
5. Owner 顺序：本步仅评估 → 再 DS 路径 1 → 再效果矩阵；事实级产品应排在映射与验收能力之后或并行设计、**后于**其落地。

### 7.2 建议保留 / 可另批的非产品跟进（仍须显式授权）

| 优先级 | 项 | 性质 |
| --- | --- | --- |
| P0 | 保持 O5 文案与「原子详情无删除」 | 已关闭，勿回退 |
| P1 | 隔离 harness：索引后的文件 → `data.memory.forget` → 同源召回（补 M08 证据） | 诊断，≠ 事实级实施 |
| P2 | 若诊断证实同源残留：另批「可恢复的 forget 串联」设计（仍非事实级） | 修 M08 分叉 |
| P3 | 事实级：仅当产品书面定义 factRef + 验收金标后再开设计/RFC | 独立需求 |
| — | DS 路径 1、效果验收矩阵 | **下一步另批**；本报告不启动 |

### 7.3 一句话结论

> **现行遗忘是「按文件 / 按源」；「事实级全来源遗忘」未实现且不应在本阶段编码。保持 O5 诚实契约；先补同源残留诊断与 DS/效果能力，再决定是否立项事实级。**

---

## 8. 证据索引

| 类 | 路径 |
| --- | --- |
| 处置 / 登记 | `docs/design/memory-system-o4-o5-disposition-2026-10-26.md` §2、§6.5、§7 |
| 候选方案 | `docs/design/memory-center-candidate-view-plan-2026-10-26.md` §4–§5 |
| 复查 M08 | `docs/design/memory-system-review-report-2026-10-26.md` §2.4、M08、§5.2 |
| 优化约束 | `docs/design/memory-system-optimization-plan-2026-10-26.md` D4、Step 6 |
| Gateway | `src/gateway/server-methods/data.ts`（`data.memory.forget`） |
| 文件删除 | `src/data/memory-lifecycle.ts`（`forgetMemoryEntry`） |
| 未接线 API | `src/memory/cogniweave-manager.ts`（`applyMemoryArtifactLifecycle`） |
| 引擎 | `packages/cogniweave-sdk/src/runtime/in-memory-engine.ts`（`forgetSource` / multi-link） |
| 模型 | `packages/cogniweave-sdk/src/models.ts`（`SourceObjectLink`、`MemoryAtom`） |
| 会话 | `src/conversations/cogniweave-bridge.ts`；`src/memory/revoke-outbox-drain.ts` |
| UI 文案 | `ui/.../memory-center-page.ts`；`ui/.../data-directory-page.ts` |
| 隔离测 | `src/gateway/server-methods/memory-forget-gateway-isolation.test.ts`；O4/O5 diagnose |

---

## 9. 未触碰证明

- 本评估过程：只读工作树 `/private/tmp/openbot-forget-assess-20261027-125800` @ `b8ff8ea4`。
- **无**产品源码修改；**无**真实记忆写入；**无**部署；**无**开启 forget 串联。
- 若存在本文件的文档 PR：仅新增本评估 Markdown，不含 `src/` / `ui/` 行为变更。
