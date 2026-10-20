# AOR 阶段 2 完成报告（供专家复验，2026-06-05 v5）

> **验收状态：已通过（2026-06-05）** — 专家终验同意放行；执行团队可进入阶段 3。
>
> v5 修复：`createGatewayRpcClient()` 下 Lobster/插件工具经独立 HTTP `toolsBaseUrl` 调 `/tools/invoke`（不再误用 `rpc://…`）。
> 前置：DAG / billing ingest / cost report / 基准门槛已在 v3 通过复核。

## 一、专家 P1 闭合对照

| 定版要求（`aor-agent-orchestration-runtime-plan-2026-06-04.md:245–247`） | v4 状态      | 落点                                                                                       |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------ |
| Capability Registry 接入 **Lobster + 插件工具**                          | **完成**     | `LobsterPipelineSkill` / `PluginToolSkill` → `POST /tools/invoke`（含 `lobster` 插件工具） |
| fallback **走 OpenBot 原生链**                                           | **完成**     | 公共 RPC `agent.modelFallbacks` → `runWithModelFallback`（非 AOR 侧循环）                  |
| Task Graph / billing / 成本可观测                                        | 已完成（v3） | 不变                                                                                       |

## 二、v4 新增 / 变更交付物

### 2.1 Lobster + 插件工具（公共 `/tools/invoke`）

| 文件                                                       | 职责                                                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/aor-core/src/tool-invoker.ts`                    | `ToolInvoker` 端口（core 零 OpenBot 依赖）                                                                                                                |
| `packages/aor-core/src/openbot-skills.ts`                  | `LobsterPipelineSkill`（`lobster` 工具）、`PluginToolSkill`（任意插件/核心工具）                                                                          |
| `packages/aor-core/src/task-types.ts`                      | 新增 TaskType：`lobster.pipeline`、`plugin.tool`                                                                                                          |
| `packages/aor-backend-openbot/src/tools-invoke.ts`         | `OpenBotToolsInvokeClient` → `POST /tools/invoke`                                                                                                         |
| `packages/aor-backend-openbot/src/openbot-capabilities.ts` | `createOpenBotCapabilityRegistry(toolInvoker)`                                                                                                            |
| `packages/aor-sdk-node/src/client.ts`                      | `createDefaultClient` / **`createGatewayRpcClient`**：agent 走 RPC 时，工具仍走 HTTP `toolsBaseUrl`（默认 `AOR_GATEWAY_URL` 或 `http://127.0.0.1:18789`） |

**双通道（RPC + HTTP）**：Gateway WebSocket/RPC 承载 `agent` / billing；`POST /tools/invoke` 始终经 **HTTP(S)** 网关 URL。`createGatewayRpcClient(transport)` 不再把 `baseUrl` 设为 `rpc://…`。

**示例（SDK）**：

```typescript
const client = createGatewayRpcClient(wsTransport, {
  toolsBaseUrl: "http://127.0.0.1:18789", // 可选；省略则用 AOR_GATEWAY_URL 或 localhost 默认
  apiKey,
});
const result = await client
  .agent({
    goal: "run inbox triage pipeline",
    type: "lobster.pipeline",
    params: { pipeline: "/path/to/triage.lobster" },
  })
  .run();
```

### 2.2 OpenBot 原生 fallback 链

| 文件                                                    | 职责                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `src/gateway/protocol/schema/agent.ts`                  | 公共字段 `modelFallbacks?: string[]`（`provider/model`）      |
| `src/commands/agent/types.ts` + `src/commands/agent.ts` | 传入 `runWithModelFallback({ fallbacksOverride })`            |
| `src/gateway/server-methods/agent.ts`                   | Gateway `agent` RPC 转发 `modelFallbacks`                     |
| `packages/aor-backend-openbot/src/gateway-rpc.ts`       | **单次** `agent` 调用 + `modelFallbacks`；移除 AOR 侧模型循环 |

**语义**：AOR `rankModels` 产出 `[primary, ...fallbacks]` → RPC 仅 patch 主模型 → `agent` 携带 `modelFallbacks` → OpenBot 内部 `runWithModelFallback` 处理重试/冷却/鉴权（与 CLI/自动回复路径一致）。

**HTTP 默认路径**：OpenAI 兼容端点仍无 fallback 字段，继续忽略 `fallbackModels`（文档已说明）。

## 三、验证证据

### 3.1 单元测试（v4 后）

| 包                  | 测试数                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| aor-core            | **37**（+2 openbot-skills）                                                 |
| aor-backend-openbot | **9**（+2 tools-invoke / openbot-capabilities；gateway-rpc 改为原生链断言） |
| aor-sdk-node        | **17**（+3 RPC+tools 组合 / resolveToolsHttpBaseUrl）                       |
| **合计**            | **64 passed**                                                               |

```bash
for p in aor-core aor-backend-openbot aor-sdk-node; do
  pnpm --dir packages/$p build && pnpm --dir packages/$p typecheck && pnpm --dir packages/$p test
done
pnpm lint:aor:boundaries && pnpm lint:aor:boundaries:selftest
```

### 3.2 关键断言

- `gateway-rpc.test.ts`：`agent` **仅调用 1 次**，且 params 含 `modelFallbacks: ["anthropic/claude-opus-4-6"]`。
- `client.test.ts`：`createGatewayRpcClient` + `lobster.pipeline` / `plugin.tool` 经 HTTP `/tools/invoke`（fake fetch），且不触发 RPC `agent`。
- `tools-invoke.guard.test.ts`：拒绝 `rpc://` 等非 HTTP baseUrl。

### 3.3 CLI（沿用 v3）

```bash
node packages/aor-sdk-node/dist/cli.js "review this repo" --rpc --report-billing --dry-run
node packages/aor-sdk-node/dist/cli.js "review this codebase" --decompose --cost-report --dry-run
node packages/aor-sdk-node/dist/bench-cli.js
```

## 四、与定版方案的偏差说明（缩小后）

1. **OpenBot 公共 API 小扩展**：新增 `agent.modelFallbacks` 是为让外部编排层（AOR）能传入 Selector 有序候选并仍走原生 `runWithModelFallback`；未改 pi 运行时或 fork 内部逻辑。
2. **Lobster 经 HTTP 工具面**：未在 AOR 内嵌 Lobster CLI；与定版「对齐 Capability Center / registerTool / Lobster」一致——执行仍由 Gateway 工具策略 + 插件注册表负责。
3. **PipelineSkill 保留**：作为 AOR 侧确定性多阶段 **模型** 管道（非 Lobster 替代）；Lobster/插件能力由独立 Skill 类型承载。

## 五、Stage 3 建议（不变）

Bandit 动态路由、live 网关客观 coding 归档、第二个 ExecutionBackend、AOR 专属 dashboard 可视化。
