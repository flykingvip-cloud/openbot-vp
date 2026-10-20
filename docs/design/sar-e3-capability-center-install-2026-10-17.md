# SAR E3 能力中心治理与安装

- 状态：实现说明。不是生产能力声明，不是 E4–E5。
- 日期：2026-10-17
- 基线：`origin/main` `8aab43c023d8d475a2d307cbad318770c491dd08`（SAR E2 squash）。祖先含 E1 `94f2ea154cccebaab4fbb650df080ebdee36e53c`、E0 `3aaacebbb724f6e5bfeea6fdeb81f2560930c124` 与 P4 `671b38abb61041909d78d8324b9498145349bc1f`。
- 路径：Path C。复用技能目录、详情、贡献审核、`SkillExecutionBindingRecord` / `syncSkillExecutionBinding` / `enterprise-capability.install-to-robots`，以及 E1 的 `EnterpriseSarExecutionBridge` 和 `AccountBinding`。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心，不改 P0–P4 写运行时。

## 1. 能力中心读什么

技能详情在既有数据资产链接旁边多一块只读事实。事实来自桥、钉死的执行绑定和 `ValidationRecord`，不复制成可编辑状态。

| 事实     | 来源                                                                        | 页面含义                                                     |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 关联网站 | `skillId` 相同的 `EnterpriseSarExecutionBridge` 与 `DataSource.displayName` | SAR `capabilityId` 只展示，不当技能 id                       |
| 账户     | 调用者自己的 `AccountBinding`                                               | 缺绑定是「待配置」。别人的 `bindingId` 不回显                |
| 执行版本 | `SkillExecutionBindingRecord.installedVersion` 与 `artifactDigest`          | 目录头版本只作对照，不写回钉                                 |
| 验证时间 | 与钉死版本和摘要匹配的 `ValidationRecord.reviewedAt`                        | 没有记录就是未记录，不用 `updatedAt` 填                      |
| 验证     | 上述记录的 `verdict`                                                        | 没有记录是 `unknown`。桥上的 `verification` 另列，不充当记录 |
| 成熟度   | 能力中心原有成熟度                                                          | 与验证并排。执行闸门不读它                                   |
| 副作用   | 桥的 `read`，以及依赖里已有的 `create` / `update`                           | 写入不进投影                                                 |
| 依赖     | 技能运行时 `dependencies`                                                   | 只展示，不新建依赖 id                                        |

`enterprise-data.assets.capability-install` 是这条只读投影。客户端传来的 `bindingId`、`userId`、摘要和验证记录都不采用。RPC 目前不持有验证记录，因此页面上的可执行结果是失败关闭；夹具级闸门在 `projectCapabilityCenterInstall`。

## 2. 安装和账户授权分开

`enterprise-capability.install-to-robots` 与技能执行绑定仍然负责把技能装到机器人。安装不写 `accountBindings`，也不把管理员能看见的私人绑定复制给调用者。

缺绑定的展示是「待配置」。有技能授权但没有调用者自己的账户，执行拒绝码是 `SAR_BINDING_MISSING`。有账户但没有技能授权，拒绝码是 `POLICY_DENIED`。两条都不可执行。

## 3. 执行闸门

下一轮执行同时需要：

- 执行绑定已启用，生命周期在既有 `EXECUTABLE_LIFECYCLES` 内
- `skillAuthorized` 为真。停用把绑定 `enabled` 置否；撤销把授权置否
- 桥上的 `bindingId` 属于本次 `userId`。管理员身份不放宽
- 桥的 `version` 与 `artifactDigest` 等于钉，且 `verification === "passed"`
- 存在 `verdict === "passed"` 的 `ValidationRecord`，版本和摘要与钉相同

成熟度、桥上单独的 passed 标记、目录头版本都不能代替这条记录。目录升级后，`syncSkillExecutionBinding` 仍用钉上的版本去取运行时定义，并把它写进 `SKILL.md` 的 `openbot.skillVersion` / `openbot.artifactDigest`。关系上的 `installedVersion` 可以跟着目录头走，SAR 钉不跟。

写效果只展示。`entersKnowledgeProjection` 恒为 false。停用、撤销和版本失效只拒绝新的 run。在途结果原样保留，`inFlightSideEffectsWithdrawn` 恒为 false，`priorWriteMayBeReplayed` 仍按 P4 为 false。这里不宣称副作用已经撤回。

## 4. 私有草稿

`includeInEnterprisePublicCatalog` 拒绝 `lifecycle === "draft"` 和 `visibility === "private"`。推荐列表使用同一谓词。

已有治理注册行不再把私人草稿显示成「已进入企业资产库」。显式提交并审核通过的技能仍走原来的审核和 `enterprise-capability.install-to-robots`。公共目录 `sidebarEntry: "all"` 不列出注册表 `draft`（投影生命周期 `submitted`）。

## 5. 明确不做

不实现 E4 投影血缘，不实现 E5 全量浏览器端到端。不把写操作送进投影。不把 mock 或 `mock_smoke_ok` 记成生产验证。不因管理员身份共享私人账户。不导出 Cookie。不修改 P0–P4 写运行时。能力中心 RPC 还没有验证记录存储，不能凭这次读取宣称生产执行已经放开。
