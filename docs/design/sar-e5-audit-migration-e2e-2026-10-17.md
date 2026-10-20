# SAR E5 审计、迁移与端到端验收

日期：2026-10-17。状态：实现说明。基线 `93a497f1ab94162f54af7825967c4a6722b31634`（E4）。祖先含 E3 `d0fd774cf3` 与 P4 `671b38abb6`。

- 范围：企业 `traceId` 与 SAR `runId` 的关联、席位授权/审批/撤销对网站执行的挡放、五类失败的可映射展示、租户/能力/版本停用、旧记录缺字段的原语义。
- 路径：Path C。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心，不改 P0–P4 写运行时。不重建调度器。不把 mock 记成生产成功。

## 1. 关联

一次网站执行在治理网关里仍使用自己的 `traceId`。SAR 的 `runId` 只写进 `SarTraceCorrelation`。两边可以互查，且限定在同一 `tenantId`。

关联记录是允许列表：`traceId`、`sarRunId`、能力、版本、证据引用、状态、拒绝码、失败类和展示标签。调用方即使把载荷、Cookie、口令或整段 trace 传进来，也不会写入这条记录。证据引用不是短 id 时只留 `sha256:` 摘要。

没有发生 SAR run 时不编造关联。旧审计只有 `traceId` 时，读取不会补一个 `runId`。

## 2. 授权挡放

网站执行仍先过席位动作授权和审批，然后才进入 E1 桥。本阶段用真实 `invokeEnterpriseDataAction` 证明：

- 有授权时 provider 被调用。
- 撤销席位授权后，下一次调用是 `NO_ACTION_GRANT`，provider 调用次数不增加。已完成的关联还在。
- 未审批、审批被拒绝、一次性审批已消费，都是 `APPROVAL_REQUIRED`，provider 不被调用。
- 这些拒绝的展示类是「策略拒绝」。

## 3. 失败分类

展示类只有五个：登录、基础设施、策略拒绝、结构变化、业务验证失败。分类先看 SAR `classifySiteFailure`，再看网关拒绝码。`params`、`risk-control`、`unknown` 不贴这五个标签。`SAR_EXECUTION_HALTED` 也不是其中一类。

| 展示         | SAR 类              | 主要码                                                                             |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| 登录         | `auth`              | `AUTH_REQUIRED`、`CREDENTIAL_REAUTH_REQUIRED`、`SOURCE_CREDENTIAL_MISSING`         |
| 基础设施     | `infrastructure`    | `BROWSER_UNAVAILABLE`、`UPSTREAM_TIMEOUT`、`HANDLER_TIMEOUT`                       |
| 策略拒绝     | `policy`            | `NO_ACTION_GRANT`、`APPROVAL_*`、`SCOPE_DENIED`、`POLICY_DENIED`、绑定/范围/写禁止 |
| 结构变化     | `structure-change`  | `STRUCTURE_CHANGED`                                                                |
| 业务验证失败 | `validation-failed` | `VALIDATION_FAILED`                                                                |

网关拒绝码仍然保留。展示类是附加字段 `failureDisplay`，不覆盖原码。结构变化失败后数据源 `status` 仍是 `connected`，且不写 `lastSucceededAt`。

## 4. 停用开关

`setSarExecutionHalt` 有三档：租户、能力、版本。匹配时桥在调用 provider 之前返回 `SAR_EXECUTION_HALTED`。版本停用只挡该版本，能力停用挡该能力的各个版本，租户停用挡该租户的网站 run。

停用不撤回在途副作用。`inFlightSideEffectsWithdrawn` 与 `priorWriteMayBeReplayed` 都是 false，与 E3 / P4 一致。已经成功的审计和关联保持原样。API 连接器读取不走这个开关。

## 5. 旧记录

`readLegacyKnowledgeLineage` 只复制已经存在的字段。缺 `sarRunId`、验证者、`sarVerification` 或 `sarCompleteness` 时，`lineageRecordsVerifiedSar` 为 false。`verifiedInProduction` 不参与判断。

`invocationAuditRecordsVerifiedSar` 只在审计自己带有成功状态、`sarRunId`、`passed`、`complete` 和 `artifactDigest` 时为 true。规范化旧文件会补上空的关联表和停用表，不会把旧 trace 填成已验证网站能力。

## 6. 任务书 §5 覆盖

| #   | 用例                               | 本阶段                                                                                      |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | 测试门户接入且不显示虚假同步       | 未做浏览器。结构变化不会写成连接成功                                                        |
| 2   | 探索草稿、审核、分配给另一数字人   | 未做                                                                                        |
| 3   | 治理读取与原始旁路拒绝             | 未改 E4。`knowledge-publication` 测试仍通过                                                 |
| 4   | 多租户、多实例、私人账户           | 关联按租户隔离。私人账户仍由 E1 拒绝                                                        |
| 5   | 安装、绑定、验证、新鲜度分开       | 未改 E2/E3 页面                                                                             |
| 6   | 缺会话或 handler 不返回 mock       | 未改 E1 失败关闭。相关测试仍通过                                                            |
| 7   | 改版失效但连接可正常               | 机制测试：结构变化保持 `connected`，不写 `lastSucceededAt`                                  |
| 8   | partial / unknown 保留             | E1 测试仍通过。unknown 不落入五类标签                                                       |
| 9   | 接管、停用、撤销                   | 授权撤销、审批拒绝/消费、三档停用已测。未做浏览器接管。不宣称副作用已撤回                   |
| 10  | P4 写操作仍不进投影                | 未改写运行时。未重跑写夹具                                                                  |
| 11  | 双向关联幂等                       | 未改 E2                                                                                     |
| 12  | API、MCP、安装审核、知识供给无回归 | CRM 读取在网站租户停用下仍成功。数据网关、血缘、安装投影、知识发布测试通过。未重跑 MCP 映射 |

## 7. 明确不做

不做外站真会话，不做双中心浏览器点击验收。不实现 `event_driven` 调度器。不把 mock 或 `mock_smoke_ok` 记成生产成功。不导出 Cookie。不修改 P0–P4 写运行时。不新建第三中心。
