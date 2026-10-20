# ADR: OpenBot Credits v2

Date: 2026-06-23

Status: Accepted (design); runtime **off by default**

## Context

P0–P1 使用 **tier 固定扣点** + P3 桥接 `resolveTokenWeightedCreditCost`（相对 benchmark 0.25x–4x）。
Ledger、forecast、economics、reconciliation 均已依赖该语义。

专家方案要求长期支持：

- `tierWeight`
- `tokenCostFactor`
- `toolFactor`
- `runtimeFactor`

若一次性切换，将冲击所有下游投影。

## Decision

1. **Credits v2 为独立计价模式**，通过租户/企业级开关启用（建议键：`billing.creditsV2Enabled`，默认 `false`）。
2. **历史 ledger 不复算**；v2 仅作用于开关开启后的新 `recordCreditUsage` 路径。
3. **v1 路径保留**：`resolveCreditCostForTier` + 可选 token-weight 乘子（当前生产默认）。
4. **v2 公式（目标态）**：

```text
creditsCharged = ceil(
  tierWeight
  * tokenCostFactor(inputTokens, outputTokens, modelRef)
  * toolFactor(toolCallCount, toolClasses)
  * runtimeFactor(durationMs, retryCount)
)
```

各 factor 由 `resource-catalog` CreditWeight + model metadata 派生；缺省回退 tier 固定扣点。

5. **Forecast / reconciliation**：读 ledger `creditsCharged` 真值，不重复实现公式；开关切换日写入 `pricingEngine: "v1" | "v2"` 到 ledger 行。

## Migration

| 阶段      | 动作                                                                        |
| --------- | --------------------------------------------------------------------------- |
| P2 Wave 1 | 本 ADR + handoff；无运行时开关                                              |
| P2 Wave 2 | `resolveCommercialCreditCost()` 门面 + 开关 + 测试                          |
| P3+       | Economics 面板标注引擎版本；对账报告分列 v1/v2                              |
| P4        | Credits v2 `toolFactor` / `runtimeFactor` 实装 + 运行采集 + ledger 审计字段 |

## Consequences

- 可先交付 queue / forecast 而不阻塞 Credits v2 编码。
- 开关关闭时行为与 P1 完全一致（回归安全）。
- 开启 v2 后需监控 forecast 偏差并校准 benchmark。

## References

- `src/gateway/billing/credit-meter.ts`
- `src/gateway/billing/record-credit-usage.ts`
- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md` §G6
