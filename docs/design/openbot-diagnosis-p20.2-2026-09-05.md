# OpenBot Diagnosis Platform — P20.2 主干身份链重算

Date: 2026-09-05

Status: **No-Go。candidate 等于最新 origin/main `a83214ae57`（#965）。LIVE == ledger == Latest == provenance peeled target == `04690f8d2e`。预检不再把 annotated tag object `8efc2eaa0525` 当成 LIVE。standalone SLO completeness=`empty`，reader/audit/quota fail-closed，故 `readyForIndependentApproval=false`。未改账本、未补 tag、未开 gate。不得进入 P21。**

Task: `openbot-diagnosis-platform`

Related: [账本对账](/design/openbot-diagnosis-p20.2-ledger-2026-09-05) · [P20.1](/design/openbot-diagnosis-p20.1-2026-09-05) · #960 <https://github.com/gmood2008/openbot/pull/960> · #965 <https://github.com/gmood2008/openbot/pull/965>

硬门禁：P20.2 ≠ 生产部署。不得开 gate、不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。

快照：

- [ledger JSON](/design/openbot-diagnosis-p20.2-ledger-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.2-ledger-2026-09-05.md)
- [convergence JSON](/design/openbot-diagnosis-p20.2-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.2-convergence-2026-09-05.md)
- [preflight JSON](/design/openbot-diagnosis-p20.2-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.2-preflight-2026-09-05.md)

---

## 1. 基线

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `a83214ae57cf21f3d57d3551a5efb441d491160b`（#965）                      |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| provenance tag object    | `8efc2eaa052590713dd3edc210b09c748a8c34e5`（不参与比对）                |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

评估前 `git fetch origin`。candidate 使用 `--candidate-sha "$(git rev-parse origin/main)"`，不是 dirty HEAD。未修改或提交 `.loom/registry.yaml`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。未发布 `provenance/sha-*`。

## 2. 已删除的过期描述

- `#960 OPEN`：#960 已 MERGED，第一个 Latest 已是 seq 63 / `04690f8d2e`
- `RELEASE_RECORD 未更新`：LIVE == ledger == Latest 已可证明
- `CLI provenance=8efc2eaa0525 ≠ LIVE`：现已比对 peeled commit

未回写 seq 61/62/63，未删除历史 Latest 段，未伪造发布时间。

## 3. Go / No-Go

| Ready 条件                       | 结果      |
| -------------------------------- | --------- |
| candidate == 最新 origin/main    | true      |
| LIVE == ledger                   | true      |
| LIVE == RELEASE_RECORD Latest    | true      |
| LIVE == provenance peeled target | true      |
| SLO completeness=complete        | **false** |
| reader / audit / quota 可用      | **false** |
| 所有生产 gate 仍为 false         | true      |

独立预检是准入观察。P15 收敛包里的排练 SLO 不得当成生产健康。

**结论：No-Go。不得进入 P21。**

provenance remint：`do_not_mint` / `published=false`。tag 已存在且 peeled target 是 LIVE；不要再补一条。

## 4. 未解决 blocker

| Blocker                             | 责任人                                |
| ----------------------------------- | ------------------------------------- |
| 不要再补 `provenance/sha-04690f8d*` | `delivery_ledger_owner`               |
| 不要改写 ledger seq 61/62/63        | `delivery_ledger_owner`               |
| SLO completeness=`empty`            | `p12_slo_observations`                |
| reader / audit / quota fail-closed  | `p12_production_dependency_injection` |
