# SAR E1 数据源与治理执行桥接

- 状态：实现说明。不是生产能力声明，不是 E2–E5。
- 日期：2026-10-17
- 基线：`origin/main` `1713f0c141c989b26e3aa0f317a885f5d54988e0`（祖先含 E0 squash `3aaacebbb724f6e5bfeea6fdeb81f2560930c124` 与 P4 squash `671b38abb61041909d78d8324b9498145349bc1f`）。
- 路径：Path C。复用治理网关和既有 `AccountBinding`。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心，不改 P0–P4 写运行时。

## 1. 桥接在哪里

员工读取仍从 `enterprise-data.invoke` 进入 `invokeEnterpriseDataAction`。信任上下文、席位授权、运行时注册、范围策略和审批都先走完。通过之后才分叉：

- `accessMethod: "credential"`：按 `sourceId` 取该数据源自己的凭证，再进入原适配器。
- `accessMethod: "website_session"`：进入 `executeGovernedSarBridge`。缺绑定、缺 provider、缺验证或范围不能在读取前执行时拒绝。禁止 `executeMockHandler`。

`sarProvider` 只由进程内调用方传入。RPC 不接受客户端传来的 provider。默认没有 provider，网站路径因此失败关闭，而不是回退 mock。

Agent 目录调用仍停在 `capability-agent-invoke-runtime.ts` 的 knowledge-object-only。该文件不引用本桥，也不调用 `site_invoke`。本桥不把原始行交给 Agent。

写操作不进入本桥。`effect` 不是 `read` 时拒绝。桥不写 `ProjectionSpec`，也不写知识对象。P4 的授权和回查保持原路径。

## 2. 映射落地

存储在企业数据仓的 `sarExecutionBridges`。字段沿用 E0，不另造同义类型。

| E0 字段                    | 落地                                              |
| -------------------------- | ------------------------------------------------- |
| `tenantId`                 | `EnterpriseSarExecutionBridge.tenantId`           |
| `sourceId`                 | `EnterpriseSarExecutionBridge.sourceId`           |
| `ConnectorActionRef`       | `actionRef.connectorId` / `actionKey` / `version` |
| SAR `capabilityId`         | `capabilityId`                                    |
| SAR `version`              | `version`（与动作版本分开）                       |
| `artifactDigest`           | `artifactDigest`                                  |
| 可选 `skillId`             | `skillId`                                         |
| `AccountBinding.bindingId` | `bindingId`                                       |
| `AccountBinding.userId`    | `userId`，执行时必须等于可信上下文的 `userId`     |

`verification` 复用能力验证的 `unverified | passed | failed | stale`。只有 `passed` 且摘要非空才执行。`registered`、`ready`、`handlerCount` 和 `mock_smoke_ok` 都不算验证。

连接器目录增加 `accessMethod`。既有 CRM / ERP / API / 数据库条目是 `credential`，分类仍是 `crm`、`erp` 或 `external`。新条目 `site-session` 的 `credentialKind` 是 `none`，`accessMethod` 是 `website_session`，分类是 `external`。数据源实例仍可标 `crm` 或 `erp`。网站会话源保存 `bindingId`，拒绝把该账户写成 `api_key` 或 `oauth2` 凭证。目录不安装该连接器的动作包，因此不会默认灌入能力。

## 3. 按 sourceId 解析账户

`selectSourceCredential` 取代「同一 `connectorId` 取第一条 active 凭证」。

- 调用带了 `sourceId`：只读该数据源的 `credentialId` 或 `bindingId`。
- 同一连接器有多条数据源且没给 `sourceId`：`SOURCE_ACCOUNT_AMBIGUOUS`。
- 数据源没有自己的凭证：不改去拿别的 active 凭证。
- 同一 `credentialId` 或 `bindingId` 被同一连接器的两个数据源引用：拒绝。
- 没有任何数据源且只有一条 active 凭证：仍使用那一条。这不是多实例串账户。

`enterprise-data.invoke` 增加可选 `sourceId`。客户端不能在 input 里塞 `bindingId`、`userId` 或 `credentialId`。

私人绑定：桥上的 `userId` 与本次可信用户不一致时返回 `SAR_BINDING_PRIVATE`。企业管理员身份不会放宽这一条。

## 4. 穿过网关时保留的事实

完整成功同时是 SAR `status: succeeded`、`verification: passed`、`completeness: complete`、`repair: "none"` 且没有 error。网关 `ok: true`，审计 `SUCCESS`。响应同时带 `traceId` 和 `sar.runId`，审计另存 `sarRunId`。两个 id 不合并。

其余结果 `ok: false`：

| SAR 结果                                      | 网关                                                                             | 审计        |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ----------- |
| `unknown`                                     | `SAR_OUTCOME_PRESERVED`，`retry` 保持 `not_ordinary`，`ordinaryFailure` 为 false | `PRESERVED` |
| `completeness: partial`                       | 同上，不返回局部行                                                               | `PRESERVED` |
| `verification: not_performed` 或其他非 passed | 同上，不改成 `passed`                                                            | `PRESERVED` |
| 已知失败 `ordinaryFailure: true`              | `HANDLER_ERROR`，同时保留 `sar.errorCode`                                        | `FAILED`    |

`PRESERVED` 不是 `SUCCESS`。物化只接受 `ok: true`，因此 partial / unknown 不会变成完整知识对象。本阶段不改投影调度。

## 5. 范围

范围策略先算完。桥声明 `supportedScopeTypes` 和 `enforcedFilterFields`。策略要求的范围或过滤字段不在声明里时，provider 零次调用，返回 `SAR_SCOPE_UNSUPPORTED`。

provider 若报告 `scopeEnforcedBeforeRead !== true`，网关丢弃数据并拒绝。事后过滤不能把这次读取变成成功。

## 6. 明确不做

不实现接入向导、双向链接、安装绑定、投影血缘、审计迁移或端到端浏览器验收。不把写能力放进默认 SAR 目录。不把外站写做成默认开关。不把 `mock_smoke_ok` 记成生产成功。网站探测在动作和 handler 已注册时返回 `website_session_not_verified`，`ok: false`。
