# ledger-audit finding codes（exit 30 分类改进）— 2026-10-31 Asia/Shanghai

## 目标

改进 `auditLedger` 对祖先关系失败的**分类**，使缺对象 / 图不完整 / 已裁定回归不再共用 `regression`。  
**不改变 fail-closed**：上述三类在未人工裁决前仍为 `severity: error` → CLI exit 30。  
**禁止**靠删除 `releases.jsonl` 行或批量写入 `regressionAcknowledged` 刷绿。

## 运行时 finding codes ↔ 离线 P1 类

离线权威当前口径见同目录 `p1-current-classification-2026-10-31.json`（145 forward-only + 1 incomplete_graph_unknown；完整 146 本轮未重遍历）。

| 运行时 `LedgerFinding.code` | 离线 P1 类（近似） | 何时发出 | 默认 severity |
|---|---|---|---|
| （无 finding） | `forward_only` | `classifyAncestry` → forward | — |
| `missing-object` | `missing_object` | tip `cat-file -t` 失败 | error（不可用 `regressionAcknowledged` 降级） |
| `incomplete-graph` | `incomplete_graph_unknown` | tip 存在但父对象缺失，或 **shallow（不论 merge-base 是否成功）**，或 is-ancestor 非 0/1 | error（同上） |
| `regression` | `proven_dag_break`（仅当图足够完整） | tip 与父对象齐全、非 shallow 截断未决，且非祖先 | error；仅此项可被 `regressionAcknowledged` → warning |

用语：消息使用 **「under the current object graph」** / 等价中文「当前对象图下」；**禁止**写「联合完整图」。

## 探针顺序（`classifyAncestry`）

1. `cat-file -t` 两侧 tip → 缺则 `missing-object`
2. `merge-base --is-ancestor` → 0 则 forward；非 0/1 则 `incomplete-graph`
3. `rev-list --parents -n 1` + 父对象存在性 → 父缺失则 `incomplete-graph`
4. 若 shallow → **一律** `incomplete-graph`（即使 `merge-base` 成功；父链截断未排除）
5. 多候选（gateway/UI）：任一 `forward` 即通过；否则按 `missing-object` > `incomplete-graph` > `regression` 聚合（禁止首个 regression 定案）
6. 否则（非 shallow 且图足够完整）→ `regression`

## 明确禁令

1. 不得删除账本 ERROR 关联行以清除 exit 30。
2. 不得在 audit 工具内自动写入 `regressionAcknowledged`。
3. `regressionAcknowledged` **不得**降级 `missing-object` / `incomplete-graph`。
4. 不得用「清理 refs / 假装对象齐全」代替 deepen / 补对象后再裁决。

## 非目标

- 本 PR **不**重遍历全部历史 146 条 ERROR（仍以离线证据为准）。
- 本 PR **不**修改 `deploy/production/releases.jsonl`。
- 本 PR **不**宣称 delivery gate PASS。
