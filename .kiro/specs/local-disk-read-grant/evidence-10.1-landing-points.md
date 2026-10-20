# 第 10.1 节提交物：逐闸门落点

设计：`docs/design/openbot-local-disk-read-grant-2026-09-29.md` v0.2.1 r2 第 10.1 节。
该节要求逐条给出文件与函数，明确不接受「已实现」这类散文描述。

行号以提交 `4c44c555e` 为准，函数名是稳定锚点。每一处都经实际读码核对，不是按记忆填写。

---

## 1. 能力档案精确五项

| 项                       | 落点                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 档案命令集合定义         | `NODE_LOCAL_FILES_READONLY_COMMANDS`（`src/infra/node-commands.ts`），转出为 `LOCAL_FILES_READONLY_COMMANDS`（`src/local-files/capability-profile.ts`）                                                   |
| 扩展点                   | `resolveNodeCommandAllowlist`（`src/gateway/node-command-policy.ts:177`），档案分支在 `:189`                                                                                                              |
| 不触及 macOS 默认        | 该分支 `return` 的是 `new Set(NODE_LOCAL_FILES_READONLY_COMMANDS)`，**不 union** `PLATFORM_DEFAULTS`，函数在 `:197` 直接返回；`:200` 起读 `PLATFORM_DEFAULTS`、`:202` 读 `allowCommands` 的路径根本不执行 |
| `allowCommands` 无法放宽 | 同一分支只对 `deny` 做 `delete`，从不读 `cfg.gateway?.nodes?.allowCommands`                                                                                                                               |
| 档案来源                 | `capabilityProfileFromCaps`（`src/local-files/capability-profile.ts`），在 `message-handler.ts` 连接过滤处与 `NodeRegistry.register`（`src/gateway/node-registry.ts`）各调用一次                          |

证明「不触及默认」的断言：`src/gateway/node-command-policy.local-files.test.ts`
「does not grant macOS SYSTEM_COMMANDS to a profiled node」「cannot be widened by
gateway.nodes.allowCommands」「leaves an unprofiled macOS node's defaults untouched」。

## 2. 节点侧命令拒绝

| 项               | 落点                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拒绝分支         | `guardCommand`（`src/node-host/local-files/guard.ts:89`），内部调 `gateProfileCommand`（`src/local-files/capability-profile.ts:51`），后者按 `system.` 前缀拒绝而非枚举 |
| 调用点           | `handleInvoke`（`src/node-host/invoke.ts:437`）                                                                                                                         |
| 位置为何是这里   | `:430` 的注释说明：`system.run` 在更下方**没有自己的 if 分支**，它走的是兜底路径（`:548`），所以守卫必须置于兜底之前，这是唯一能覆盖它的位置                            |
| 档案来自启动配置 | `src/node-host/runner.ts:177` 读 `config.capabilityProfile`，据此决定 `caps`（`:205`）与 `commands`（`:208`），并在 `:257` 关掉非档案能力                               |

## 3. 连接身份五项相等

设计要求「连接进入 `active` 前五项精确相等」。**实现分布在三个时刻**，因为五项事实并非同时可得——绑定是独立授权仪式，节点可以在尚未绑定时就连上来。逐项如下：

| 设计要求的项                           | 实际执行点                                                                                                                                                                                                                                                          | 时刻                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 节点声明的命令集合 == 网关期望集合     | `checkProfileCommandSet`（`src/local-files/capability-profile.ts:78`），调用点 `src/gateway/server/ws-connection/message-handler.ts` 的 `role === "node"` 分支，**在命令过滤之前**、用节点声明的原始集合，不等则 `close(1008, ...)`。顺序很关键，见下方「握手顺序」 | 连接握手             |
| Node Host 启动配置中的档案             | 节点侧自证：`runner.ts:177` 决定声明内容，`guardCommand` 在每次调用时再拒绝档案外命令                                                                                                                                                                               | 节点进程内，每次调用 |
| `LocalDeviceBinding.capabilityProfile` | `verifyRedemption`（`src/local-files/redemption.ts:139`）经 `LocalDeviceBindingStore` 查绑定；`LocalFilesService.requestAccess`（`src/gateway/local-files/service.ts:256`）在读取前查同一绑定                                                                       | 每次读取             |
| 设备公钥与绑定一致                     | `verifyRedemption`（同上）比对 `connection.devicePublicKey` 与绑定上的公钥；未认证连接直接拒                                                                                                                                                                        | 每次兑换             |
| 绑定建立时的一致性                     | `createLocalDeviceBinding`（`src/gateway/local-files/binding-admin.ts`）要求节点在线、声明 `LOCAL_FILES_CAP`、命令集精确相等、连接已证明持有私钥                                                                                                                    | 绑定仪式             |

