# OpenBot 进化可感知层 — 冻结执行方案

| 字段     | 值                                                          |
| -------- | ----------------------------------------------------------- |
| 文档性质 | 开工与分阶段验收的唯一权威执行方案                          |
| 版本     | 2026-09-25-v1（冻结）                                       |
| 对照仓   | <https://github.com/upbeyond/openbot>                       |
| 协调     | 材料 Owner / 实施协调 bot                                   |
| 独立验收 | 进化可感知验收（每阶段完整测试验收，只出 PASS/FAIL/REVISE） |
| 上游依据 | 用户建议方案；独立验收 `REVISE`（2026-09-25）；可行性审计   |

> 入库说明（Phase 0，不改冻结正文）：本文是开工与分阶段验收的唯一权威。**Non-goals 见 §7**。
> Phase 0 只读类型与 §3 映射在 `packages/evolution-core/src/timeline.ts`，不是第二写库。
> 本阶段不接 Timeline 查询 API 生产路径、UI、Da Bai 直播报。
> 主张分级：`code-present`。禁止把本文或 Phase 0 类型说成 `runtime-enabled` 或 `production-proven`。

## 0. 一句话目标

在**不新建第二事实源**的前提下，把既有诊断/演进控制面投影成用户可追问的「进化时间线」，形成：诊断发现 → 进化改变 → 验证证明 → 时间线可见。

## 1. 硬约束（一票否决）

1. 履历 / 周报 / 待决 / 自动动作 / 观察队列 / 回滚史 = **只读投影**，写权威仍在既有 Proposal/Experiment/Application/Verification/Recheck/Ledger（及 Diagnosis Report）。
2. 用户可见句子必须能指回至少一个：`ledgerEventId` / `proposalId` / `applicationId` / `verificationId`；禁止模型根据聊天自由发明条目。
3. `EvolutionTarget.domain === "system"` 的变化**不得**进入「我学会了」叙事；数字人配置变化不得标成平台升级。
4. 自动 Apply 必须通过既有 `evaluateSurfaceAutonomy`（预算 / TTL / kill switch / 禁止扩 scope）；不得另立自治真相。
5. **不授权**：平行写库、第五执行状态机、跨域统一写权威、Meta-Schema/constitutional-contracts 产品化、真实 Path、Gate 收紧、`ORCHESTRATION_LIVE_INVOKE=true`、Fabric 默认开、影子旗生产启旗、扩大数字人自治默认权限。

## 2. Proposal v1 / v2 投影权威（关闭验收 C4）

| 规则           | 要求                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| 活写模型       | Diagnosis Proposal **v1** 仍为 `src/diagnosis` 活写面（直至另立迁移决策）                                |
| 统一控制面类型 | `@openbot/evolution-core` Proposal **v2** 为投影与新查询面的规范类型                                     |
| 投影           | v1 → v2 只读投影（evolution-core 已提供 read-only v1 projection 方向）；**禁止**投影写回 v1 制造第三真相 |
| 终态权威       | 用户可见「结果」以 **Ledger 事件 + Application/Verification 终态** 为准；Proposal 状态为过程态           |
| 标注           | 每条投影记录必须带 `proposalSchema: 1 \| 2`（或 legacy 标记）                                            |

## 3. Ledger / 对象 → 八字段映射（关闭验收 C2）

用户可见「一项变化」最少字段：

| 字段     | 来源（权威）                                                                                                                                     | 缺省 / fail-closed                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 变化对象 | `EvolutionLedgerEvent.target` + `surfaceId`；domain 映射展示名                                                                                   | 无 target → **不入履历**                                                                                                      |
| 变化前后 | `EvolutionApplication.targetVersionBefore/After`；必要时 candidate/surface 摘要                                                                  | 无版本对 → 摘要=`unavailable`，仍可入履历但标记 `completeness=partial`                                                        |
| 变化原因 | `proposal.sourceEvidenceRefs` + `sourceMechanismRef`；关联 Case/Finding id（若有）                                                               | 无证据 refs → `reason=unspecified`，**不得**由模型补故事                                                                      |
| 执行方式 | 由事件推演：`proposal.authorized`+autonomy 结果 → `automatic`；人工批准事件 → `user_confirmed` / `admin_approved`；平台发布 → `platform_release` | 无法推演 → `executionMode=unknown`，不得标 automatic                                                                          |
| 证据     | `evidenceRefs` + 关联 Report/Verification id                                                                                                     | 可空数组，但 verification 完成前结果不得标「已验证」                                                                          |
| 结果     | Verification outcome / Application status / rollback 事件                                                                                        | 映射：improved→已验证有效；neutral/inconclusive→观察中；regressed→无效；rolled_back→已回滚；仅 applied 无 verification→观察中 |
| 影响范围 | `confidentialityScope` + `tenantScope` → 本人/企业/平台                                                                                          | 缺省按 proposal.confidentialityScope                                                                                          |
| 可逆性   | 存在 rollback 能力与 `RollbackDrill`/`application.rolled_back` 引用                                                                              | `reversible=true` 仅当 surface 允许 rollback 且有 rollback 引用或策略                                                         |

