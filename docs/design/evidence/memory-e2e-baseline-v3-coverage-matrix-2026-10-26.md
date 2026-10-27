# O8 v3 覆盖矩阵（分层；状态模型 passed/failed/not-run）

| 字段   | 值                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 日期   | 2026-10-26（Asia/Shanghai）                                                                                  |
| 证据   | `memory-e2e-baseline-v3-post-rework-2026-10-26.json`                                                         |
| 数据集 | `memory-batch1-dataset-v1.json`（与 v1/v2 同一版）                                                           |
| 替代   | **本版替代 v2**（`memory-e2e-baseline-v2-post-rework-2026-10-26.json` / v2 matrix）。v1 保留。               |
| 修正   | ① not-run 不计入 passed；② `forgetMemoryEntry` 标 `helper-integration`，不得称已覆盖 `gateway-handler-chain` |

## 分层结果（脚手架内部；≠ 系统有效率）

| 层级                       | 用例                                        | passed/failed/not-run | 说明                                                      |
| -------------------------- | ------------------------------------------- | --------------------- | --------------------------------------------------------- |
| isolation                  | ISO-v3-1                                    | 1/0/0                 | 解析配置与存储路径；清理隔离外 env/凭据                   |
| sdk-unit                   | S2-v3-real-deprecate, S3-v3-wrong-owner     | 2/0/0                 | S2 真正调用 `deprecateAtom`；冲突写路径未测               |
| manager-integration        | S1-v3-manager-search                        | 1/0/0                 | `CogniWeaveMemoryManager.search`；**未**经真实工具/回复链 |
| cross-process-retrieval    | S5-v3-manager-cross-process-search          | 1/0/0                 | 子进程重建 manager 并 `search`                            |
| helper-integration         | S4-v3-forget-same-source                    | 1/0/0                 | **直接** `forgetMemoryEntry`（data/helper）；≠ 网关处理链 |
| gateway-handler-chain      | GW-v3-auth / managed-reject / handler-chain | 0/0/3                 | **全部 not-run**；网关认证、managed 拒绝、处理链未测      |
| health-audit-observability | H1-v3, A1-v3                                | 2/0/0                 | O1/O2 观测项                                              |
| model-effect               | MODEL-v3-untimed                            | 0/0/1                 | **not-run**；请求发送/正确采用未测；**不计入 passed**     |

汇总：total=12 **passed=8 failed=0 not-run=4**（scaffoldInternalOnly；禁止解释为系统有效率）。

## 实际执行的样本 ID

- 执行用例：`ISO-v3-1`, `S2-v3-real-deprecate`, `S3-v3-wrong-owner`, `S1-v3-manager-search`, `S5-v3-manager-cross-process-search`, `S4-v3-forget-same-source`, `H1-v3-backend-scope-health`, `A1-v3-empty-md-class`
- 数据集样本命中：`P01`–`P05`, `P21`

## 明确未覆盖

- 网关：`GW-v3-auth-not-run`, `GW-v3-managed-reject-not-run`, `GW-v3-handler-chain-not-run`
- 模型：`MODEL-v3-untimed`
- 数据集正例未跑：`P06`–`P20`, `P22`
- 数据集负例未跑：`N01`–`N11`
- 完整工具调用链 / 回复注入 / 提示词构造：仍未验证

## 相对 v2 的修正

- MODEL 层：`pass:true` → `status:not-run`（passed 不再被虚增）。
- S4：`gateway-handler-chain` → `helper-integration`；另增 3 条 gateway not-run 显式条目。
