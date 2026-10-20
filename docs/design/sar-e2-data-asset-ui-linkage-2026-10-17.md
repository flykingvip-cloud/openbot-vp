# SAR E2 数据资产页面联动

- 状态：实现说明。不是生产能力声明，不是 E3–E5。
- 日期：2026-10-17
- 基线：`origin/main` `94f2ea154cccebaab4fbb650df080ebdee36e53c`（SAR E1 squash）。祖先含 E0 `3aaacebbb724f6e5bfeea6fdeb81f2560930c124` 与 P4 `671b38abb61041909d78d8324b9498145349bc1f`。
- 路径：Path C。复用 E1 的 `DataSource`、`AccountBinding` 和 `EnterpriseSarExecutionBridge`。不建 Bridge，不导出 Cookie，不分叉 OpenCLI，不新建第三中心，不改 P0–P4 写运行时。

## 1. 页面读什么

数据治理中心资产页不再把 `updatedAt` 当成同步证据。列表和详情同时给出：

| 事实     | 来源                                           | 页面含义                                                         |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| 接入方式 | `DataSource.accessMethod`，缺省时用连接器目录  | `credential` 或 `website_session`                                |
| 关联能力 | 该数据源的 `EnterpriseSarExecutionBridge`      | SAR `capabilityId` 与版本；有 `skillId` 才链到能力中心           |
| 验证     | 桥上的 `verification`                          | `unverified` / `passed` / `failed` / `stale`；没有桥是 `unknown` |
| 数据范围 | 桥上的 `supportedScopeTypes`                   | 空集合是「范围未知」，不补成 ALL                                 |
| 检查     | `lastCheckedAt`                                | 只由带 `sourceId` 的测试连接写入                                 |
| 成功读取 | `lastSucceededAt`                              | 只由治理读取成功写入；演示连接器不写                             |
| 入库     | `lastMaterializedAt` 与 `materializationCount` | 只由既有投影物化在写出血缘之后写入；演示连接器不写               |
| 记录修改 | `updatedAt`                                    | 只表示数据源记录被编辑                                           |

实时查询：有 `lastSucceededAt`、没有入库时间。新鲜度是 `live_query`，`claimsSynced` 和 `claimsIngested` 都是 false。页面文案是「实时查询，未入库」。

客户端传入的时钟在 `upsertDataSource` 时丢弃。已有时钟原样保留，编辑记录只改 `updatedAt`。

## 2. 三组统计

资产页分开计数，不合成一个「健康」：

- 连接健康：`status === "connected"` 才是 healthy。非法状态是 unknown。unknown 不加进 healthy。
- 能力验证：任一桥 `failed` 则聚合为 failed，即使连接是 healthy。全部 `passed` 才是 healthy。没有桥是 unknown，不是 passed。生产验证次数是 `verification === "passed"` 的桥数量，不是存储计数器。
- 数据新鲜度：入库时间在 24 小时内才是 fresh。更旧是 stale。只有成功读取是 `live_query`。其余是 unknown。只有 fresh 计入健康。
- 演示：目录 `integrationTier === "demo"` 单独计数，并在行上标「演示」。演示探测、演示读取和演示物化都不增加生产验证或入库次数。

总览五态里的 `sync_delayed` 只看过期的 `lastMaterializedAt`。没有入库时间不再因为 `updatedAt` 变旧而显示同步延迟。该徽章只表示连接侧，不代替能力验证和新鲜度。

## 3. 网站接入向导

网站连接器没有动作包，保存网站数据源时不再要求已注册动作。执行仍走 E1：没有桥、没有验证或绑定不属于当前用户时失败关闭。

向导只做两件事：

1. 列出当前调用者自己的 `AccountBinding`。有则可选择。
2. 没有可选项时结果是 `owner_must_authorize`，由账户所有者登记自己的 `bindingId`。

登记写入 `EnterpriseDataStore.accountBindings`，只保留 `bindingId`、`tenantId`、`userId`。`userId` 来自 `resolveBillingScope`，不接受客户端传入。同一 `bindingId` 已属于别人时返回 `SAR_BINDING_PRIVATE`，不回显对方用户。没有身份时返回 `OWNER_IDENTITY_REQUIRED`。

未改绑定的既有网站源可以继续保存，不要求当场重新授权。执行时 E1 仍按桥上的 `userId` 失败关闭。

网站探测模式仍是 `website_session_not_verified`。保存网站源时不用这次探测把新源标成已连接，也不把已经连接的源改成断开。列表上的「测试连接」在数据源属于本租户且连接器一致时只写 `lastCheckedAt`。

## 4. 双向链接

资产页只有桥上存在 `skillId` 时才链接到能力中心 `/capabilities/{skillId}`。SAR `capabilityId` 只展示，不拿去当技能路由。

能力详情调用 `enterprise-data.assets.owned-link`。服务端只返回本租户、且 `skillId`、桥 `capabilityId` 或 `DataCapability.capabilityId` 与路由标识相同的数据源。跨租户标识不出现在结果里。反向链接回到数据治理资产页 `?edc=sources&sourceId=`。

## 5. 明确不做

不实现 E3 能力中心安装、E4 投影血缘、E5 浏览器端到端。不把写操作送进投影。不把 mock 或 `mock_smoke_ok` 记成生产验证。不因管理员身份共享私人账户。不导出 Cookie。
