# OpenBot Diagnosis Platform — P20.1 当前 LIVE 身份对账

Date: 2026-09-05

Status: **No-Go。candidate 已等于最新 origin/main `e106c3e168`。LIVE 仍等于 ledger seq 63 / `04690f8d2e`。主干 RELEASE_RECORD Latest 仍停在 seq 61 / `e59aede250`。#960 是 `delivery_ledger_owner` 的 Latest 回填，尚未合入。`provenance/sha-04690f8d2ed5` 已存在且剥开后指向 LIVE，但 CLI 读到的是 annotated tag 对象 `8efc2eaa0525`，`liveEqualsProvenance=false`。Diagnosis 未改 Latest、未改 ledger、未补 tag。standalone preflight SLO completeness=`empty`，reader/audit/quota fail-closed。不得输出 Ready for independent approval。不得进入 P21。**

Task: `openbot-diagnosis-platform`

Related: [P20.1 行动单](/design/openbot-diagnosis-p20.1-delivery-owner-actions-2026-09-05) · [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05) · #960 <https://github.com/gmood2008/openbot/pull/960> · #957 <https://github.com/gmood2008/openbot/pull/957> · #953 <https://github.com/gmood2008/openbot/pull/953>

硬门禁：P20.1 ≠ 生产部署。不得开 gate、不得补 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。

快照：

- [convergence JSON](/design/openbot-diagnosis-p20.1-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.1-convergence-2026-09-05.md)
- [preflight JSON](/design/openbot-diagnosis-p20.1-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.1-preflight-2026-09-05.md)

---

## 1. 基线

评估前 `git fetch origin`。HEAD 快进到 `origin/main`。candidate = `git rev-parse origin/main`。LIVE 来自运行容器 `/app/dist/build-info.json`。未用 dirty worktree 或未合并分支当 candidate。未修改或提交 `.loom/registry.yaml`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。

| 项                      | 值                                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| candidate / origin/main | `e106c3e168a1c2f09fcb3017d887f841ed881bdf`（#961）                      |
| LIVE                    | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| forward-only            | allow；`LIVE ⊂ origin/main`                                             |

\#957（P20）已合入。LIVE 相对 P20 未再前移。

## 2. 六者关系

| 身份                          | SHA                                                   | 来源 / 时间                                                                    | 可证明 | 结论                                                              |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| candidate                     | `e106c3e168a1c2f09fcb3017d887f841ed881bdf`            | `git rev-parse origin/main`                                                    | true   | 与 origin/main 一致                                               |
| origin/main                   | `e106c3e168a1c2f09fcb3017d887f841ed881bdf`            | 新鲜 fetch；Merge #961                                                         | true   | 唯一生产来源                                                      |
| LIVE                          | `04690f8d2ed51f24a06825c153b7c1885d17182a`            | 容器 `build-info.json`，`builtAt=2026-09-04T13:29:54.802Z`                     | true   | 唯一运行事实                                                      |
| ledger 开放行 seq 63          | `04690f8d2ed51f24a06825c153b7c1885d17182a`            | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`，`liveFrom=2026-09-04T13:39:37Z`，#953，`tag=main`            | true   | 与 LIVE 一致；**keep**                                            |
| RELEASE_RECORD Latest cutover | `e59aede2506dbe8c571f0019f7e1bac0687778b6`            | 主干第一个 `## Latest cutover` = seq 61                                        | true   | **仍落后**；修复只走 #960，Diagnosis 不代写                       |
| provenance                    | tag object `8efc2eaa052590713dd3edc210b09c748a8c34e5` | annotated `provenance/sha-04690f8d2ed5`，剥开后是 LIVE；CLI `rev-parse` 未剥开 | 部分   | 对象 SHA ≠ LIVE，故 `liveEqualsProvenance=false`；**do_not_mint** |

## 3. RELEASE_RECORD

诚实 Latest 必须等于已证明的 LIVE/ledger，即 seq 63 / `04690f8d2e`。不得回写 seq 62 / `81aafe1e` 或 seq 61 / `e59aede250`。不得删除历史 Latest 段。不得伪造 `liveFrom`。

该写入只属于 `delivery_ledger_owner`，且必须在 `main` 上走 PR。当前载体是 #960（OPEN）。Diagnosis 未打开第二份 Latest PR，也未在特征分支改 `RELEASE_RECORD.md`，避免本地 preflight 假装主干已对齐。

## 4. Provenance

远端已有 annotated tag `provenance/sha-04690f8d2ed5`：

- TaggerDate: `2026-09-05T06:38:29+08:00`
- 剥开目标：`04690f8d2ed51f24a06825c153b7c1885d17182a`（当前 LIVE）
- 说明写的是 already-running LIVE 的 SoT identity，不是新 cutover
- seq 63 账本行仍是 `tag=main`

\#960 承认这是事后补的身份 tag。P20.1 不补发第二条历史 tag。remint plan 保持 `do_not_mint` / `published=false`。CLI 当前把 tag 对象 SHA 当成 provenance 身份，因此即 tag 已指向 LIVE，Ready 仍因 `liveEqualsProvenance=false` 失败。Diagnosis 不改 CLI、不改 tag。

## 5. 生产准入

四门 gate 默认且实际均为 false。`diagnosis-reports` 未进 live pack。`coreGatewayHandlers` 无 diagnosis reports 方法。未 build / publish / restart / 灰度 / 切流量。

standalone preflight：SLO completeness=`empty`，reader / audit / quota fail-closed。convergence 内嵌 rehearsal 不得当生产健康。

## 6. Go / No-Go

| Ready 条件                    | 结果      |
| ----------------------------- | --------- |
| candidate == 最新 origin/main | true      |
| LIVE == ledger                | true      |
| LIVE == RELEASE_RECORD        | **false** |
| LIVE == provenance（CLI）     | **false** |
| SLO completeness=complete     | **false** |
| 生产依赖可用                  | **false** |
| 所有生产 gate 仍为 false      | true      |

**结论：No-Go。`readyForIndependentApproval=false`。不得进入 P21。**

## 7. 未解决 blocker

| Blocker                                                     | 责任人                                |
| ----------------------------------------------------------- | ------------------------------------- |
| 在主干合入 #960，把第一个 Latest 写成 seq 63 / `04690f8d2e` | `delivery_ledger_owner`               |
| 不要让 Diagnosis 代写 Latest，不要开第二份 Latest PR        | `delivery_ledger_owner`               |
| 不要再补 `provenance/sha-04690f8d*`                         | `delivery_ledger_owner`               |
| 不要改写 ledger seq 61/62/63                                | `delivery_ledger_owner`               |
| SLO completeness=`empty`                                    | `p12_slo_observations`                |
| reader / audit / quota fail-closed                          | `p12_production_dependency_injection` |
