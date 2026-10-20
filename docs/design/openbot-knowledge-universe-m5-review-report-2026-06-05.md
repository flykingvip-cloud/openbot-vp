# OpenBot 知识宇宙 M5 待审核报告

Date: 2026-06-05

权威方案：`docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 定稿）

## 1. 阶段目标

M5：Agent Runtime 集成（KU-19 ~ KU-23）

- `knowledge.resolve` 由 Resolve Engine 驱动
- `knowledge.context` 构建任务知识上下文
- `knowledge.agent-profile` 认知配置
- Agent Cognitive Runtime Adapter
- Employee Agent 消费知识宇宙与关系网络

## 2. 交付清单

### 2.1 Knowledge Resolve Engine（KU-19）

| 文件                                                 | 任务                                   |
| ---------------------------------------------------- | -------------------------------------- |
| `src/gateway/knowledge/resolve/intent-classifier.ts` | KU-19-1 任务意图识别                   |
| `src/gateway/knowledge/resolve/source-selector.ts`   | KU-19-2 知识来源选择                   |
| `src/gateway/knowledge/resolve/context-builder.ts`   | KU-19-3 Agent 上下文组装               |
| `src/gateway/knowledge/resolve/resolve-engine.ts`    | KU-19 / KU-20 / KU-21 编排             |
| `src/gateway/knowledge/router.ts`                    | resolve / context / agent-profile 升级 |

### 2.2 Agent Runtime Adapter（KU-22）

| 文件                                                                   | 任务                         |
| ---------------------------------------------------------------------- | ---------------------------- |
| `src/gateway/knowledge/adapter/knowledge-resolver-adapter.ts`          | KU-22-1 resolve 接线         |
| `src/gateway/knowledge/adapter/relationship-recommendation-adapter.ts` | KU-22-2 推荐接线             |
| `src/gateway/knowledge/adapter/knowledge-context-adapter.ts`           | KU-22-3 context 接线         |
| `src/gateway/knowledge/adapter/agent-memory-adapter.ts`                | KU-22-4 最近访问 memory 适配 |
| `src/gateway/knowledge/adapter/cognitive-runtime-adapter.ts`           | 认知运行时聚合入口           |

### 2.3 Employee Agent 集成（KU-23）

| 文件                                                 | 说明                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `src/gateway/knowledge/reply-gateway-client.ts`      | 从 auto-reply 可信用户邮箱构建 `GatewayClient`     |
| `src/auto-reply/reply/knowledge-universe-context.ts` | 从任务消息推断意图并构建知识上下文                 |
| `src/auto-reply/reply/get-reply-run.ts`              | 注入 `extraSystemPrompt` 知识宇宙块                |
| `src/auto-reply/templating.ts`                       | `GatewayClientUser` / `GatewayClientSessionDomain` |
| `src/gateway/server-methods/chat.ts`                 | webchat / group chat 下发可信会话用户              |

### 2.4 类型与 UI 契约

| 文件                                                   | 说明                                               |
| ------------------------------------------------------ | -------------------------------------------------- |
| `src/gateway/knowledge/types.ts`                       | `KnowledgeResolveIntent` / `KnowledgeAgentContext` |
| `ui/src/ui/capability/knowledge-universe/endpoints.ts` | context 响应扩展 agents/owners/promptBlock         |

### 2.5 测试

| 文件                                                              | 覆盖                                       |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `src/gateway/knowledge/resolve-engine.test.ts`                    | 意图分类、来源选择、resolve/context 一致性 |
| `src/gateway/knowledge/adapter/cognitive-runtime-adapter.test.ts` | 认知运行时 bundle                          |
| `src/gateway/knowledge/knowledge-consumption-boundary.test.ts`    | 回归：不直连 EDC                           |
| `src/auto-reply/reply/knowledge-universe-context.test.ts`         | 有/无 GatewayClientUser 的企业 scope 差异  |
| `src/auto-reply/reply/knowledge-universe-context.reply.test.ts`   | `get-reply-run` → `extraSystemPrompt` 链路 |

## 3. M5 验收对照

| 验收项                             | 状态 | 证据                                              |
| ---------------------------------- | ---- | ------------------------------------------------- |
| 机器人执行任务时自动检索知识宇宙   | ✅   | `runKnowledgeResolveEngine` + auto-reply 注入     |
| 自动构建知识上下文                 | ✅   | `runKnowledgeContextEngine` / `promptBlock`       |
| 自动消费企业知识与数据能力         | ✅   | source selector + profile `allowDataCapabilities` |
| 自动获取关联知识/负责人/机器人     | ✅   | `buildKnowledgeAgentContext` related groups       |
| 不允许机器人直连 Connector/CRM/ERP | ✅   | prompt 约束 + consumption boundary 回归           |

## 4. 架构说明

```text
Task Message
    │
    ▼
Intent Classifier → Source Selector → Resolve Engine
    │                                      │
    ▼                                      ▼
Agent Profile                    Relationship Runtime
    │                                      │
    └──────────────┬───────────────────────┘
                   ▼
            Context Builder
                   │
                   ▼
     Cognitive Runtime Adapter
                   │
                   ▼
     Employee Agent extraSystemPrompt
```

知识 plane 仍遵守 M4 consumption boundary：adapter 仅调用 knowledge router / resolve engine，不 import EDC。

## 5. 风险与尾差

| 项                                    | 说明                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| 非 gateway 渠道无 `GatewayClientUser` | WhatsApp/Telegram 等外部渠道不注入企业知识块（无可信 seat 会话） |
| 意图分类为规则引擎                    | 未接 LLM classifier；后续可替换 `intent-classifier.ts` 实现      |
| UI context controller 未单独新增      | 定稿 `knowledge-universe-context.ts` controller 可留 M5+ UI 迭代 |

## 6. 审核结论

**建议：通过 M5，知识宇宙 Agent Runtime 链路已贯通。**