**`verifyConnectionIdentity` 已接线**（提交 `b9bcede8b`）。它原先没有生产调用点，只是对规则的一份声明，比不写更糟——读码的人会以为检查发生在那里。

现在的单一执行点是 `verifyRedemption`（`src/local-files/redemption.ts`），每次兑换都跑。之所以现在可行：`4c44c555e` 的握手修复让 `NodeSession` 开始携带 `capabilityProfile`，加上一直都有的 `commands`，网关这才同时拿到五项事实。

| 五项                     | 在 `verifyRedemption` 里的来源                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| 绑定档案                 | `bindingCheck.binding.capabilityProfile`                                                   |
| 绑定设备公钥             | `bindingCheck.binding.devicePublicKey`                                                     |
| 节点配置档案             | `connection.capabilityProfile`，取自 live registry session（`undefined` 即拒绝，不是放行） |
| 连接设备公钥             | `connection.devicePublicKey`，握手时已验签                                                 |
| 声明命令集 vs 网关期望集 | `connection.declaredCommands` 与档案常量，经 `checkProfileCommandSet`                      |

`RedeemingConnection` 上这两个新字段是**必填**而非可选，所以调用方无法省略而静默跳过；两者都从 session 读，不从请求体读，节点无法把自己描述得比注册时更好。

设计要求「连接进入 `active` 前」，这里放在兑换处，比设计更晚但更强：重连后命令集漂移的节点会在下一次读取被抓，而不是到进程重启前一直被信任。握手处仍然独立查一次命令集（下表第一行），所以两处都在。

## 4. resolve-ticket

| 项                     | 落点                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 网关签发点             | `issueResolveTicket`（`src/local-files/issue.ts:35`），调用点 `LocalFilesService.resolve`（`src/gateway/local-files/service.ts:178`）                                                                                                                  |
| 节点分支               | `handleFsStatResolve`（`src/node-host/local-files/handlers.ts:150`），经 `invokeParams.capabilityType === "resolve-ticket"` 分派（`src/node-host/local-files/dispatch.ts`）                                                                            |
| 不新增 `fs.resolve`    | 档案是精确五项（上文闸门 1）；`capability-profile.test.ts`「does not grow a general path-probing command」断言这一点                                                                                                                                   |
| 不列目录               | `resolveTargetPath`（`src/node-host/local-files/safe-open.ts:104`）只对单个路径做 `realpath`/`lstat`，代码中无 `readdir`                                                                                                                               |
| 不回正文、不算内容哈希 | `handleFsStatResolve` 的返回类型（`handlers.ts:144-147`）只有 `canonicalPath`、`fileId`、`targetKind`、`sizeBytes`、`mtimeMs`；`handlers.test.ts`「expands ~ on the node and returns path identity only」断言 `text`/`sha256`/`entries` 三个键都不存在 |
| 不接受 glob            | 票据上只有一个 `rawPath` 字符串字段，没有模式参数；`resolveTargetPath` 不做展开                                                                                                                                                                        |
| 结果不进模型           | resolve 结果只在网关进程内流转（`service.ts:178` 的返回值是 private `ResolvedTarget`），对模型统一返回 `LOCAL_FILES_OPAQUE_DENIAL`；`service.test.ts`「never returns the canonical path, size, inode or type to the caller」                           |

## 5. 兑换事务

