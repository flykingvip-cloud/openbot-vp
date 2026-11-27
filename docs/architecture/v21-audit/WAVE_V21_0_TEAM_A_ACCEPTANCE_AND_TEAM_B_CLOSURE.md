# Wave-V21-0 团队 A 独立验收结论与团队 B 收口推进指令

> **验收总裁定**：  
> - **团队 A（`knowledge-sdk` @ `9d25ea96b75b5ab528a2d2670b5419d9a217e39e`）**：**团队 A 侧 Wave-V21-0 独立验收无条件通过（`TEAM_A_WAVE_V21_0_CLEAN_ACCEPT`）**，正式转入只读待命态；  
> - **整体 Wave-V21-0 与团队 B（`openbot-vp`）**：**进行中，待团队 B 闭环（`WAVE_V21_0_IN_PROGRESS_AWAITING_TEAM_B`）**；认可团队 B 对 `9d25ea96` 的独立核对与严守红线纪律，授权团队 B 按官方 10 字段重出 Stream A/B 报告并推进 Stream C/D、VB-1、VB-3 至 VB-5 收口。  
> **红线声明**：`wave_v21_1_unlocked: false` · `owner_v21_baseline_signed: false` · `stream_e_joint_frozen: false` · `schema_v7_ddl_authorized: false` · `final_alignment_frozen: false` · `prod_shadow_migration_cutover_authorized: false` · `formal_t01_t27: NOT_RUN_NOT_ACCEPTED`。  
> **验收日期**：2026 年 11 月 26 日

---

## 一、独立验收总裁定与双团队态势结论

独立验收团队已直接拉取远端 `flykingvip-cloud/knowledge-sdk` 仓库并切换至 `9d25ea96b75b5ab528a2d2670b5419d9a217e39e`，现场执行 Git 谱系与保护分支核查、GitHub Actions API 作业查验、本地 `verify_v21_boundaries.py`、`verify_frozen.py`、`contracts/v21-reuse-v1/validate.py` 与 25 项沙箱闭环单测复算，并逐项复核了团队 A 交接报告及团队 B 的独立核对回执，正式出具以下四项总裁定：

1. **团队 A 侧 `VA-1` 至 `VA-5` 独立验收通过（`TEAM_A_WAVE_V21_0_CLEAN_ACCEPT`）**：
   - 提交 `9d25ea96b75b5ab528a2d2670b5419d9a217e39e` 严格延续父提交 `02bf58738986bc7e22dfeafcb2911970d14f2588`，未改写历史，且相对 `02bf5873` **仅修改两份文档**（`docs/acceptance/v21-wave0/V21_WAVE0_TEAM_A_HANDOFF_REPORT.md` 与 `docs/acceptance/v21-wave0/SOURCE_GAPS.md`），契约包与清单哈希保持逐字节不变。
   - 团队 A 完整落地了 5 组跨系统契约包（18 文件、51 组黄金向量）、零生产 DDL 沙箱闭环原型（25/25 项通过）、自动化零重复守门脚本 `scripts/verify_v21_boundaries.py` 与独立 CI 作业 `v21-wave0-boundaries`，且 **精准切换至 v2.1 文档第 7 节官方 10 字段**（显式锚定源文档 SHA-256 `c5196ff1d050ac6477cc064390a708a4d10121cf7fe300bb24764a87a2a5b1c2`），未越权代写 Stream B/C 或 124 项委派清单，未自签正式验收。
2. **团队 B 独立交叉核对确认准确无误**：
   - 团队 B 回执中核对的 commit SHA（`9d25ea96`）、父提交（`02bf5873`）、双文档 diff、契约无差异、`v21-contract-manifest.json` SHA-256（`6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`）及 Stream D/E 口径区分，与独立验收实测结果 **100% 完全一致**。
   - 高度认可团队 B 主动发现官方 10 字段对齐要求并决定按官方字段重出 Stream A/B 报告、绝不借草稿混水摸鱼的工程纪律。
