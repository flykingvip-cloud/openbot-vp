# Phase D P8a — `no_valid_path` 仅报告

书面范围：`phase_d_p8a_report_only`（2026-09-25，切片 A）。这是发现目录下的薄注，不是第五份 Phase A 正文，也不改写 Phase C 的 NO-GO。

## 本切片做什么

`@openbot/constitutional-contracts` 增加默认关闭的缺口命名：

- 显式调用 `reportPathGap(..., { report: true })`，或调用方传入已打开的 `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT` 快照时，报告 `gapCode = no_valid_path`。
- 函数不读 `process.env`。旗标未打开时不命名、不执行。
- 合法 Path 集合为空。候选字符串也不会被选中。`selectedPath` 输出恒为 `null`。
- `executed` 恒为 false，`sideEffects` 恒为空。

P8a 的成功是**能把缺口叫出来**。`path=unset` 不是热路径收紧的成功门。

## 本切片不授权

- P8b：至少一条可被选中并执行的真实合法 Path
- P8c：影子决策与 legacy 对照，以及把它当作收紧门
- Gate / Path 热路径收紧；enforce 默认开
- `ORCHESTRATION_LIVE_INVOKE` / live invoke = true；Fabric 默认开
- 接入 gateway chat、tool invoke、ACP、AOR
- 涂装 Path：sessionKey、Lobster、AOR 图、Fabric 图、休眠编排都不是 Path
- Workflow ≠ Path；回执 ≠ 证明；安装 ≠ 授权。这三条不在本注里合并

## 回滚

不要调用 `reportPathGap`。包内没有热路径接线。删掉该模块即回到只有 §9.1 草稿契约的状态。
