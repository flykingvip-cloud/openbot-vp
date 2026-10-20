# 企业数据治理与供给中心 M6 验收收口（2026-09-28）

> 审计性质：只读独立验收。本次不改实现，不修复红线 5。  
> 审计 HEAD：`812d8e83059e41b4af4b547797952b37e65c0776`（`EDGSC: M5 acceptance close`，核对时与 `origin/main` 一致）。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §5.3–5.4、§9–10、§11 M6、§12。对照完成报告 `docs/design/edgsc-m6-completion-report-2026-06-05.md` 与差距审计 `docs/design/edgsc-gap-audit-2026-09-27.md` §2–§3。  
> 范围：仅 M6（Knowledge Feed Adapter、Knowledge Universe、Agent Cognitive Runtime、Employee Agent 执行入口）。M1–M5 不在本文验收范围内，本文不改写它们的验收状态。  
> **结论是有条件通过。通过前不得建议合并。本 PR 只提交本验收收口文档。** 不得把本文当成「M6 已批准、可以并入 `main`」的依据。

## 1. 结论

**有条件通过**

在上述 HEAD 上，M6 的 Feed Adapter、知识宇宙经适配器消费 FeedItem、Agent 认知包对 Knowledge Object 的 restricted 过滤、消费侧血缘解释只读，以及知识平面不 import Enterprise Data Gateway，均能在代码和本次测试里对上。

§12 红线 5 仍是 **OPEN**。它阻断「Agent Runtime 不直接申请底层 Action」的完整闭环。该缺口单独成节，不用来否定上面已经落地的 Feed Adapter 与知识宇宙消费路径。

因此本里程碑不能写成无条件通过，也不能建议把 M6 作为已批准项合并进 `main`。

## 2. 分项核对

| 交付                                          | 核对                                                                                                                                                                                                                                                                                                                                                                                                                                | 证据                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge Feed Adapter                        | **成立。** `loadKnowledgeFeedBundle` 把企业 Feed 与数据能力 Feed 合成同一 `KnowledgeFeedBundle`。企业侧把 `EnterpriseKnowledgeObjectFeedItem` 改编为 `KnowledgeFeedItem`，并挂上 `lineageId`、`freshnessStatus`。类型在 `feed/types.ts`。适配器函数本身不调用 `invokeEnterpriseDataAction`。                                                                                                                                        | `src/gateway/knowledge/feed/knowledge-feed-adapter.ts`；`src/gateway/knowledge/feed/enterprise-feed-adapter.ts`；`src/gateway/knowledge/feed/types.ts`                                                                                                    |
| Knowledge Universe 经适配器消费 FeedItem      | **成立，附残留。** `loadEnterpriseStoreBundle` 在装配对象列表时调用 `loadKnowledgeFeedBundle`，并把 `feedItems`、可访问企业对象、restricted 分栏放进宇宙 bundle。RPC `knowledge.feed.list` 已注册，返回 `feedItems` 与分栏摘要。残留见 §4：同一次宇宙加载会先走按需物化。                                                                                                                                                           | `src/gateway/knowledge/source-bundle.ts`；`src/gateway/knowledge/router.ts` 的 `knowledgeFeedList`；`src/gateway/server-methods/knowledge.ts` 的 `knowledge.feed.list`                                                                                    |
| Agent Cognitive Runtime 消费 Knowledge Object | **认知包路径成立。** `filterObjectsForAgentConsumption` 去掉 `accessState=restricted`。`runKnowledgeResolveEngine` 先按 `agentType` 装宇宙，再在检索池上做同一过滤。`knowledge.cognitive.bundle` 对 resolve 对象和 context 的 primary / related / recommended 再滤一次。提示词要求经知识宇宙消费，并写明不要直接调用外部 CRM/ERP/Connector API。完整的「Agent 只消费 Knowledge Object、不申请 Action」见 §3，本行不把它写成已闭合。 | `src/gateway/knowledge/runtime/agent-cognitive-adapter.ts`；`src/gateway/knowledge/resolve/resolve-engine.ts`；`src/gateway/knowledge/router.ts` 的 `knowledgeCognitiveBundle`；`src/gateway/server-methods/knowledge.ts` 的 `knowledge.cognitive.bundle` |
| 血缘解释只读                                  | **成立。** `explainKnowledgeLineage` 只调用 `resolveKnowledgeLineageChain` 读存储，并带回 `chain` 与 `reverseChain`。文件不 import `data-gateway`，不调用 `invokeEnterpriseDataAction`。RPC `knowledge.lineage.explain` 只加载 store 后调用该函数，不走宇宙装配，也不走按需物化。                                                                                                                                                   | `src/gateway/knowledge/lineage/lineage-explain.ts`；`src/gateway/knowledge/router.ts` 的 `knowledgeLineageExplain`；`src/gateway/server-methods/knowledge.ts` 的 `knowledge.lineage.explain`                                                              |
| 知识平面硬边界                                | **成立。** `knowledge-consumption-boundary.test.ts` 禁止知识平面生产代码出现 `invokeEnterpriseDataAction`、`enterprise-data/data-gateway`、`knowledgeDataInvoke`。`knowledge.data.invoke` 与 `knowledge.publish.execute` 未注册。本次测试 3 条通过。知识平面对 Gateway 的间接供给触发记在 §4，不把红线 4 改写成失败，也不把它写成无残留的 PASS。                                                                                    | `src/gateway/knowledge/knowledge-consumption-boundary.test.ts`；`src/gateway/server-methods-list.ts`；`src/gateway/method-scopes.ts`；`src/gateway/server-methods/knowledge.ts`                                                                           |
| 员工执行入口                                  | **员工 RPC 仍是 `enterprise-data.invoke`。** 生产代码里调用 `invokeEnterpriseDataAction` 的实现有三处：员工 RPC `enterprise-data.invoke`、供给侧 `runProjectionMaterialization`、Agent 工具桥 `invokeDataCapabilityWithContext`。第三处是红线 5，见 §3。M6 没有新增另一条员工执行 RPC。                                                                                                                                             | `src/gateway/server-methods/enterprise-data-m1.ts`；`src/gateway/enterprise-data/projection-materializer.ts`；`src/gateway/enterprise-data/capability-agent-invoke-runtime.ts`                                                                            |

