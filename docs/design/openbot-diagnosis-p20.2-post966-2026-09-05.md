# OpenBot Diagnosis Platform — P20.2 #966 合入后重算

Date: 2026-09-05

Status: **No-Go。#966 已合入主干。candidate 等于最新 origin/main `6d43b3f24c`。LIVE == ledger == Latest == provenance peeled target == `04690f8d2e`。主干 CLI 不再把 tag object `8efc2eaa0525` 当成 LIVE。standalone SLO completeness=`empty`，reader/audit/quota fail-closed，故 `readyForIndependentApproval=false`。不得进入 P21。未开 gate。**

Task: `openbot-diagnosis-platform`

Related: [P20.2](/design/openbot-diagnosis-p20.2-2026-09-05) · #966 <https://github.com/gmood2008/openbot/pull/966>

硬门禁：合入 peel 修正 ≠ 生产部署。不得开 gate、不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。

快照：

- [convergence JSON](/design/openbot-diagnosis-p20.2-post966-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.2-post966-convergence-2026-09-05.md)
- [preflight JSON](/design/openbot-diagnosis-p20.2-post966-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p20.2-post966-preflight-2026-09-05.md)

---

## 1. 基线

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `6d43b3f24c57cf1196912e2ceeb5bc84135917f4`（#966 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA，`liveFrom=2026-09-04T13:39:37Z`                       |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

评估前 `git fetch origin`。#966 `state=MERGED`，`mergedAt=2026-09-05T03:50:52Z`。未改 `RELEASE_RECORD.md` / `releases.jsonl`。未提交 `.loom/registry.yaml`。未发布 `provenance/sha-*`。

## 2. Go / No-Go

| Ready 条件                       | 结果      |
| -------------------------------- | --------- |
| candidate == 最新 origin/main    | true      |
| LIVE == ledger                   | true      |
| LIVE == RELEASE_RECORD Latest    | true      |
| LIVE == provenance peeled target | true      |
| SLO completeness=complete        | **false** |
| reader / audit / quota 可用      | **false** |
| 所有生产 gate 仍为 false         | true      |

独立预检是准入观察。`live_equals_provenance` **pass**。剩余 blocker 只有 SLO 与生产依赖。

**结论：No-Go。不得进入 P21。**

provenance remint：`do_not_mint` / `published=false`。不要再补 `provenance/sha-04690f8d*`。
