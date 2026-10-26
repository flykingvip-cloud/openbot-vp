# 目标代码基线证据（员工技能生命周期）

> 状态：证据索引。D0=A 已确认，仍不是实施许可。
> 日期：2026-10-10
> 配套方案：`docs/design/employee-skill-lifecycle-channel-optimization-plan-2026-10-10.md`
> **D0=A 已由产品负责人确认（2026-10-10）。** 系统边界是本私有仓 gateway 的员工技能资产 / employee-install / 投影 / runtime binding。
> 完整实施仍暂缓。下一步只允许垂直切片的设计与验收勾选，未实施产品改动。公开仓附录不适用 D0=A。

## 系统边界

| 项             | 值                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D0             | **A，已确认**（产品负责人，2026-10-10）                                                                                            |
| 证据所在仓库   | 私有仓 `https://github.com/upbeyond/openbot`                                                                                       |
| 不是           | 公开仓 `https://github.com/CopilotKit/OpenBot`                                                                                     |
| 调查基线       | `93ce9df262b3666d83f64c559a5e7801e6bde089`                                                                                         |
| 公开仓同名搜索 | `employee-install`、`skill-lifecycle-store`、`runtime-binding-sync`、`install-pack-to-robot` 为 0 命中。这是预期，不能用来否定下表 |
| 公开仓 PR #545 | 另一主题。与本私有仓 PR #545（员工端技能进化通道现状分析）编号撞车                                                                 |
| 生产部署版本   | **待核实**。不得把调查基线默认写成生产版本                                                                                         |

## 调查基线上的四个文件

1. https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/server-methods/employee-install.ts
2. https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/runtime-binding-sync.ts
3. https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/capability-packs/install-pack-to-robot.ts
4. https://github.com/upbeyond/openbot/blob/93ce9df262b3666d83f64c559a5e7801e6bde089/src/gateway/skill-lifecycle-store.ts

`employee-install.ts` 文件头称当前实现为 stub，用于支撑 UI 闭环。confirm 路径在运行时同步失败时仍可把请求标为 `installed`。这与优化方案 §1.4 的描述一致。

## 三套技能

本索引服务的方案只覆盖私有仓的「员工技能资产 + 文件系统 `SKILL.md`」。这一边界已按 D0=A 冻结。公开仓的应用内技能（`save_skill`、`skills.yaml`、Bot 授权）和 Intelligence Learning 技能是另外两套，验收标准不适用 D0=A。
