# OpenBot Diagnosis Platform — P20 动态发布身份对账

Date: 2026-09-05

Status: **No-Go。candidate 已等于最新 origin/main `65a8195278`。LIVE 已前移到 seq 63 / `04690f8d2e`，与开放 ledger 行一致。RELEASE_RECORD Latest 仍停在 seq 61 / `e59aede250`。LIVE 侧 provenance 缺失且 `do_not_mint`。standalone preflight SLO completeness=`empty`，reader/audit/quota fail-closed。P19 行动单（写 seq 62 / `81aafe1e`）已过期。不得输出 Ready for independent approval。P21–P26 不得启动。**

Task: `openbot-diagnosis-platform`

Related: [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05) · [P19 行动单（已过期）](/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04) · #953 <https://github.com/gmood2008/openbot/pull/953> · #955 <https://github.com/gmood2008/openbot/pull/955> · #952 <https://github.com/gmood2008/openbot/pull/952>

硬门禁：P20 ≠ 生产部署。不得开 gate、不得补 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。批准也不等于开 gate。

快照：

- [convergence JSON](/design/openbot-diagnosis-p20-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20-convergence-2026-09-05.md)
- [preflight JSON](/design/openbot-diagnosis-p20-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20-preflight-2026-09-05.md)

---

## 1. 基线

评估前 `git fetch origin`。HEAD 快进到 `origin/main`。candidate 使用 `--candidate-sha "$(git rev-parse origin/main)"`，LIVE 使用运行容器 `/app/dist/build-info.json`。未使用 dirty worktree、旧 candidate 或未合并分支作为 candidate。未修改或提交 `.loom/registry.yaml`。

| 项                      | 值                                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| candidate / origin/main | `65a8195278224840bfde4de850e4ce53f067d765`（#952）                      |
| LIVE                    | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| forward-only            | allow；`LIVE ⊂ origin/main`                                             |

\#955（P19）已合入主干。P19 当时的 LIVE 是 seq 62 / `81aafe1e`，现已退役。

## 2. 六者关系

| 身份                          | SHA                                        | 来源 / 时间                                                                                                                                                  | 可证明 | 结论                              |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------- |
| candidate                     | `65a8195278224840bfde4de850e4ce53f067d765` | `git rev-parse origin/main`                                                                                                                                  | true   | 与 origin/main 一致               |
| origin/main                   | `65a8195278224840bfde4de850e4ce53f067d765` | 新鲜 fetch；Merge #952                                                                                                                                       | true   | 唯一生产来源                      |
| LIVE                          | `04690f8d2ed51f24a06825c153b7c1885d17182a` | 容器 `build-info.json`，`builtAt=2026-09-04T13:29:54.802Z`                                                                                                   | true   | 唯一运行事实；是 origin/main 祖先 |
| ledger 开放行 seq 63          | `04690f8d2ed51f24a06825c153b7c1885d17182a` | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`，`liveFrom=2026-09-04T13:39:37Z`，#953，`tag=main` | true   | 与 LIVE 一致；**keep**            |
| ledger seq 62                 | `81aafe1e218e91656c3a399edb5a9080ad00d448` | 已 `liveTo=2026-09-04T13:39:37Z`                                                                                                                             | true   | historical；不得改写              |
| RELEASE_RECORD Latest cutover | `e59aede2506dbe8c571f0019f7e1bac0687778b6` | 第一个 `## Latest cutover` = seq 61，`liveFrom=2026-09-04T06:53:46Z`                                                                                         | true   | **落后于 LIVE seq 63**            |
| provenance                    | missing for LIVE                           | 有 `provenance/sha-e59aede2506d`（seq 61）；无 `provenance/sha-04690f8d*`                                                                                    | false  | LIVE 侧不可证明；`do_not_mint`    |

## 3. 发布身份链

- LIVE == 开放 ledger 行（seq 63 / `04690f8d2e`）。`ledgerAction=keep`。Diagnosis 不改写 seq 61/62/63。
- `RELEASE_RECORD.md` Latest **仍落后**。解析器取第一个 `## Latest cutover`。修复只能由 `delivery_ledger_owner` 在主干追加新的 Latest，写成已证明的 LIVE/ledger。
- Provenance remint plan（证据化，**未发布**）：
  - `action: do_not_mint`
  - `published: false`
  - `proposedTag: provenance/sha-04690f8d2ed5`
  - 原因：seq 63 账本 `tag=main`，cutover 未走 `provenance-sha-*`。现在补 tag 会伪造既有发布史。
- 禁止：伪造历史、回写 seq 62 / `81aafe1e` 或 seq 61 / `e59aede250`、事后补发代表既有发布史的 tag。

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

Trusted tenant 只来自 membership。缺失观测不得渲染为健康。非诊断分支提交不是验收证据。P21 依赖闭环在本增量 **不得开始**：身份链尚未可证明一致。

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

**结论：No-Go。`readyForIndependentApproval=false`。P15–P20 均不签收。P21–P26 停止。**

即使日后 Ready，也不得自行开 gate、部署或切流量。

## 7. 未解决 blocker

| Blocker                                                                            | 责任人                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Latest cutover 写成 seq 63 / `04690f8d2e`（不是 seq 62 / `81aafe1e`，不是 seq 61） | `delivery_ledger_owner`                               |
| 不得补发 `provenance/sha-04690f8d*`                                                | `delivery_ledger_owner`                               |
| 不得改写 ledger seq 61/62/63                                                       | `delivery_ledger_owner`                               |
| 不得再执行 P19「写 seq 62 / `81aafe1e`」                                           | `delivery_ledger_owner`                               |
| SLO completeness=`empty`                                                           | `p12_slo_observations`                                |
| reader / audit / quota fail-closed                                                 | `p12_production_dependency_injection`                 |
| 开 gate 的人类批准（批准 ≠ 开启）                                                  | `platform_security` / `enterprise_admin` / `employee` |