| 项                 | 落点                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 四步实现           | `redeemInvocationCapability`（`src/local-files/redemption.ts:235`），四步各有标注注释：验证 `:242`、扣减预算 `:249`、消费 nonce `:269`、一次性成功 `:283`                                      |
| 第一步的全部校验   | `verifyRedemption`（`:139`），文档注释明确「Step 1 only」                                                                                                                                      |
| 兑换键             | `buildRedemptionKey`（`src/local-files/nonce-ledger.ts`），由 `capabilityDigest + nonce + nodeId` 组成                                                                                         |
| 验证先于写入的证明 | `verifyRedemption` 是纯函数，不接触 `NonceLedger` 也不调 `reserve()`；`redemption.test.ts`「verifies before writing anything」在验证后检查 `remaining()` 未变                                  |
| 任一步失败整笔回滚 | 预算失败时直接 `return`，nonce 未消费（`redemption.test.ts`「does not mark the nonce consumed when verification fails」「refuses redemption once maxEntriesRead is spent, nonce unconsumed」） |
| 原子性             | 函数体内无 `await`，Node 单线程下两个并发兑换无法交错；`server-methods/local-files.test.ts`「the handler is synchronous / returns no promise」把这一性质钉在 RPC 层                            |
| 解析票据同路       | `redeemResolveTicket`（`:313`），`redeemCapability`（`:376`）按 kind 分派                                                                                                                      |

## 6. 签名与 keyset

| 项                                    | 落点                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ed25519 验签                          | `verifyCapability`（`src/local-files/capability.ts:277`），签发 `signCapability`（`:47`），摘要 `capabilityDigest`（`:43`）                                                                                                                                           |
| 规范化字节                            | `canonicalJsonStringify`（`src/local-files/canonical-json.ts`）；签名覆盖 `claimsJSON` 的确切字节                                                                                                                                                                     |
| `keyId` 验证集合来源                  | `NodeCapabilityKeyset`（`src/local-files/keyset.ts:129`）；节点侧持久化实现 `PersistentNodeCapabilityKeyset`（`src/node-host/local-files/keyset-store.ts`）                                                                                                           |
| 信任根固定点                          | `NodeCapabilityKeyset.pinTrustRoot`（`keyset.ts:134`）；重复固定不同根被拒（`redemption.test.ts`「refuses to re-pin a different trust root」）                                                                                                                        |
| 更新只走旧信任根或已认证连接          | `applyLocalFilesKeysetEvent`（`keyset-store.ts`）要求 `signed.trustRootKeyId` 等于已固定根（`keyset.ts:158`）；未认证通道被拒（`redemption.test.ts`「refuses a keyset pushed over an unauthenticated channel」）                                                      |
| 复用 device-identity 格式但不复用密钥 | `src/local-files/capability.ts:11` 只 import `signDevicePayload` / `verifyDeviceSignature` 两个函数；签名密钥由 `generateCapabilitySigningKey`（`keyset.ts:246`）独立生成，与 `src/infra/device-identity.ts` 的设备密钥无共享来源。`keyset.ts:6` 的注释记录了这一区分 |

## 7. 入口证据生成

| 项                   | 落点                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生成点               | `DirectedResourceRegistry.record`（`src/local-files/directed-resource.ts:165`）                                                                                                    |
| 只读 `authored_text` | `:181` 的 `.filter((span) => span.sourceKind === "authored_text")`——非 `authored_text` 的区段**根本不入库**，不是入库后再判断                                                      |
| 判定点               | `evaluateDirectedGrant`（`:100`），`:116` 再次核对 `sourceKind`                                                                                                                    |
| 不重扫模型上下文     | 该模块只读入站区段参数，不引用任何会话或上下文存储；`evaluateDirectedGrant` 按用户原始书写文本比对，不按规范化路径                                                                 |
| 按轮 write-once      | `record` 对同一轮的第二次记录直接忽略（`directed-resource.test.ts`「ignores a second recording for the same turn」「freezes the stored span so a later stage cannot rewrite it」） |

**据实说明**：当前**没有任何渠道**产出 `authored_text` 区段，因此定向许可恒为空，主动读取全部走一次性审批卡片。这是设计第 4.5 节规定的 fail closed 方向，不是缺陷，但意味着闸门 7 的生产路径尚未被真实渠道驱动过。

