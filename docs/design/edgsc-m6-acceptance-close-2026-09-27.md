# 企业数据治理与供给中心 M6 验收收口（2026-09-27）

> 基线：`origin/main` `812d8e83059e41b4af4b547797952b37e65c0776`（M5 验收合入，PR #156）。  
> 依据：最终指令 §5.3–5.4、§9–10、§11 M6、§12。  
> 本文只说明 M6 可以交给专属验收机器人。**验收机器人批准前，M6 不是通过。**

## 1. 结论

M6 的 Knowledge Feed Adapter、Knowledge Universe、Agent Cognitive Runtime，以及 `knowledge.feed.list` / `knowledge.lineage.explain` / `knowledge.cognitive.bundle`，在上述基线上已经落在代码里。本分支关闭了红线 5，并让知识宇宙加载只读已有 FeedItem。

员工执行入口仍是 `enterprise-data.invoke`。供给侧调用 Gateway 的实现仍是 `runProjectionMaterialization`。

## 2. 对照

| 条款                                         | 核对                                                                                                                                                                                                                                                                                  | 代码                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| §11 Knowledge Feed Adapter                   | `loadKnowledgeFeedBundle` 合并企业 Feed 与数据能力 Feed。企业对象只来自已写入的 `EnterpriseKnowledgeObjectFeedItem`。没有物化记录的投影规格不会被编成宇宙对象。                                                                                                                       | `feed/knowledge-feed-adapter.ts`；`feed/enterprise-feed-adapter.ts` |
| §5.3 / §9 Knowledge Universe 只消费 FeedItem | `knowledge.feed.list` 走 `loadKnowledgeSourceBundle`，返回 `feedItems`。宇宙加载不再调用按需物化。                                                                                                                                                                                    | `source-bundle.ts`；`router.ts` 的 `knowledgeFeedList`              |
| §5.4 / §10 Agent 只消费 Knowledge Object     | `knowledge.cognitive.bundle` 对 resolve / context 做 `filterObjectsForAgentConsumption`，去掉 `accessState=restricted`。                                                                                                                                                              | `runtime/agent-cognitive-adapter.ts`；`router.ts`                   |
| §11 三个消费 RPC                             | `knowledge.feed.list`、`knowledge.lineage.explain`、`knowledge.cognitive.bundle` 在 `server-methods/knowledge.ts`。`knowledge.lineage.explain` 只读存储。                                                                                                                             | `server-methods/knowledge.ts`；`lineage/lineage-explain.ts`         |
| 知识平面不 import Gateway                    | 边界测试禁止知识平面出现 `invokeEnterpriseDataAction` / `data-gateway`。没有 `knowledge.data.invoke`。                                                                                                                                                                                | `knowledge-consumption-boundary.test.ts`                            |
| §12 红线 5                                   | **本分支关闭。** `data_capability` 的 `invoke` 直接返回 `knowledge-object-only`，不调用 agent invoke。`invokeDataCapabilityWithContext` 在席位、授权、配额之后失败关闭，不请求 ConnectorAction。生产代码里该调用只剩员工 `enterprise-data.invoke` 与 `runProjectionMaterialization`。 | `data-capability-tool.ts`；`capability-agent-invoke-runtime.ts`     |
| 执行授权仍是 Seat                            | 本分支不新增 DigitalHuman 或 KnowledgeObject 权限主体。Gateway 执行路径未改。                                                                                                                                                                                                         | `enterprise-data-m1.ts`；`data-gateway.ts`                          |

`src/gateway/server-methods/enterprise-data-m6.ts` 是数据能力中心首页只读聚合，不是 §11 M6 的三个知识消费 RPC。验收请以 `server-methods/knowledge.ts` 为准。

## 3. 本分支修的缺口