固定消费链路在适配器这一层可以写成：

`FeedItem → Knowledge Feed Adapter → Knowledge Universe → Agent Cognitive Runtime（Knowledge Object）`

§9–10 要求企业端负责治理与供给，知识宇宙负责组织、发现与消费，Agent Runtime 负责检索、推理与回答。上表前四行对得上这条消费方向。Agent 直接申请 Action 的缺口不写进这条链路的「已交付」里。

`src/gateway/server-methods/enterprise-data-m6.ts` 是能力中心首页仪表盘 RPC（`enterprise-data.dashboard.*` 等）。它与 §11 M6 的知识宇宙 / Agent 联调不是同一交付。本文不以该文件作为 M6 通过证据。

## 3. 红线 5（单独记录，不抵消 §2）

**状态：OPEN。本次不修。不得写成 PASS。**

已核实调用链仍在：

`src/agents/tools/data-capability-tool.ts`  
→ `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` 的 `invokeDataCapabilityForAgent` / `invokeDataCapabilityWithContext`  
→ `invokeEnterpriseDataAction`

工具名是 `data_capability`，`action=invoke` 时传入 `capabilityId`。`src/agents/openclaw-tools.ts` 在默认工具集里注册了 `createDataCapabilityTool`。运行时注释把它写成 W5 受控桥：Seat 由服务端解析，底层仍走 Grant、Scope、脱敏、审批和审计，知识平面边界测试因此扫不到这条路径。

§5.4 与 §12 第 5 条要求 Agent Runtime 只消费 Knowledge Object，真正调用 Enterprise Data Gateway 的供给实现是 `ProjectionMaterializer`。当前 Agent 工具可以按 capability 的 `actionRefs` 触发 `ConnectorAction@version`。认知提示词在「不要直接调用外部 Connector API」之外，同时把 CRM/ERP 行指向 `data_capability`（`src/gateway/knowledge/resolve/context-builder.ts`）。这是提示分流，不是红线闭合。

本缺口阻断的是「Agent 不直接申请 Action」的完整闭环。它不否定 §2 里 Feed Adapter、宇宙经适配器消费 FeedItem、认知包过滤 restricted、血缘解释只读、知识平面不 import Gateway 这些已经落地的部分。

## 4. 残留项（记录，本次不修）

1. **宇宙加载会间接触发供给。** `src/gateway/knowledge/source-bundle.ts` 在 `loadKnowledgeFeedBundle` 之前调用 `src/gateway/knowledge/feed/on-demand-projection-materializer.ts` 的 `ensureOnDemandProjectionsMaterialized`，后者调用 `runProjectionMaterialization`。知识平面没有直接 import Gateway。可见且尚无 Feed 记录的 `on_demand` 绑定，会在宇宙装配时被物化（单次最多 3 条）。  
   差距审计 §3 写过「`knowledge.feed.list` 本身不在这条路径上」。本次核对时该句已过时：`knowledgeFeedList` 经 `loadKnowledgeBundle` 进入 `loadKnowledgeSourceBundle`，因此 `knowledge.feed.list` 与 `knowledge.cognitive.bundle` 都会走到同一装配。完成报告里「`knowledge.feed.list` 不触发物化」与当前代码不一致。`loadKnowledgeFeedBundle` 函数本身仍不调用物化器；`knowledge.lineage.explain` 也不走这条路径。本残留保持记录，不在本 PR 修改。