3. **整体 Wave-V21-0 尚未结项，Wave-V21-1 保持锁定**：
   - `contracts/v21-reuse-v1/status.json` 正确维持 `DRAFT_WAVE_V21_0_NOT_FROZEN`，OpenBot 侧 CI 守门、跨语言 TS 复算回执、Stream A–D 官方字段穿透报告与 Track 1 Space Gate 3 收口均属团队 B 待完成残余项。在团队 B 递交 `V21_WAVE0_TEAM_B_HANDOFF_REPORT.md` 并通过独立复核及 Owner 签认前，**绝不解锁 Wave-V21-1**。
4. **团队 A 立即进入只读待命态**：
   - 自本验收结论生效起，团队 A **冻结 `feat/v21-wave0-contracts-and-adapters@9d25ea96`**，不再主动追加新特性或改动 `contracts/v21-reuse-v1/`；仅在团队 B 跨语言复算登记 `V21-DELTA-*` 需联合修补时按指令响应。

---

## 二、团队 A（9d25ea96）独立密码学与实测复算证据

以下全部证据均由独立验收团队于本地只读拉仓与 GitHub Actions API 现场重跑取得，不依赖提交方自报日志：

| 核验维度 | 独立核查命令 / API 锚点 | 现场复算实测结果 | 核验结论 |
|---|---|---|---|
| **提交谱系与增量范围** | `git rev-parse 9d25ea96^` 与 `git diff --stat 02bf587..9d25ea96` | 父提交精确为 `02bf58738986bc7e22dfeafcb2911970d14f2588`；仅改动 2 个文档文件（`V21_WAVE0_TEAM_A_HANDOFF_REPORT.md`、`SOURCE_GAPS.md`，`+166/-23`），未改写历史 | **EXACT MATCH** |
| **生产源码与依赖零污染** | `git diff --stat 9940818b..9d25ea96 -- src/ pyproject.toml` | **0 文件改动，0 字节差异**；`pyproject.toml` 核心 `dependencies = []` 保持不变，生产 `migrations/`（Schema v6）与 `/v2/spaces` 逐字节无改动，`/v3/*` 未挂载生产 HTTP | **PASS** |
| **保护分支完整性** | `git rev-parse origin/main origin/feat/align-wave1p5-m1-readiness origin/feat/align-wave2-m2-min-slice origin/feat/space-alignment-v1-design-proto` | `main = b953c992...`、`wave1p5 = 0d2f172c...`、`wave2 = 9940818b...`、`space-proto = 4bed2a1c...` 全部原封不动 | **PASS** |
| **契约清单 SHA-256 复算** | `sha256sum contracts/v21-reuse-v1/v21-contract-manifest.json` 与 `python3 contracts/v21-reuse-v1/validate.py` | 18 文件清单 SHA-256 = `6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`（与团队 B 复算零偏差）；51 组黄金向量（18 正例 / 33 反例 / 0 失败），返回 `DRAFT_CONTRACTS_VALIDATED_NOT_FORMAL_ACCEPTANCE` | **EXACT MATCH** |
| **自动化边界与 M1 冻结守门** | `python3 scripts/verify_v21_boundaries.py` 与 `python3 docs/acceptance/v2.2-align-wave2/verify_frozen.py` | 双脚本全部 `passed: true`：709 个基线文件逐字节核验 `baseline_file_drift = 0`，Schema 锁定 `6`，M1 28 项契约与 45 份架构文件 `byte_diff = 0`，12 项禁止重复能力扫描通过，Python 3.9 AST 校验 11 文件通过 | **PASS** |
| **零 DDL 沙箱闭环单测** | `PYTHONPATH=src:. python3 -m unittest sandbox/v21_reuse_v1/sandbox_cases.py` | **25/25 项全绿，0 skipped**：`ResourceCapabilityCases`（5）、`IKCCases`（5）、`KSGLiteCases`（5）、`SemanticReferenceCases`（2）、`RevocationCases`（4）、`DualViewCases`（3）、`SourceShapeCases`（1） | **PASS** |
| **GitHub Actions 远端 CI** | Run `45912934551`（head `9d25ea96b7`，branch `feat/v21-wave0-contracts-and-adapters`） | **`37/37` 作业全部 `completed / success`**（含新增独立作业 `v21-wave0-boundaries` 绿灯，前序 `02bf587389` Run `45908411136` 亦全绿） | **PASS** |
| **官方 10 字段与 Stream E 规范度** | 逐段核读 `V21_WAVE0_TEAM_A_HANDOFF_REPORT.md` 与 `SOURCE_GAPS.md` | Stream D（SDK 侧）完整使用 v2.1 第 7 节官方 10 字段并正式废止旧英文临时列名；Stream E 按契约清单 + 兼容性测试矩阵呈现并诚实标注 OpenBot 侧 CI 为 Team B 残余；Explicit Non-Claims 完整合规 | **PASS** |

