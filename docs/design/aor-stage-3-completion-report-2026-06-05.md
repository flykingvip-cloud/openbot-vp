# AOR 阶段 3 完成报告（供专家验收，2026-06-05 v3）

> **验收状态：已通过（2026-06-05）** — 专家终验同意放行（v2 P1 闭合）；执行团队可进入阶段 4。
>
> **v2 修复（2026-06-05）**
>
> - **[P1] 租户 sessionKey**：`resolveRunSessionKey()` 在 `tenantId` 存在且未传 `sessionKey` 时，自动生成 `aor:<runId>` 并加租户前缀（`acme:aor:<runId>`），RPC 不再落到 bare `aor:<uuid>`。
> - **[P1] 优化计费键语义**：`aor_optimization_savings` 上报 `costSavingsUsd`；新增 `aor_optimization_revenue_share` 上报 `revenueShareUsd`。
>
> 前置：阶段 1、阶段 2 均已验收通过（见 `docs/design/aor-stage-1-completion-report-2026-06-05.md`、`docs/design/aor-stage-2-completion-report-2026-06-05.md`）。
> 定版依据：`docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md` 第八节「阶段 3（3–6 月）：平台化」。
> 启动说明：`docs/design/aor-stage-3-kickoff-2026-06-05.md`。

## 一、定版 §阶段 3 对照表

| 定版主题                          | 验收口径（kickoff）                       | 状态           | 落点                                                                                                                                     |
| --------------------------------- | ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **3A Bandit / Feedback Learning** | bench 不劣于 Stage 2 基线 + 学习曲线证据  | **完成**       | `packages/aor-core/src/bandit.ts`、`selector.ts`（`bandit` 策略）、`packages/aor-sdk-node/src/bench.ts`（`banditRounds` / `aor:bandit`） |
| **3B TaskType Registry**          | ≥4 新类型 + 单测 + CLI `--type` 可跑 ≥2   | **完成**       | `task-types.ts`、`capabilities.ts`、`parser.test.ts`                                                                                     |
| **3C 第二 ExecutionBackend**      | 独立 build/test；`lint:aor:boundaries` 绿 | **完成**       | `packages/aor-backend-stub/`                                                                                                             |
| **3D 多租户 / 审计**              | runId → trace → billing 可追溯            | **完成（v2）** | `audit.ts`（`resolveRunSessionKey`）、`orchestrator.ts`、`billing-bridge.ts`（`userId`）                                                 |
| **3E 优化分成计费**               | Markdown/JSON 优化报告；billing 键对齐    | **完成（v2）** | `optimization-report.ts`、`billing-bridge.ts`（双键语义分离）、`bench-cli.ts`                                                            |

## 二、交付物明细

### 2.1 3A — Bandit 动态路由

| 文件                                  | 职责                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/aor-core/src/bandit.ts`     | `BanditFeedbackStore`：Evaluator 分数 → Beta 臂；Thompson 采样注入 `ModelProfile.taskTypeScores`                  |
| `packages/aor-core/src/selector.ts`   | 新策略 `"bandit"`：学习后的 quality 主导（0.9）+ 成本 tie-break（0.1），与 `best_quality` 同构但分数来自 Feedback |
| `packages/aor-sdk-node/src/bench.ts`  | `banditRounds`（默认 3）、策略 `aor:bandit`、`buildOptimizationReportFromBench`                                   |
| `packages/aor-sdk-node/src/client.ts` | `enableBandit` / `createBanditClient()`                                                                           |

**闭环**：`Orchestrator.run` → Evaluator → `feedback.record` → 下次 `feedback.apply(catalog)` → `rankModels(..., strategy: "bandit")`。

### 2.2 3B — TaskType 扩展

新增 4 个 TaskType（均注册默认 `PromptSkill`）：

| TaskTypeId         | 用途      |
| ------------------ | --------- |
| `coding.refactor`  | 重构建议  |
| `coding.security`  | 安全审计  |
| `research.summary` | 研究摘要  |
| `ops.deploy`       | 部署/发布 |

Parser 关键词规则 + `parser.test.ts` 覆盖 `coding.security` / `ops.deploy`。

**CLI 示例**（`--dry-run` 离线可跑）：

```bash
node packages/aor-sdk-node/dist/cli.js "security audit for XSS" --type coding.security --dry-run
node packages/aor-sdk-node/dist/cli.js "deploy canary to production" --type ops.deploy --dry-run
```

### 2.3 3C — 第二 ExecutionBackend（stub）

| 文件                                                  | 职责                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/aor-backend-stub/src/stub-backend.ts`       | `StubExecutionBackend`：可注入 `StubResponder`，零 OpenBot 依赖             |
| `packages/aor-backend-stub/src/cross-backend.test.ts` | 同一 `Orchestrator` + stub backend 路由 `coding.review` → `claude-opus-4-6` |

**演示**：

```bash
pnpm --dir packages/aor-backend-stub build && pnpm --dir packages/aor-backend-stub test
```

### 2.4 3D — 多租户 / 审计

