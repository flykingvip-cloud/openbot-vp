# Phase D P8b / P8c 与「再挂观察」站桩（文档；不启动）

> 书面范围：`phase_d_p8b_p8c_deferred`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-p8c-deferred.md`。  
> 日期：2026-09-25  
> 对照：执行方案 §9.3；`phase-d-p8a-no-valid-path.md`；`fc-04-next-soft-observe.md`；FC-08 系列  
> 本页只改 discovery 文档站桩。**整段** P8b/P8c 仍不批准启动；**Knife1**（选中-only）窄授权见 §4.2 / acceptance / start-order，不在本页正文实现。

## 1. 一句话

P8a（#59）只做到「缺口可命名」。**整段 P8b（含执行面）与 P8c（影子 vs legacy 对照）当前仍不批准启动。** 例外仅限已记名的 **Knife1 窄开工**（登记 + 默认关选中；`executed` 恒 false；见 §4.2）——不得把该例外读成整段 P8b/P8c GO。FC-04 已写明：stdio 桥与 AOR 为明确非刀；剩余软观察工作是缺口注，不是再挂第 4 刀。

## 2. P8 子阶段状态

| 子阶段 | 内容 | 状态 |
| --- | --- | --- |
| P8a | `no_valid_path` 仅报告，永不执行 | **已落地**（`code-present`；默认关） |
| P8b（整段） | ≥1 条可被选中**并执行**的真实合法 Path | **仍不批准整段启动**；轨迹空间闭合 / C5 全面 pass 仍 defer；**有界执行 opt-in** 另见 §4.2 三件套（≠ 整段 GO） |
| P8b Knife1 | 登记 + 默认关选中；`executed` 恒 false | **窄授权已开**（acceptance + start-order；`code-present`）——≠ 整段 P8b GO |
| P8c（整段） | 影子决策 vs legacy 对照；收紧另立 ADR | **仍不批准整段启动**；有界对照报告例外另见 §4.2；**Gate 收紧 ADR 仍 OUT** |

废止仍有效：「P8 成功 = path=unset」不得作为进入热路径收紧的门。

## 3. 「再挂一处 observe」

| 候选 | 裁决 |
| --- | --- |
| ACP stdio 桥 | **明确非刀**（FC-08）；不另挂软观察 |
| AOR（`packages/aor-core`） | **明确非刀**；不得 import 预检进核心；不得为观察开 Fabric |
| Cron / subagent | 回到热路径 ≠ 收成 explicit reuse-observe；**不发明新旗标**（FC-08 / FC-08d） |
| 其它旁路 | 仅当 FC-04 排序页与新的分刀书面范围同时存在时才可议；本页不授权 |

## 4. 若日后要启动 P8b：最低书面范围要素（现在不写开工令）

另立书面范围时至少写清：合法 Path 的定义与非涂装清单、选中/执行边界、`executed` 语义、与 C5 的关系、回滚旗标、Profile A/B 冲击、**不得**借 P8b 打开 enforce / Gate 收紧。本页**不是**该书面范围。

### 4.1 父书面范围（已 accepted-for-knife1-only；非整段开工）

`phase-d-p8b-written-scope.md`（书面范围 id：`phase_d_p8b_written_scope`）于 #71 以 **draft-into-repo** 入库；#71 验收 bot APPROVE **仅**覆盖草稿完整性，**不是**工程门接受。

记名工程门接受见 `phase-d-p8b-written-scope-acceptance.md`（2026-09-26 Asia/Shanghai）：**仅** `accepted-for-knife1-only`。

- **不**把本页「整段 P8b/P8c 不批准启动」改成整段启动；
- 父范围页**不**构成开工令；接受与开工仍为两段门（父范围 §6）；
- **不**授权 enforce / Gate / live invoke / P8c / Tier H / 重开 #58–#71。

整段 P8b（含执行）与 P8c 在上表仍为「不批准启动」，直至各自另有接受 + 开工令。

### 4.2 Knife1 窄授权（选中-only；≠ 整段「批准启动」）

在 §4.1 记名接受之后，Knife1 另具两件文书（不可由实现 PR 自声称）：

| 文书 | id / 落点 |
| --- | --- |
| 有界范围 | `phase-d-p8b-knife1-scope.md`（`phase_d_p8b_knife1_select_only`） |
| 开工令 | `phase-d-p8b-knife1-start-order.md`（`phase_d_p8b_knife1_start_order`） |

内容：合法 Path 登记 + 默认关选中 API；旗标 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`；`executed` 恒 false；主张 `code-present`。

