# Memory / Workspace Phase 0 Evidence Summary

| 字段            | 内容                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **evidence-id** | `memory-workspace-phase0-20260814`                                                                                                                         |
| **状态**        | **待 review-25 关闭 Phase 0**（`main@6ed8bd4f91` · 工程门禁 pass · governance 待 sign-off）。`deployAuthorized=false`；Phase 1A **design/owner prep only** |
| **日期**        | 2026-08-14                                                                                                                                                 |
| **性质**        | 仓库 AST 调用点盘点 + 离线 Catalog candidate + v1 多根识别 + **LIVE 只读根枚举**。**未**改 LIVE、**未**重索引、**未**撤 overlay、**未**搬目录              |
| **调用点基线**  | [memory-workspace-phase0-20260814.call-sites.json](./memory-workspace-phase0-20260814.call-sites.json)                                                     |
| **candidate**   | [memory-workspace-phase0-20260814.catalog-candidate.json](./memory-workspace-phase0-20260814.catalog-candidate.json)                                       |
| **LIVE 根枚举** | [memory-workspace-phase0-live-20260814.summary.json](./memory-workspace-phase0-live-20260814.summary.json)                                                 |
| **关联**        | [整改方案](../memory-workspace-identity-remediation-2026-08-14.md) · [隔离证据 20260810](./workspace-isolation-20260810-001.summary.json)                  |

---

## 1. 方案审核（执行前）

二次复审结论为 **Changes Required**。本文件是只读证据摘要，**不是** Phase 0 退出门禁。可以继续补盘点，不能执行 Phase 1+。

| 检查                                          | 结果                                            |
| --------------------------------------------- | ----------------------------------------------- |
| 执行冻结写在首页                              | 通过                                            |
| 无第二套 `WorkspaceIdentity` SoT              | 通过（Envelope typed view）                     |
| 持久主键 = 治理 `resourceId`                  | 通过；`WorkspaceId` 仅为别名                    |
| Data Governance Catalog 为唯一目标 SoT        | 通过；现 Catalog 降为只读 adapter               |
| Binding 沿用现有 `WorkspaceBindingRecord`     | 已按二次复审改回当前精确类型；v2 宽字段进附录 A |
| 迁移扩展 `workspace-cutover`                  | 通过；禁止第二套 state machine                  |
| Phase 1+ tasks 标 BLOCKED                     | 通过                                            |
| 不抢 `workspace-resolver` owner               | 通过                                            |
| `DataGovernanceEnvelope` 已在运行时代码落地？ | **否**（仅设计文档）— 正确保持 Phase 1 blocked  |
| 持久治理 Catalog store 已存在？               | **否** — coverage 计 0%，不得打开 miss=deny     |

本次 **未** 实现 §6.6 跨进程止损运行时代码（需独立可回滚评审；`src/memory/**` 为共享脏树，不在本 Phase 0 写入）。

---

## 2. P1–P8 调用点（AST + 相对 import 再导出）

扫描器：`docs/design/evidence/memory-workspace-phase0-inventory.mjs`。扫描根：`src` + `extensions` + `scripts`；扩展名含 `.ts/.tsx/.mts/.cts/.js/.mjs`。Freeze 额外拦截新 `__resolve*` / `*WorkspaceDir` 定义与 Catalog 合成符号。仍不能完整追踪包装函数间接链和动态 import，**不能单独关闭 WS-D / WS-E**。

| 路径                                   | 生产调用 | 测试 | 说明                                              |
| -------------------------------------- | -------- | ---- | ------------------------------------------------- |
| P1 `resolveAgentWorkspaceDir`          | 78       | 6    | 含 extensions/voice-call 与 2 个 scripts 调用     |
| P2 `resolveMemoryWorkspaceDir`         | 2        | 2    | `get-reply` + memory manager                      |
| P3 `resolveAgentWorkspaceDirForClient` | 13       | 4    | chat / skills / steward-file / checkpoint         |
| P4 现场合成 Catalog                    | 14       | 26   | `createEmptyWorkspaceCatalog` + `buildUserOwned…` |
| P5 steward 双根                        | 15       | 10   | get-reply / cutover / checkpoint                  |
| P6 group 写根                          | 7        | 4    | group-workspace-file 等                           |
| P7 LIVE overlay                        | 0        | 0    | **不在仓库**；仅生产 overlay                      |
| P8 memory sqlite store / prune         | 4        | 0    | `memory-search` store + `syncMemoryFiles` ×3      |

生产路径 `write|watch|index`：**51**。Retirement gate 要求此类生产调用清零后才能切 Resolver 写路径。

### 2.1 事故链相关写点（优先退役）

