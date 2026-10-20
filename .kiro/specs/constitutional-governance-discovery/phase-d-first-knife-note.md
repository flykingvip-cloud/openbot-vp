# Phase D 第一刀记录（书面范围，不改 Phase C）

> 记录日期：2026-09-25。
> 书面范围：`phase_d_first_knife_contracts`。
> 本页只说明有界第一刀已经按该书面范围开工。它不改写 Phase A 正文，不改写 Phase C 的 freeze / acceptance / 决策树，也不把 Phase C 的独立 NO-GO 改成 GO。

Phase C 仍是独立 NO-GO。执行方案 §9 里「D 当前不批准」只被这一份书面范围覆盖到 `packages/constitutional-contracts` 这一刀，其余不批准项继续有效。

这一刀的代码在 `packages/constitutional-contracts`：

- Identity / Contract / Evidence 草稿 schema
- 注入式只读适配器（不物理并账；安装 ≠ 授权）
- 宪法账本视图（不写穿源账）
- shadow 符合性报告（默认不 enforce 生产聊天）

没有接线到 gateway chat、tool invoke、ACP、AOR。`ORCHESTRATION_LIVE_INVOKE`、Fabric 默认开关、Path / Gate 收紧都不在这刀里改变。

回滚：包可独立停止引用。`OPENBOT_CONSTITUTIONAL_SHADOW` 默认关闭，且本刀没有安装读取它的热路径 hook。
