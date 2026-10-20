# AOR 阶段 4 完成报告（供专家验收，2026-06-05 v2）

> **验收状态：待验收（v2 已修复 P1）** — 执行团队已完成定版 Stage 4 四项交付（4A–4D），并响应专家初审 P1 将 live/coding 路径改为真实 workspace 命令执行。
>
> **v2 变更（P1 修复）**：`live-coding.ts` / `bench.ts` / `cli.ts` 不再硬编码 `node -e "process.exit(0)"`；改由 `workspace-objective.ts` 从目标 workspace 的 `package.json` scripts 解析 build/test/coverage，经检测到的包管理器（pnpm/npm/bun/yarn）真实 shell 执行。新增失败场景单测（`live-coding.test.ts`、`bench.test.ts`）。
>
> 前置：阶段 1–3 均已验收通过（见 `docs/design/aor-stage-*-completion-report-2026-06-05.md`）。
> 定版依据：`docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md`（§七 仓库结构、`sdk-python/` 增长方向）。
> 启动说明：`docs/design/aor-stage-4-kickoff-2026-06-05.md`。

## 一、定版 Stage 4 对照表

| 轨道                          | 验收口径（kickoff）                                   | 状态     | 落点                                                                  |
| ----------------------------- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| **4A Live Bandit / Bench**    | 跨进程持久化 + learning 曲线 + live 路径可复现        | **完成** | `bandit-persistence.ts`、`bench.ts`、`bench-cli.ts`、`live-coding.ts` |
| **4B Python SDK**             | pip 可安装；coding.review dry-run/mock；README 对照表 | **完成** | `packages/aor-sdk-python/`                                            |
| **4C Graph ExecutionBackend** | 独立 build/test；≥1 TaskType 端到端；boundaries 绿    | **完成** | `packages/aor-backend-graph/`                                         |
| **4D Control Plane**          | cost-budget 可见 AOR 计量键 + 优化 proxy              | **完成** | `ui/src/ui/views/cost-budget/cost-budget-page.ts`                     |

## 二、交付物明细

### 2.1 4A — Live Bandit 持久化 + Bench

| 文件                                               | 职责                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/aor-core/src/bandit-persistence.ts`      | `PersistentBanditFeedbackStore`、JSON 原子写入、`export/importPersistedState` |
| `packages/aor-sdk-node/src/client.ts`              | `banditStatePath` / `AOR_BANDIT_STATE_PATH`                                   |
| `packages/aor-sdk-node/src/bench.ts`               | `banditStatePath`、learning 曲线、`--live` backend、`--coding` 客观 Evaluator |
| `packages/aor-sdk-node/src/bench-cli.ts`           | CLI 参数解析与输出                                                            |
| `packages/aor-sdk-node/src/live-coding.ts`         | **Live gateway 客观 coding 归档**（JSON 证据链）                              |
| `packages/aor-sdk-node/src/workspace-objective.ts` | 从 workspace `package.json` 解析 build/test/coverage 命令                     |

**CLI 示例**：

```bash
# 离线 panel + bandit 持久化 + learning 曲线
node packages/aor-sdk-node/dist/bench-cli.js \
  --bandit-state .aor-bandit.json --bandit-rounds 3

# Live gateway bench（需 Gateway 运行）
node packages/aor-sdk-node/dist/bench-cli.js --live --gateway-url http://127.0.0.1:18789

# Live 客观 coding 归档（workspace package.json build/test/coverage）
node packages/aor-sdk-node/dist/bench-cli.js \
  --coding-archive /tmp/aor-coding-archive.json \
  --workspace . --goal "review this codebase"
```

**客观 Evaluator 机制**：`resolveWorkspaceObjectiveCommands(workspace)` 读取 `package.json` scripts（`build` / `test` / `test:coverage`），按 lockfile 推断包管理器并 `execFile` 真实执行；`--coding` bench 仅对 `coding.review` 任务启用 workspace 命令，summarization 仍用 output token 检查。

**失败场景单测**：

- `live-coding.test.ts`：workspace `test` script `exit(1)` → `evaluationScore < 1`
- `bench.test.ts`：`codingWorkspace` + failing test script → `avgCompletion < 1`

**跨进程 Bandit 证据**：`bench.test.ts` 两次 `runBenchmark` 共用 `banditStatePath`，第二次 `learningSnapshot` 总 trials 大于首轮。

### 2.2 4B — Python SDK

| 文件                                           | 职责                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| `packages/aor-sdk-python/aor_sdk/client.py`    | `AorClient.run()` → Gateway `/v1/chat/completions` |
| `packages/aor-sdk-python/tests/test_client.py` | mock gateway + `dry_run=True`                      |
| `packages/aor-sdk-python/README.md`            | 与 Node SDK 能力对照表                             |

```bash
cd packages/aor-sdk-python && pip install -e ".[dev]"
PYTHONPATH=. python3 -m unittest tests.test_client -q

python3 -c "from aor_sdk import AorClient; print(AorClient().run('review', dry_run=True).text)"
```

### 2.3 4C — Graph ExecutionBackend（LangGraph 同构 MVP）

| 文件                                                   | 职责                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/aor-backend-graph/src/graph-backend.ts`      | `GraphExecutionBackend`：线性 node pipeline（analyze → format / compress） |
| `packages/aor-backend-graph/src/cross-backend.test.ts` | Orchestrator + graph backend 路由 `coding.review`                          |