2. **能力 Feed 读取 DataSource 元数据。** `src/gateway/knowledge/feed/data-capability-feed-adapter.ts` 用 `listDataSources` 取显示名，并用 `resolveCapabilityFreshness` 按 DataSource `status` 计算 fresh / stale / unknown。该函数不调用 Gateway。这与 §5.3「知识宇宙只消费 `EnterpriseKnowledgeObjectFeedItem`、不消费 DataSource」的字面边界不完全重合，属于展示层读取。保持差距审计 §3 的记录。

另记一条观察，不单独立项否决：`loadEnterpriseKnowledgeFeed` 在已落库 FeedItem 之外，还会把 `lifecycle=active` 且绑定启用的投影规格经 `adaptEnterpriseProjectionSpec` 编成 FeedItem。这条仍在适配器内，不调用 Gateway。

## 5. 本次明确不做

- 不改 `src/agents/tools/data-capability-tool.ts` 或 `capability-agent-invoke-runtime.ts`。红线 5 保持 OPEN。
- 不改按需物化，不改能力 Feed 的 DataSource 新鲜度读取。
- 不验收 M1–M5，不把它们写成由本文重新通过或重新否决。
- 不把 `enterprise-data-m6.ts` 仪表盘 RPC 算进 §11 M6。
- 不建议在红线 5 仍 OPEN、本文仅为有条件通过时，把 M6 当作已批准项合并进 `main`。

## 6. 测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/knowledge/knowledge-consumption-boundary.test.ts \
  src/gateway/knowledge/feed/knowledge-feed-adapter.test.ts \
  src/gateway/knowledge/feed/data-capability-feed-adapter.test.ts \
  src/gateway/knowledge/feed/on-demand-projection-materializer.test.ts \
  src/gateway/knowledge/lineage/lineage-explain.test.ts \
  src/gateway/knowledge/runtime/agent-cognitive-adapter.test.ts \
  src/gateway/knowledge/m6-integration.test.ts
```

结果：**7 files, 16 tests passed**（核对 HEAD `812d8e83059e41b4af4b547797952b37e65c0776`）。

| 套件                                        | 条数 | 本次它证明的事                                                                                                                                                              |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-consumption-boundary.test.ts`    | 3    | 知识平面生产代码不出现 Gateway 调用；未注册 `knowledge.data.invoke`                                                                                                         |
| `knowledge-feed-adapter.test.ts`            | 1    | 种子库物化后，统一 Feed 带 `lineageId` 与 `freshnessStatus`，并同时有企业对象与数据能力对象                                                                                 |
| `data-capability-feed-adapter.test.ts`      | 4    | 新鲜度只根据 DataSource 状态推导：全连接为 fresh，任一断开或错误为 stale                                                                                                    |
| `on-demand-projection-materializer.test.ts` | 2    | 可见的 `on_demand` 绑定在 Feed 为空时会被物化                                                                                                                               |
| `lineage-explain.test.ts`                   | 1    | 解释从 store 读出 feed / projection / connector_action 层，反向链动作在源数据之前；测试里的物化发生在解释之前                                                               |
| `agent-cognitive-adapter.test.ts`           | 2    | 默认 `employee-agent`；restricted 对象被滤掉                                                                                                                                |
| `m6-integration.test.ts`                    | 3    | `knowledge.feed.list` 返回数组和分栏计数字段；认知包与 resolve/context 路径上的对象不是 restricted。该套件用空 client，不断言租户 Feed 内容；租户 Feed 内容以适配器单测为准 |

未跑完整 `src/gateway/knowledge/` 目录。完成报告中的「Knowledge 平面 49 passed」不是本次复跑结果。

## 7. 给后续验收的口径

1. Feed Adapter、宇宙分栏、认知包 restricted 过滤、血缘解释只读、知识平面边界，按 §2 核对，可以保持「已交付」。
2. 红线 5 保持 OPEN。路径仍是 `data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。
3. `knowledge.feed.list` 与 `knowledge.cognitive.bundle` 会经宇宙装配触发按需物化。`knowledge.lineage.explain` 不会。
4. 本文件是有条件通过。通过前不得建议合并。本 PR 的 diff 应只有本文。