| 文件                                      | 职责                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/aor-core/src/audit.ts`          | `TenantContext`、`buildAuditRecord`、`tenantSessionKey`、**`resolveRunSessionKey`**                      |
| `packages/aor-core/src/orchestrator.ts`   | `AorRunResult.runId`；`RunOptions.tenant`；**自动/显式 sessionKey 均经 `resolveRunSessionKey` 租户前缀** |
| `packages/aor-core/src/billing-bridge.ts` | ingest 载荷转发 `userId`                                                                                 |
| `packages/aor-sdk-node/src/client.ts`     | `AgentRunOptions.tenant` / `includeAudit` → `AgentRunResult.audit`                                       |

**租户字段约定**：

| 字段       | 用途                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `tenantId` | 逻辑租户；**始终**拼入 Gateway `sessionKey`（省略时先物化为 `aor:<runId>`，再前缀为 `<tenantId>:aor:<runId>`） |
| `userId`   | Billing / cost-budget 用户 id；写入 `usage-ingest` 每条 event                                                  |
| `runId`    | 单次编排 id；贯穿 trace、billing `eventId` 前缀、audit、默认 sessionKey 后缀                                   |

**v2 回归断言**：`createGatewayRpcClient(...).agent(...).run({ tenant: { tenantId: "acme", userId: "u1" }, runId: "run-fixed" })` → 首个 `sessions.patch` 的 `key` 为 **`acme:aor:run-fixed`**（见 `packages/aor-sdk-node/src/client.test.ts`）。

### 2.5 3E — 优化分成 / Control Plane

| 文件                                           | 职责                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/aor-core/src/optimization-report.ts` | `computeOptimizationReport`、`formatOptimizationReportMarkdown`                |
| `packages/aor-core/src/billing-bridge.ts`      | `AOR_METERING_KEYS.aorOptimizationSavings` + **`aorOptimizationRevenueShare`** |
| `packages/aor-sdk-node/src/bench-cli.ts`       | 输出 bandit 行 + Markdown 优化报告                                             |

**分成模型（v2 语义）**：

| 计量键                           | quantity 含义                                                        |
| -------------------------------- | -------------------------------------------------------------------- |
| `aor_optimization_savings`       | `round(costSavingsUsd × 100)` — 相对强模型基线的节省额（美分 proxy） |
| `aor_optimization_revenue_share` | `round(revenueShareUsd × 100)` — 节省额 × 分成率（默认 20%）         |

## 三、验证证据

### 3.1 单元测试（阶段 3 后）

| 包                  | 测试数（较阶段 2 Δ）                           |
| ------------------- | ---------------------------------------------- |
| aor-core            | **49**（+12；含 v2 sessionKey / billing 语义） |
| aor-backend-openbot | **10**（不变）                                 |
| aor-backend-stub    | **3**（新包）                                  |
| aor-sdk-node        | **19**（+2；含 RPC tenant sessionKey）         |
| **合计**            | **81 passed**                                  |

```bash
for p in aor-core aor-backend-openbot aor-backend-stub aor-sdk-node; do
  pnpm --dir packages/$p build && pnpm --dir packages/$p typecheck && pnpm --dir packages/$p test
done
pnpm lint:aor:boundaries && pnpm lint:aor:boundaries:selftest
```

### 3.2 Bench 门槛（继承阶段 2 + Bandit）

```bash
node packages/aor-sdk-node/dist/bench-cli.js
```

**实测摘要（offline panel，2026-06-05）**：

| policy                      | completion |                total_cost_usd |
| --------------------------- | ---------: | ----------------------------: |
| single:claude（强模型基线） |       100% |                        0.7050 |
| single:mini（便宜基线）     |        67% |                        0.0170 |
| aor:auto                    |       100% |  0.4124（**-42%** vs strong） |
| aor:bandit（3 轮学习后）    |       100% | 0.4124（**不劣于 aor:auto**） |

- 阶段 2 门槛：**MET**（成本 -30% vs strong；完成率 +20 pts vs cheap）
- Bandit：**MET**（完成率 ≥ aor:auto；成本相同）

优化报告 excerpt：`Cost savings: $0.2926 (41.5%)`；`Revenue share (20%): $0.0585`

### 3.3 边界守卫

```
AOR boundary guard: OK
AOR boundary guard self-test OK
```

## 四、与定版方案的偏差说明

1. **第二 Backend 选型**：定版列举 LangGraph；本阶段交付 **in-repo stub**（`aor-backend-stub`）验证 `ExecutionBackend` 抽象，LangGraph 适配留 Stage 4 候选。
2. **Bandit 选择语义**：`bandit` 策略在 Thompson 采样注入 catalog 后，排序与 `best_quality` 同构（quality 0.9 + cost 0.1），避免纯成本权重在 panel 上误选便宜模型；学习信号仍来自 Evaluator 分数。
3. **OpenBot Core**：阶段 3 无新增 Core 公共 API；审计/租户字段在 AOR 侧组装后经既有 `usage-ingest.report` 上报。

## 五、已知限制与 Stage 4 候选

| 项                | 说明                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| Live 网关 Bandit  | bench 为 offline panel；live 网关需复用同一 `BanditFeedbackStore` + 持久化 |
| LangGraph backend | stub 已验证契约；生产级图编排适配未做                                      |
| Python SDK        | 定版 `sdk-python/` 未启动                                                  |
| AOR Dashboard     | 优化报告现为 Markdown/JSON；专属 UI 为可选增强                             |

## 六、专家验收结论

专家团队于 2026-06-05 确认 v2 两项 P1 闭合，**同意阶段 3 验收通过**，允许进入阶段 4。

启动说明见 `docs/design/aor-stage-4-kickoff-2026-06-05.md`。

---

**阶段 2 基线**：64 tests（core 37 / backend 10 / sdk 17）。
**阶段 3 归档（v3）**：81 tests（core 49 / openbot 10 / stub 3 / sdk 19）；专家终验通过日期 2026-06-05。
