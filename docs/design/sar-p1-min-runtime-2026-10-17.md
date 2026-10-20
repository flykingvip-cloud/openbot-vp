# SAR P1 最小运行时

- 状态：实现说明。不是真实站点生产能力，也不自动发布能力。
- 日期：2026-10-17
- 路径：Path C。复用 P0 账户浏览器、SessionHandle 和有限操作。不建 Bridge daemon，不导出 Cookie，不分叉 OpenCLI。

## 工具

`site_list`、`site_describe`、`site_invoke` 挂在现有 agent 工具列表上，和 `resolvePluginTools` 走同一条工具面。工具名出现在 coding / messaging profile 里，只表示模型可以调用这个入口。

每次 `site_invoke` 另做资格判断：服务端主体、固定版本、制品摘要、验证状态、账户绑定。模型参数里的租户、用户或 scope 不改变主体。未授权的 list / describe 不返回别人的包 id、绑定 id、凭证、CDP、profile 或计划脚本。

`skill-capability-contract` 仍只做动词发现和生命周期词汇。站点契约留在 `src/site-capability/`。OI/grant、AccountBinding、站点能力仍然是三件不同的事。

## 结果

`SiteRunResult` 带 `succeeded` / `failed` / `unknown`、验证、完整性、`evidenceRef` 和 `repair: "none"`。

- 合法空集合是 `succeeded` + `complete`，不进入修复。
- 超过 `maxItems` 的读取是 `succeeded` + `partial`。
- `RESULT_UNKNOWN` 是 `unknown`，`retry` 为 `not_ordinary`，不当作普通失败重试。

## 可控站

`ControllableTestSite` 在 P0 搜索 / 详情 / 登录之外增加公开查询和登录后查询。登录仍只接受夹具口令，口令不进 describe。

## 账户浏览器串行

`createBrowserTool` 在没有显式 scope 时，用服务端租户和平台用户推导 `account:<tenant>:<user>:browser`。`plan_once` 会确保进程内协调器存在，并和 SAR 共用这把锁。模型参数不能改这把 key。`DEFAULT_BROWSER_EVALUATE_ENABLED` 保持产品默认；SAR 仍然拒绝脚本。
