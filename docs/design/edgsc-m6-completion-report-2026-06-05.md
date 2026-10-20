# 企业数据治理与供给中心 M6 知识宇宙与 Agent 联调 — 待验收报告（2026-06-05）

> 前置：M5 治理闭环已通过边界修复（知识平面不得直连 Gateway）。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §9–10、§11 M6  
> 总计划：`docs/design/edgsc-master-implementation-plan-2026-06-05.md`

## 〇、阶段定位

**M6 = Feed Adapter 深化 + Knowledge Universe 联调 + Agent Runtime 消费契约**

| 类别          | M6 交付                                                           | 明确未做                                      |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Feed Adapter  | 统一 `loadKnowledgeFeedBundle`（企业 Feed + 数据能力 Feed）       | 跨租户同步、外部 SIEM                         |
| 血缘消费      | `knowledge.lineage.explain`（只读 Store，不调用 Gateway）         | 治理面 `enterprise-data.lineage.resolve` 替代 |
| Universe      | `knowledge.feed.list`、restricted/accessible 分栏入 bundle        | 首页 UI 画布（KU-05 系列）                    |
| Agent Runtime | `knowledge.cognitive.bundle`、`resolve/context` 过滤 restricted   | Agent Memory 持久化（KU-22-4）                |
| 边界          | 知识平面无 `invokeEnterpriseDataAction` / `knowledge.data.invoke` | 任何 Capability→Gateway 消费路径              |

## 一、硬约束自检

| #   | 约束                                        | 状态 | 证据                                                                |
| --- | ------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 1   | Knowledge Universe 只吃 FeedItem            | ✅   | `knowledge-feed-adapter.ts` → `source-bundle.ts`                    |
| 2   | Agent Runtime 只吃 Knowledge Object         | ✅   | `filterObjectsForAgentConsumption`；`resolve-engine.ts`             |
| 3   | 消费层不得直连 Gateway                      | ✅   | `knowledge-consumption-boundary.test.ts`                            |
| 4   | 可见性按 agentType 评估                     | ✅   | `source-bundle` 传递 `agentType`；M4 visibility store               |
| 5   | 血缘解释不触发执行                          | ✅   | `lineage-explain.ts` 仅读 Store + `lineage-governance-store` 链解析 |
| 6   | 员工执行仍仅 `enterprise-data.invoke`（M1） | ✅   | 无新增执行 RPC                                                      |

## 二、固定消费链路（M6 联调后）

```text
DataSource → DataCapability → ProjectionSpec → Materializer → FeedItem
  → Knowledge Feed Adapter → Knowledge Universe → Agent Runtime → Employee Agent
```

## 三、交付物清单

### 3.1 Feed Adapter

| 模块                              | 说明                                   |
| --------------------------------- | -------------------------------------- |
| `feed/knowledge-feed-adapter.ts`  | 统一企业 + 数据能力 Feed 编排          |
| `feed/enterprise-feed-adapter.ts` | 挂接 `lineageId`、`freshnessStatus`    |
| `feed/types.ts`                   | `KnowledgeFeedFreshnessStatus`         |
| `source-bundle.ts`                | 经 Feed Adapter 装配 Universe 对象列表 |

### 3.2 血缘消费侧

| 模块                         | 说明                         |
| ---------------------------- | ---------------------------- |
| `lineage/lineage-explain.ts` | 消费层血缘解释（Store 只读） |

### 3.3 Agent Runtime 联调

| 模块                                 | 说明                                              |
| ------------------------------------ | ------------------------------------------------- |
| `runtime/agent-cognitive-adapter.ts` | `agentType` 解析、restricted 过滤                 |
| `resolve/resolve-engine.ts`          | Agent 任务检索池过滤 restricted                   |
| `router.ts`                          | `knowledgeCognitiveBundle` 聚合 resolve + context |

### 3.4 Gateway RPC（M6 新增）

| 方法                         | 说明                                                |
| ---------------------------- | --------------------------------------------------- |
| `knowledge.feed.list`        | 标准化 Feed 列表 + 分栏摘要                         |
| `knowledge.lineage.explain`  | 消费层血缘解释                                      |
| `knowledge.cognitive.bundle` | Agent Runtime 认知包（profile + resolve + context） |

既有 `knowledge.resolve` / `knowledge.context` / `knowledge.agent-profile` 已接入 Agent 过滤与 `agentType` 上下文。

## 四、测试证据

```bash
pnpm exec vitest run src/gateway/knowledge/
pnpm exec vitest run src/gateway/knowledge/knowledge-consumption-boundary.test.ts
pnpm exec vitest run src/gateway/enterprise-data/
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m*.test.ts
```

| 套件                                     | M6 关键覆盖                              |
| ---------------------------------------- | ---------------------------------------- |
| `knowledge-feed-adapter.test.ts`         | 统一 Feed、lineage、freshness            |
| `lineage-explain.test.ts`                | 消费侧全链路层序                         |
| `agent-cognitive-adapter.test.ts`        | agentType、restricted 过滤               |
| `m6-integration.test.ts`                 | cognitive.bundle、resolve/context 一致性 |
| `resolve-engine.test.ts`                 | 意图/来源/上下文引擎回归                 |
| `knowledge-consumption-boundary.test.ts` | **无知识平面→Gateway 路径**              |

**Knowledge 平面：49 passed**

## 五、与 M5 治理 RPC 的边界

| 能力       | 治理面（M5）                               | 消费面（M6）                                                       |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------ |
| 血缘全链路 | `enterprise-data.lineage.resolve`（admin） | `knowledge.lineage.explain`（seat 消费解释）                       |
| 供给审计   | `enterprise-data.supply-audit.*`           | Feed 摘要中的 `feedItemCount`                                      |
| 审批       | `enterprise-data.governance-approvals.*`   | `knowledge.access.request` / `knowledge.enterprise.access.request` |

## 六、专家复验建议关注点

1. **消费边界**：确认 Agent 检索结果不含 `accessState=restricted` 对象。
2. **Feed 只读**：`knowledge.feed.list` 不触发物化或 Gateway。
3. **双 RPC 血缘**：治理 resolve 与消费 explain 职责分离，不混用权限域。
4. **M1–M5 回归**：enterprise-data 套件无回归。

## 七、结论

M6 Feed Adapter / Knowledge Universe / Agent Runtime 联调链路已落地；消费层与执行层边界保持冻结。

**状态：待专家验收。**