## 8. 模型侧入口

| 项                 | 落点                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 工具定义           | `createLocalFileTools`（`src/agents/tools/local-file-tool.ts:141`），五个工具 `local_file.stat/list/read` 与 `local_archive.list/read_entry`                                         |
| 注册点             | `createLocalFileToolsIfAvailable`（`src/agents/tools/local-file-tool-registration.ts`），调用点 `src/agents/pi-tools.ts:634`；运行时或可信身份缺失时返回空数组，不注册必然失败的工具 |
| 无可伪造授权参数   | 工具入参只有路径与归档条目路径（`local-file-tool.test.ts`「accepts no authorization argument a model could forge」）                                                                 |
| 通用 invoke 拒绝点 | `assertNotLocalFilesCommand`（`local-file-tool.ts:41`），调用点 `src/agents/tools/nodes-tool.ts:758`；分类函数 `isLocalFilesCommand`（`:31`）按前缀而非枚举匹配                      |

**据实说明**：设计第 10.1 节点名了 `src/agents/pi-tools.before-tool-call.ts` 作为拒绝点之一。实际拒绝落在 `nodes-tool.ts:758`，即通用 invoke 工具自身的执行路径内，而非 before-tool-call 钩子。效果相同（模型经通用路径调 `fs.*` / `archive.*` 抛错），位置与设计设想不同，此处如实标注。

## 9. 安全打开

四处分别给出。核心复用 `openFileWithinRoot`（`src/infra/fs-safe.ts:177`），本特性叠加 resolve 阶段身份核对。

| 设计要求                 | 落点                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `lstat` 逐级核对         | `fs-safe.ts:90` 打开前 `lstat`；`:119` 打开后同时取 `handle.stat()` 与 `fs.lstat()`；`:120` 拒绝符号链接；`:133` `realpath` 后再 `lstat` 一次（`:135`）。本特性侧 `safe-open.ts:162`（resolve 阶段）与 `:334`（列目录）另有 `lstat` |
| 不跟随符号链接的打开标志 | `fs-safe.ts:52` `OPEN_READ_FLAGS = O_RDONLY                                                                                                                                                                                         | O_NOFOLLOW`（`:51` 按平台判定可用性） |
| 打开后 `fstat` 核对      | `fs-safe.ts:119` 的 `handle.stat()` 与 `:129` 的 `sameFileIdentity(stat, lstat)`；本特性在 `safe-open.ts:278` 再用 `sameFileIdentity` 把打开结果与 resolve 记录的 `fileId` 比对，不一致即 `identity-mismatch`                       |
| 从文件描述符读取         | `readFromOpenFile`（`safe-open.ts:395`），`:403` 的 `params.file.handle.read(...)` 走已打开描述符，不按路径二次打开；归档嗅探同样走描述符（`:90`）                                                                                  |
| 硬链接拒绝               | `fs-safe.ts:126` 与 `:135` 的 `stat.nlink > 1`（`rejectHardlinks`）；本特性默认开启                                                                                                                                                 |

## 10. 三层硬拒绝

| 项                       | 落点                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 节点侧执行点（最后一道） | `evaluateTarget`（`src/local-files/path-policy.ts:448`）：先 `evaluateCanonicalPath`（`:454`）再 `evaluateStatFacts`（`:458`）。三层本体分别是 `evaluateCanonicalPath`（`:206`，层 1 绝对拒绝 + 层 3 用户内容白名单）、`evaluateSensitiveName`（`:290`，层 2）、`evaluateStatFacts`（`:398`，特殊文件与硬链接）                      |
| 归档条目同规则           | `evaluateArchiveEntryPath`（`:421`）+ `evaluateSensitiveName`，所以桌面上的 ZIP 不能放行其中的 `.env` 或私钥                                                                                                                                                                                                                         |
| 网关提前拒绝             | `prefilterRawPath`（`:327`），调用点 `LocalFilesService.resolve`（`src/gateway/local-files/service.ts:185`），在签发 resolve 票据之前                                                                                                                                                                                                |
| 提前拒绝为何只是省往返   | 该函数**只能返回拒绝或 `undefined`**，没有 allow 结论：网关无法规范化外部文件系统的路径（`~` 属于节点的绑定用户，符号链接与真实路径只存在于那里）。`undefined` 表示交给节点。`path-policy.test.ts`「stays undecided rather than admitting anything」「never disagrees with the node by allowing what the node denies」把这个方向钉住 |

