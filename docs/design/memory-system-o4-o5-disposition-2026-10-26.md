# 记忆系统 O4/O5 后续处置记录（2026-10-26）

| 字段                | 值                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 文档 ID             | `memory-system-o4-o5-disposition-2026-10-26`                                                                     |
| 日期                | 2026-10-26（Asia/Shanghai）                                                                                      |
| 授权                | O4 产品契约方向已批准（实现仍待批）；O5 **仅**文件删除文案 + 网关隔离验证；禁止候选视图实现 / lifecycle / 真实库 |
| 工作树              | `/private/tmp/openbot-memory-batch1-rework`                                                                      |
| 分支                | `codex/openbot-memory-batch1-rework`                                                                             |
| 开始 HEAD（本续轮） | 见 §6 续轮检查点                                                                                                 |
| `origin/main`       | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`                                                                       |
| 基线                | `merge-base --is-ancestor origin/main HEAD` = 0；behind = 0                                                      |
| Loom / 工作树       | `openbot-memory-batch1-rework`（唯一写入）；非 T34                                                               |
| 状态                | **O5 文案+隔离已关闭**；O4 契约已批、实现暂缓、只读设计待审；DS 映射调查见独立文；事实级遗忘仍待评估             |

## 0. 检查版本、环境与授权边界

### 0.1 环境确认（本轮开始）

- 唯一写入：上述工作树；`machineId` 指向该机。
- 分支 / HEAD / 干净工作区 / Loom worktree 归属与协调方核验一致。
- **未** switch / rebase / stash / 建工作树；**未** push / PR / 部署。
- **未**触碰真实记忆库、真实网关写入、主体补绑、`includeTentative` 默认、原子状态提升、遗忘 lifecycle 串联、purge、迁库、重建真实索引、重启网关。

### 0.2 必读边界（保留，避免重复误判）

1. **O4** 只证实 tentative 默认不在记忆中心列表展示，**尚未证明违反产品契约**。
2. **O5** **未证实**同一被删除来源仍被召回；删 A 后独立来源 B 仍命中 ≠ 遗忘故障。
3. helper ≠ 网关处理链；not-run 不计 passed。
4. v1 O5/S4 以路径名 `MEMORY.md` 残留判缺陷 → **证据无效**（见 [memory-e2e-baseline-v1-coverage-limits-2026-10-26](/design/evidence/memory-e2e-baseline-v1-coverage-limits-2026-10-26)）。

---

## 1. O4 — 记忆中心展示契约核实

### 1.1 调查项与证据

| #   | 调查项                                                         | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 结论                                                                                                                                   |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 产品说明 / UI 文案 / 测试是否明确规定「记忆中心只展示 active」 | UI：`ui/src/ui/ports/employee/views/memory-center-page.ts` 空态「暂无可管理的记忆。」；详情未渲染 `status`；无状态筛选控件。产品：CogniWeave tech-spec 讨论检索候选集中 tentative「可参与，降权」，**未**写 Memory Center UI 默认列表政策。生命周期方案写明「搜索 / Memory Center 展示 / 模型注入分别由 policy 决定」（[openbot-conversation-lifecycle-implementation-plan-2026-07-16](/design/openbot-conversation-lifecycle-implementation-plan-2026-07-16) §8.4）。既有诊断测试记录「产品预期待核实」。 | **无明确产品规范**强制「只展示 active」或「默认必须展示 tentative」。现有默认行为是实现结果，不是已成文 UI 契约。                      |
| 2   | UI → RPC → manager → queryAtoms                                | UI `render-model-memory-center.ts` → `data.memory.list` → `listAgentMemoryEntries` + `listMemoryCenterAtoms({ limit: 200 })` → `ensureMemorySubjectBinding` + `engine.queryAtoms({ filter: { limit } })`（**未**传 `includeTentative: true`）→ `mapAtomToMemoryCenterRow`（DTO **含** `status`）。RPC 见 `src/gateway/server-methods/data.ts`；列表见 `src/memory/cogniweave-manager.ts` `listMemoryCenterAtoms`。                                                                                         | 调用链清晰。**不支持**状态筛选参数；`status` 在返回数据中，但 UI **未展示、未筛选**。                                                  |
| 3   | 各状态对展示 vs 检索                                           | `packages/cogniweave-sdk/src/retrieval/lifecycle-gate.ts`：`tombstoned`/`deprecated` 默认不可检索；`tentative`/`conflicted` 默认不可检索，除非 `includeTentative` / `includeConflicted`。Memory Center 列表走同一 `queryAtoms` 门闩 → 默认与「可召回原子」集合对齐（active）。`manager.search` 走文件/证据检索路径 + `isSourcePathRetrievable`，与 atom 列表门闩**不同路径**（展示 ≠ 文件检索）。                                                                                                          | **勿等同**：列表可见性当前绑定 queryAtoms 生命周期门闩；文件 search 另径。tentative 默认可被 search 命中文件内容，却不出现在原子列表。 |
| 4   | 主体 / 租户 / 作用域权限                                       | Gateway：`assertMemoryCenterAgentAccess`（enterprise 拒、personal workbench 须拥有 agent）。Manager：`ensureMemorySubjectBinding` 后 `queryAtoms` fail-closed（未绑定 / 错主体 / 跨租户 → `[]`）。O3 ACL 单测已覆盖 active×四态。                                                                                                                                                                                                                                                                          | 列表与 forget 均有授权；候选数量若开放展示，**必须**同等过滤（推荐契约已写入方案文）。                                                 |

### 1.2 O4 结论

| 项           | 结论                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现象         | tentative 默认不在 Memory Center 原子列表中（已隔离观察）。                                                                                                           |
| 是否违反契约 | **未证实违反** — 缺少「必须展示 tentative」或「明确只展示 active」的用户可见成文契约。                                                                                |
| 产品动作     | **不改** `includeTentative` 默认；不批量晋升 active；不自动绑权限；**不实现**候选视图直到另批。                                                                       |
| 交付         | 已批准契约与方案见 [memory-center-candidate-view-plan-2026-10-26](/design/memory-center-candidate-view-plan-2026-10-26)（**产品契约已批准，候选视图实现仍待批准**）。 |
| 契约收敛     | 两种状态视图（已确认 / 候选）；状态精确过滤；同一 ACL；读取无写库副作用（见方案 §1）。                                                                                |

### 1.3 状态 × 权限矩阵（隔离）

| 单元                                      | 结果来源                                                            | 结果摘要                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| tentative × 合法主体（列表默认）          | **已执行**（`memory-batch1-o4-o5-diagnose.test.ts` + 本轮矩阵用例） | 默认 `includeTentative` 缺省 → 列表不可见；库内可有 tentative 行 |
| active × 合法主体                         | **已执行**（O3 `query-atoms-acl` + 本轮矩阵）                       | 可见 / 可查询                                                    |
| active/tentative × 未绑定                 | **已执行**（本轮矩阵；O3 覆盖 active）                              | fail-closed `[]`                                                 |
| active/tentative × 错误主体               | **已执行**（本轮矩阵）                                              | fail-closed `[]`                                                 |
| active/tentative × 跨租户                 | **已执行**（本轮矩阵）                                              | fail-closed `[]`                                                 |
| UI 状态筛选入口                           | **源码推断**                                                        | 无 `includeTentative` / statusFilter 控件                        |
| `listMemoryCenterAtoms` 传参              | **源码推断**                                                        | 仅 `limit`；不过滤参数透出                                       |
| 网关 RPC 带状态筛选                       | **未测 / not-run**                                                  | 接口尚无该参数                                                   |
| deprecated/conflicted/tombstoned 展示文案 | **源码推断**                                                        | 门闩排除；UI 无专门空态区分                                      |

---

## 2. O5 — 遗忘契约与缺陷关闭

### 2.1 已核实产品/实现契约（按调用链，非仅 helper 名）

| 层                            | 内容                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 用户可见文案（Memory Center） | 按钮「忘记这条记忆」；`title`「从本机移除后，机器人将不再使用该记忆」；成功「已忘记这条记忆。」                                         |
| 用户可见文案（数据目录）      | 按钮「忘记此条记忆」；成功「已删除指定记忆条目。」（更接近文件条目语义）                                                                |
| 请求参数                      | `{ agentId, memoryKey }` → `data.memory.forget`                                                                                         |
| 网关处理                      | `rejectWhenManaged` → `assertMemoryCenterAgentAccess` → `forgetMemoryEntry`；**不**调用 `applyMemoryArtifactLifecycle` / `forgetSource` |
| helper                        | 在 Data Space 候选路径中 unlink/rm **单个** `memoryKey`（agent/workspace/personal/agentRoot）                                           |
| 后续同步                      | forget RPC **未**串联索引/lifecycle 撤回；session 路径另有 sync，Markdown 删除补偿未挂在此入口                                          |
| 原子 UI                       | 可选中原子详情，**无**忘记按钮（忘记仅针对记忆**文件**条目）                                                                            |

**契约定性（当前实现）**：删除 Data Space 上的**单个记忆文件来源**（按 `memoryKey`），**不是**「忘记某事实及其全部来源」，也不是对 atom 行的直接删除。

### 2.2 原「遗忘残留缺陷成立」处置

| 项               | 内容                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原判断           | 曾依据 v1/S4 等「删后仍命中 / MEMORY.md 残留」倾向认定残留缺陷，并讨论串联 lifecycle。                                                                                                                             |
| 原证据（保留）   | v1 基线 JSON；复查报告 M08「实现分叉属实、删除后召回证据不足」；O8 v1 覆盖限制说明第 4 条。                                                                                                                        |
| 撤回理由         | (1) 未按来源 identity 排除其他有效来源；(2) helper 成功 ≠ 网关处理链；(3) 双来源对照下，删 A 后 B 命中符合「单来源删除」契约；(4) Data Space 文件与 workspace `MEMORY.md` 检索树不同，不能用文本相同代替来源一致。 |
| **本轮关闭判断** | **未证实，关闭当前缺陷判断；验证缺口另行跟踪。** 不实施 lifecycle/purge；不关 GitHub issue。                                                                                                                       |

### 2.3 文案核对与本轮修正

| 文案（修正前）                           | 与后端契约                            | 判定                       |
| ---------------------------------------- | ------------------------------------- | -------------------------- |
| 「忘记这条记忆」                         | 实际删单个文件 key                    | 模糊；易理解为整条事实     |
| 「从本机移除后，机器人将不再使用该记忆」 | 未保证索引/其他来源/atom 立即不可检索 | **过承诺**（文案 > 实现）  |
| 「已忘记这条记忆。」                     | 仅确认文件删除 RPC 成功               | 偏强                       |
| 「已删除指定记忆条目。」（数据目录）     | 更贴近单条目删除                      | 相对一致但仍不统一         |
| 原子无删除、文件有删除                   | 与「单文件来源」一致                  | 保持：原子详情不加删除按钮 |

**本轮已统一文件删除入口文案（不改后端）**：

| 位置 | 统一文案                                                               |
| ---- | ---------------------------------------------------------------------- |
| 按钮 | 删除此记忆文件                                                         |
| 提示 | 仅删除所选文件，不会清除其他来源中的相同内容，也不保证立即停止相关召回 |
| 成功 | 已删除所选记忆文件                                                     |

入口：Memory Center 文件详情、数据目录同类忘记入口。原子详情仍无删除按钮。

### 2.4 双来源对照（契约断言）

隔离测试：同内容短语，来源 A = Data Space `memory/agent/*.md`，来源 B = workspace `MEMORY.md`。

- 删 A 后 B **合法保留** → **不得**判遗忘故障。
- 仅当来源 A 删除前可检索、删除后命中仍映射到 **同一来源 A**（或其应撤销派生）且排除其他有效来源 → 才可重开缺陷。
- 当前分类常见为 `not-confirmed-defect:source-A-never-indexed-...` 或 `not-confirmed-defect:control-source-B-retained-per-source-contract`（见诊断测试）。

### 2.5 验收缺口清单（完整）

| 缺口 ID              | 内容                                                     | 本轮状态                           |
| -------------------- | -------------------------------------------------------- | ---------------------------------- |
| GW-auth              | 网关认证下 `data.memory.forget`（enterprise 拒绝）       | **已执行**（gateway isolation）    |
| GW-managed           | managed 模式拒绝                                         | **已执行**（gateway isolation）    |
| GW-ownership         | 员工会话外键 agent 拒绝；自有 agent 允许进处理链         | **已执行**（gateway isolation）    |
| GW-handler-chain     | 真实 `dataHandlers["data.memory.forget"]` 合法允许删文件 | **已执行**（gateway isolation）    |
| same-source-map      | 删除前 A 已进入可检索映射且可按 source identity 断言     | 部分：路径启发式；缺稳定 sourceId  |
| recall-immediate     | 删后立即召回同来源 = 0                                   | 依赖 A 曾被索引；当前常无法成立    |
| recall-after-sync    | 现有同步后再召回                                         | 未单独驱动 sync；**not-run** 完整  |
| recall-after-restart | 跨进程重建 manager 后再召回                              | 已跑对照；仍受「A 是否曾索引」限制 |
| fact-level-forget    | 忘记事实及全部来源                                       | **未实现**；若产品需要 → 独立需求  |

### 2.6 重开条件（达到后只交证据 + 修复设计，不实施）

1. 入口（优先真实处理函数，隔离环境）成功处理来源 A。
2. A 删除前可被检索，且命中可映射到 A 的来源 identity/locator。
3. 删除后命中仍是同一来源 A 或其应撤销派生。
4. 已排除其他有效来源（不得用文本相同代替）。
5. 附：复现步骤、来源映射、权限上下文、同步与重启结果。

若产品要「忘记事实及全部来源」：作为**独立功能需求**（共享来源、权限、完成态、恢复），不在本缺陷重开路径内默认实施。

---

## 3. 已执行 / not-run

### 已执行

- 工作树 / Loom / 基线再确认。
- 源码与 UI 文案只读追踪（list / forget / lifecycle-gate / ACL）。
- 隔离：`src/memory/memory-batch1-o4-o5-diagnose.test.ts`（含本轮矩阵补强与 O5 契约断言）。
- 相关 format / 类型检查（见提交前验证记录）。

### not-run / 限制

- Data Space 来源 A **无法**经现有 `manager.search` 索引路径进入检索映射（search 只扫 workspace `MEMORY.md` / `workspace/memory`）；**明文记录限制，不伪造来源映射**；不得用 B 命中当 A 残留。
- 真实记忆库读写、生产网关重启、lifecycle 串联、purge。
- 候选视图 UI/RPC 产品实现（契约已批，**实现仍待批准**）。
- 外部 tracker 关闭/评论。

---

## 4. 需审核事项（续轮后）

1. ~~O4 推荐契约~~ → **产品契约已批准**；**候选视图实现仍待批准**（方向批准 ≠ 代码授权）。
2. ~~O5 文案收敛~~ → **本轮已实施**（仅文件删除入口文案 + 渲染测试）。
3. 是否立项「事实级忘记（全部来源）」→ **仅登记待评估**，不实施。
4. 若未来要使 Data Space 文件可被 search 按来源 identity 断言 → 需另批索引范围设计（当前限制已记录）。
5. 外部 tracker：**只列候选，不评论不关闭**（见 §6.4）。

---

## 5. 未触碰证明

- 无真实记忆写入；无 push / PR / 部署；未改 RPC / 来源范围 / lifecycle；原子详情未加删除按钮。
- `includeTentative` 默认未改；未提升原子状态；未串联 forget lifecycle；未 purge；未实现候选视图。
- 未触碰主目录真实库、T34 工作树。

---

## 6. 续轮（2026-10-26 Asia/Shanghai）— 契约收敛 / O5 文案 / 网关隔离

### 6.1 工作树检查点（开始）

| 项            | 值                                            |
| ------------- | --------------------------------------------- |
| 工作树        | `/private/tmp/openbot-memory-batch1-rework`   |
| HEAD（开始）  | `8a91f36fcfb50001024c94ef32b4f70a6109e6f8`    |
| `origin/main` | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`    |
| ancestor      | = origin/main；ahead 分支本地提交；工作区干净 |
| 归属          | 本任务工作树；非 T34                          |

### 6.2 O4

- 方案文状态改为：**产品契约已批准，候选视图实现仍待批准**。
- 收敛：两种状态视图、状态精确过滤、ACL、读取副作用边界。
- **未实现**候选筛选 UI/RPC。

### 6.3 O5 文案与隔离

- 文案三件套已落到 Memory Center + 数据目录同类入口；补渲染/文案测试。
- 新增 `src/gateway/server-methods/memory-forget-gateway-isolation.test.ts`：经真实 `dataHandlers["data.memory.forget"]` 覆盖 managed / enterprise / ownership / legal-allow。
- 双来源召回对照仍由 `memory-batch1-o4-o5-diagnose.test.ts` 维护；来源 A 删前无法进入现有 search 索引 → 分类保持 `not-confirmed-defect:source-A-never-indexed-...`；**不伪造**；B 命中不作为 A 残留。
- 未发现需立即停在后端修复前的「新同来源残留」证据（A 从未进索引，无法成立同来源残留）。

### 6.4 外部 tracker 候选列表（只列，不评论不关闭）

检索 `flykingvip-cloud/openbot-vp` 开放 issue 时，当前开放 issue 列表为空 / 无稳定 memory-forget 命中。内部设计侧候选（非 GitHub 操作）：

| 候选 ID       | 来源                                   | 主题                                            |
| ------------- | -------------------------------------- | ----------------------------------------------- |
| M08           | memory-system-review-report-2026-10-26 | 文件遗忘与会话生命周期入口不一致（实现分叉）    |
| O5-gap-index  | 本处置 §2.5 / §6.3                     | Data Space 来源无法经现有 search 路径按来源断言 |
| O5-fact-level | 方案 §5 / 待评估                       | 事实级全来源遗忘（独立需求，未立项实施）        |
| O4-impl       | 方案状态                               | 候选视图实现（契约已批，实现仍待批准）          |

### 6.5 待评估需求登记

- **事实级全来源遗忘**：仅登记待评估；需要多来源定位、权限、完成态、恢复与召回验收；**本轮不设计不实施**。

---

## 7. 状态续记（2026-10-26 Asia/Shanghai）— Owner 验收关闭后

| 项                         | 状态                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O5 文案修正 + 本批隔离验证 | **关闭**（Owner 验收；基线核对 `8b9e0ebf`；不改 RPC/lifecycle）                                                                                                                                                      |
| O4 产品契约                | 保持已批准                                                                                                                                                                                                           |
| O4 候选视图实现            | **暂缓**；只读路径设计见 [memory-center-o4-readonly-path-design-2026-10-26](/design/memory-center-o4-readonly-path-design-2026-10-26)（待审）                                                                        |
| Data Space → search 映射   | **不批准**为补测试扩索引；只读调查见 [memory-data-space-search-contract-survey-2026-10-26](/design/memory-data-space-search-contract-survey-2026-10-26)：模型承诺与 search 能力不一致 → **建议独立立项**，本轮不实现 |
| 事实级全来源遗忘           | **仍待评估**，不进入实现                                                                                                                                                                                             |

证据口径维持：mock 配置/身份下分支行为 ≠ 完整客户端链；合法删除成功用例 null client；员工自有 agent 用例 = 所有权通过后 not found，≠ 员工完整删除流程已验收。
