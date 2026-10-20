# Phase D §9.2 产品边界脚手架（不是独立产品发布）

> 记录日期：2026-09-25。
> 书面范围：`phase_d_product_split_scaffold`。
> 基线：`main` 已包含 Runtime 门面合并（PR #60，`5a1b3f00492f72d1805e8edbc57c9a647f799e33` 或其后）。
> 本页是发现目录下的薄注。它不改写 Phase A 正文，不改写 Phase C 的 freeze / acceptance / 决策树，也不把 Phase C 的独立 NO-GO 改成 GO。

## 计划原文与本次授权

执行方案 §9.2 原文（`docs/design/openbot-transformation-execution-plan-2026-09-23.md`）：

> Registry / Conformance / Runtime 拆独立产品：**推迟**，直到部署边界、所有权、生命周期被证明需要分离。

该推迟仍然有效。2026-09-25 的书面授权把切片顺序定为 A（P8a）→ B（Runtime 门面）→ C（本刀）。用户要求在 A、B 已合并之后，仍把 C 做成**脚手架 / 边界刀**，而不是完整产品发布。本注记录的就是这把刀。它不把 §9.2 改写成「已经批准拆分」。

## 三个提议中的产品

边界只存在于本仓库的私有 workspace 包里。它们重新导出 `@openbot/constitutional-contracts` 已有表面，不复制 schema，不另起一套运行时。

| 提议产品    | 包                                    | 指向的既有表面                             |
| ----------- | ------------------------------------- | ------------------------------------------ |
| Registry    | `@openbot/constitutional-registry`    | 适配器与只读账本视图词汇。源账 id 保持分开 |
| Conformance | `@openbot/constitutional-conformance` | shadow 评估器与 P8a `no_valid_path` 报告   |
| Runtime     | `@openbot/constitutional-runtime`     | 默认关闭的 runtime façade shadow           |

`pnpm-workspace.yaml` 里的 `packages/*` 会识别这三个目录。各包只提供 `typecheck` / `test` / `build`。没有新的部署作业，没有发布流水线。

## 真正拆分仍要的证明（本刀不主张已经完成）

下面三项都还没有被证明。本脚手架不声称它们已经成立：

1. **部署边界**：三个名字还没有各自的部署单元、运行进程或发布物。
2. **所有权**：没有新的产品 Owner，也没有把写权威从现有源账挪走。
3. **生命周期**：没有独立的发布列车、版本节奏或下线流程。

在这三项被单独证明之前，§9.2 的推迟继续有效。

## 明确不做（OUT）

出现任何一条，都不属于本刀：

- 独立仓库、独立发布列车、新的生产部署流水线，或声称这些产品可以独立交付
- 声称部署边界 / 所有权 / 生命周期的证明已经完成
- P8b / P8c；Path 涂装；Gate / Path 热路径收紧；enforce 默认打开
- `ORCHESTRATION_LIVE_INVOKE` / live invoke = true；Fabric 默认打开
- 第五套执行状态机；新的生产账本库；跨域写权威
- Profile A/B 合并；Registry **物理**并账；回执升成证明；插件已安装写成已授权
- 改写 Phase C freeze / 决策文档，或声称 Phase C 为 GO
- 把这些包 import 进 gateway chat、tool invoke、ACP、AOR、dispatch、gateway-hook
- 抬升 `PROTOCOL_VERSION`；替换 Pi；Bridge MVP
- 把 Runtime 门面从默认关闭的 shadow 改成 enforce

## 回滚

删掉这三个包目录和本注即可。`@openbot/constitutional-contracts` 与已合并的 Runtime 门面保持原样，默认仍然关闭。热路径没有引用这些包名。