## 11. 返回限额

| 设计要求             | 落点                                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表 200 项          | `LOCAL_FILES_LIMITS.maxListEntries = 200`（`src/local-files/types.ts:215`），执行点 `listDirectoryDirectChildren`（`src/node-host/local-files/safe-open.ts:355`），不递归                                                                                                                                                        |
| 单次 1–2 MiB         | `maxSingleReadBytes = 2 MiB`（`types.ts:217`），执行点 `handleFsRead`（`src/node-host/local-files/handlers.ts:352`）；截断在结果里标明 `truncated`                                                                                                                                                                               |
| 单轮累计 5–10 MiB    | 两层。单张授权 `budget.maxTotalExpandedBytes`（`turn-authorization.ts:126`/`:164`/`:201`）；跨授权 `maxTurnTotalBytes = 10 MiB`（`types.ts:219`），账本键 `turnLedgerKey`，执行点 `turnBytesExhausted`（`turn-authorization.ts:219`），在 `reserve()`（`:164`）与 `reserveIssuance()`（`:205`）两处检查，在 `recordBytes()` 记账 |
| 连续分片不能绕过累计 | 上限对照的是**已返回字节**，达到即拒绝新调用，因此分片无法逐次贴边越过。`redemption.test.ts`「chunking cannot walk past the turn cap」                                                                                                                                                                                           |

---

## 与设计描述不一致之处（汇总）

审核时应逐条处理，不要当成已闭合：

1. ~~**闸门 3**：`verifyConnectionIdentity` 无生产调用点。~~ **已接线**（`b9bcede8b`），执行点是 `verifyRedemption`，每次兑换都跑，见闸门 3 一节。仍与设计描述有一处偏差：设计说「连接进入 `active` 前」，实际在兑换处，理由与取舍已在该节写明。
2. **闸门 7**：无渠道产出 `authored_text` 区段，定向许可恒为空，该路径未被真实渠道驱动。
3. **闸门 8**：通用 invoke 的拒绝点在 `nodes-tool.ts`，不在设计点名的 `pi-tools.before-tool-call.ts`。

## 握手顺序（第 10.1 节未列，但两个方向都出过缺陷）

握手里有两步，顺序决定成败，而两步各自都是对的——所以只有把它们当成一个序列去测才看得见问题。

1. **`4c44c555e`：正确的节点被拒。** `NodeSession` 没有 `capabilityProfile`，网关里没有任何地方填充 `resolveNodeCommandAllowlist` 档案分支的输入。过滤器因此用 macOS 默认集，把五条命令全部剥掉，随后档案检查读到空集，以「命令集不符」关闭连接。配置正确的只读节点根本连不上。
2. **`d1a7e2981`：过度声明的节点被悄悄收窄。** 档案检查读的是过滤**之后**的 `connectParams.commands`。于是一个同时声明 `system.run` 的节点，多的那条先被剥掉，检查看到正好五条便放行。结果是安全的（`system.run` 已经没了），但设计第 9.5 节要的是**拒绝**：声明集不等于档案意味着它跑的不是被绑定的那份配置，悄悄纠正会把这件事藏起来。检查已移到过滤之前、用声明原始集，后面那处重复检查已删除。

两者都由 `test/gateway.local-files-handshake.e2e.test.ts` 覆盖（真网关进程 + 真 websocket，`pnpm test:e2e`）。单测侧 `src/gateway/node-command-policy.local-files.test.ts` 的 `handshake()` 辅助复现同样的顺序，并显式断言那个陷阱：声明集被拒，而过滤后的集合看起来是正确的。

`activation.test.ts` 两次都看不见，因为它在进程内桥接 websocket 跳，压根不跑握手。这正是为什么双进程覆盖不是可选项。