定版列举 LangGraph；本阶段交付 **同构 graph pipeline backend**（零 OpenBot 依赖），验证 ExecutionBackend 抽象可承载图编排器；真实 `@langchain/langgraph` npm 绑定留 Stage 5。

```bash
pnpm --dir packages/aor-backend-graph build && pnpm --dir packages/aor-backend-graph test
```

### 2.4 4D — Control Plane 可视化

| 文件                                                           | 职责                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ui/src/ui/views/cost-budget/cost-budget-page.ts`              | 「使用量分析」：`aor_*` 计量键 + **优化分成 proxy**（savings / revenue share） |
| `ui/src/ui/views/cost-budget/cost-budget-page.browser.test.ts` | `aor-usage-keys` + `aor-optimization-summary` 断言                             |

**计量键**（与 Stage 3 billing-bridge 对齐）：

| 键                               | UI 展示                          |
| -------------------------------- | -------------------------------- |
| `aor_task`                       | 编排步数                         |
| `aor_orchestration`              | 编排成本 proxy                   |
| `aor_optimization_savings`       | 节省额 proxy（quantity÷100 USD） |
| `aor_optimization_revenue_share` | 分成额 proxy                     |

数据来源：`billing.analytics` → `byKey` 聚合（无 OpenBot Core 内部 import）。

## 三、验证证据

### 3.1 单元测试（阶段 4 后）

| 包                  | 测试数（较 Stage 3 Δ）                                     |
| ------------------- | ---------------------------------------------------------- |
| aor-core            | **52**（+3 bandit-persistence）                            |
| aor-backend-openbot | **10**（不变）                                             |
| aor-backend-stub    | **3**（不变）                                              |
| aor-backend-graph   | **4**（新包）                                              |
| aor-sdk-node        | **33**（+6 workspace-objective / 失败场景 / bench coding） |
| aor-sdk-python      | **3** unittest                                             |
| cost-budget UI      | **8**（+1 AOR 优化面板）                                   |
| **TS 合计**         | **102 passed**                                             |

```bash
for p in aor-core aor-backend-openbot aor-backend-stub aor-backend-graph aor-sdk-node; do
  pnpm --dir packages/$p build && pnpm --dir packages/$p typecheck && pnpm --dir packages/$p test
done
pnpm lint:aor:boundaries && pnpm lint:aor:boundaries:selftest
cd packages/aor-sdk-python && PYTHONPATH=. python3 -m unittest tests.test_client -q
pnpm exec vitest run ui/src/ui/views/cost-budget/cost-budget-page.browser.test.ts
```

### 3.2 Bench 门槛（继承 Stage 2/3）

```bash
node packages/aor-sdk-node/dist/bench-cli.js
```

离线 panel：`aor:auto` / `aor:bandit` 仍 **100% completion**，成本较强基线 **-42%**；Bandit learning 曲线在 CLI 末尾输出。

### 3.3 边界守卫

```
AOR boundary guard: OK
AOR boundary guard self-test OK
```

守卫范围已扩展：`packages/aor-backend-graph`。

## 四、与定版方案的偏差说明

1. **LangGraph**：交付 `aor-backend-graph`（同构 pipeline MVP），非 `@langchain/langgraph` 原生绑定；Orchestrator 契约已验证。
2. **Python SDK**：MVP 为 HTTP + prompt 模板 + `dry_run`；完整 Orchestrator/Bandit/RPC 留 Stage 5。
3. **Live coding 归档**：单测用 temp workspace + mock gateway；`--workspace .` 生产路径执行真实 `pnpm build` / `pnpm test` / `pnpm test:coverage`（按 scripts 存在性）。
4. **OpenBot Core**：阶段 4 无新增 Core 公共 API；UI 仅消费既有 `billing.analytics`。

## 五、已知限制与 Stage 5 候选

| 项                              | 说明                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `@langchain/langgraph` 原生适配 | graph backend MVP 已就位，可换真实图运行时            |
| Python 完整 Orchestrator        | 需 gRPC/WS 或 HTTP 多步协议封装                       |
| Bandit 持久化后端               | 文件 JSON → Redis/SQLite 多租户 store                 |
| Live 生产 bench 归档            | 需 CI 密钥 + 真实 Gateway 定期跑 `--coding-archive`   |
| AOR 专属 Dashboard              | 当前复用 cost-budget analytics；趋势图/臂可视化可增强 |

## 六、提请专家验收

请专家团队对照 `docs/design/aor-stage-4-kickoff-2026-06-05.md` 四项验收口径，重点复核：

1. **4A**：Bandit 跨进程 + learning 曲线 + **workspace 真实 build/test/coverage** + 失败场景单测
2. **4B**：Python `dry_run` / mock gateway 单测 + README 对照表
3. **4C**：`aor-backend-graph` build/test + cross-backend orchestration
4. **4D**：cost-budget analytics 中 `aor_*` 与 optimization proxy

---

**阶段 3 归档**：81 tests（core 49 / openbot 10 / stub 3 / sdk 19）。
**阶段 4 合计（v2）**：102 TS tests + 3 Python + 8 UI browser tests；`lint:aor:boundaries` 绿。
