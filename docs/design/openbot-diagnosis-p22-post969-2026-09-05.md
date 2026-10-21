# OpenBot Diagnosis Platform — P22 #969 合入后重算

Date: 2026-09-05

Status: **Ready for independent approval。** #969 已合入主干。candidate 等于最新 origin/main `2156a529d6`。LIVE == ledger == Latest == provenance peeled == `04690f8d2e`。P22 审批包在 squash 尖上仍 Ready。四角色与四门 gate 仍全部 `signed=false`。批准不等于开启。standalone production-preflight 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。未开 gate。不得自行进入 P23。

Task: `openbot-diagnosis-platform`

Related:

- [P22](/design/openbot-diagnosis-p22-2026-09-05)
- #969 <https://github.com/gmood2008/openbot/pull/969>
- [post969 审批包 JSON](/design/openbot-diagnosis-p22-post969-approval-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-post969-approval-2026-09-05)
- [post969 report JSON](/design/openbot-diagnosis-p22-post969-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-post969-report-2026-09-05)
- [convergence JSON](/design/openbot-diagnosis-p22-post969-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-post969-convergence-2026-09-05)
- [preflight JSON](/design/openbot-diagnosis-p22-post969-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-post969-preflight-2026-09-05)

硬门禁：合入 P22 审批包 ≠ 已签署 ≠ 生产部署。不得开 gate、不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。`approvedForProductionCutover` 保持 false。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA，`liveFrom=2026-09-04T13:39:37Z`，`tag=main`           |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

\#969 `state=MERGED`，`mergedAt=2026-09-05T05:54:56Z`。账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。未提交 `.loom/registry.yaml`。未发布新的 `provenance/sha-*`。provenance remint：`do_not_mint` / `published=false`。

## 2. Go / No-Go

| Ready 条件                                  | 结果      |
| ------------------------------------------- | --------- |
| candidate == 最新 origin/main               | true      |
| LIVE == ledger == Latest == peeled          | true      |
| P21 隔离依赖 / 故障注入 / 隔离 SLO complete | true      |
| 四角色批准事项与四门 gate 记录仍冻结        | true      |
| 签名格式拒绝 client param / model output    | true      |
| 全部 signed=false，value=false              | true      |
| standalone 生产 SLO / 生产依赖可用          | **false** |

P22 评估器在 #969 squash 尖上仍给出 **Ready for independent approval**。这只表示人类可以签署，不表示已签署，也不表示可以开 gate。

独立生产预检仍是准入观察：`slo.completeness=empty`，reader/audit/quota fail-closed。那份空 SLO **不得**渲染为健康，也 **不得**被 P22 Ready 覆盖。

**结论：Ready for independent approval。不得自行打开 gate、部署或进入 P23。**

## 3. 两份观察不得混用

| 观察                                | 结果                                     |
| ----------------------------------- | ---------------------------------------- |
| P22 独立审批包（消费 P21 隔离证据） | Ready for independent approval           |
| standalone production-preflight     | No-Go（空 SLO + 生产依赖 fail-closed）   |
| standalone trunk-convergence        | No-Go（P15 包装器未把空生产 SLO 当成绿） |

P22 Ready ≠ 已签署 ≠ 开 gate ≠ P23 只读报告 API 金丝雀 ≠ 生产切换 ≠ Diagnosis Platform 完成。