**互斥分类（用户周报桶）：**

- `automatic`：预授权 auto 且 Ledger 无人工批准节点
- `user_approved`：存在用户/管理员批准事件后 apply
- `pending`：PENDING_APPROVAL / 待决定
- `observing`：已 apply 或 experiment held，verification 未终态或 outcome=neutral/inconclusive
- `rolled_back`：rollback.completed

一条变化**只能**落在一个主桶（pending 优先于 observing；rolled_back 优先于已验证）。

## 4. Da Bai 只读问答合同（关闭验收 C3）

| 项               | 合同                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 入口             | 只读查询工具/API（名称实施期确定）；**不**写 Ledger、**不** Apply                                                                |
| 支持意图（最低） | 本周学会了什么；相对上周差异；哪些自动；哪些经批准；哪些观察中；哪些回滚；平台本周升级了什么                                     |
| 输入             | `{ tenantScope, agentId?, window: {from,to}, intent }`                                                                           |
| 输出             | 结构化：`{ items: EvolutionTimelineItem[], bucketCounts, platformItems[], unresolvedIntents[] }`；每条 item 含 §3 字段 + 事实 id |
| 失败关闭         | 窗口无数据 → 空列表 + `completeness=empty`；权限不足 → deny；禁止回退成模型编造列表                                              |
| 叙述层           | 允许模板填充（固定句式）；**禁止**无 item id 的「学会了」句进入用户可见事实通道                                                  |

## 5. 阶段划分与成功标准

### Phase 0 — 合同冻结（本文档入库 + 类型别名就位）

**交付：**

- 本执行方案进入仓库设计文档路径（实施 PR 指定）
- `EvolutionTimelineItem`（或同等）只读类型草案与 §3 字段对齐
- 测试：映射表用例（至少 6 条：automatic / user_approved / pending / observing / rolled_back / system 分栏）

**成功标准（验收必过）：**

1. 独立验收对照本文 §1–§4 无矛盾
2. 映射用例测试全绿
3. 明确 Non-goals（§7）在 PR 中可见

**本阶段不做：** Timeline 查询 API 生产接线、UI、Da Bai 直播报。

### Phase P0 — Evolution Timeline 只读投影

**交付：** 从 Ledger(+Application/Verification/Proposal 投影) 生成 TimelineItem 列表的只读模块 + 单测；数字人 vs `system` 分栏强制。

**成功标准：**

1. 给定夹具 Ledger 序列，Timeline 条目数与桶分类与期望一致
2. 每条含可回溯 id；缺 target 条目不出现
3. `system` 域条目不进入「数字人学会了」集合
4. 无新写路径（静态/测试守卫可证）
5. 独立验收 PASS

### Phase P1 — Digest + Pending + Automatic + Da Bai 结构化问答

**交付：** 周窗口 Digest；Pending Decisions；Automatic Actions 只读视图；Da Bai 意图 → §4 查询绑定。

**成功标准：**

1. Digest 窗口内 100% 条目可回溯 id
2. 自动/批准/待决/观察/回滚互斥可测
3. 无 id 的叙述生成路径测试必须失败（守卫）
4. 独立验收 PASS

### Phase P2 — Observation Queue + 触发目录产品化 + 投递策略

**交付：** Observation Queue；五类触发与去重/冷却的可测目录；重大变化即时 / 普通进周报策略（复用 Da Bai delivery 模式，不重造写库）。

**成功标准：**

1. 观察中队列与 Timeline observing 桶一致
2. 触发去重/冷却有测试
3. 投递分级可测
4. 独立验收 PASS

## 6. 每阶段验收流程（强制）

1. 实施 PR/分支就绪，含本阶段成功标准的自动测试与证据说明。
2. 协调方唤醒 **进化可感知验收** bot，提交：执行方案路径、阶段 id、PR/分支、证据包路径。
3. 验收 bot 只出 `PASS` / `FAIL` / `REVISE` + 条款级证据；**不写代码**。
4. 仅 `PASS` 可进入下一阶段；`REVISE` 必须关闭条件后复验；`FAIL` 不得宣称阶段完成。

## 7. Non-goals

- 不合并 Proposal v1 存储到 v2（本方案只规定投影）
- 不改造普通聊天完成权 / Fabric 默认路径
- 不把诊断高频 Timeline 事件计为「进化次数」KPI
- 不做跨租户履历
- 不在本方案授权扩大 auto 默认面

## 8. 基线声明要求

任何阶段验收材料必须写明：

- `mainSha` 或 PR head SHA
- 主张分级：`code-present` / `runtime-enabled` / `production-proven`（缺省多为 code-present）
- 禁止把 code-present 说成 production-proven
