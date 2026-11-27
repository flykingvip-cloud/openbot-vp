# VB-1 残留缺口处置（不重做 124 项，不强行标绿）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 审查 SHA（产品代码）：`f0fccbd37bb9a45545562ee668295f9153b6f6aa`。Track 1 分支必须保持此 SHA。本文件只做盘点与建议，**不在 Track 1 落地未授权产品修复**。
- 最新指令仍出现「推动 30 项 partial 归零」字样，该数字 **已过时**。不得按 30 去强行归零。

## 已完成（复用 P0/P1 补充包，不从头再做）

来源：`/workspace/kb-sdk-align/gate3-p0-closeout/`

| 交付 | 文件 | 结论（包内已记录，本轮不重审代码） |
|---|---|---|
| 6 条 P0 写/调用链 | `P0_SIX_WRITE_PATHS_REVIEW.md` | E010 / E029 / E037 / E068 / E070 升为 code-verified；**E080 仍为 partial**（共享租户索引无 KB 写 ACL） |
| 共享 Bundle 过滤器穿透 | `P1_SHARED_BUNDLE_FILTER_PENETRATION.md` | 24 条读/聚合中 12 条升为 code-verified，12 条仍 partial |
| 遗留 vault-sync 基线 | `P2_LEGACY_VAULT_SYNC_BASELINE.md` | vault-sync 40 项保持 40/0/0；遗留 gateway sync 默认关闭 |
| 更新计数 | `PARTIALS_STATUS_AND_UPDATED_COUNTS.md` SHA-256 `f7de6a3f3ec8a144c2d278c2a73309a8b7f66dc882dda312b5d60918343e9036` | 相对已接受 94/30/0，补充后 **111 code-verified / 13 partial / 0 cannot-verify** |
| PRE-02 处置建议单 | `PRE02_DISPOSITION_RECOMMENDATION.md` | **仍为未发送草案**（无具名收件人则不发送） |

PRE-03 / EXT-02 DBA 申请仍未发送。Gate 7 保持 **MET（附带条件）**。Exit Gate 3 / Gate 4 保持 **NOT_MET**。本轮不自签。

## 残留 13 项（保持 partial）

| ID | RPC | 保持 partial 的原因 |
|---|---|---|
| E003 | `knowledge.runtime.context` | 共享租户索引无 KB ACL |
| E007 | `knowledge.discovery.list` | 同上 |
| E008 | `knowledge.actions.list` | 共享索引；可选 knowledgeBaseId 未先授权 |
| E017 | `knowledge.feed.digest` | 组合 E007+E008 |
| E018 | `knowledge.timeline.list` | 包装 E007 |
| E078 | `knowledge.governance.summary` | 共享租户索引；kbId 只是过滤不是授权 |
| E079 | `knowledge.governance.tasks.list` | 同 E078 |
| E082 | `knowledge.governance.claims.list` | 同 E078 |
| E080 | `knowledge.governance.tasks.update` | 同索引；知 taskId 即可写，无 KB 写门 |
| E005 | `knowledge.object` | `obj:doc:` 无范围扫描全部 KB |
| E011 | `knowledge.relationships` | relationships 图无 ACL |
| E019 | `knowledge.lineage.explain` | 无 feed visibility/grant |
| E067 | `knowledge.source.catalog.get` | 无 owner/KB 门 |

以上均为真实 ACL 缺口。修复建议已在 P0/P1 包登记，**本轮只保留建议，不改产品代码**。

## 建议（非授权、非实施）

若未来单独授权在非 Track 1 分支修补，优先顺序仍建议：E080 写门 → 共享租户索引读门（E003/E007/E008/E078/E079/E082 及派生 E017/E018）→ E005 无范围扫描 → E011 / E019 / E067。任何修补不得默认打开 SDK 旗标，不得双写。
