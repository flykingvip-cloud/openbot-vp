# 企业数据治理与供给中心软残留清理（2026-09-28）

> 基线：`origin/main` `4b305f05f5fa9074abd6a53ddfae3ed8a121d099`（M6 残留清理 `#159`）。
> 依据：最终指令 §5.3–5.4、§9–10、§12 红线 4–5；`docs/design/edgsc-m6-residual-cleanup-2026-09-28.md` §3 明确没做的两处；M6 收口对认知标题的口径。
> **本文件不是验收通过记录。** 不得把任何里程碑标成通过。合并前必须由独立验收人按下面清单逐条核对并书面批准。

## 1. 做了什么

两处软残留都按「消费不从实时 DataSource 连接状态发明治理事实，Agent 只看见已授权的知识对象表面」处理。没有重开红线 4 或红线 5。

| 软残留                                                                                    | 处理                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能力访问判定用 DataSource 类别或断开状态区分「外部 / 可申请」；外部数据源摘要展示连接状态 | 访问只看席位 Grant 与部门/角色策略。断开、`category=external` 不再变成 `accessState=external`。未授权仍是 `requestable`（已有申请则为 `pending`）。`externalSourceCount` 只数已经标成 `external` 的访问结果，不再数实时数据源。知识宇宙加载的外部源摘要固定为空：连接器健康留在企业数据平面，不进入可消费 Feed 的新鲜度或对象。 |
| 认知图 / 认知包仍可能带出席位未授权的能力标题                                             | `runKnowledgeResolveEngine` 在返回前剥掉未授权能力节点（`obj:data:<capabilityId>`），并把仍挂在摘要或边上的标题改成「未授权能力」。已授权能力标题保留。`accessState=restricted` 的对象过滤仍由 `filterObjectsForAgentConsumption` 单独做，本处不接管它。运行时相关组使用同一套剥离后的对象。                                    |
| 无 granted 时 profile 仍回落 `customer.profile`，且 granted 为空时放行 requested          | `buildAgentKnowledgeProfile` 与 `buildKnowledgeAgentProfile` 的 `allowDataCapabilities` 只来自 `accessState=granted`。没有 granted 时为空。requested 只与 granted 取交集，不能把未授权 id 放进允许列表。                                                                                                                        |

## 2. 对照

| 条款                                     | 本次口径                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| §5.3 / §9 知识宇宙只消费 FeedItem        | 消费包不再用 DataSource 连接状态或类别编访问结论，也不再把连接器状态写进宇宙摘要。可消费对象与新鲜度仍只来自已写入的 FeedItem / 供给记录。 |
| §5.4 / §10 Agent 只消费 Knowledge Object | 认知解析图、推荐对象、相关组不再露出未授权能力标题。Agent 仍不申请 Connector Action。                                                      |
| 红线 4 知识宇宙不接 Gateway              | 知识平面仍不 import `data-gateway`，不调用 `invokeEnterpriseDataAction`，不托管供给节拍。                                                  |
| 红线 5 Agent 不申请 Connector Action     | 未新增调用点。生产代码里 `invokeEnterpriseDataAction` 仍只在定义处、员工 `enterprise-data.invoke`、`projection-materializer.ts`。          |

## 3. 明确没做

- 没有把 M6 或本次清理标成通过。
- 没有删除 `ingestKnowledgeDocument` 对缺少 ownership proof 的拒绝。
- 没有让知识宇宙在浏览时调用按需物化或 Gateway。
- 没有改员工宇宙自己的关系图缓存（`buildKnowledgeSourceBundle` 的 `graph`）。剥离发生在 Agent 解析 / 认知运行时返回前。
- 能力目录卡上的 `sourceSystems` 仍可能显示 DataSource 的 `displayName`。那是目录标签，不是连接状态，也不写入 Feed 新鲜度或可消费对象。
- 企业知识检索能力（已索引片段）仍标记为 `fresh`，因为它反映的是索引里已经有的片段，不是连接器状态。
- `accessState` 类型里仍保留 `external`，供已经标好的描述符使用。解析器不再从实时数据源制造这个值。

## 4. 验收清单

独立验收人逐条核对。未核对的项保持未通过。不要在本文件把结果改成通过。

- [ ] 能力访问在数据源 `category=external` 且 `status=disconnected` 时，无 Grant 为 `requestable`，部门/角色策略命中时仍为 `granted`，不会变成 `external`。
- [ ] 知识宇宙外部源摘要不返回实时 DataSource 连接状态；`externalSourceCount` 不按实时数据源类别计数。
- [ ] 上述变化不写入可消费 Feed 的 `feedItems` / `objects`，也不用连接状态编新鲜度。没有供给记录时新鲜度仍为 `unknown`。
- [ ] Agent 认知解析图、对象和推荐里不出现未授权能力标题；已授权能力标题仍在。
- [ ] `allowDataCapabilities` 只含已 granted 的能力。没有 granted 时为空，不回落 `customer.profile`，也不放行 requested。
- [ ] `filterObjectsForAgentConsumption` 仍去掉 `accessState=restricted`。剥离未授权能力标题不会把受限对象滤掉或加回来。
- [ ] `src/gateway/knowledge/` 生产代码不 import、不调用 `runProjectionMaterialization` / `invokeEnterpriseDataAction`。
- [ ] 生产代码里 `invokeEnterpriseDataAction` 只出现在定义处、员工执行入口、`projection-materializer.ts`。测试文件除外。
- [ ] 第 5 节命令在该提交上复跑。本清单仍须人工批准后才能合并。

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

- 第 5 节 vitest：18 个文件，98 passed / 0 failed。其中个人入库治理用例仍在，企业闭包黄金路径通过。允许列表用例锁住：没有 granted 时 `allowDataCapabilities` 为空，requested 不能把 `customer.profile` 放进来。
- 另跑了认知图、入站策略、上下文治理和 `resolve-engine.test.ts`。连同第 5 节合计 22 个文件，145 passed / 0 failed。
- 生产代码 `invokeEnterpriseDataAction` 命中与上列三个文件一致。
