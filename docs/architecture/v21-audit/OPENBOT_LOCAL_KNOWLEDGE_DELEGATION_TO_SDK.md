# 《OpenBot 本地知识模块向 SDK 委派收口清单》

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 对齐对象：Space Pre-v7 B2-2 **124** 项实审（不得另发明计数）。
  - 构成：`knowledge.ts` **77** + `knowledge-governance.ts` **7** + `vault-sync.ts` **40** = **124**
  - 官方 8 动作：`read` / `upload` / `update` / `delete` / `manage_members` / `manage_permissions` / `archive` / `transfer_ownership`
  - 已接受矩阵：`/workspace/kb-sdk-align/gate3-b22-handover/B2_2_124_TRANSITIVE_REVIEW_MATRIX.md`，SHA-256 `1a12baa08c05a5913177a95492f3614261b70f09f79faf660b09607ed594a08c`（基线 **94 code-verified / 30 partial / 0 cannot-verify**）
  - P0/P1 补充包：`/workspace/kb-sdk-align/gate3-p0-closeout/PARTIALS_STATUS_AND_UPDATED_COUNTS.md`（SHA-256 `f7de6a3f3ec8a144c2d278c2a73309a8b7f66dc882dda312b5d60918343e9036`）将其中 17 项升为 code-verified，残留 **13 partial**，合计 **111 / 13 / 0**。本清单不把 13 项强行标绿。
- 本清单是委派分类，不是产品代码修复，不在 Track 1 `f0fccbd3` 落地补丁，不自签 Gate 3/4。
- 分类口径（仅这三类）：**保留 UI shell + 向 SDK 委派** / **过渡期禁止双写** / **规划退役**。

## 1. 分类总表（按模块，不改 124 计数）

| 子集 | 项数 | 当前证据状态（补充包） | 委派分类 | 说明 |
|---|---:|---|---|---|
| 知识域 RPC（`knowledge.ts` 77，含官方 8 动作入口） | 77 | 含在 84 项「knowledge + governance」中：补充后 71 verified / 13 partial | 主体：**保留 UI shell + 向 SDK 委派**；凡涉及对象写/检索权威的路径标 **过渡期禁止双写** | Space / KB / 文档 / 来源 / 关系 / feed 的产品壳留在 OpenBot；企业知识存储与检索权威目标委派 Knowledge SDK。13 项 ACL 缺口必须先关闭，才能把对应读/写路径标为可委派完成 |
| 治理 RPC（`knowledge-governance.ts` 7） | 7 | 落入上列 84 项；其中 E078/E079/E080/E082 仍为 partial | 治理建议/任务/声明：**保留 UI shell + 向 SDK 委派**治理对象；**禁止** OpenBot 与 SDK 双写同一治理任务 | E080 知 `taskId` 即可写，无 KB 写门——委派前必须补门，不得带着缺口切写主 |
| vault-sync 40（`vault-sync.ts`） | 40 | 40 / 0 / 0（补充包无变化；P2 只做基线） | 个人/工作区同步壳：**保留 UI shell**；与 SDK 资产身份重叠处 **禁止双写**；遗留 `knowledge.vault-sync.sync` 网关路径 **规划退役** | `requireTargetKnowledgeWrite` 已在 bind-kb / reindex；遗留 gateway sync 默认关闭（仅 `OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC=1` 时执行），不得当作分享兼容机制 |

补充包相对基线：原 84 项由 54/30/0 变为 71/13/0；vault-sync 40 保持 40/0/0；合计 111/13/0。本表不重新打分。

## 2. 官方 8 动作与委派方向

以矩阵已记录的实现事实为准（矩阵写明「无 transfer_ownership 入口被 124 项实码推断为已实现」——本清单不改写该推断，只给委派方向）：

| 官方动作 | OpenBot 现状（复用矩阵，不重审 124） | 委派分类 |
|---|---|---|
| read | 大量 knowledge.* 读 RPC；存在两条读门不一致与共享租户索引旁路（见残留 13 项） | 保留 UI / 检索壳；目标向 SDK 统一读授权。在 13 项 ACL 缺口关闭前，**禁止**宣布读路径已完成委派 |
| upload / update / delete | 知识对象写路径已部分 code-verified（P0 中 E010/E029/E037 等已升格）；不得在过渡期同时写 SDK 与本地权威副本 | **禁止双写**；UI 保留，写主迁移须单写主切换 |
| manage_members / manage_permissions | 成员与授权 RPC 在 knowledge / space 壳；人类成员主键仍是 email 的历史口径见矩阵摘要 | 保留成员管理 UI；授权判定目标与 SDK / Space 门禁对齐；禁止第二套 ACL 写主 |
| archive | 归档类动作按矩阵已入账项处理 | 保留 UI；归档状态禁止双写 |
| transfer_ownership | 矩阵已记录 124 项实码推断该入口已实现 | 保留所有权转移 UI；转移结果禁止在 OpenBot 与 SDK 各写一份互不相认的权威 |

## 3. 残留 13 项对委派的阻塞（保持诚实）

这些条目补充包仍为 partial，本清单全部保持 partial，并标记为「委派未完成 / 禁止带着缺口切写主」：

| ID | RPC | 阻塞 | 对委派的含义 |
|---|---|---|---|
| E003 | `knowledge.runtime.context` | 共享租户索引，无 KB ACL | 读委派前需 KB 门 |
| E005 | `knowledge.object` | `obj:doc:` 无范围扫描 | 对象读不得无 ACL 委派 |
| E007 | `knowledge.discovery.list` | 共享索引投影 | 发现面需先补门 |
| E008 | `knowledge.actions.list` | 可选 kbId 未先授权 | 行动列表需先授权 |
| E011 | `knowledge.relationships` | 图扫描无读门 | 关系图不可无 ACL 委派 |
| E017 | `knowledge.feed.digest` | 组合 E007+E008 | 随前项关闭 |
| E018 | `knowledge.timeline.list` | 包装 E007 | 随前项关闭 |
| E019 | `knowledge.lineage.explain` | 无 feed visibility/grant | 解释接口需可见性门 |
| E067 | `knowledge.source.catalog.get` | 无 owner/KB 门 | 目录读需先授权 |
| E078 | `knowledge.governance.summary` | 共享索引，kbId 只是过滤 | 治理摘要需 KB ACL |
| E079 | `knowledge.governance.tasks.list` | 同 E078 | 同左 |
| E080 | `knowledge.governance.tasks.update` | 知 taskId 即可写 | **写委派前必须补 KB 写门** |
| E082 | `knowledge.governance.claims.list` | 同 E078 | 同左 |

修复建议已写在 P0/P1 包中，**本轮不落地产品补丁**。

## 4. 裁定（字段 10 口径）

- **保留 UI shell + 向 SDK 委派**：OpenBot 继续做 Space / 成员 / 会话中的知识体验壳；企业知识对象、检索计划、资源注册的目标权威在 Knowledge SDK。
- **过渡期禁止双写**：Semantic Object、知识对象正文、治理任务状态、vault-sync 目标资产身份，任何时候只允许一个权威写主。
- **规划退役**：遗留 `knowledge.vault-sync.sync` 网关路径（默认关闭）列入退役，不作为兼容层重新打开。
- 本清单不解锁 Schema v7，不开启 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED`，不把 13 项标绿。
