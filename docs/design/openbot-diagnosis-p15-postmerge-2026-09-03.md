# OpenBot Diagnosis Platform — P15 合入后重评

Date: 2026-09-03

Status: **No-Go。#919 已合入，candidate 已等于最新 origin/main `0712f1a535`，但 RELEASE_RECORD 落后且 provenance 缺失。readyForIndependentApproval=false。未开 gate。P15 仍不能签收。P15 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Security、Enterprise Admin、Employee、delivery ledger owner、SRE、QA

Task: `openbot-diagnosis-platform`

Related:

- [P15 主干收敛排练](/design/openbot-diagnosis-p15-trunk-convergence-2026-09-03)
- PR #919 <https://github.com/gmood2008/openbot/pull/919>

硬门禁：candidate 已收敛仍不得打开生产 gate、不得注册 live pack、不得补发 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。

机器可读快照：

- [post-merge convergence JSON](/design/openbot-diagnosis-p15-postmerge-convergence-2026-09-03.json) · [Markdown](/design/openbot-diagnosis-p15-postmerge-convergence-2026-09-03.md)
- [post-merge preflight JSON](/design/openbot-diagnosis-p15-postmerge-preflight-2026-09-03.json) · [Markdown](/design/openbot-diagnosis-p15-postmerge-preflight-2026-09-03.md)

---

## 1. 合入证据

| 项                 | 值                                                              |
| ------------------ | --------------------------------------------------------------- |
| PR                 | <https://github.com/gmood2008/openbot/pull/919>                 |
| state              | `MERGED`                                                        |
| mergedAt           | `2026-09-03T12:52:20Z`                                          |
| mergeCommit        | `2f5ac01dd44cec5815f7f987a7f8cfce464ad9ba`                      |
| 919 in origin/main | yes                                                             |
| 评估时 origin/main | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf`（#914 之后，含 919） |

评估前已 `git fetch origin`。candidate 取最新 `origin/main`，不是旧特征分支 HEAD。

---

## 2. 合入后身份链

2026-09-03 容器 LIVE 仍为：

```json
{ "commit": "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96", "builtAt": "2026-09-03T01:37:57.887Z" }
```

| 身份           | SHA                                        | 可证明          | 结论                 |
| -------------- | ------------------------------------------ | --------------- | -------------------- |
| candidate      | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` | 是              | 等于最新 origin/main |
| origin/main    | `0712f1a5357ad7eaf56bd212c563e6488cd6b6bf` | 是              | 含 #919              |
| LIVE           | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 是（container） | 未变                 |
| ledger seq 58  | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` | 是              | 与 LIVE 对齐         |
| RELEASE_RECORD | `37cc40e51f468404baf3077307e347f32f636cb1` | 是              | 落后 LIVE            |
| provenance     | missing                                    | 否              | 不得补发             |

一致性：`candidateEqualsOriginMain=true`，`liveEqualsLedger=true`，`liveEqualsReleaseRecord=false`，`liveEqualsProvenance=false`。

LIVE 是 origin/main 祖先。remint plan 仍为 `do_not_mint` / `published=false` / `provenance/sha-6d9ea1f2d5da`。

---

## 3. 生产边界复验

- 四门 gate 仍为 false
- `DIAGNOSIS_REPORT_API_DEPLOYED=false`；`diagnosis-reports` 未注册进 live packs
- `coreGatewayHandlers` 无 `diagnosis.*`
- P4–P10 链保持 preview / `WAITING_AUTHORIZATION`
- 裸 P12 preflight 仍报 SLO empty、reader/audit/quota unavailable；准入排练包内 SLO 为 complete

---

## 4. 结论

主干收敛的 candidate 条件已满足。P15 **仍不能签收**：RELEASE_RECORD 与 provenance 仍未可证明对齐。下一步只属于 `delivery_ledger_owner` 在主干上处理 Latest cutover；不得事后补发代表既有发布史的 provenance tag。在此之前不得进入独立批准或任何生产部署步骤。
