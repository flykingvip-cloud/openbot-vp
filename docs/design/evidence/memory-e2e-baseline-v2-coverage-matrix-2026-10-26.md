# O8 v2 覆盖矩阵（分层；勿称完整 E2E）

> **Superseded by** `memory-e2e-baseline-v3-coverage-matrix-2026-10-26.md` / `memory-e2e-baseline-v3-post-rework-2026-10-26.json`. Historical v2 content retained; do not use v2 passed counts (MODEL-v2-untimed was pass:true; S4 mislabeled gateway-handler-chain).

| 字段   | 值                                                                                        |
| ------ | ----------------------------------------------------------------------------------------- |
| 日期   | 2026-10-26（Asia/Shanghai）                                                               |
| 证据   | `memory-e2e-baseline-v2-post-rework-2026-10-26.json`                                      |
| 数据集 | `memory-batch1-dataset-v1.json`（与 v1 同一版）                                           |
| v1     | **保留**；见 `memory-e2e-baseline-v1-coverage-limits-2026-10-26.md`（含 **O5 证据无效**） |

## 分层结果（脚手架内部；≠ 系统有效率）

| 层级                       | 用例                                    | 通过       | 说明                                                              |
| -------------------------- | --------------------------------------- | ---------- | ----------------------------------------------------------------- |
| isolation                  | ISO-v2-1                                | 1/1        | 解析配置与存储路径；清理隔离外 env/凭据                           |
| sdk-unit                   | S2-v2-real-deprecate, S3-v2-wrong-owner | 2/2        | S2 **真正**调用 `deprecateAtom`；冲突写路径未测                   |
| manager-integration        | S1-v2-manager-search                    | 1/1        | `CogniWeaveMemoryManager.search`；**未**经真实工具/回复链         |
| cross-process-retrieval    | S5-v2-manager-cross-process-search      | 1/1        | 子进程重建 manager 并 `search`（非只读 metadata）                 |
| gateway-handler-chain      | S4-v2-forget-same-source                | 1/1        | `forgetMemoryEntry` 允许路径；活网关 RPC / managed 拒绝运行时未测 |
| health-audit-observability | H1-v2, A1-v2                            | 2/2        | O1/O2 返修后观测项                                                |
| model-effect               | MODEL-v2-untimed                        | 0 executed | 请求发送/正确采用未测                                             |

汇总：total=9 passed=9（**scaffoldInternalOnly**；禁止解释为系统有效率提升）。

## 相对 v1 的明确改进

- S2：不再预置 deprecated，改为执行 `deprecateAtom`。
- S5：子进程重建 **manager.search**，不只 queryAtoms metadata。
- S1：标出未测步骤（工具链 / 回复注入 / 提示词构造）。
- 验收：观测层失败会使验收失败；诊断成功 ≠ 产品通过。
- v1 的 13/22→19/22 **仅**脚手架内部历史，不外推。
