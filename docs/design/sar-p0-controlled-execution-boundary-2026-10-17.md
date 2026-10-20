# SAR P0 受控执行边界

- 状态：P0 实现说明（不是生产能力声明，不合入即上线）
- 日期：2026-10-17
- 路径：Path C。复用账户浏览器。不建 Bridge daemon，不导出 Cookie，不分叉 OpenCLI。

## 结论

站点适配器只拿到不透明的 `SessionHandle`。服务端把租户、用户和账户绑定解析到现有账户浏览器 scope。真正执行的代码在受信运行时里，操作集合是有限且声明式的。全局 `DEFAULT_BROWSER_EVALUATE_ENABLED` 可以保持 `true`；SAR 仍然拒绝集合外的页面求值。

## 依赖与复用

| 现有表面           | 路径                                                          | SAR 怎么用                                                                                                                              |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 账户浏览器命名空间 | `src/browser/account-browser-namespace.ts`                    | `resolveAccountBrowserScopeKeyFromSandboxKey` 推导 `account:<tenant>:<user>:browser`。不分配裸 CDP，不接受 profile / user-data-dir 覆盖 |
| 导航守卫           | `src/browser/navigation-guard.ts`                             | `assertBrowserNavigationAllowed`。适配器不能关守卫，也不能自带 SSRF 策略                                                                |
| 浏览器 evaluate    | `src/browser/constants.ts`、`src/browser/routes/agent.act.ts` | 产品默认保持不动。SAR 不调用 `act:evaluate`，也不把脚本转给 Playwright                                                                  |
| 交互所有权语义     | `ui/src/ui/account-computer/interaction-ownership.ts`         | 复用阶段含义：人工接管抢占代理。服务端另有 epoch + generation，不把 UI `leaseGeneration` 当跨重启 fencing token                         |
| plan-once 门控     | `src/account-computer/browser-plan-once-wire.ts`              | 计划开始和每一次 `act` 都向账户浏览器桌面锁申请。未声明的并行派发被拒绝                                                                 |
| 技能动词发现       | `src/gateway/skill-capability-contract.ts`                    | 只继续做发现和生命周期提示。不改名、不塞站点操作                                                                                        |
| 插件工具装载       | `src/plugins/tools.ts`                                        | 不新增 evaluate 透传工具                                                                                                                |
| 账户浏览器桥       | `src/agents/sandbox/account-worker-browser-bridge.ts`         | 不新开控制链。SAR 不读取其中的 CDP 地址                                                                                                 |

新建契约：`src/site-capability/contract.ts`（`SITE_EXECUTION_CONTRACT_ID = openbot.site-execution-contract`）。

明确不是同一件事：OI/grant 是授权来源；AccountBinding 是账户浏览器归属；站点操作能力是 manifest 上的有限权限。

## SessionHandle

服务端输入是 principal（租户 + 用户）、已登记的 `bindingId`、服务端签发的页面 target。返回值里给适配器的句柄只有 `token`。

拒绝：`cdpUrl`、websocket 调试地址、`user-data-dir`、`profile`、`host`、Cookie，以及看起来像 URL 或主机名的 page target。

## 有限操作

服务端实现且仅接受：

- `navigate`
- `read_page`
- `request_context`
- `capture_result`

受信端口只有 `navigate` / `readFields` / `requestContext` / `capture`。编译结果是带标签的数据结构，不是函数字符串。`fn`、`script`、`expression`、`evaluate` 以及名为 `evaluate` 的操作在进入端口之前被拒绝。

## 执行所有权

`SarExecutionAuthority` 把 epoch 和 generation 写入 `EpochStore`。进程重新 boot 时沿用同一个 epoch，generation 加一，内存中的旧 run 作废。调用方携带的 `uiLeaseGeneration`、`presentedEpoch`、`presentedGeneration` 不能授权。

每次 `dispatch` 在动作派发边界检查：人工接管、epoch/generation、取消、桌面锁。接管或租约撤销会抬高 generation。旧 run 不能再派发新动作。已经派发出去的动作保持可观察（`dispatched_not_stopped`，结束后是 `finished_after_cancel_request` 或 `finished_after_invalidation`）。`completeCancel` 恒为 `false`。

同一 `account:<tenant>:<user>:browser` 上，通用 browser、SAR、人工接管共用一把锁。后到的未声明派发返回 `SERIAL_CONFLICT` 或 `HUMAN_TAKEOVER`。

## 可控测试站

`ControllableTestSite` 提供搜索、详情、登录真值，可重置，可注入 `STRUCTURE_CHANGED` / `AUTH_REQUIRED` / `UPSTREAM_TIMEOUT`。登录只接受 `fixture-user` / `fixture-pass`。登录本身是夹具状态，不是 SAR 写操作。

## 非目标

P0 不实现 `site_list` / `site_describe` / `site_invoke` 产品工具（常量标记为 `not_implemented_p0`）。不开放生成式 JS。不把目录 fencing 挪来当页面 fencing。
