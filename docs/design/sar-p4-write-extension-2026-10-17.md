# SAR P4 写操作独立扩展评审

- 状态：扩展评审实现。不是默认开启的生产写能力。
- 日期：2026-10-17
- 基线：`main` 上的 P3 `9aa713944018d088256a2d49df7125676006d5f3`
- 路径：Path C。复用账户浏览器串行桌面锁。不新建浏览器 daemon，不导出 Cookie，不分叉 OpenCLI。

## 这次证明什么

写路径单独证明四件事。通过这些测试不等于可以对外站写，也不等于写能力已经进默认目录。

| 命题        | 行为                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| 授权        | `create` / `update` 与 `read` 分开。未授权、错误版本、错误绑定、跨账户、只读 effect，都在派发前拒绝 |
| 幂等 / 回查 | 成功之后按 runId 和制品摘要回查。相同幂等键不再执行 `apply_draft`                                   |
| 并发        | 账户浏览器级串行。并行写要么 `SERIAL_CONFLICT`，要么排队后仍一次一个执行                            |
| 结果未知    | `RESULT_UNKNOWN` 和 `TIMEOUT` 的状态是 `unknown`。确认前不当作普通失败重放                          |

`SiteRunResult.repair` 在自动路径上保持 `none`。

## 和既有契约的边界

P0 的 `parseSiteCapabilityManifest` 仍然只接受 `read`。写 manifest 走 `parseWriteCapabilityManifest`。`publish`、`delete`、付款都不接受。`compileSarOperation` 仍然拒绝 `apply_draft`，读操作集合没有变大。

写能力登记在 `WriteExtensionRuntime`。这个运行时不会装进 `getDefaultSiteCapabilityRuntime`。默认 `site_list` 仍是空的。

OI/grant 仍只是授权来源。它不是 AccountBinding，也不是站点写能力。调用参数里的 `oiGrant` 会被拒绝。只注册了绑定、没有对应 effect 的 grant，不能写。

evaluate 双层策略不变。产品默认 `DEFAULT_BROWSER_EVALUATE_ENABLED` 保持开启。写调用里的脚本字段仍在派发前被拒绝。

## 可控夹具

只有一个夹具站点：`https://fixture.sar-write.test`。

| 能力                            | 固定版本     | effect   | 做什么                   |
| ------------------------------- | ------------ | -------- | ------------------------ |
| `fixture.sar.draft-note.create` | `2026.10.17` | `create` | 创建草稿笔记             |
| `fixture.sar.draft-note.update` | `2026.10.17` | `update` | 更新同一夹具上的草稿笔记 |

两条能力分开授权。创建授权不能调用更新。夹具不登录、不保存口令、不访问外站。小红书等外站 origin 在登记时拒绝。

`apply_draft` 只存在于这个夹具运行时。回查读收据，不增加派发计数。

## 回查

`WriteRecheckStore` 按幂等键记下 runId、制品摘要、载荷摘要和状态。

- 已确认：回查收据摘要。一致则返回原 runId，`replayed: false`，不再派发。载荷不同则 `IDEMPOTENCY_CONFLICT`，不重放。
- 制品摘要不一致：`digest_mismatch`，不重放。
- 未知且收据不存在：保持 `unknown`，不重放。
- 未知但收据存在（响应丢失、副作用已落地）：确认收据，不第二次派发。原来的 unknown 记录留在账本里。

`priorWriteMayBeReplayed` 对 unknown 和 `retry: not_ordinary` 返回 false。运行时在派发前检查它。

## 并发

默认是 `reject`。同一账户浏览器锁被占用时，后到的写返回 `SERIAL_CONFLICT`，不进入 `apply_draft`。

`queue` 是显式选项。后到的写等待前一个释放锁，然后执行自己的一次派发。等待期间不重叠。两种模式都复用 `SarExecutionAuthority` 的账户浏览器 claim，不另开并行桌面。

## 自动修复

`proposeWriteRepair` 是写路径的修复钩子。它复用学习环的失败分类。只读学习环的 `repair` 和 `explore` 不改：unknown 仍只给建议，写 manifest 不能被学成可调用草稿。

- unknown 只给建议，不产生候选。
- 结构变化或验证失败最多复制一个 `private` 候选。`enabled: false`，`published: false`。
- 候选不进入写运行时的 grant，调用它返回未授权。
- `autoPublished`、`writeEnabled`、`fixtureRelaxed`、`grantsExpanded` 都是 false。
- 读学习环的 `explore` 仍拒绝写 manifest，不会把写能力学成可调用草稿。

显式 `published: true` 的登记被拒绝。`private` 记录即使传入 `enabled: true` 也不会变成可授权。

## 明确不做

- 不把写能力登记进进程默认目录。
- 不自动发布，不自动启用写能力。
- 不放宽夹具故障注入。
- 不接小红书或其他外站写。
- 不把生成式 JS 放进写路径。
