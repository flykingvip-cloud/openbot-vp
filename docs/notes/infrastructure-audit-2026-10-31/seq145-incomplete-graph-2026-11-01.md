# seq145 未决后续任务

- 任务 ID：`IA-SEQ145`
- Loom：`infrastructure-audit:seq145-incomplete-graph`
- 状态：blocked
- 负责人：待指派（Loom owner 记为 `unassigned`，避免空 owner）
- 登记时间：2026-11-01
- 关联：基础设施审计收尾 [closeout-2026-11-01.md](closeout-2026-11-01.md)。不在本批治理结项的完成范围内。

## 当前事实

历史权威分类（未在本轮改写）`docs/notes/infrastructure-audit-2026-10-31/p1-current-classification-2026-10-31.json`：

- 类：`incomplete_graph_unknown`
- 用语：「当前联合对象图下非祖先」
- 不得写成「联合完整图」或「历史无共同祖先」
- 不得写成已证明内容回退
- `truncation_not_ruled_out`: true
- 账本 seq145 `gatewaySha` `065840dfba129475c9c9030c80af07970dcdd084` 没有 `regressionAcknowledged`

当日证据仍在 `seq145-evidence.json` 与 `p1-dag-break-evidence-closure-2026-10-31.md`。donor 清单与 `recovered-shas.txt` 保留。

本轮（2026-11-01，候选 `c3b00f492411dc96d2befd67921fe4951cfede97`，非浅克隆）另有一套结果，不能代替历史分类：

- `git cat-file -t 9a8e91d19e893fc5d963103538cdbd35f315ac30` 失败（seq144 tip 不在本对象库）
- seq145 tip 对象存在
- `pnpm delivery:ledger:audit` 退出码 30；seq145 行是 `missing-object`，缺的是 `9a8e91d19e89`
- 本轮没有算出共同祖先，也没有证明共同祖先不存在

## 缺的证据

1. seq144 tip 与 seq145 tip 同时可读。
2. seq144 的声明父提交在用于裁决的对象图里可读，且 `rev-list` 不再停在浅边界。
3. 在该图上的 `git merge-base --is-ancestor` 双向退出码，以及 `git merge-base` 是否给出提交。
4. 独立验收对分类的书面结论。执行方测试不算这项。

## 关闭条件

同时满足才可关闭：

- 上列证据写进新的证据文件，旧的 `seq145-evidence.json` 与 donor 清单仍保留。
- 分类只允许：forward-only，或继续 `incomplete_graph_unknown`，或在截断已被排除且双方对象齐全时记为 ancestry break。
- 任何一种分类都不得自动写入 `regressionAcknowledged`。若要 acknowledge，须另有明确授权，且只能在截断已排除的 ancestry break 上单独决定。
- 不删除 `releases.jsonl` 行，不把历史 146 表改成「已重审全表」。
- 独立验收记录指向上述证据。

未满足时保持未决。本任务保持 blocked，直到有人接手并补齐对象图。

## Loom 路径归属（2026-11-01 复验整理）

本说明文件路径仍由 `infrastructure-audit:infra-audit` 认领（目录通配）。任务 `infrastructure-audit:seq145-incomplete-graph` 保持 `blocked` / `owner: unassigned`（等待责任分配），**不再单独认领本路径**，以消除 ownership-overlap。接管本残留时须按 AGENTS.md 做 takeover（`loom register`）后再认领路径。