---

## 三、L1–L5 门禁当前联合态势表

| 门禁编号 | 门禁要求 | 团队 A 侧状态（`9d25ea96`） | 团队 B 侧状态（`openbot-vp`） | 联合态势 |
|---|---|---|---|---|
| **L1 · 边界与零重复守门** | 纯标准库核心、零 12 项重复、Schema v6、Semantic Object 零双写 | **MET**（`verify_v21_boundaries.py` + CI `37/37` 全绿） | **IN PROGRESS**（`main@58287aa4` 保持清洁，待提交 `VB-3` 只读/守卫适配与 CI 守门） | 待团队 B 闭环 |
| **L2 · 跨语言契约 SHA-256 互认** | `contracts/v21-reuse-v1/` 双向哈希一致 + Py/TS 51 向量全绿 | **MET**（`6da567e0...` 已固化，Py + Node/TS CI 均绿） | **PARTIAL**（清单 SHA-256 已交叉核对一致，待落盘 `VB-4` TS 兼容测试与 OpenBot 侧 CI 守门及 `V21-DELTA-*` 登记） | 待团队 B 闭环 |
| **L3 · Track 1 Space Gate 3 收口** | 30 项 `partial` 穿透归零 + `PRE-02` 处置单 + M2-B/B3 零退化 | **N/A**（`9940818b` 与 `4bed2a1c` 零修改） | **NOT_MET**（待完成 6 项 P0 写路径 + 共享 Bundle 过滤器穿透与 `PRE-02` 建议单） | 待团队 B 闭环 |
| **L4 · 安全与治理红线实测** | Mode A/B/C Fail-Closed、双视图脱敏、四通道撤权、高风险禁 `partial_available`、`knowledge-object-only` 锁定 | **MET**（沙箱 25/25 + 51 向量实测通过） | **IN PROGRESS**（待交付 `ControlledDataBridgeGuard` 单测与 `knowledge-object-only` 不变证明） | 待团队 B 闭环 |
| **L5 · Stream A–E 穿透完整度** | Stream A–D 全部按官方 10 字段闭环（含 B/C/D 外加项）；Stream E 契约清单 + 兼容矩阵双仓入账 | **MET（SDK 侧）**（Stream D 官方 10 字段 + Stream E SDK 侧契约矩阵与 `SOURCE_GAPS.md` 已闭环） | **IN PROGRESS**（正按官方 10 字段重出 Stream A/B 报告，后续推进 Stream C/D） | 待团队 B 闭环 |

---

## 四、团队 A 只读待命规范与团队 B 收口执行指令

### 4.1 致团队 A（knowledge-sdk）：转入只读待命（Standby）

- **冻结交付锚点**：保持 `feat/v21-wave0-contracts-and-adapters` 停留在已验收节点 **`9d25ea96b75b5ab528a2d2670b5419d9a217e39e`**（契约清单 SHA-256 **`6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`**），在团队 B 完成 `VB-4` 跨语言复算前**禁止擅自改动契约文件或追加未授权代码**。
- **唯一触发动作**：若团队 B 在 `VB-4` 中登记 `V21-DELTA-*` 契约差异项，待双团队同步裁决后按定向 Delta 指令做最小修补；在 Wave-V21-0 联合结项并获 Owner 书面签认前，**严禁提前开启 Wave-V21-1 或任何 Schema v7/v8/v9 生产迁移**。

### 4.2 致团队 B（openbot-vp）：按既定顺序推进 Wave-V21-0 全量收口

