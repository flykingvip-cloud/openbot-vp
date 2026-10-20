# OpenBot 协作 SDK 下一阶段决策备忘录

关联文档：

1. 原始实施方案归档版：[/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03](/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03)
2. 收尾报告：[/design/openbot-collaboration-sdk-closeout-2026-04-09](/design/openbot-collaboration-sdk-closeout-2026-04-09)
3. 收尾检查清单：[/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09](/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09)
4. 第二宿主验证报告：[/design/aegis-second-host-validation-report-2026-04-09](/design/aegis-second-host-validation-report-2026-04-09)

## 1. 当前判断

基于已完成的第二宿主验证，当前最稳妥的策略是：

1. 继续把 SDK 保留在 OpenBot 主仓 `packages/` 下演进。
2. 继续把 `Aegis` 作为第二宿主，而不是把 SDK 提前拆仓。
3. 进入“adapter 固化与第三宿主准备”阶段，而不是进入“发布与迁仓”阶段。

## 2. 已经成立的事实

当前已经有以下事实支撑：

1. `@openbot/collaboration-core` 可被仓库外宿主真实消费。
2. `@openbot/collaboration-runtime` 可被仓库外宿主真实消费。
3. `Aegis` 已通过真实包依赖消费这两个包。
4. `Aegis` 已形成正式宿主侧 adapter 边界：
   - `server/collaboration-aegis-adapter/`
5. `Aegis` 宿主定向测试通过。
6. `Aegis` 全仓 `build` 通过。
7. `Aegis` 已完成 review、decision、memory 三类深链路验证。

## 3. 现在不应该做什么

当前阶段不建议做：

1. 不建议把 SDK 从 OpenBot 主仓迁出。
2. 不建议把 SDK 立即拆成独立仓库。
3. 不建议立即对外发布或做 npm 公共发布策略。
4. 不建议切入 Aegis 主链路。
5. 不建议把 `@openbot/collaboration-openbot-adapter` 直接复用到 Aegis。

## 4. 现在最合理的下一阶段

下一阶段应明确收敛为：

`adapter 固化与第三宿主准备`

建议顺序：

1. `collaboration-aegis-adapter` 边界固化
2. 第三宿主选择与最小接入方案
3. 第三宿主最小验证

原因：

1. 第二宿主的关键对象链路已经完成一轮充分验证。
2. 当前更需要证明“可复制到更多宿主”，而不是继续只在 Aegis 内加验证。
3. 在没有第三宿主之前，不适合进入拆仓或公开发布讨论。

## 5. 进入拆仓/发布讨论的门槛

只有同时满足以下条件，才值得讨论拆仓或发布：

1. 至少两个宿主具备正式 adapter 边界。
2. 至少一个宿主完成更深对象链路验证。
3. `core`、`runtime`、宿主 adapter 边界基本冻结。
4. 发布、版本、兼容性策略已明确。

## 6. 当前 Go/No-Go

### Go

1. 继续推进 `Aegis` adapter 边界固化。
2. 继续保留 SDK 在主仓 `packages/` 下。
3. 开始准备第三宿主最小验证。

### No-Go

1. 不进入拆仓。
2. 不进入公开发布。
3. 不进入 Aegis 主链路切流。

## 7. 最终结论

当前最准确的决策是：

`继续做 adapter 稳定化与第三宿主准备，不做迁仓，不做发布，不做主链路切流。`
