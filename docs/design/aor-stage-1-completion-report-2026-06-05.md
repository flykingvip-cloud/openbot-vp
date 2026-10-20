# AOR 阶段 1 完成报告（供专家验收，2026-06-05，修订版 v2）

> 修订说明（v2）：依据专家两轮验收反馈，本报告已全量更新到与当前代码与实测输出一致。
> 主要变更：(1) 更正测试计数与 CLI 实测结果；(2) 新增"客观对比基准（达成定版 30%/20% 门槛）"；
> (3) 明确客观 coding 评估器为**显式开启**、默认仍为内容型；(4) 新增机器化边界守卫证据；
> (5) 复现实验命令改为"先重建后运行"，避免 stale dist。

## 一、阶段目标与验收口径

阶段 1（定版方案第八节，`docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md`）目标：**用客观数字证明"任务调度优于单模型"**，并搭好后续阶段可直接升级的骨架。

| 验收项                                        | 计划     | 状态                              |
| --------------------------------------------- | -------- | --------------------------------- |
| 3 个模型（OpenAI / Anthropic / 便宜模型）     | 必需     | 完成（seed catalog）              |
| 2 个 TaskType（coding.review、summarization） | 必需     | 完成                              |
| `ExecutionBackend`(OpenBot)                   | 必需     | 完成（HTTP 适配 + 可注入 client） |
| Node SDK + CLI demo                           | 必需     | 完成                              |
| 可验证型 Evaluator（build/test/coverage）     | 必需     | 完成（**显式开启**；见 §五）      |
| 客观对比证明"调度优于单模型"（30%/20% 门槛）  | 必需     | 完成（离线基准达标，§四）         |
| Selector：cheapest / best_quality             | 必需     | 完成（外加 balanced）             |
| OpenAI 兼容入口冷启动                         | 必需     | 完成                              |
| 边界守卫"机器化强制" + 负例                   | 定版红线 | 完成（§六）                       |

## 二、交付物（新增工作区包 + 守卫脚本）

```
packages/aor-core/             # 纯领域内核，零运行时依赖、零 OpenBot 内部依赖
packages/aor-backend-openbot/  # OpenBot 适配器，仅依赖 @openbot/aor-core
packages/aor-sdk-node/         # 开发者 SDK + CLI + 客观评估器 + 基准
scripts/check-aor-boundaries.ts # AOR 边界守卫（机器化强制 + 自检负例）
```

### 关键新增/变更文件（相对最初版）

