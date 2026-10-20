# Phase D P8b Knife1 — 合法 Path 登记 + 选中（仅 code-present；不开执行）

> 书面范围 id：`phase_d_p8b_knife1_select_only`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-knife1-scope.md`。  
> 日期：2026-09-26（Asia/Shanghai）  
> 基线：`main` @ `524f31e4238d50e8c68b892fca0388b5e7f69de5`（含 #71 `ad05d733` 及 #72/#73）或其后。  
> 上级书面范围：`phase-d-p8b-written-scope.md`（`phase_d_p8b_written_scope`；`accepted-for-knife1-only`）。  
> 记名接受：`phase-d-p8b-written-scope-acceptance.md`。开工令：`phase-d-p8b-knife1-start-order.md`。  
> 对照：`phase-d-p8a-no-valid-path.md`；`phase-d-p8b-p8c-deferred.md`；ADR-1；`phase-d-p8b-knife1-profile-impact.md`  
> **本页是 Knife1 有界范围说明**（落点 / IN / OUT / 成功标准）。正式开工令见 `phase-d-p8b-knife1-start-order.md`。不是整段 P8b 完成，不是整段 Phase D GO，不翻 Phase C NO-GO。

## 1. 一句话

在 C **NO-GO**、整段 D **不批准**仍站桩的前提下，本刀在 `@openbot/constitutional-contracts` 落地 **≥1 条可指认、可版本化的合法 Path**，并提供**默认关**的显式选中 API。主张天花板停在 **`code-present`**。`executed` 在本刀**恒为 false**。不得 enforce / Gate 收紧 / live invoke / 热路径接线。

## 2. 与上级书面范围的关系

| 项 | 状态 |
| --- | --- |
| `phase_d_p8b_written_scope` | #71 draft-into-repo 后，经 `phase-d-p8b-written-scope-acceptance.md` 记名为 **`accepted-for-knife1-only`**；本刀继承其 Path 定义 / 非涂装 / `executed` / 回滚 / Profile / OUT |
| 接受门 | **不得**由本页或实现 PR 自声称。权威：Owner via network-of-network，依据 2026-09-26「按顺序实施前3项」item 1；详见 acceptance 记录。#71 验收 bot APPROVE 仅为 draft-only |
| 开工令 | `phase-d-p8b-knife1-start-order.md`（基线 SHA、落点、旗标、回滚、测试）。本页是范围说明，与开工令配套；**不等于**整段 P8b / 整段 D GO |
| 覆盖 | 仅 Knife1（登记 + 选中）；执行副作用、P8c、热路径均 **OUT** |

## 3. 本刀做什么（IN）

1. **合法 Path 定义（代码）**：登记恰好 **1** 条轨迹 `constitutional.declared.v1`（version=1），语义为「被显式选中后才可进入后续（未授权）执行边界的宪法合法轨迹」；本刀不赋予执行权。
2. **非涂装**：选中 API 丢弃并拒绝把 sessionKey / Lobster / AOR 图 / Fabric 图 / 休眠编排 / workflowRef / `PathKind` / ExecutionPlan / 回执 当作 Path。
3. **选中边界**：仅当候选 ∈ 合法集合 **且** 旗标允许时，`selectedPath` 可为该 id；集合外 → 保持缺口报告语义（不静默映射）。
4. **`executed` 语义（本刀收紧）**：恒 `false`；`sideEffects` 恒空。执行副作用留待后续有界刀 + 另文开工令。
5. **回滚旗标**：`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`（独立、默认关）。关或未 opt-in → 有效合法集视为空、`selectedPath=null`、`executed=false`（回到 P8a 行为面）。函数**不**读 `process.env`，只接受调用方快照或 `select: true`。
6. **Profile 冲击证据**：见同目录 `phase-d-p8b-knife1-profile-impact.md`（书面必须写；不合并 A/B）。

### 3.1 API 落点

| 符号 | 文件 |
| --- | --- |
| `DECLARED_LEGAL_PATHS` / `CONSTITUTIONAL_DECLARED_PATH_V1` | `packages/constitutional-contracts/src/legal-path/registry.ts` |
| `selectLegalPath` / `isLegalPathSelectEnabled` / `isDeclaredLegalPath` | `packages/constitutional-contracts/src/legal-path/select.ts` |
| 单测 | `packages/constitutional-contracts/src/legal-path/select.test.ts` |
| 导出 | `packages/constitutional-contracts/src/index.ts` |
| 包 README 短节 | `packages/constitutional-contracts/README.md` |

P8a 的 `LEGAL_CONSTITUTIONAL_PATHS = []` 与 `reportPathGap` **保持不动**（报告-only 切片不升格）。

## 4. 明确不授权（OUT）

- **enforce**；热路径 **Gate / Path 收紧**
- `ORCHESTRATION_LIVE_INVOKE` / **live invoke** = true
- Fabric default-on；为观察打开 Fabric
- **`executed=true`** 或任何副作用执行面（本刀禁止）
- **P8c**；**Tier H**
- 重开有界 D **#58–#71** 为「下一刀」清单项
- 整段 Phase D GO；静默把 Phase C **NO-GO** 翻成 GO
- 新 soft-observe；ACP stdio 软观察；AOR core 预检 import；Cron/subagent 新观察旗标
- 宣称 C10 pass / C5 全面 pass / 产品已拆 / `runtime-enabled` / `production-proven`
- 把本模块 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径

## 5. 主张等级

- 天花板：**`code-present`**
- 禁止主张：P8b 已完成、Path 已在热路径、C5 全面 pass、整段 D GO

## 6. 成功标准（本刀）

| 标准 | 判定 |
| --- | --- |
| ≥1 合法 Path | 代码中可指认、可版本化的 `constitutional.declared.v1` |
| 选中 | 旗标开 + 候选命中 → `selectedPath` 非空；否则 null |
| 非涂装 | 单测覆盖拒绝 sessionKey / Lobster / AOR / Fabric / orchestration / workflow |
| `executed` | 恒 false；无副作用 |
| 回滚 | 旗标关 → 行为面回到 P8a（有效集空 / 不选中 / 不执行） |
| Profile | 冲击证据页存在且禁止合并 A/B |
| 无热路径 | 无 gateway/ACP/AOR 接线 |
| 主张 | 仅 code-present；OUT 清单未偷渡 |

**PASS：** 上表满足。  
**FAIL：** 打开 enforce/live invoke、`executed=true`、热路径接线、涂装 Path、或把本刀写成整段 D GO / C5 pass。

## 7. 回滚

- 不要调用 `selectLegalPath`，或不要传入 `select: true` / 打开的旗标快照。
- 删除 `src/legal-path/` 与本注 + Profile 冲击页即回到仅有 P8a 报告的状态。
- 无热路径残留调用。

## 8. 验收交接

独立验收 bot：按本页 §6 + 上级 OUT + acceptance 记录宽度 + start-order + `phase-c-83-product-confirmation.md` 非授权清单审阅。  
Material Owner **不**自合并；**不**在本 PR 内直接呼叫验收 bot（由父代理提交复审）。

## 9. 后续 P8b 残差（本刀不做）

- 执行边界内的 opt-in `executed=true` — **另文三件套：** `phase_d_p8b_execute_opt_in`（有界；默认关 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`；≠ 整段 P8b GO）
- 合法轨迹空间扩展（>1）与旁路表闭合
- P8c 影子对照；Gate 收紧 ADR
- C5 转 pass 所需的完整闭合（本刀至多局部「可选中」证据）
- **报告面桥接（另文；Owner Path-Gate track 下）：** `phase_d_path_gate_shadow_select_report` — shadow↔本刀 select 仅报告；**仍不**执行 / Gate 收紧（见 `phase-d-path-gate-shadow-select-report-scope.md`）