| path | file:line                                       | op          | replacement                             | phase  |
| ---- | ----------------------------------------------- | ----------- | --------------------------------------- | ------ |
| P2   | `src/auto-reply/reply/get-reply.ts:122`         | write       | Resolver handle + memory 子路径         | freeze |
| P3   | `src/auto-reply/reply/get-reply.ts:147`         | write       | 禁止覆盖已解析身份                      | freeze |
| P4   | `src/gateway/workspace-resolver/tool-cwd.ts:51` | write       | 停空 Catalog 合成                       | freeze |
| P4   | `src/gateway/workspace-resolver/tool-cwd.ts:52` | write       | 同上                                    | freeze |
| P8   | `src/memory/manager-sync-ops.ts:898` 等         | index       | v1 多根拒绝 sync；v2 按 resourceId 分区 | freeze |
| P7   | LIVE `__resolveMemoryWorkspaceDir`              | write/index | 同发后撤 overlay                        | freeze |

Freeze 用法（相对本基线，禁止新增生产调用点）：

```bash
node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs --mode freeze \
  --baseline docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json
```

---

## 3. 离线 Catalog candidate 与 coverage

持久 Data Governance Catalog **尚未实现**。candidate 由 `raw-controlled → catalog-candidate` 对 **156 个 LIVE 根逐条**生成（含 31 个 group 根），含 identity / binding / proof / dual-tree 关系。**不是** Catalog SoT，也不得写入 store。

P0 coverage（相对持久治理 Catalog）：

| 可写资源         | 门槛                       | 本次                                                                                                                                                  |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| employee_private | 100% 有记录                | 持久 Catalog **0%**；盘点 85；44 steward = `unknown` + `resolutionStatus=pending_authority` + `evidenceHint=unique-user-dir`；0 classified；gate fail |
| agent_primary    | 100% 精确 `agentAssetId`   | 持久 Catalog **0%**；LIVE 精确命中 12/40，gate fail                                                                                                   |
| group_shared     | 100% tenant-scoped binding | **已盘点** 31 根（`inventoried=true`）；0 条有 tenant binding；持久 Catalog **0%**；gate fail                                                         |
| conflict/unknown | 100% 阻断并进清单          | 清单已建；**阻断未启用**（未授权）                                                                                                                    |

因此 **不得** 打开 Catalog miss=deny，**不得** 停止现有合成（会中断合法流量）。仅冻结 **新增** 合成调用点。

`resourceId` 候选规则（与现 `buildWorkspaceResourceId` 一致，字段名仍是治理 `resourceId`）：

```text
ws:<tenant>:group:<groupId>
ws:<tenant>:user:<userId>:asset:<agentAssetId>
ws:<tenant>:seat:<seatId>:asset:<agentAssetId>
ws:<tenant>:unknown:<reason>          → 必须 quarantine，禁止当可写身份
```

steward 不得用 `agentId` 冒充 `agentAssetId`。现 `tool-cwd` 把 `agentId` 传入 `agentAssetId`，candidate 标为 **conflict**。

---

## 4. 归属矩阵（脱敏 · 不自动修复）

来源：隔离证据 `workspace-isolation-20260810-001` + 2026-08-14 事故事实 + **同日第五次只读 LIVE 探针**（分类只保留 classified / conflict / unknown；脚本 SHA `a555541b…`）。未做 LIVE 写操作。上一版第四态 `classified_pending_authority` 作废。

| 类            | pathPattern                                         | 分类                                                                                                                 | 处置                                    |
| ------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A_employee    | `{stateDir}/agents/main/employees/<user>/workspace` | 44 = `unknown` + `pending_authority` / `unique-user-dir`；1 missing-tenant = `unknown`。目录唯一不是 membership 证明 | 待权威 membership 映射后才能 classified |
| B_flat_l2     | `tenants/<tid>/users/<uid>/OpenBot/workspace`       | conflict（main 扁平 vs agents/main）                                                                                 | quarantine 直至 Registry 精确证明       |
| C_agent_main  | `…/OpenBot/agents/main/workspace`                   | classified 或 conflict（与 B 并存）                                                                                  | 无唯一证明则 quarantine                 |
| D_skill_l2    | `…/OpenBot/workspace-bot-skill`                     | unknown（slug 目录，缺 assetId）                                                                                     | quarantine；禁止按文件名继承            |
| E_skill_host  | `{stateDir}/workspace-bot-skill`                    | conflict（与 D 双树）                                                                                                | quarantine；断开 watch                  |
| F_canvas      | `{stateDir}/canvas`                                 | unknown                                                                                                              | quarantine                              |
| G_bot2_l2     | `…/OpenBot/workspace-bot-2`                         | **unknown**（重跑后仍无 enterprise-scoped Registry 命中）                                                            | 事故样本：真记忆在此；禁止按 slug 升级  |
| H_bot2_host   | `{stateDir}/workspace-bot-2`                        | conflict（与 G 共享无分区 sqlite）                                                                                   | quarantine；禁止当 prune 全集           |
| I_sqlite_bot2 | `{stateDir}/memory/bot-2.sqlite`                    | conflict / 多根 v1                                                                                                   | 默认停止破坏性 sync（见 §5）            |

未解释可写根：D/E/F 及一切 `workspace-{agentId}` 在缺少 tenant-scoped `agentAssetId` 映射时一律 **unknown**。样本在 Registry 精确映射补齐前，**不得**宣称 Phase 0 退出门禁已闭合。

---

## 5. v1 SQLite 多根识别