| 文件                                            | 职责                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/aor-sdk-node/src/coding-evaluator.ts` | `createObjectiveCodingEvaluator`：把 build/test/coverage 探针组合为 coding 客观评估器 |
| `packages/aor-sdk-node/src/bench.ts`            | 基准 harness（单模型基线 vs AOR 路由，真实 `node` 客观判定）                          |
| `packages/aor-sdk-node/src/bench-cli.ts`        | `aor-bench` 命令，输出对比表与门槛达成判定                                            |
| `packages/aor-sdk-node/src/client.ts`           | `createDefaultClient({ codingObjective })` 开启客观评估器                             |
| `scripts/check-aor-boundaries.ts`               | 扫描 `packages/aor-*` 禁止导入 OpenBot 内部 / pi 运行时 / 越界相对路径                |

## 三、验证证据（实测）

### 1）测试 / 类型检查 / 构建（全绿）

| 包                  | typecheck | 单元测试      | build |
| ------------------- | --------- | ------------- | ----- |
| aor-core            | OK        | **20 passed** | OK    |
| aor-backend-openbot | OK        | **3 passed**  | OK    |
| aor-sdk-node        | OK        | **11 passed** | OK    |
| **合计**            | —         | **34 passed** | —     |

格式化：`oxfmt --check` 通过。oxlint 配置不覆盖 `packages/`（既有 `collaboration-*` 同样不在范围），与现有约定一致。

### 2）CLI 实测（`--dry-run` 桩后端，已更正）

| 命令要点                                           | 实测选模                                     | 说明                                                             |
| -------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `coding.review` + `best_quality`                   | **anthropic/claude-opus-4-6**（score 0.810） | 与 seed catalog 质量分（claude 0.9 > gpt 0.85）一致              |
| `summarization` + `cheapest`                       | openai/gpt-5.4-mini（score 0.956）           | 最低成本                                                         |
| `coding.review` + `best_quality` + `--budget 0.05` | openai/gpt-5.4-mini（score 0.558）           | **预算强制降级**：claude $0.2025、gpt-5.4 $0.0525 均超预算被排除 |

> 更正说明：旧版报告误写 best_quality 选 `openai/gpt-5.4`，根因是当时 CLI 跑的是 selector 修复（词典序）**之前的 `aor-core/dist`**。重建后结果稳定为 `anthropic/claude-opus-4-6`。

## 四、客观对比基准：调度优于单模型（达成定版 30%/20% 门槛）

`node packages/aor-sdk-node/dist/bench-cli.js`（离线 panel 后端，混合工作负载：2 个 coding.review + 4 个 summarization；每条输出由**真实 `node` 进程**校验是否包含必需 token 作为完成度信号）：

```
policy           completion   total_cost_usd   models
single:claude         100%         0.7050   claude×6
single:mini            67%         0.0170   mini×6
aor:auto              100%         0.4124   claude×2(coding), mini×4(summarization)

AOR vs single:claude (strong): completion 100% vs 100%, cost $0.4124 vs $0.7050 (-42%)
AOR vs single:mini (cheap):    completion 100% vs 67% (+33 pts), cost $0.4124 vs $0.0170
Plan thresholds: cost -30% vs strong = MET; completion +20 pts vs cheap = MET
```

**量化口径（明确）：**

- **成本↓**：以"强模型单跑（claude 全包）"为基线，AOR 路由后成本**下降 42%（≥30% 达标）**，且完成率持平（均 100%）。
- **完成率↑**：以"便宜模型单跑（mini 全包）"为基线，AOR 完成率**提高 33 个百分点（≥20 达标）**。相对便宜基线，AOR 的**绝对成本更高**（$0.4124 vs $0.0170）——本报告不再宣称"成本可比地低"，只主张"以更高完成率换取，且仍显著低于强模型基线"。

这两项门槛已写入 `packages/aor-sdk-node/src/bench.test.ts` 作为**断言**，回归即被 CI 捕获。

**适用范围声明：** 上述为**离线确定性基准**，唯一拟真项是各模型对各任务的输出文本（fixtures）；下游"写文件→真实 `node` 校验→打分"全部真实执行。把 panel 后端替换为 `OpenBotBackend` 即为**真实网关基准**（命令见 §七 live 模式），该实网关数据建议在 Stage 2 由运营方用真实 key 跑出归档。

## 五、Evaluator 现状（默认 vs 客观，明确区分）

- **默认**（`createBuiltinEvaluators`，`packages/aor-core/src/evaluator.ts`）：coding.review 为**内容型**探针（非空 / 结构化发现 / 长度阈值），summarization 为非空 + 压缩比。离线、零依赖，适合无工作区场景。
- **客观型**（`createObjectiveCodingEvaluator`，`packages/aor-sdk-node/src/coding-evaluator.ts`）：组合 `createCommandProbe`/`createCoverageProbe`，由**真实进程**的退出码/覆盖率驱动分数。**为显式开启**：通过 `createDefaultClient({ codingObjective: {...} })` 注入，或由基准 harness 直接使用。

> 结论：评估器框架已搭好，且客观型 coding 评估器已实现并被基准实际使用；但**当前默认 SDK 行为是内容型评估**。之所以不默认开启客观型，是因为它会对每次运行 shell 出 build/test，不适合非 coding / 无工作区的通用场景。Stage 2 接真实网关 coding 流程时，将以客观型为默认。

## 六、边界守卫（机器化强制 + 负例）

- 脚本：`scripts/check-aor-boundaries.ts`，npm：`pnpm lint:aor:boundaries`（已接入 `check` 链）。
- 规则：`packages/aor-*` 禁止导入 `openclaw`/OpenBot 内部（仅 backend 适配器允许 `openclaw/plugin-sdk`）、禁止 `@mariozechner/pi*`、禁止越出包根的相对路径。
- 实测：
  - 实扫：`AOR boundary guard: OK (no forbidden imports in packages/aor-*)`。
  - 负例自检（`--self-test`）：`detected 3 planted violations, 0 false positives`（分别命中 `openclaw`、越界相对路径 `../../../src/...`、`@mariozechner/pi-ai`）。

> 这同时满足"现在没有越界"与"未来越界会被 CI 阻断"。

## 七、复现实验命令（先重建，避免 stale dist）

```bash
# 1) 按依赖顺序重建 + 验证
for p in aor-core aor-backend-openbot aor-sdk-node; do
  pnpm --dir packages/$p build && pnpm --dir packages/$p typecheck && pnpm --dir packages/$p test
