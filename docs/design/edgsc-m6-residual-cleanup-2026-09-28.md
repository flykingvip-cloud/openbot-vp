# 企业数据治理与供给中心 M6 残留清理（2026-09-28）

> 基线：`origin/main` `720d7ae1b508207c76334c8ee64e4cd7a161038e`（已包含 M6 合入 `f00177e06`）。分支在打开期间已变基到这个 tip。
> 依据：最终指令 §5.3–5.4、§9–10、§12 红线 4–5；M6 收口文档 §4 留下的三处残留。
> **本文件不是验收通过记录。** 不得把任何里程碑标成通过。合并前必须由独立验收人按下面清单逐条核对并书面批准。

## 1. 做了什么

三处残留都按「消费只读已写入的 FeedItem，供给才调用 Gateway」处理。没有重开红线 4 或红线 5。

| 残留                                                                                     | 处理                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据能力 Feed 用 DataSource 连接状态编新鲜度，并合成可消费展示项                         | 知识 Feed 只保留已写入的企业 FeedItem。能力目录不再合成 `feedItems` / `objects`。目录卡和 `knowledge.capability.invoke` 的新鲜度改读投影绑定上已落盘的 FeedItem；没有供给记录则为 `unknown`。闭包黄金路径的回复上下文改为核对供给写下的 Feed 标题，不再依赖合成的「客户画像能力」卡片。 |
| `scheduled-projection-materializer.ts` 留在知识目录并调用 `runProjectionMaterialization` | 定时节拍与按需供给助手都迁到 `src/gateway/enterprise-data/`。网关维护节拍改为从该目录调用。知识平面生产代码不再出现 `runProjectionMaterialization`。                                                                                                                                    |
| 个人知识库入库黄金路径因缺少 ownership proof 失败                                        | 用例改为传入 `ownershipProofFromTenantUser`，并使用临时 `governanceStateDir`。生产入库仍在缺少证明时拒绝。安全断言未删。                                                                                                                                                                |

## 2. 对照

| 条款                                              | 本次口径                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5.3 / §9 知识宇宙只消费 FeedItem                 | `loadKnowledgeFeedBundle` 不再并入数据能力合成项。未物化时企业 Feed 仍为空，数据能力对象也不再被编进可消费 Feed。                                                     |
| §5.4 / §10 / 红线 5 Agent 不申请 Connector Action | 未新增 Agent 到 Gateway 的调用。`invokeEnterpriseDataAction` 的生产调用点仍应只有员工 `enterprise-data.invoke` 与 `ProjectionMaterializer`。                          |
| 红线 4 知识宇宙不接 Gateway                       | 知识平面不 import `data-gateway`，不调用 `invokeEnterpriseDataAction`，也不再托管供给节拍。                                                                           |
| 供给节拍仍可用                                    | `tickScheduledProjectionMaterialization` 仍由网关维护调用，实现位于 `enterprise-data/scheduled-projection-materializer.ts`，内部仍走 `runProjectionMaterialization`。 |

## 3. 明确没做

- 没有把 M6 或本次清理标成通过。
- 没有删除 `ingestKnowledgeDocument` 对 `governance_write_denied:missing_ownership_proof` 的拒绝。
- 没有让知识宇宙在浏览时调用按需物化或 Gateway。
- 能力访问判定仍可能读取 DataSource 的类别或断开状态，用来区分「外部 / 可申请」。那不是新鲜度，也不是合成 Feed 项。外部数据源摘要仍展示数据源状态。这两处不在本次三处残留的改动里。
- 企业知识检索能力（已索引片段）仍标记为 `fresh`，因为它反映的是索引里已经有的片段，不是连接器状态。

## 4. 验收清单

独立验收人逐条核对。未核对的项保持未通过。不要在本文件把结果改成通过。

- [ ] 知识 Feed / 宇宙加载不读取 DataSource 连接状态来给可消费对象编新鲜度。
- [ ] 未物化时，知识 Feed 里没有数据能力合成项；物化后的企业 Feed 仍带 lineage 与 freshness。
- [ ] 能力目录新鲜度只来自已写入的 FeedItem；没有供给记录时为 `unknown`，即使数据源已断开。
- [ ] `src/gateway/knowledge/` 生产代码不 import、不调用 `runProjectionMaterialization` / `invokeEnterpriseDataAction`。
- [ ] 定时供给节拍仍在 `src/gateway/enterprise-data/scheduled-projection-materializer.ts`，网关维护仍调用它。
- [ ] 按需供给助手若存在，只在企业数据供给侧，宇宙加载不调用它。
- [ ] 个人入库黄金路径通过，且通过原因是测试提供了真实 ownership proof。
- [ ] 缺少 ownership proof 的托管入库仍然失败（`kb-ingest.governance.test.ts` 对应用例仍在）。
- [ ] 生产代码里 `invokeEnterpriseDataAction` 只出现在定义处、员工执行入口、`projection-materializer.ts`。测试文件除外。
- [ ] 第 5 节命令在该提交上复跑，个人入库用例为通过。本清单仍须人工批准后才能合并。

## 5. 建议复跑

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/knowledge/feed/knowledge-feed-adapter.test.ts \
  src/gateway/knowledge/knowledge-consumption-boundary.test.ts \
  src/gateway/knowledge/runtime/agent-cognitive-adapter.test.ts \
  src/gateway/knowledge/m6-integration.test.ts \
  src/gateway/knowledge/lineage/lineage-explain.test.ts \
  src/gateway/server-methods/enterprise-data-m6.test.ts \
  src/gateway/enterprise-data/capability-agent-invoke-runtime.test.ts \
  src/agents/tools/data-capability-tool.test.ts \
  src/gateway/enterprise-data/agent-data-planner.test.ts \
  src/gateway/enterprise-data/on-demand-projection-materializer.test.ts \
  src/agents/execution-preflight/reuse-observe-helper-lock.test.ts \
  src/gateway/knowledge/knowledge-data-closure.golden-path.test.ts \
  src/gateway/enterprise-data/scheduled-projection-materializer.test.ts \
  src/gateway/enterprise-data/capability-supply-freshness.test.ts \
  src/gateway/knowledge/feed/data-capability-feed-adapter.test.ts \
  src/gateway/knowledge/capability-invoke-runtime.test.ts \
  src/gateway/knowledge/sources/capability-access-resolver.test.ts \
  src/gateway/knowledge/kb-ingest.governance.test.ts
```

红线 5 调用点：

```bash
rg -n "invokeEnterpriseDataAction" src --glob '!*.test.ts'
```

期望生产命中只在：

- `src/gateway/enterprise-data/data-gateway.ts`（定义）
- `src/gateway/server-methods/enterprise-data-m1.ts`（员工执行）
- `src/gateway/enterprise-data/projection-materializer.ts`（供给）

## 6. 提交时的复跑记录

下面只是实现者在本分支上的复跑记录，**不是验收通过**。

- 第 5 节 vitest：18 个文件，93 passed / 0 failed。其中个人入库黄金路径 `closes personal KB ingest → retrieve → generation lineage writeback` 通过。企业闭包那条也通过，回复上下文核对的是已写入 Feed 的标题。
- 缺少 ownership proof 的拒绝仍由 `kb-ingest.governance.test.ts` 覆盖，该文件 4 条通过。
- 生产代码 `invokeEnterpriseDataAction` 命中与上列三个文件一致。`capability-agent-invoke-runtime.test.ts` 里的调用面锁同时通过。
