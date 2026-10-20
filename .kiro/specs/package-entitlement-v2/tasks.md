# Tasks — Package Entitlement V2

## Agents

- cursor-agent · role: owner · scope: package-entitlement-v2 · paths: `src/gateway/consumption-forecast/**`, `ui/src/ui/views/cost-budget/**`, `ui/src/ui/ports/platform/pricing/**` · since: 2026-06-19

## P0 ✅ · P1 ✅

## P2 ✅

- [x] WMA 日序列预测（ledger → `dailyCostSeries` → `forecastCostMode: wma`）— cursor-agent
- [x] `consumption-forecast.platform-overview` 平台租户风险汇总 — cursor-agent
- [x] `consumption-forecast.budget-signals` 企业预算联动 RPC — cursor-agent
- [x] 平台 Economics Tab「容量与消耗预警」面板 — cursor-agent
- [x] 企业「预算与控制」Forecast 告警条 — cursor-agent
- [x] browser 测试：`economics-forecast-at-risk` + `forecast-budget-alerts`（51 项通过）— cursor-agent

## P3 ✅

- [x] Bot 增长趋势信号（`bot-growth.ts` → forecast botQuotaRisk / projectedBots）— cursor-agent
- [x] 容量建议 + decision 选项（`capacity-recommendations.ts` → `consumption-forecast.get.recommendations`）— cursor-agent
- [x] Credits token-weight 扣点（`resolveTokenWeightedCreditCost` → `recordCreditUsage`）— cursor-agent
- [x] 企业 forecast UI：Bot 增长 KPI + 容量建议面板 — cursor-agent
- [x] 平台 Economics 汇总增加 Bot 配额预警 — cursor-agent