| 项                 | 结论                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| 已知多根库         | `{stateDir}/memory/bot-2.sqlite`（事故样本）                                              |
| 根 A               | 租户 `workspace-bot-2`（MEMORY.md + memory/\*.md，status 曾计 50）                        |
| 根 B               | host `workspace-bot-2`（几乎空 + continuity）                                             |
| 检测依据           | 同一 `agentId` 库、无 `workspace_id` 列、prune 按当前 `listMemoryFiles` 缺席删除          |
| 代码               | `src/memory/manager-sync-ops.ts` `syncMemoryFiles`；store `src/agents/memory-search.ts`   |
| 本次动作           | **只识别**。未改 LIVE、未改 `src/memory/**`、未部署跨进程锁                               |
| 建议（待独立评审） | 多根 fingerprint 冲突时拒绝 sync/prune/reset/rebuild；status=unknown；仅 maintenance 解锁 |

通用跨进程止损门禁 = 独立、可回滚发布，**不是**本次已授权范围。

---

## 6. 迁移威胁模型（Phase 0）

| 威胁                     | 现状             | Phase 0 控制                       |
| ------------------------ | ---------------- | ---------------------------------- |
| 规范树 sync 剪光租户行   | 仍可能           | 识别多根；不重索引；不撤 overlay   |
| 请求期合成假 Catalog     | P4 14 处生产     | Freeze：禁新增；不停现网合成       |
| 把 candidate 当 SoT 写入 | Catalog 未建     | candidate 只进 evidence，不持久化  |
| 抢 DGV2 resolver 路径    | 热文件已有 owner | 本任务不改 `workspace-resolver/**` |
| 新 helper / overlay      | 历史分叉源       | Freeze gate + 方案冻结             |
| 提前 miss=deny           | coverage 0%      | 明确禁止                           |

---

## 7. LIVE 只读根枚举（第五次重跑）

复现链（无未记录中间变换；`probe.scriptSha256` 必须等于将提交文件的 SHA-256）：

```text
OPENBOT_STATE_DIR=... OPENBOT_TENANTS_ROOT=... \
  node docs/design/evidence/memory-workspace-phase0-live-roots.mjs --mode raw-controlled \
| node docs/design/evidence/memory-workspace-phase0-live-roots.mjs --mode evidence-summary
```

本轮相对第六次复审的修正：

1. 根分类只允许 `classified | conflict | unknown`。目录推断改为 `classification=unknown` + `resolutionStatus=pending_authority` + `evidenceHint=unique-user-dir`。
2. 退出门禁按 `classification !== "classified"` 计算：`notClassifiedCount=144`，并显式计入 `pendingAuthority=44`。
3. `classificationTrusted` 改名为 `registryParsingTrusted`。

| 项                                          | 值                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| 探针 SHA-256                                | `a555541b2532c199c62429f743e4bae728974e48f9cdf2ee5a24430270418c6d`              |
| 租户 / 用户目录 / 工作区根 / group / sqlite | 13 / 56 / 156 / 31 / 12                                                         |
| classified / conflict / unknown             | **12 / 85 / 59**                                                                |
| pending_authority                           | 44（附在 unknown 上，不是第四种 classification）                                |
| notClassifiedCount                          | 144（门禁 open）                                                                |
| classified 构成                             | 仅 12 个 enterprise-scoped Registry tenant workspace                            |
| employee_steward                            | 45 条互不相同 resourceId；0 classified；44 pending_authority；1 无 hint unknown |
| group 根                                    | 31 已盘点；0 classified                                                         |
| Registry                                    | `registryParsingTrusted=true`；`authoritativeMembership=false`                  |

事故样本 `bot-2` **仍是 unknown**。不得按目录名升级，不得据此解除破坏性 sync 限制。

**结论：** 证据包检查点 Accepted。Phase 0 **工程退出门禁**（inventory / disposition / Freeze / WS-C 接线）可在 `main@1b98b72f95` 复算通过；**治理关闭为 P0 No-Go**（review sequence 24 supersede review-23）。main tip 三门禁机器证据见 `memory-workspace-phase0-main-gate-evidence.json`；仍待 independent official-review 复验与 Runner 长期稳定证明。持久 Catalog coverage 仍是 0%（Phase 1A 输入，非 Phase 0 阻塞）。不得打开 miss=deny，不得把 pending 当 Catalog SoT，不得执行迁移或 LIVE 部署。

复算工程退出门禁：

```bash
node --test docs/design/evidence/memory-workspace-phase0-exit-gate.test.mjs
node docs/design/evidence/memory-workspace-phase0-exit-gate.mjs --json
```

## 8. 未做 / 仍冻结

- LIVE schema、Resolver 切换、重索引、撤 overlay、目录搬迁/删除
- 持久治理 Catalog store / Workspace adapter
- memory schema v2
- §6.6 运行时止损合入与生产发布（独立可回滚评审）

下一步：§14.1 重新签署前 Phase 1 保持 BLOCKED。运行时多根止损需单独评审，不能从本盘点直接合入 `src/memory/**`。
