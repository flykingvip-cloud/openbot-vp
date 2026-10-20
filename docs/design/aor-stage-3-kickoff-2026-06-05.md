# AOR 阶段 3 启动说明（2026-06-05）

> **前置**：阶段 1、阶段 2 均已验收通过（见 `docs/design/aor-stage-1-completion-report-2026-06-05.md`、`docs/design/aor-stage-2-completion-report-2026-06-05.md`）。
> **定版依据**：`docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md` 第八节「阶段 3（3–6 月）：平台化」。

## 一、阶段 3 目标（定版原文）

| 主题     | 定版要求                                                       |
| -------- | -------------------------------------------------------------- |
| 动态优化 | Bandit 动态优化（喂 Evaluator 分数）；TaskType Registry 沉淀   |
| 平台化   | 多租户 / 审计；第二个 ExecutionBackend（如 LangGraph）验证抽象 |
| 商业化   | 优化分成计费                                                   |

闭环形态（定版 §十）：

```
Task → Parser → Planner → Capability Registry → Selector → Backend → Evaluator → Feedback → Selector 权重
```

阶段 2 已具备：DAG Planner、Lobster/插件工具、原生 fallback、`usage-ingest.report`、客观 Evaluator 与 bench 门槛。**阶段 3 重点是让 Feedback Learning 真正驱动 Selector，并证明 ExecutionBackend 抽象可跨底座复用。**

## 二、建议工作流（按优先级）

### 3A — Bandit / Feedback Learning（P0）

| 项              | 说明                                                              | 落点建议                                           |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Bandit Selector | 用 Evaluator `score` 更新路由权重（替代/扩展 `EmaFeedbackStore`） | `packages/aor-core/src/feedback.ts`、`selector.ts` |
| 上下文特征      | taskType + 约束（budget/latency）+ 可选 session 维度              | `FeedbackStore` 接口扩展                           |
| 回归            | bench 门槛仍达标；Bandit 跑 N 轮后成本/完成率不劣于 Stage 2 基线  | `packages/aor-sdk-node/src/bench.test.ts`          |

**验收口径**：同一 bench panel，Bandit 启用后相对静态 `balanced` 策略有可测改进（或不低于基线 + 有 learning 曲线证据）。

### 3B — TaskType Registry 沉淀（P1）

| 项         | 说明                                                           |
| ---------- | -------------------------------------------------------------- |
| 扩展本体   | `coding.refactor`、`coding.security`、`research.*`、`ops.*` 等 |
| Parser     | 规则/关键词扩展或可选 LLM 解析边界（仍输出受控 TaskTypeId）    |
| Skill 绑定 | 新 TaskType → 默认 Skill（含 Lobster/插件路径）                |

**验收口径**：≥4 个新 TaskType 注册 + 单测 + CLI `--type` 可跑通至少 2 个。

### 3C — 第二个 ExecutionBackend（P1）

| 项       | 说明                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 抽象验证 | 新增 stub 或 LangGraph 适配包（如 `packages/aor-backend-langgraph` 或 in-repo stub） |
| 契约     | 仅依赖 `ExecutionBackend` + 公共网络/RPC，不 import OpenBot 内部                     |
| 测试     | 同一 Task 在 OpenBot backend 与第二 backend 上 Orchestrator 行为一致（接口级）       |

**验收口径**：`pnpm lint:aor:boundaries` 仍绿；第二 backend 有独立 build/test。

### 3D — 多租户 / 审计（P2）

| 项       | 说明                                          | OpenBot 落点                             |
| -------- | --------------------------------------------- | ---------------------------------------- |
| 运行审计 | AOR runId、trace、Selector 决策写入可查询记录 | 扩展 `usage-ingest` 载荷或独立 audit RPC |
| 租户隔离 | sessionKey / userId 前缀策略                  | Gateway session + billing `userId`       |
| 文档     | 运维接入说明（generic placeholders）          | `docs/design/`                           |

**验收口径**：单次 run 可追溯（runId → trace → billing events）；文档化租户字段约定。

### 3E — 优化分成计费 / Control Plane（P2）

| 项       | 说明                                                   |
| -------- | ------------------------------------------------------ |
| 优化报告 | 基于 bench + 生产 ingest 聚合「节省 vs 单模型强模型」  |
| 分成模型 | 对接 `gateway/billing` 计量键（已有 `aor_*` 键可扩展） |
| UI       | 复用 cost-budget 数据面；AOR 专属面板为可选增强        |

**验收口径**：可生成 Markdown/JSON 优化报告；billing 键与 Stage 2 `billing-bridge` 对齐。

## 三、边界与约束（继承阶段 1–2）

- **不改 OpenBot Core 内部**；扩展仅走公共 Gateway / `/tools/invoke` / `usage-ingest.report` / `agent.modelFallbacks`。
- **`aor-core` 零 OpenBot 依赖**；新 backend 仅在 `packages/aor-backend-*`。
- **bug-fix / 新特性**：bench 或单测证明；PR 遵循 `CLAUDE.md` 中 AOR 边界守卫。

## 四、建议里程碑（约 12–16 周，可并行）

| 周次  | 交付                                    |
| ----- | --------------------------------------- |
| 1–4   | 3A Bandit MVP + bench 对比              |
| 3–6   | 3B TaskType 扩展 + 3C 第二 Backend stub |
| 6–10  | 3D 审计字段 + ingest 串联               |
| 10–14 | 3E 优化报告 + 阶段 3 完成报告           |

## 五、阶段 3 完成报告模板（届时填写）

- 定版 §阶段 3 四项逐条对照表
- 测试合计 + `lint:aor:boundaries`
- Bandit vs 基线 bench 证据
- 第二 Backend 演示命令
- 已知限制与 Stage 4 候选（如 Python SDK `sdk-python/`）

## 六、立即可执行的第一步

1. 在 `packages/aor-core` 设计 `BanditFeedbackStore`（或 `ContextualBanditSelector`）接口草案 + 单测骨架。
2. 扩展 `bench.ts`：增加 `--strategy bandit` 与 learning 轮次配置。
3. 创建 `packages/aor-backend-stub` 或文档化 LangGraph spike 包目录（二选一，评审后定）。

---

**阶段 2 归档**：64 tests（core 37 / backend 10 / sdk 17）；专家终验通过日期 2026-06-05。
