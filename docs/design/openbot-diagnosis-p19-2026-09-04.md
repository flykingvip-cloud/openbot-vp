# OpenBot Diagnosis Platform — P19 #945 重评（CLOSED，不是合入）

Date: 2026-09-04

Status: **No-Go。用户称「945已合入」，但 #945 是 CLOSED / superseded，`mergeCommit=null`。seq 61 经 #948，seq 62 经 #950。LIVE 已等于 ledger seq 62 / `81aafe1e`。RELEASE_RECORD Latest 仍停在 seq 61 / `e59aede250`。LIVE 侧 provenance 缺失且 `do_not_mint`。当前树 SLO completeness=`empty`，reader/audit/quota fail-closed。不得输出 Ready for independent approval。**

Task: `openbot-diagnosis-platform`

Related: [P19 行动单](/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04) · [P18 行动单（已过期）](/design/openbot-diagnosis-p18-delivery-owner-actions-2026-09-04) · #945 <https://github.com/gmood2008/openbot/pull/945> · #948 <https://github.com/gmood2008/openbot/pull/948> · #950 <https://github.com/gmood2008/openbot/pull/950> · #951 <https://github.com/gmood2008/openbot/pull/951>

硬门禁：P19 ≠ 生产部署。不得开 gate、不得补 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。批准也不等于开 gate。

快照：

- [convergence JSON](/design/openbot-diagnosis-p19-convergence-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p19-convergence-2026-09-04.md)
- [preflight JSON](/design/openbot-diagnosis-p19-preflight-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p19-preflight-2026-09-04.md)

---

## 1. #945 事实纠正