**叙事区分（避免与「仍不批准启动」冲突）：**

- 「**整段** P8b / P8c **仍不批准启动**」——上表与 §5 继续成立；
- 「**Knife1 窄开工已授权**」——仅登记/选中、默认关、无执行、无热路径；**不得**写成整段 P8b GO。

另：

- **不**授权 enforce、Gate 收紧、live invoke、Fabric、P8c、Tier H、热路径接线（有界执行 opt-in **不**偷渡这些项）；
- Profile 冲击证据见 `phase-d-p8b-knife1-profile-impact.md`；
- 残差（轨迹空间扩展、**整段** P8c / Gate 收紧 ADR、C5 闭合、热路径接线）仍 defer，须另文开工令；有界 P8c 对照报告见上条三件套。
- Owner Path-Gate track（#101）下第一有界刀指针：`phase_d_path_gate_shadow_select_report`（shadow↔Knife1 **仅报告**桥；**不**扩大为整段 P8b 执行 / P8c / Gate 收紧）。
- Owner Path-Gate track 下第二有界刀指针：`phase_d_path_gate_shadow_select_diagnostics`（shadow↔Knife1 **诊断报告**充实；承接 #104；**不**扩大为整段 P8b 执行 / P8c / Gate 收紧 / 登记扩展）。
- **Owner 已授权有界执行 opt-in 三件套（2026-09-26）：** `phase_d_p8b_execute_opt_in` + acceptance + start-order — 仅授权「选中后 + 默认关 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`」包本地 `executed=true` 的后续实现；**不是**整段 P8b/P8c free-for-all；**整段**叙事（上表 / §5）继续成立。
- **Owner 已授权有界 P8c 影子↔legacy 对照报告三件套（2026-09-27）：** `phase_d_p8c_shadow_legacy_compare` + acceptance + start-order — 仅授权「SHADOW ∧ 默认关 `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` ∧ 调用方 legacy 快照」包本地 `shadowCompared=true` 报告对照的后续实现；**`readyToTighten` 仍恒 false**；**不是**整段 P8c 完成；**不是** Gate 收紧 ADR；**整段**叙事（上表 / §5）继续成立。


## 5. 明确不做（整段站桩；Knife1 例外不扩大）

- **整段**仍不实现可执行 Path 面；不涂装 sessionKey、Lobster、AOR 图、Fabric 图、休眠编排为 Path
- Knife1 仅允许登记集内 id 的**选中**（默认关）；涂装别名仍拒绝；**不**把选中写成执行
- 不讨论热路径 Gate 收紧；不改默认关观察旗标为默认开；不把 Knife1 旗标写成 enforce/live invoke
- 不改写 Phase C NO-GO；不把 Doc02「D 当前不批准」改成全局 GO
- 不得用 §4.2 把本页「整段不批准启动」读成已经整段启动

## 6. 验收提示

**PASS：** 整段 P8b/P8c 与再挂观察仍标为不启动 / 非刀；Knife1 若出现则必须同时有 acceptance + start-order，且叙事不得升格为整段 GO；P8a 不被升格成 C5 pass。  
**FAIL：** 把 Knife1 写成整段 P8b 已批准启动；或「下一刀 = 整段 P8b」而无新书面范围；或把 stdio/AOR 写成待接线刀。
