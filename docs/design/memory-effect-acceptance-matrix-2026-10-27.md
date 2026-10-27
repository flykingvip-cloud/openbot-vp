# Memory effect-acceptance matrix — 实施说明（2026-10-27）

## 目的

在 O8 layered baseline 之上建立 **effect-acceptance** 矩阵与隔离 harness，把召回 / list / ACL / O4 `statusView` / path1 forget 与 forget assessment 的多来源期望收成同一套 `passed|failed|not-run` 记录。

## 交付

| 产物 | 路径 |
| --- | --- |
| Harness | `src/memory/memory-effect-acceptance-matrix.test.ts` |
| 覆盖矩阵 | `docs/design/evidence/memory-effect-acceptance-matrix-2026-10-27.md` |
| 隔离复用 | `src/memory/memory-batch1-isolation.ts` |

## 非目标

见 evidence 矩阵「Hard bans」与「明确不声称」。本 PR **不** merge 即 deploy；**不**写生产记忆。

## 验收

- vitest：effect matrix harness 全绿；`failed=0`；至少 4 条 `not-run`（含 PROD / FACT / GW / MODEL）
- 文档写明 covers / does-not-claim
- PR open，**无** auto-merge
