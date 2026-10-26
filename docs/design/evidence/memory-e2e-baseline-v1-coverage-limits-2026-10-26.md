# O8 v1 覆盖限制说明（保留原文，不覆盖）

| 字段    | 值                                                                                     |
| ------- | -------------------------------------------------------------------------------------- |
| 日期    | 2026-10-26（Asia/Shanghai）                                                            |
| v1 证据 | `memory-e2e-baseline-pre-2026-10-26.json` / `memory-e2e-baseline-post-2026-10-26.json` |
| 状态    | **保留**；O8 v2 另文；**不得**用 v1 数字解释系统有效率                                 |

## 覆盖限制

1. **S1**：经 SDK `upsertAtoms` + `queryAtoms`，**未**经真实工具或回复处理链完成新会话检索。
2. **S2**：预置 `status=deprecated` 原子后过滤，**未**真正执行事实更新/废弃/冲突操作。
3. **S5**：子进程重建 runtime 后 `queryAtoms`；**未**重建 `CogniWeaveMemoryManager` 并走 `search` 检索链路。只读 metadata 不能证明检索链路。
4. **O5 / S4**：以路径名 `MEMORY.md` 残留判定缺陷；**未**按来源 ID 排除其他有效来源 → **O5 证据无效**，不得据此认定残留缺陷或提出串联 lifecycle 修复。
5. **模型效果**：请求发送 / 正确采用均为 `untimed`（本批未调用真实模型）。

## 脚手架内部结果（禁止外推）

- pre `13/22` → post `19/22` **仅**作脚手架内部结果（H1/A1 等观测项转绿），**不能**解释为系统有效率提升。
- 诊断数据采集成功 ≠ 产品测试通过。

> Current layered baseline: `memory-e2e-baseline-v3-post-rework-2026-10-26.json` (v2 superseded). v1 limits above still apply historically.