继续严守 `main@58287aa4` 不变、零 PR、零 16 份未归属草稿混入、不触碰 `knowledge-sdk` 与 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED=false` 红线，按以下四步推进闭环：

1. **步骤 1｜按官方 10 字段重出 Stream A 与 Stream B 审计报告（锚定 `c5196ff1...` 第 7 节）**：
   - 严格采用 v2.1 规范第 7 节官方 10 字段（`文件路径与代码入口`、`核心对象与数据表/存储文件`、`API / RPC / Event 契约`、`当前权威写主`、`已实现且稳定功能`、`仅有接口/原型/默认关闭/Fail-Closed 功能`、`已完成的测试证据`、`未覆盖的测试场景`、`与另一仓库的重复点`、`保留/扩展/迁移/废弃裁定`），**禁止使用旧英文临时列名**。
   - **Stream A 必答**：冻结可复用 LLM / Runtime / Tool / Workflow 清单，给出基于 `src/memory/embeddings-*.ts` 封装公开受控 `models.embed` 代理的最小改造面，确认无内置神经 Reranker。
   - **Stream B 必答外加项**：沿真实调用链逐连接器甄别 **生产可用真实驱动 vs Demo/Mock**（Postgres / MySQL / HTTP REST / Notion / 用友 T+ / SAP / Salesforce），锁定 `openbot-enterprise-semantic-objects.json` 唯一写主，明确维持 `data-capability-tool.ts:99-108` `knowledge-object-only` Fail-Closed 不变并列出未来解锁 Mode A/B/C 的安全前置门禁。
2. **步骤 2｜按官方 10 字段完成 Stream C 与 Stream D 审计报告**：
   - **Stream C 必答外加项**：实码核清 `packages/aor-core` Stage 4（持久化 Bandit、Python SDK、Graph Backend、Control Plane）真实测试状态，明确 `VerifiableEvaluator` 与企业级 LLM-as-Judge / 离线数据集平台的缺口，并给出 `conversation-evaluation` 演进至 `AIExecutionTrace` 的注入点。
   - **Stream D 必答外加项**：核查 `packages/cogniweave-sdk` `/v1/*` 14 组路由的租户隔离与撤权失效缺口，并交付 **《OpenBot 本地知识模块向 SDK 委派收口清单》（与 Space Pre-v7 B2-2 124 项实审完全对齐）**。
3. **步骤 3｜完成 `VB-1`（Space Gate 3 穿透）、`VB-3`（默认关闭适配单测）与 `VB-4`（TS 复算与 OpenBot CI 守门）**：
   - 穿透 6 项 P0 写/调用链（`E010 / E029 / E037 / E068 / E070 / E080`）与 `loadKnowledgeSourceBundle / loadEnterpriseStoreBundle` 共享过滤器专节，推动 30 项 `partial` 归零，交付 `PRE-02` 处置建议单；
   - 在隔离分支 `codex/openbot/v21-wave0-audit-and-adapters` 落地默认关闭的 `SemanticObjectCatalogReadAdapter`、`ControlledDataBridgeGuard`、`AIExecutionTraceHeaderPropagator` 单测；
   - 基于团队 A `9d25ea96`（清单 SHA-256 `6da567e0...`）完成 OpenBot 侧 TS 51 向量兼容校验与 CI 守门接入，如有字段分歧统一登记 `V21-DELTA-*`。
4. **步骤 4｜提交 `V21_WAVE0_TEAM_B_HANDOFF_REPORT.md` 触发 Wave-V21-0 联合终验**：
   - 附分支 SHA、既有 M2-B / B3 / vault-sync 零退化回归汇总、新增 Vitest 与跨语言复算结果及 Stream A–D 官方字段终稿，交回本端执行 Wave-V21-0 最终独立复核（**严禁自签 Exit Gate 3/4 或自启 Wave-V21-1**）。

---

## 五、可直接转发双团队的同步指令摘要

### 5.1 转发给团队 A（knowledge-sdk）

```text
【独立验收结论｜团队 A（knowledge-sdk）｜Wave-V21-0】
1. 验收裁定：团队 A 侧 Wave-V21-0（VA-1 至 VA-5，提交 9d25ea96b75b5ab528a2d2670b5419d9a217e39e，父提交 02bf5873）独立验收无条件通过（TEAM_A_WAVE_V21_0_CLEAN_ACCEPT）。
2. 独立复算确认：Run 45912934551 37/37 全绿（含 v21-wave0-boundaries）；verify_v21_boundaries.py 与 verify_frozen.py 零漂移；contracts/v21-reuse-v1 51 向量全过且清单 SHA-256 精确为 6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d；沙箱 25/25 通过；src/ 与 pyproject.toml 零改动；官方 10 字段与 Stream E 规范完全达标。
3. 下一步动作：请立即冻结 9d25ea96 进入只读待命态（Standby），暂不改动契约树，不提前开启 Wave-V21-1；待团队 B 完成 VB-1 至 VB-5 与跨语言复算后再联合收口。
```

### 5.2 转发给团队 B（openbot-vp）

```text
【检查点确认与收口指令｜团队 B（openbot-vp）｜Wave-V21-0】
1. 核对确认：已独立复算确认团队 A 9d25ea96（父提交 02bf5873）全部交付物与清单 SHA-256（6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d）完全属实，团队 A 侧已验收通过并转入只读待命态；整体 Wave-V21-0 仍待团队 B 闭环，Wave-V21-1 保持锁定。
2. 请按既定顺序全速推进收口（严守 main@58287aa4 不变、零 PR、OPENBOT_KNOWLEDGE_SDK_V2_ENABLED=false）：
   - 按 v2.1 文档（SHA-256 c5196ff1...）第 7 节官方 10 字段重出 Stream A/B 报告（Stream B 必含逐连接器真实驱动 vs Demo/Mock 与解锁 knowledge-object-only 安全门禁）；
   - 按官方 10 字段完成 Stream C（必含 AOR Stage 4 真实测试状态与 LLM-as-Judge 缺口）与 Stream D（必含本地 124 项知识入口向 SDK 委派收口清单）；
   - 推进 VB-1（6 项 P0 写路径 + 共享 Bundle 过滤器穿透归零 30 项 partial + PRE-02 建议单）、VB-3（只读 SemanticObject / Mode A/B/C 守卫 / Trace 透传单测）与 VB-4（对接 9d25ea96 51 向量 TS 校验、OpenBot CI 守门及 V21-DELTA-* 登记）；
   - 交付 V21_WAVE0_TEAM_B_HANDOFF_REPORT.md 与零退化回归证明，提交独立终验。
```

---

## 六、现行冻结与门禁状态账本

```yaml
verdict_id: "WAVE_V21_0_TEAM_A_ACCEPTANCE_AND_TEAM_B_CLOSURE"
team_a_status: "TEAM_A_WAVE_V21_0_CLEAN_ACCEPT"
team_a_standby_mode: true
team_a_verified_sha: "9d25ea96b75b5ab528a2d2670b5419d9a217e39e"
team_a_parent_sha: "02bf58738986bc7e22dfeafcb2911970d14f2588"
team_a_ci_run_id: 45912934551
team_a_ci_jobs: "37/37 success"
team_a_manifest_sha256: "6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d"
team_a_vectors_passed: "51/51 (18 positive / 33 negative)"
team_a_sandbox_cases_passed: "25/25"
overall_wave_v21_0_status: "WAVE_V21_0_IN_PROGRESS_AWAITING_TEAM_B"
team_b_next_steps:
  - "Re-issue Stream A/B with official section-7 10 fields"
  - "Complete Stream C/D with official 10 fields and extras (incl. 124-item delegation list)"
  - "Close VB-1 (30 partial -> code-verified + PRE-02), VB-3 (adapters tests), VB-4 (TS/CI gating)"
  - "Submit V21_WAVE0_TEAM_B_HANDOFF_REPORT.md for final joint acceptance"
frozen_guardrails:
  wave_v21_1_unlocked: false
  owner_v21_baseline_signed: false
  stream_e_joint_frozen: false
  schema_v6_frozen: true
  schema_v7_ddl_authorized: false
  final_alignment_frozen: false
  prod_shadow_migration_cutover_authorized: false
  space_gate7_status: "MET"
  space_gate3_status: "NOT_MET"
  space_gate4_status: "NOT_MET"
```
