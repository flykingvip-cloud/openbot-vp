# 实现范围草案（编码未批准 · 仅冻结范围）

> 本文件列出**将来编码获批后**会触碰的路径。当前工作树**不得**改这些运行时文件。

## 1. 冻结约束

| 约束            | 值                                                                                      |
| --------------- | --------------------------------------------------------------------------------------- |
| 复用            | `src/task-orchestration/**`                                                             |
| 预检            | 复用 `src/agents/execution-preflight/` 既有类型或只读结果；不得改 `attempt.ts` 预检语义 |
| Evaluator       | 仅返回结构化结果（见 `report-schema-draft.json`）                                       |
| 报告            | 仅来自测试或离线命令                                                                    |
| invoke          | `false`（硬）                                                                           |
| enqueue         | `false`（硬）                                                                           |
| 工具            | 不调用 `web_search` / `web_fetch`                                                       |
| ledger          | 不写生产 ledger（`wroteLedger: false`）                                                 |
| 状态机 / 日志库 | 不新建第五套状态机；不新建日志库                                                        |
| 回滚            | 仅配置/接线级；**永不**翻转 `ORCHESTRATION_LIVE_INVOKE`                                 |

## 2. 行锚（相对 `baseline-manifest.yaml` 的 `mainSha` = origin/main `6dae88725b0ebfbdeee3c52a501fb5ac39be6028`；与 `anchorsAtMainSha` 一致）

| 事实                                | 锚点                                              |
| ----------------------------------- | ------------------------------------------------- |
| `ORCHESTRATION_LIVE_INVOKE = false` | `src/task-orchestration/types.ts:22`              |
| `web_read` ∈ `ExecutionSurface`     | `src/task-orchestration/types.ts:40`              |
| `CAPABILITY_LADDER` 含 `web_read`   | `src/task-orchestration/types.ts:70`              |
| web_read 绑定 `execute: false`      | `src/task-orchestration/surface-binding.ts:78-91` |
| 影子派发 enqueue/invoke false       | `src/task-orchestration/dispatch.ts:161-186`      |

## 3. 精确计划触碰列表（编码获批后 · 草案）

下列路径是**将来**可能编辑的最小集合（仍须另开编码批准）：

1. `src/task-orchestration/web-read-shadow-eval.ts` — **新建**：影子评估器（结构化结果 only）
2. `src/task-orchestration/web-read-shadow-eval.test.ts` — **新建**：语料驱动单测 / 离线评估
3. `src/task-orchestration/surface-router.ts` — **可能只读扩展或旁路钩子**：web_read / clarify 决策观察（不得改热路径默认行为）
4. `src/task-orchestration/dispatch.ts` — **可能接线**：shadow 观察报告钩（保持 `enqueue:false` / `invoke:false` / `wroteLedger:false`）
5. `src/task-orchestration/types.ts` — **可能**：评估结果类型（不得改 `ORCHESTRATION_LIVE_INVOKE`）
6. `src/task-orchestration/reason-codes.ts` — **可能**：影子/clarify 相关 reason code 常量
7. `src/task-orchestration/index.ts` — **可能**：导出评估器符号
8. `src/task-orchestration/feature.ts` — **可能**：shadow 观察旗标接线（默认 off；回滚靠关旗）
9. `scripts/web-read-shadow-report.ts` 或等价离线命令入口 — **新建（可选）**：读语料、打报告；不写生产 ledger

明确**不在**计划内：

- `src/agents/tools/web-search.ts` / `web-fetch.ts`（不调用）
- `packages/**`、`ui/**`、schema、依赖清单、Feature Flag 默认值翻转
- `deploy/production/releases.jsonl`
- `.loom/registry.yaml`（仍由 kiro-loom）

## 4. 回滚摘要

关闭观察旗标或卸掉接线。无执行面变更。详见 `rollback.md`。