| 项        | 值                                                      |
| --------- | ------------------------------------------------------- |
| PR        | <https://github.com/gmood2008/openbot/pull/945>         |
| title     | Delivery: record seq61 LIVE cutover (e59aede250 / #938) |
| state     | `CLOSED`                                                |
| closedAt  | `2026-09-04T12:32:59Z`                                  |
| mergedAt  | `null`                                                  |
| merge SHA | `null`                                                  |

关闭原因：主干已有 seq 61（#948）+ seq 62（#950）。#945 只补 seq 61 行，会与后续 cutover 冲突。

真正合入的账本工作：

| PR   | 状态   | 作用                                                     |
| ---- | ------ | -------------------------------------------------------- |
| #948 | MERGED | Latest + ledger 对齐到当时 LIVE seq 61 / `e59aede250`    |
| #950 | MERGED | 追加开放行 seq 62 / `81aafe1e`（当前容器 LIVE）          |
| #951 | MERGED | 当前 origin/main tip（s29 reasoncode）；不是账本 cutover |

## 2. 六者关系

评估前再次 `git fetch origin`，candidate 必须等于最新 `origin/main`。LIVE 唯一来源是运行容器 `openbot-gateway-rc` 的 `/app/dist/build-info.json`。

| 身份                          | SHA                                        | 来源                                                                      | 结论                                            |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| candidate                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` | `--candidate-sha` = 最新 origin/main                                      | 与 origin/main 一致                             |
| origin/main                   | `04690f8d2ed51f24a06825c153b7c1885d17182a` | `git fetch origin` 后 `rev-parse`                                         | Merge #951                                      |
| LIVE                          | `81aafe1e218e91656c3a399edb5a9080ad00d448` | 运行容器，`builtAt=2026-09-04T08:27:11.537Z`，`version=2026.7.12-rc.2`    | 唯一运行事实；是 candidate / origin/main 的祖先 |
| ledger 开放行 seq 62          | `81aafe1e218e91656c3a399edb5a9080ad00d448` | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`，`liveFrom=2026-09-04T09:05:07Z`，#950                   | 与 LIVE 一致；**keep**                          |
| ledger seq 61                 | `e59aede2506dbe8c571f0019f7e1bac0687778b6` | 已 `liveTo=2026-09-04T09:05:07Z`                                          | historical；不得改写                            |
| RELEASE_RECORD Latest cutover | `e59aede2506dbe8c571f0019f7e1bac0687778b6` | 第一个 `## Latest cutover` = seq 61                                       | **落后于 LIVE seq 62**                          |
| provenance                    | missing for LIVE                           | 有 `provenance/sha-e59aede2506d`（seq 61）；无 `provenance/sha-81aafe1e*` | LIVE 侧 **不可证明**；`do_not_mint`             |

Forward-only：`allow`。`LIVE ⊂ origin/main`。不得把 Latest 回写成 seq 61 / `e59aede250` 或 seq 59 / `3d03d3b4df`。

## 3. 发布身份链

- LIVE 与开放 ledger 行已对齐（seq 62 / `81aafe1e`）。`ledgerAction=keep`。
- `RELEASE_RECORD.md` Latest **仍落后**。解析器取第一个 `## Latest cutover`，当前是 seq 61。修复只能由 `delivery_ledger_owner` 在主干追加新的 Latest，写成已证明的 LIVE/ledger。
- Provenance remint plan（证据化，**未发布**）：
  - `action: do_not_mint`
  - `published: false`
  - `proposedTag: provenance/sha-81aafe1e218e`
  - 原因：seq 62 账本 `tag=main`，cutover 未走 `provenance-sha-*`。现在补 tag 会伪造既有发布史。
- 禁止：伪造历史、回写错误 SHA、事后补发代表既有发布史的 tag、改写 seq 61/62。

即便 Latest 对齐，缺 provenance 仍使 `liveEqualsProvenance=false`，Ready 仍为 false。

P15 convergence 内嵌 rehearsal SLO 不得当生产健康。standalone preflight 才是准入观测。

## 4. 生产准入（四门 gate 仍为 false）

| Gate                                      | default | value |
| ----------------------------------------- | ------- | ----- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | false   | false |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | false   | false |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | false   | false |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | false   | false |

- `diagnosis-reports` 未进入 live gateway pack。
- `coreGatewayHandlers` 无 diagnosis reports 方法。
- 真实聊天、Da Bai transport、Doctor `--fix`、Channel restart、自动修复均未接通。
- P5 合同已签；`liveDeliveryEnabled=false`。
- `gatesOpened=false`，`trafficSwitched=false`，`approvedForProductionCutover=false`。

## 5. 依赖与 SLO

Trusted tenant 只来自 membership。缺失观测不得渲染为健康。非诊断分支提交不是验收证据。

standalone preflight：

| 项                      | 结果                     |
| ----------------------- | ------------------------ |
| SLO completeness        | `empty`                  |
| SLO observed metrics    | 全部 `null`              |
| rendered health         | `not_ready`              |
| Composite Report reader | unavailable；fail closed |
| audit persist           | unavailable；fail closed |
| quota store             | unavailable；fail closed |

convergence 内嵌 rehearsal 出现 `completeness=complete` / reader pass，那是演练夹具，不是生产观测。

## 6. Go / No-Go

| Ready 条件                    | 结果      |
| ----------------------------- | --------- |
| candidate == 最新 origin/main | true      |
| LIVE == ledger                | true      |
| LIVE == RELEASE_RECORD        | **false** |
| LIVE == provenance            | **false** |
| SLO completeness=complete     | **false** |
| 生产依赖可用                  | **false** |
| 所有生产 gate 仍为 false      | true      |

**结论：No-Go。`readyForIndependentApproval=false`。P15/P16/P17/P18/P19 均不签收。**

即使日后 Ready，也不得自行开 gate、部署或切流量。

## 7. 未解决 blocker

| Blocker                                                                            | 责任人                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Latest cutover 写成 seq 62 / `81aafe1e`（不是 seq 61 / `e59aede250`，不是 seq 59） | `delivery_ledger_owner`                               |
| 不得补发 `provenance/sha-81aafe1e*`                                                | `delivery_ledger_owner`                               |
| 不得改写 ledger seq 61/62                                                          | `delivery_ledger_owner`                               |
| 不得把 #945 当成已合入证据                                                         | `delivery_ledger_owner`                               |
| SLO completeness=`empty`                                                           | `p12_slo_observations`                                |
| reader / audit / quota fail-closed                                                 | `p12_production_dependency_injection`                 |
| 开 gate 的人类批准（批准 ≠ 开启）                                                  | `platform_security` / `enterprise_admin` / `employee` |