done

# 2) 边界守卫（实扫 + 负例自检）
pnpm lint:aor:boundaries
pnpm lint:aor:boundaries:selftest

# 3) 客观对比基准（离线，含 30%/20% 门槛判定）
node packages/aor-sdk-node/dist/bench-cli.js

# 4) CLI demo（离线桩后端）
node packages/aor-sdk-node/dist/cli.js "review this codebase and suggest improvements" --strategy best_quality --dry-run
node packages/aor-sdk-node/dist/cli.js "summarize this article" --strategy cheapest --dry-run
node packages/aor-sdk-node/dist/cli.js "review repo" --strategy best_quality --budget 0.05 --dry-run

# 5) 真实网关基准（运营步骤，需 OpenBot 网关 + key；将 panel 替换为 OpenBotBackend）
#    createDefaultClient({ baseUrl, apiKey, codingObjective: { test: { command: "pnpm", args: ["test"] } } })
```

## 八、已知偏差与说明（请专家关注）

1. **Parser 为规则版**：阶段 1 采用关键词打分以保证离线、确定、可测试；LLM 理解经 `LlmClassifier` 钩子在 Stage 1.x 接入，接口不变。
2. **成本目录为 seed 值**：`catalog.ts` 中成本/延迟/质量为种子；真实部署应由 SDK 从 OpenBot 配置读取成本，由 Evaluator 回填延迟/质量（Stage 2）。
3. **OpenAI 兼容入口当前回传零 usage**（`src/gateway/openai-http.ts:499`）：故成本以 Selector 估算为准；Stage 2 接 `usage.cost` RPC 取真实用量。
4. **基准为离线确定性**：见 §四"适用范围声明"。真实网关数据为 Stage 2 运营步骤。
5. **工作区链接**：本检出 `node_modules/@openbot` 因一处**无关 WIP**（`extensions/dingtalk` 引用 `openclaw@workspace:*`）导致全量 `pnpm install` 失败；已按既有惯例在 root `tsconfig.json` 增补 `paths` 并建立标准工作区软链完成验证。该问题不属本阶段范围，未改动。

## 九、Stage 2 进入条件（建议）

- 接真实 OpenBot 网关跑 coding 场景，以 `createObjectiveCodingEvaluator`（`pnpm build`/`pnpm test`/coverage）产出**实网关**的单模型基线 vs AOR 对比并归档。
- 客观 coding 评估器在 coding 流程切为默认。
- Planner：从单步升级为 DAG（并行/依赖），`AorRunResult` 契约已预留。
- Capability Registry 接入 Lobster pipeline 与插件工具作为复合能力实现。
- 成本统计 dashboard 对接 `gateway/billing` + cost-budget UI。
