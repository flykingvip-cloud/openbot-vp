# SAR E4 数据产品与知识供给

日期：2026-10-17。状态：实现说明。基线 `d0fd774cf36176cf7446a82d1380a4268ada8030`（E3）。

- 范围：复用 `DataCapability.actionRefs` 与 `EnterpriseKnowledgeProjectionSpec.sourceActions`，沿现有 on-demand / scheduled 物化路径发布知识对象。
- 路径：Path C。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心，不改 P0–P4 写运行时。不旁路 E1 治理网关。不做 E5 全量端到端。

## 1. 物化范围

| 模式 | 现网 | 本阶段 |
| --- | --- | --- |
| `on_demand` | `ensureOnDemandProjectionsMaterialized` | 继续只跑这个模式 |
| `scheduled` | `tickScheduledProjectionMaterialization` | 继续只跑这个模式。这是唯一的调度器 |
| `event_driven` | 可以保存 | 仍然只保存。没有调度器，不把枚举说成已实现 |

物化仍要求投影 `lifecycle === "active"`、绑定 `enabled`、恰好一条 `sourceActions`。动作必须能在关联的 `DataCapability.actionRefs` 上对上，不能从能力反推来源。

网站会话投影必须写明 `sourceId`。执行用户取该数据源上的账户所有者，不取调用者，也不能从物化 RPC 覆盖 `userId`。另一个私人账户不会被这次物化读到。

## 2. 发布闸门

网关 `ok: true` 不够。`decideKnowledgePublication` 再看 SAR 事实：

- 失败、`verification !== "passed"`、`completeness !== "complete"`：不发布完整知识对象。
- `completeness === "partial"` 且状态成功、核验通过：默认仍不发布。
- 只有投影显式 `partialPublication: "publish_marked"` 时，才保存一条不完整对象。对象的 `publication` 为 `partial`，标题、摘要和 `publicationNotice` 都写明「不完整输出，不是完整知识对象」。
- 员工调用的保留结果不带回行。物化进程才能看到脱敏后的 partial 载荷，并且仍要过上面的策略。
- 非网站的既有成功读取仍可发布完整对象。血缘上没有 SAR 版本、run、验证者时，不把它当成已验证网站能力。

写动作不能进入 `ProjectionSpec`。`readOnly === false` 的动作在规格保存时拒绝。P4 `WriteExtensionRuntime` 仍不进投影。

## 3. 血缘

新的 `KnowledgeLineageRecord` 在有事实时记下 `sourceId`、`sourceActions`、`sarCapabilityId`、`sarVersion`、`sarRunId`、`sarEvidenceRef`、`validator`、`sarVerification`、`sarCompleteness`。

`validator` 来自桥上显式写下的名字。核验状态不是验证者。缺任一字段，或完整性不是 `complete`，`lineageRecordsVerifiedSar` 为 false。旧记录缺这些字段时原样保留，读取时不补成已验证。

## 4. Agent

Agent 仍走 `loadEnterpriseKnowledgeFeed` 以及 `knowledge.search` / `knowledge.cognitive.bundle` 读到的知识对象。`invokeDataCapabilityWithContext` 在席位、授权和配额之后返回 `knowledge-object-only`，不请求连接器动作，也不 import 数据网关。未获可见性的席位看不到对象正文。

## 5. 明确不做

不实现 `event_driven` 调度器。不做 E5 的 trace 关联、迁移和全量浏览器端到端。不把 mock 或 `mock_smoke_ok` 记成生产成功。不因管理员身份共享私人账户。不导出 Cookie。不修改 P0–P4 写运行时。
