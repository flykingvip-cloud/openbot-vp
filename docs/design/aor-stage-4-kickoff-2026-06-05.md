# AOR 阶段 4 启动说明（2026-06-05）

> **前置**：阶段 1–3 均已验收通过（见 `docs/design/aor-stage-*-completion-report-2026-06-05.md`）。
> **定版依据**：`docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md`（§七 仓库结构、`sdk-python/` 增长方向）。
> **阶段 3 归档**：81 tests；Bandit / 多租户 / stub backend / 优化计费均已闭合。

阶段 1–3 完成了「证明调度价值 → 可商用 → 平台化」。**阶段 4 重点是生产化与生态扩展**：让 Bandit 与客观 Evaluator 在 live Gateway 上持续积累，并对外提供 Python SDK 与可选的第二编排底座（LangGraph）。

## 一、阶段 4 目标（承接 Stage 3 已知限制）

| 主题         | 来源         | 目标                                                      |
| ------------ | ------------ | --------------------------------------------------------- |
| Live 学习    | Stage 3 §五  | Bandit 跨进程/跨重启持久化；live 网关 bench 证据          |
| 生态         | 定版 §七     | `packages/aor-sdk-python`（或 `sdk-python/`）最小可用 SDK |
| 第二 Backend | Stage 3 偏差 | LangGraph（或等价图编排）适配包，超越 stub                |
| 可观测       | Stage 3 §3E  | 优化报告接入 cost-budget / 可选 AOR 面板                  |

闭环形态（延续定版 §十）：

```
Task → … → Evaluator → Feedback（持久化）→ Selector → Backend（OpenBot | LangGraph）
                              ↓
                    usage-ingest + 优化报告 → Control Plane
```

## 二、建议工作流（按优先级）

### 4A — Live Bandit 持久化（P0，已启动）

| 项         | 说明                                        | 落点                                          |
| ---------- | ------------------------------------------- | --------------------------------------------- |
| 磁盘状态   | JSON 持久化 Beta 臂；原子写入               | `packages/aor-core/src/bandit-persistence.ts` |
| SDK 接线   | `banditStatePath` / `AOR_BANDIT_STATE_PATH` | `packages/aor-sdk-node/src/client.ts`         |
| 学习曲线   | `learningSnapshot()` 跨重启对比             | bench / CLI `--bandit-state`                  |
| Live bench | 同一客观 Evaluator，Panel → OpenBotBackend  | `packages/aor-sdk-node/src/bench.ts`          |

**验收口径**：两次独立进程加载同一 state 文件，第二次 Selector 决策体现已学习臂；live 网关路径可复现（文档 + 单测/mock）。

### 4B — Python SDK（P1）

| 项     | 说明                                                                     |
| ------ | ------------------------------------------------------------------------ |
| 包布局 | `packages/aor-sdk-python/`（PyPI 名待定）                                |
| 最小面 | `AorClient.run(goal, type=...)` → HTTP OpenAI compat 或 Gateway RPC 封装 |
| 边界   | 仅依赖公共 Gateway；不 import OpenBot 内部                               |

**验收口径**：pip 可安装；对 `coding.review` 跑通 dry-run / mock gateway；README 与 Node SDK 能力对照表。

### 4C — LangGraph ExecutionBackend（P1）

| 项   | 说明                                                          |
| ---- | ------------------------------------------------------------- |
| 包   | `packages/aor-backend-langgraph/`（或 spike 后定名）          |
| 契约 | 实现 `ExecutionBackend`；图定义由 Skill/Planner 映射          |
| 测试 | 与 `aor-backend-stub` 同级的 cross-backend orchestration 单测 |

**验收口径**：独立 build/test；`lint:aor:boundaries` 仍绿；至少 1 个 TaskType 端到端。

### 4D — Control Plane 可视化（P2）

| 项          | 说明                              | OpenBot 落点                   |
| ----------- | --------------------------------- | ------------------------------ |
| 优化报告 UI | 展示 savings / revenue share 趋势 | `ui/src/ui/views/cost-budget/` |
| Bandit 臂   | 可选：展示 top arms / trials      | 读 usage-ingest 或导出 JSON    |
| 文档        | 运维接入（generic placeholders）  | `docs/design/`                 |

**验收口径**：cost-budget 页或子面板可看到 AOR 计量键聚合；无 Core 内部 import。

## 三、边界与约束（继承阶段 1–3）

- **不改 OpenBot Core 内部**；扩展仅走公共 Gateway / `/tools/invoke` / `usage-ingest.report`。
- **`aor-core` 零 OpenBot 依赖**；新 backend 仅在 `packages/aor-backend-*`。
- **Stage 3 守卫**：81 tests + `lint:aor:boundaries` 为阶段 4 基线，每 PR 不得回退。

## 四、建议里程碑（约 12–16 周，可并行）

| 周次 | 交付                                  |
| ---- | ------------------------------------- |
| 1–3  | 4A 持久化 + SDK env + 学习曲线 CLI    |
| 2–6  | 4B Python SDK MVP                     |
| 4–8  | 4C LangGraph backend spike → MVP      |
| 8–12 | 4D cost-budget 集成 + 阶段 4 完成报告 |

## 五、阶段 4 完成报告模板（届时填写）

- 4A–4D 逐条对照表
- 测试合计 + boundaries
- Live / Python / LangGraph 演示命令
- 已知限制与 Stage 5 候选

## 六、立即可执行的第一步（已全部落地）

1. ✅ `PersistentBanditFeedbackStore` + `exportPersistedState` / `importPersistedState`
2. ✅ SDK：`banditStatePath` / `AOR_BANDIT_STATE_PATH` → `createBanditClient`
3. ✅ CLI：`aor-bench --bandit-state <path> --bandit-rounds N` + learning 曲线输出
4. ✅ Live bench hook：`aor-bench --live [--gateway-url URL]`
5. ✅ `packages/aor-backend-graph` 图编排 backend MVP
6. ✅ `packages/aor-sdk-python` HTTP client MVP + `dry_run`
7. ✅ cost-budget analytics 子页 AOR 计量键 + 优化 proxy 面板
8. ✅ Live gateway 客观 coding 归档（`live-coding.ts` + `--coding-archive`）

**阶段 4 完成报告**：`docs/design/aor-stage-4-completion-report-2026-06-05.md`

**阶段 3 归档**：81 tests（core 49 / openbot 10 / stub 3 / sdk 19）；专家终验通过日期 2026-06-05。