红线 5 的原路径是 `src/agents/tools/data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。Agent 工具的 `invoke` 不再进入这条运行时。运行时本身也不再请求 ConnectorAction。`executeDataPlan` 与知识库外部源抓取若仍调用该运行时，得到的是 `knowledge-object-only`，不是连接器行。

`loadEnterpriseStoreBundle` 不再调用 `ensureOnDemandProjectionsMaterialized`。`knowledge.feed.list` 因此不会在浏览时物化。按需物化函数还在，供供给方调用；宇宙加载不调用它。没有 Feed 记录的投影规格也不再被适配成宇宙对象。

## 4. 留给验收机器人、本分支不改的行为

数据能力 Feed 仍读取 DataSource 状态来计算新鲜度，并据此合成 Feed 展示项。它不调用 Gateway。这和「知识宇宙只消费已物化的 EnterpriseKnowledgeObjectFeedItem」的字面边界不完全重合，仍是展示层读取。

`scheduled-projection-materializer.ts` 仍在知识目录下，由网关维护节拍调用 `runProjectionMaterialization`。那是供给节拍，不是宇宙加载，也不是 Agent 申请 Action。

`on_demand` 绑定不会再因为打开知识宇宙而自动物化。供给入口仍是 `enterprise-data.projection-materializer.run` 与 scheduled 模式。

`knowledge-data-closure.golden-path.test.ts` 的个人知识库入库用例在 `origin/main` 上已经因缺少 ownership proof 失败。本分支没有改那条入库路径。

## 5. 验收机器人应核对

1. `data_capability` action=`invoke` 返回 `knowledge-object-only`，且不调用 `invokeDataCapabilityForAgent`。
2. 已授权席位调用 `invokeDataCapabilityWithContext` 不调用企业数据 Gateway，结果原因是 `knowledge-object-only`。
3. 生产代码里 `invokeEnterpriseDataAction` 只出现在 `data-gateway.ts`、`enterprise-data-m1.ts`、`projection-materializer.ts`。
4. `source-bundle.ts`、`router.ts`、`enterprise-feed-adapter.ts` 不调用按需物化，也不把没有 Feed 记录的投影规格编成对象。
5. 物化之后的企业 Feed 带 lineage 与 freshness。未物化时企业 Feed 为空；数据能力展示项仍可出现。
6. `knowledge.cognitive.bundle` 的对象不含 `accessState=restricted`。`knowledge.lineage.explain` 只读，并带回反向链。
7. 知识平面不 import Gateway。员工执行仍是 `enterprise-data.invoke`。供给仍经 `runProjectionMaterialization`。
8. 批准前不要把 M6 写成通过。

## 6. 测试

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
  src/gateway/knowledge/feed/on-demand-projection-materializer.test.ts \
  src/agents/execution-preflight/reuse-observe-helper-lock.test.ts \
  src/gateway/knowledge/knowledge-data-closure.golden-path.test.ts
```

结果：**11 files fully passed；golden path 2 tests 中消费链 1 passed，个人入库 1 failed**（2026-09-27，分支 `cursor-grok/edgsc-m6-acceptance-close`，基线 `812d8e830`）。合计 **70 passed / 1 failed**。失败的是 `closes personal KB ingest → retrieve → generation lineage writeback`：`ingestKnowledgeDocument` 因缺少 ownership proof 拒绝。同一失败在未改入库代码的 `origin/main` 上可以复现，不是本分支回归。

其中 `knowledge-feed-adapter.test.ts` 2 条，含未物化时企业 Feed 为空；`knowledge-consumption-boundary.test.ts` 4 条，含宇宙加载不物化；`agent-cognitive-adapter.test.ts` 2 条；`m6-integration.test.ts` 3 条；`lineage-explain.test.ts` 1 条；`enterprise-data-m6.test.ts` 20 条（首页聚合，不是三个知识消费 RPC）；`capability-agent-invoke-runtime.test.ts` 14 条，含失败关闭与生产调用面锁；`data-capability-tool.test.ts` 7 条；`agent-data-planner.test.ts` 8 条；`on-demand-projection-materializer.test.ts` 2 条；`reuse-observe-helper-lock.test.ts` 6 条。
