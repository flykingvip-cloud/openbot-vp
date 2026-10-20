# Tasks: Local Disk Read Grant (non-production prototype)

## Agents

- kiro-diskgrant · role: owner · scope: 按 `docs/design/openbot-local-disk-read-grant-2026-09-29.md` v0.2.1 r2 第 8 节第 1–7 步实现非生产原型：能力协议核心、节点只读命令、Gateway 绑定与在线兑换、入口层定向记录、高层工具、审批与审计、攻击测试 · paths: `.kiro/specs/local-disk-read-grant/**`, `src/local-files/**`, `src/node-host/local-files/**`, `src/gateway/local-files/**`, `src/agents/tools/local-file-tool.ts`, `src/agents/tools/local-file-tool.test.ts`, `src/gateway/node-command-policy.local-files.test.ts` · since: 2026-09-30

## 范围

批准范围仅为第 8 节第 1–7 步的**非生产**实现。第 8–10 步（生产专用节点接入、白名单灰度、会话目录授权）未批准，本任务不触碰。

## 已完成

- [x] 能力协议核心：canonical JSON 确定性序列化、Ed25519 签名、`capabilityDigest`、三类令牌（resolve-ticket / Turn authorization / Invocation capability）共用一套签名体系且 nonce 空间分离 — kiro-diskgrant
- [x] Keyset：首次配对固定信任根；更新须由旧信任根签名或走已认证设备连接；未知 `keyId`、keyset 过期、无信任根一律 fail closed；撤销即从验证集合移除，已签发未过期令牌立即失效；拒绝回滚文档 — kiro-diskgrant
- [x] Turn authorization 与预算：`issued`（派生闸门）与 `calls`（兑换闸门）分开计数，字节预算在读取返回后累计并封顶 — kiro-diskgrant
- [x] 兑换事务：`capabilityDigest + nonce + nodeId` 为兑换键；四步固定顺序（验证 → 扣减预算 → 消费 nonce → 一次性成功）；验证先于任何写入；任一步失败整笔回滚且**不**把 nonce 记为已消费 — kiro-diskgrant
- [x] 三层路径拒绝：凭据目录与系统路径硬拒绝、敏感文件名与类型（同时适用于归档条目）、普通用户内容为白名单而非默认可读；`nlink > 1` 默认拒绝；外接盘与网络挂载拒绝；`/System/Volumes/Data` firmlink 归一化、APFS 大小写与 NFC/NFD 折叠 — kiro-diskgrant
- [x] 能力档案：`system.*` 按前缀拒绝（不靠枚举）；声明命令集必须与档案精确相等（多一条或少一条都拒绝）；连接身份五项相等校验 — kiro-diskgrant
- [x] 节点安全打开：复用 `src/infra/fs-safe.ts` 的 `O_NOFOLLOW` + lstat/fstat/realpath 身份三角与硬链接拒绝，叠加 resolve 阶段 inode 与最终打开的一致性校验；从已打开描述符读取；目录只取直接子项 — kiro-diskgrant
- [x] 归档不落地：ZIP 在内存中处理，Zip Slip、绝对路径与反斜杠条目名、压缩炸弹（按声明膨胀比 + 流式字节上限双重）、嵌套归档全部拒绝 — kiro-diskgrant
- [x] 双端命令拒绝：Gateway 侧档案节点只得五条命令，不叠加 macOS `SYSTEM_COMMANDS`，且 `gateway.nodes.allowCommands` 无法放宽；节点侧 guard 置于 `handleInvoke` 的 `system.run` fallthrough **之前**（这是唯一能覆盖 `system.run` 的位置） — kiro-diskgrant
- [x] Gateway 编排：resolve → 定向授权或一次性审批 → Turn authorization → 每次调用派生 Invocation capability；审批卡片用节点返回的规范化路径，卡片文案与实际批准的有界任务一致 — kiro-diskgrant
- [x] resolve 结果不进模型：用户批准前只进授权卡片；反复探测返回逐字节相同的「该位置不可授权」，不泄露存在性、大小、inode 或类型 — kiro-diskgrant
- [x] 入口层定向记录：只接受 `authored_text` 区段，按轮次 write-once，span 冻结，按用户原始书写文本匹配（不按规范化路径） — kiro-diskgrant
- [x] 独立审批类型与审计：审批端口与 shell exec 审批策略解耦；拒绝与超时都是拒绝，无默认允许；审计含决策/字节/哈希，不含正文、凭据、完整令牌，路径只存哈希与脱敏展示 — kiro-diskgrant
- [x] 高层工具：`local_file.stat/list/read` 与 `local_archive.list/read_entry`；工具参数只有路径（与条目路径），没有任何模型可伪造的授权字段；通用 `nodes` invoke 对 `fs.*` / `archive.*` 抛错 — kiro-diskgrant

## 验收覆盖

第 6 节 1–14 与第 9.6 节 1–17 的覆盖情况（测试文件 → 用例）：

| 用例                                                       | 位置                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 桌面 zip 复现、无二次确认、非阻塞状态、不落地解压      | `src/gateway/local-files/service.test.ts`、`src/node-host/local-files/handlers.test.ts`；句尾「网关工作区 exec 仍拒绝」见下方缺口 2               |
| 6.2 同轮主动读取需一次性批准，拒绝/超时为拒绝              | `src/gateway/local-files/service.test.ts`                                                                                                         |
| 6.3 无路径无附件时不搜索磁盘                               | `src/local-files/directed-resource.test.ts`                                                                                                       |
| 6.4 路径在代码块/引用/附件正文中不自动授权                 | `src/local-files/directed-resource.test.ts`                                                                                                       |
| 6.5 路径明确但意图不明确先询问                             | `src/local-files/directed-resource.test.ts`                                                                                                       |
| 6.6 凭据类路径硬拒绝                                       | `src/local-files/path-policy.test.ts`、`src/node-host/local-files/handlers.test.ts`                                                               |
| 6.7 符号链接与检查后替换 inode                             | `src/node-host/local-files/handlers.test.ts`                                                                                                      |
| 6.8 直接构造 `system.run` 失败                             | `src/local-files/capability-profile.test.ts`、`src/gateway/node-command-policy.local-files.test.ts`、`src/node-host/local-files/handlers.test.ts` |
| 6.9 通用 invoke 调 `fs.read` / `archive.readEntry` 失败    | `src/agents/tools/local-file-tool.test.ts`                                                                                                        |
| 6.10 伪造令牌、重放 nonce、并发双消费                      | `src/local-files/redemption.test.ts`                                                                                                              |
| 6.11 未绑定数字人、错误租户、已撤销绑定                    | `src/gateway/local-files/service.test.ts`                                                                                                         |
| 6.12 Zip Slip、高压缩比、嵌套                              | `src/node-host/local-files/handlers.test.ts`                                                                                                      |
| 6.13 单轮累计上限后的分片                                  | `src/local-files/redemption.test.ts`「the per-turn cumulative byte cap spans authorizations」5 条、`src/gateway/local-files/service.test.ts:383`  |
| 6.14 审计含决策/字节/哈希，不含正文与完整令牌              | `src/local-files/audit.test.ts`、`src/gateway/local-files/service.test.ts`                                                                        |
| 9.6.1 未收到 resolve 结果前不签发真实路径读取令牌          | `src/gateway/local-files/service.test.ts`                                                                                                         |
| 9.6.2 一张「检查这个 ZIP」授权完成多次调用、nonce 各不相同 | `src/gateway/local-files/service.test.ts`、`src/local-files/redemption.test.ts`                                                                   |
| 9.6.3 卡片文案与实际批准范围一致                           | `src/gateway/local-files/service.test.ts`                                                                                                         |
| 9.6.4 节点重启后重放未过期 capability                      | `src/local-files/redemption.test.ts`                                                                                                              |
| 9.6.5 已撤销 `keyId` 签名的令牌，且不发起兑换              | `src/local-files/redemption.test.ts`、`src/node-host/local-files/handlers.test.ts`                                                                |
| 9.6.6 声明命令多一条或少一条                               | `src/local-files/capability-profile.test.ts`                                                                                                      |
| 9.6.7 外接盘与网络挂载                                     | `src/local-files/path-policy.test.ts`                                                                                                             |
| 9.6.8 `/Users` 与 `/System/Volumes/Data/Users` 同一文件    | `src/local-files/path-policy.test.ts`                                                                                                             |
| 9.6.9 渠道无结构化区段时不生成定向许可                     | `src/local-files/directed-resource.test.ts`                                                                                                       |
| 9.6.10 反复 resolve 不得得知存在性                         | `src/gateway/local-files/service.test.ts`、`src/node-host/local-files/handlers.test.ts`                                                           |
| 9.6.11 只提交 nonce / 篡改 capability / 错误节点连接       | `src/local-files/redemption.test.ts`                                                                                                              |
| 9.6.12 两个节点并发兑换同一 capability                     | `src/local-files/redemption.test.ts`                                                                                                              |
| 9.6.13 Turn authorization 已撤销或预算耗尽                 | `src/local-files/redemption.test.ts`                                                                                                              |
| 9.6.14 敏感文件硬链接到 Desktop                            | `src/local-files/path-policy.test.ts`、`src/node-host/local-files/handlers.test.ts`                                                               |
| 9.6.15 keyset 无法刷新或未知 `keyId` fail closed           | `src/local-files/redemption.test.ts`                                                                                                              |
| 9.6.16 审批后读取前 inode 被替换                           | `src/node-host/local-files/handlers.test.ts`                                                                                                      |
| 9.6.17 兑换成功后打开失败不自动重签发                      | `src/gateway/local-files/service.test.ts`                                                                                                         |

### 对标设计后发现的覆盖缺口

上表按「哪个文件测了这条」填写，复查后有以下几处名不副实。记在此处，而不是改掉表格让它看起来完整。

1. ~~**`maxTurnTotalBytes` 声明了但从未被读取。**~~ **已修复（提交 `d59b33eab`）。** 原状况：`src/local-files/types.ts:197` 定义了设计第 4.10 节的单轮累计上限（10 MiB），全仓库没有第二处引用；实际生效的只有单张 Turn authorization 的 `maxTotalExpandedBytes`，而一轮之内每个已解析目标各有一张授权，所以跨授权的累计上限不存在。现在 `TurnAuthorizationStore` 带一个按 `tenant/user/agent/session/turn` 聚合的账本（`turnLedgerKey`），在 `reserve()` 与 `reserveIssuance()` 两处检查、在 `recordBytes()` 记账，`remaining()` 返回两个上限里先到的那个。**故意不按节点或设备聚合**：这条上限约束的是一轮上下文里进了多少磁盘内容，不是单台设备送了多少。闸门前后对照：把 `turnBytesExhausted` 临时改成 `return false`，`redemption.test.ts` 的五条里四条失败（第五条「does not charge one turn's bytes to another turn」断言的是账本隔离而非拒绝，所以仍通过）；恢复后 30 条全绿。
2. ~~**第 6 节第 1 条句尾未测。**~~ **已补**：`src/agents/tools/local-file-tool.test.ts` 的「the gateway workspace exec policy is unchanged (acceptance 6.1)」4 条，直接驱动 `assertSharedFsExecMutationAllowed`。另有两条局限写成了测试而非藏起来：`tools.fs.workspaceOnly` 默认 `false`，且该策略只抽「写」形式，输入重定向不拦，所以 exec 的读取不在其覆盖内。
3. ~~**四条用例在测试名里没有编号。**~~ **已编号**：6.10 分布在 redemption 的伪造、重放、并发三组；9.6.2 分布在有界 ZIP 的四条预算测试；9.6.1 与 9.6.7 各自补了真实测试而不只是改名——9.6.1 原先只有节点半边，补了网关半边（resolve 失败时无 Turn authorization、只有一次节点调用、不弹卡片）；9.6.7 发现无法只靠 resolve 证明（策略只能在规范化之后跑，未挂载的卷先落 not-found），因此另补一条用签名 capability 携带 `/Volumes` 路径的确定性节点侧证明。
4. ~~**第 10.1 节的落点表尚未提交。**~~ **已提交**：`evidence-10.1-landing-points.md`，11 个闸门逐条给出文件与函数，27 处 `file:line` 全部核对过。表末汇总了三处与设计描述不一致的地方（`verifyConnectionIdentity` 无生产调用点、无渠道产出 `authored_text`、通用 invoke 拒绝点不在设计点名的文件），留给审核处理而非当成已闭合。
5. ~~**第 10.2 节的「闸门关闭前失败、打开后通过」证据尚未提交。**~~ **已采**：单轮累计上限、网关 prefilter、工作区 exec 回归、握手命令过滤四处都做了「临时放宽 → 断言失败 → 复原 → 全绿」的对照，逐条记在对应提交信息里。
6. ~~**第 10.3 节七行里只有第一行做到了「把另一端放宽」。**~~ **七行已齐**：`activation.test.ts` 的 dual-side 组现覆盖 `system.*`、通用 invoke 调 `fs.*`、硬拒绝路径、令牌伪造、nonce 重放、路径越界与符号链接、ZIP 逃逸七行。放宽网关的手段是 `mintCapabilityFor`，直接把真签名的 capability 签进 runtime，绕过 resolve、策略与审批。
7. ~~**第 10.4 节的脱敏审计样本尚未提交。**~~ **已提交**：`audit-evidence.jsonl` 七条，由 `src/gateway/local-files/audit-evidence.test.ts` 真实运行产出（条件是安排出来的，不是 stub 出来的）。四条断言作闸门：七类齐全、4.12 字段齐全、无禁止字段与正文、无完整本机路径（拿本次运行的真实临时家目录比对）。

## 已接线（第二轮）

- [x] `localFiles.redeem` 网关 RPC 已注册，五处接线全部到位：schema（`src/gateway/protocol/schema/local-files.ts`）、`PROTOCOL_SCHEMAS` 映射、ajv 校验器、`coreGatewayHandlers`、`server-methods-list.ts`，以及 `method-scopes.ts` 的 `NODE_ROLE_METHODS`（该集合双向排他，因此 operator 无法兑换节点 capability） — kiro-diskgrant
- [x] **已认证设备公钥现在能到达 handler。** 这是本轮发现的真实缺口：`devicePublicKey` 原先只是握手过程中的局部变量，`GatewayWsClient` 上没有该字段，因此兑换无法绑定到活连接。已在 `ws-types.ts` 与 `server-methods/types.ts` 上新增字段，并在 `message-handler.ts` 组装 client 时填入已验签的值。回退到配对记录是不够的 —— 纯 token 认证的连接从未证明持有私钥，却能通过配对记录检查 — kiro-diskgrant
- [x] 兑换绑定到活连接：要求 role 为 node、registry 中存在会话且 `connId` 等于本 socket、且本连接有已验签的设备公钥；三者缺一即 `authenticated: false`，fail closed。nodeId 取自连接而非请求体（schema 里根本没有 `nodeId` 字段可伪造） — kiro-diskgrant
- [x] Keyset 下发通道已接线。节点连接且声明 `local-files` capability 时，网关通过已认证连接推送签名 keyset（`localFiles.keyset` 事件）；节点在 `onEvent` 中消费并持久化。首次配对采用 TOFU 固定信任根，此后更新必须匹配已固定的根，因此第二个网关无法接管已配对节点 — kiro-diskgrant
- [x] 连接身份命令集校验已接到握手路径：声明 `local-files` capability 的节点，其命令集必须与档案精确相等，否则连接以 1008 关闭，不进入 `active`（验收 9.6 用例 6 从单测变为真实拒绝） — kiro-diskgrant
- [x] 网关侧运行时组合点 `src/gateway/local-files/runtime.ts`，未配置时兑换一律拒绝 — kiro-diskgrant

## 已接线（第三轮：运行时激活）

- [x] 审批生命周期抽取为通用 `ApprovalLifecycle<TRequest>`（`src/gateway/approval-lifecycle.ts`），`ExecApprovalManager` 变为其薄子类，exec 审批行为不变。抽取而非重写的理由：resolved-entry 宽限窗口、防重复裁决、`consumeAllowOnce` 的原子性，这三处是重写最容易埋 bug 的地方 — kiro-diskgrant
- [x] 独立审批类型 `LocalFileApprovalService`（`src/gateway/local-files/approval.ts`）：复用生命周期但不复用 shell 策略。`allow-always` 在边界被拒绝而非降级，因此无法为某个路径取得常驻许可；超时、界面不可达、显式拒绝三者同为拒绝；卡片显示节点返回的规范化路径并写明实际批准的有界任务 — kiro-diskgrant
- [x] `localFiles.approval.requested` / `resolved` 事件与 `localFiles.approval.resolve` RPC（operator approvals scope，非 node scope）已注册 — kiro-diskgrant
- [x] `NodeInvokePort`（`src/gateway/local-files/node-port.ts`）直接走 `nodeRegistry.invoke`，**不**经 `node.invoke` RPC —— 后者面向 operator 且能被通用 `nodes` 工具触达，正是设计第 4.6 节要关掉的第二道门 — kiro-diskgrant
- [x] 网关启动点已接（`src/gateway/server.impl.ts`）：签名密钥随网关生命周期存在，重启即换新密钥并使此前签发的 capability 全部失效（fail closed 方向）。审批路由检查沿用 exec 审批同一判据 — kiro-diskgrant
- [x] **resolve ticket 此前无法兑换。** 集成测试发现的真实缺口：设计第 9.3 节规定 resolve ticket 同样经在线兑换，但 `redeem()` 只处理 invocation capability，因此每次 resolve 都以 `kind-mismatch` 失败、整条链走不通。新增 `redeemResolveTicket`（验签 + 绑定 + 节点/设备核对 + 消费 nonce，无父授权与预算）与按 kind 分派的 `redeemCapability`；两者 nonce 空间分离 — kiro-diskgrant
- [x] 激活集成测试 `src/gateway/local-files/activation.test.ts`：真实网关运行时 + 真实节点 handler + 真实临时文件系统 + 真实审批生命周期 + 真实兑换账本，复现 2026-09-21 桌面 zip；并按设计第 10.3 节把每条拒绝在「另一端放宽」的条件下各证一次 — kiro-diskgrant

## 已接线（第四轮：设备绑定，阻断项已解除）

**裁定：独立绑定动作，不折进配对批准。** 依据是设计自身的论证 —— 第 3 节明确写着配对只证明「这台节点连到了这个 Gateway」，不证明租户、用户、数字人、会话；这正是第 4.3 节让 `LocalDeviceBinding` 成为独立授权层的理由。若把绑定写进配对批准，能批准配对的人就静默获得了读盘授权，等于重新制造设计要拆开的那个混淆。

- [x] 绑定仪式 `src/gateway/local-files/binding-admin.ts`。关键设计：`devicePublicKey` **不是入参**，而是从已认证的活连接上读取 —— 人工转抄密钥既易错又是替换设备的机会。另有三条拒绝各堵一个具体失误：节点必须当前在线（密钥是观测到的而非声称的）；其声明命令集必须与档案精确相等（防止误绑一台带 shell 的通用节点）；已有 active 绑定必须先显式撤销（防止把同一台机器静默改指到另一个用户） — kiro-diskgrant
- [x] 绑定持久化 `src/local-files/device-binding-persistence.ts`，照 device-pairing 的范式：原子写、`0o600`、带版本信封。缺失或损坏的存储一律读成「无绑定」而非部分集合 —— 损坏的存储应当拒绝访问，而不是放行一个谁都没打算给的子集。畸形记录逐条丢弃而不做字段兜底，否则一条缺字段的记录会变成用默认值做出的授权决定 — kiro-diskgrant
- [x] `LocalDeviceBindingStore` 内存为同步授权路径的权威（兑换不能 await），磁盘只负责持久；变更走 `putPersisted` / `revokePersisted`，写失败向调用方抛出而不是被同步 setter 吞掉。启动时 `hydrate()`，失败则记日志并保持空集（拒绝而非猜测） — kiro-diskgrant
- [x] 三个 operator RPC：`localFiles.binding.create` / `revoke`（ADMIN scope）、`localFiles.binding.list`（READ scope）。列表视图把设备公钥缩成指纹 —— 运维需要区分两台设备，不需要把密钥复制到别处 — kiro-diskgrant
- [x] 端到端证据：`activation.test.ts` 证明「无绑定时每次读取都被拒 → 经仪式建立绑定 → 真实读取成功」，以及绑定经重启（重新 hydrate）后仍然授权、带 `system.run` 的节点被拒绝绑定 — kiro-diskgrant

## 已接线（第五轮：表现层）

- [x] `localFiles.approval.list`（READ scope）与 `ApprovalLifecycle.listPending()`。列表排除宽限窗口内已裁决的条目 —— 它们已不可作答，列出来只会引导运维去试。卡片视图不含任何 capability 素材：卡片是提示而非授权，作答的人需要路径与任务，不需要令牌 — kiro-diskgrant
- [x] CLI `openbot local-files`（`src/cli/local-files-cli.ts`）：`binding list|create|revoke` 与 `approval list|allow|deny`。有意不放进既有 `approvals` 组 —— 那组编辑的是 shell exec 审批**配置**，这里是回答实时的读盘提示，同一个词但不是同一种权限 — kiro-diskgrant
- [x] `binding create` **不接受设备密钥参数**。密钥在网关侧从活连接读取，命令行上没有任何可供运维抄错或替换的字段。`approval` 只有 allow / deny 两个动词，对应卡片的两个按钮，没有 allow-always — kiro-diskgrant
- [x] 模型工具注册（`src/agents/tools/local-file-tool-registration.ts`）。两道闸门都 fail closed：本进程必须有网关运行时（CLI 里跑的 agent 没有，因此看不到这些工具），且必须有可信轮次身份（tenant 取自 `ExecutionIdentityContext.enterpriseId`，文档明确是「session 固定、绝非客户端提示」）。任一不满足则**完全不提供**这些工具，而不是提供了再失败 —— 宣告一个永远不可能成功的能力，只会教模型反复重试并耗掉轮次 — kiro-diskgrant
- [x] 设备选择永不猜测：用户名下 active 绑定不唯一时返回拒绝而非任选一台（设计第 4.3 节「不广播」）；绑定未列出该数字人时同样拒绝 — kiro-diskgrant

## 已接线（第六轮：图形审批卡片）

方案：完整镜像 exec 审批卡的五层链路（controller 纯解析/归约 → capability facade → 返回 `boolean` 的 gateway-subscription → `app.ts` 的 `@state` 与 slice 类型 → 挂在 `app-render.ts` 的 view）。选它的理由不是省事，而是这套分层由 `app-render.boundary.node.test.ts` 强制守护；另外阻塞式弹窗在这里是对的 —— 网关把超时当拒绝，因此一张用户可能注意不到的卡片会静默否决请求。

三处有意偏离 exec 卡，各有设计依据：

- [x] **只有两个按钮。** 没有 allow-always：这条授权按构造就是一次性的，提供常驻许可会错误表述被批准的内容（设计 4.11）。view 测试断言按钮恰好 2 个且不含 always/一直 — kiro-diskgrant
- [x] **主题是「要做什么」而非命令串。** 首行是「某数字人 想要 检查这个归档」，下面是节点返回的规范化路径，不是网关拼的字符串（设计 9.1） — kiro-diskgrant
- [x] **有界任务显示预算。**「检查这个归档」覆盖一次 list 加多次条目读取，只显示动词会低估授权范围；单次调用的任务不显示预算行（设计 9.2） — kiro-diskgrant
- [x] 解析器对缺失必填字段返回 `null` 而不是兜底渲染 —— 一张低估授权范围的卡片比没有卡片更糟。未知 task / targetKind、畸形 budget 一律拒绝 — kiro-diskgrant
- [x] 卡片窗口过期后自动消失（网关已按超时拒绝，留着按钮等于提供已不生效的选项）；失败时保留卡片并显示错误，不静默消失 — kiro-diskgrant
- [x] 中英文案齐全（`en.ts` + `zh-CN.ts`），CSS 复用 exec 审批块作为模板 — kiro-diskgrant

顺带发现：`gateway-subscriptions/exec-approval.ts` 用的是 `window.setTimeout`，因此无法在 node 测试环境中被单测覆盖（浏览器里正常）。本模块改用 `globalThis.setTimeout`，运行时行为在浏览器中完全相同但可被测试。未修改 exec 那个文件（不属本任务）。

## 待接线（未完成）

- [x] `verifyConnectionIdentity` 已接线（`b9bcede8b`）。执行点是 `verifyRedemption`，每次兑换都跑；`4c44c555e` 让 `NodeSession` 开始携带 `capabilityProfile` 之后，网关才同时拿到五项事实。`RedeemingConnection` 的两个新字段是必填而非可选，档案缺失即拒绝，两者都从 live session 读而不从请求体读。比设计要求的「连接进入 active 前」更晚但更强：重连后命令集漂移会在下次读取被抓。落点逐项见 `evidence-10.1-landing-points.md` 闸门 3 — kiro-diskgrant
- [ ] 入口层 span 供给未接线（第 8 节第 4 步的后半）。`DirectedResourceRegistry` 已完成且有 13 条测试，但**生产调用点为零**，没有渠道产出 `authored_text` 区段。因此定向许可恒为空，主动读取全部走一次性审批卡片——这是设计第 4.5 节规定的 fail closed 方向，不是缺陷。本轮做了可行性分析，结论是**它不是「接一个适配器」那么小，需要单独立项**，三条理由：
  1. **不能伪造区段。** 第 9.6 节第 9 条明确要求「渠道没有结构化区段时，不生成 `sourceKind=authored_text` 的定向许可」。所以「把整条消息正文当作 authored_text」这种做法是被设计禁止的，必须有渠道真正提供的结构来证明。实际有这类结构的只有 Telegram（entities，含 `blockquote` / `code` / `pre`）。
  2. **偏移映射做错会 fail open。** `expandTextLinks`（`src/telegram/bot/helpers.ts:342`）把 `text_link` 实体重写成 markdown，逐个插入后其后所有偏移都发生位移，而非 `text_link` 实体的原始偏移不再对应改写后的文本。必须在改写**之前**算区段，或者维护一张偏移映射。这里搞错不是拒绝而是**把引用段标成用户自书写**——正好是第 4.5 节存在的目的被反转，所以这一处需要自己的审核，不适合作为收尾顺手加。
  3. **键对不上（结构性障碍）。** 注册表的查找键是 `{tenantId, userId, sessionKey, turnId, rawPath}`，而 `turnId` 取自 agent 的 `runId`（`local-file-tool-registration.ts:82`）。`runId` 是在 run 启动时生成的，位于消息入口的**下游**——入口处知道区段却还没有 `runId`，所以无法在入口直接 `record()`。设计第 4.5/9.2 节又要求许可绑定到轮次，不能改成按 `inboundMessageId` 记。看起来正确的形状是：入口只把**区段**挂到 `MsgContext` 上传下去，等 `runId` 存在时再 `record()`，即一条跨「渠道 → auto-reply → agent run」的管线改动。

  这三点都落在本任务声明路径之外（Telegram 渠道代码、`MsgContext` 管线、轮次生命周期），且接通后会改变安全相关行为（用户点名的路径不再弹卡片，这是设计第 6 节第 1 条要的，但属于需要显式批准的激活动作）。建议另开任务，并先补一份关于偏移映射的设计说明。

- [x] 双进程握手已覆盖（`d1a7e2981`）。`test/gateway.local-files-handshake.e2e.test.ts` 用 `test/helpers/gateway-e2e-harness.ts` 起真网关进程、开真 websocket，4 条：五条命令穿过过滤后经 `node.list` 原样读回、多声明 `system.run` 被拒、少一条被拒、普通 macOS 节点不受影响。由 `pnpm test:e2e` 跑（默认套件排除 `*.e2e.test.ts`），**需要先 build `dist/`**。写它的当场就找出了反向缺陷，见 `evidence-10.1-landing-points.md` 的「握手顺序」 — kiro-diskgrant
- [x] 双进程读取链路的线路部分已覆盖。`test/gateway.local-files-read-chain.e2e.test.ts` 在真网关进程 + 真 websocket 上跑一个**真节点宿主**：`onEvent` 把 `node.invoke.request` 转进真实的 `handleInvoke`、把 keyset 事件转进真实的 `applyLocalFilesKeysetEvent`，与 `src/node-host/runner.ts` 的接法一致，`localFiles.redeem` 也走同一条连接。5 条：keyset 经已认证连接下发并固定信任根；绑定 create/list/revoke 经真实 admin RPC（列表只给公钥指纹）；operator 发起的 `fs.read` 确实到达节点并因无 capability 被拒（第二道门的线路证明）；伪造签名的令牌在节点本地验签失败、不发起兑换；`POST /tools/invoke` 对 `local_file.read` 返回 404 而非放行 — kiro-diskgrant
- [ ] **一次成功读取**仍未在双进程下跑通，这是唯一剩下的环节。读取需要一张网关签名的 Invocation capability，而只有 `LocalFilesService.requestAccess` 会签，入口是 `local_file.*` 模型工具；设计有意不提供「发起读取」的 operator RPC，所以要端到端跑一次必须有真实模型参与的 agent 轮次，属于 live 测试范畴（`pnpm test:live` / `test:docker:live-gateway`）而不是这里。编排逻辑本身由 `activation.test.ts` 在进程内覆盖，它依赖的每一个线路帧现在都各有真实往返证明。

### 部署前提：没有租户身份就没有工具（本轮发现）

`createLocalFileToolsIfAvailable` 要求 `executionIdentity.enterpriseId`，否则**整组工具被省略**（不是注册后失败）。因此在没有租户身份的部署里，`local_file.*` 根本不会出现在模型工具表里。

这**不是缺陷**，三个理由一致：设计第 4.3 节的设备绑定本就以租户 + 用户为键；`binding.create` 拒绝空 `tenantId`；仓库对租户解析的既有立场也是 fail closed（`src/conversations/managed-planes.ts:154`：managed single-tenant 只认 `OPENBOT_DEFAULT_TENANT_ID`，缺失即失败）。

但它是一条**没有任何文档记载的部署前提**，而且解释了 `POST /tools/invoke` 为什么返回 404。生产接入（第 8 节第 8 步）时必须确认目标部署确实提供租户身份，否则功能装上了也不会出现。已就此加了一条永久断言：operator token 不能经通用 HTTP 工具路由拿到磁盘访问。

### 握手缺陷（已修，记录在此）

提交 `4c44c555e`。`NodeSession` 原先没有 `capabilityProfile` 字段，因此网关里没有任何地方填充 `resolveNodeCommandAllowlist` 档案分支所依赖的输入——分支、测试与扩展点都真实存在，但运行时到不了。后果不是静默降级而是一扇关着的门：握手时网关按解析出的白名单过滤节点声明的命令，无档案时解析到 macOS 默认集，而五条 `fs.*` / `archive.*` 都不在其中，于是只读节点的命令被全部剥掉；随后的档案检查读到空集，以「命令集不符」`close(1008)` 关闭连接。配置正确的节点被当成配置错误拒掉了。

修法：`capabilityProfileFromCaps` 从节点声明的能力推出档案（节点自身是按启动配置决定声明的），握手过滤与 `NodeRegistry.register` 各调用一次，后者让 `server-methods/nodes.ts` 与 `browser.ts` 的后续解析与握手时一致。四条测试把握手当成**序列**复现——缺的正是这一点：两步各自都对，组合是错的。

### 已关闭的旧条目

- ~~`/cli/local-files` 文档页与 CLI 侧链接~~：文档页由 `d5e70c40a` 落地（非本任务提交），链接已补在 `local-files-cli.ts`，`--help` 输出 `docs.openbot.love/cli/local-files`。
- ~~`createLocalFileTools()` 未加入模型工具列表~~：已在 `5a17f8cbe` 接线，落点是 `src/agents/pi-tools.ts:632–643` 的 `createLocalFileToolsIfAvailable`，运行时或身份缺失时返回空数组（不注册必然失败的工具）。

## 已知取舍

- 兑换事务的原子性依靠「同步临界区」实现：`redeemInvocationCapability` 全程无 `await`，因此 Node 单线程下两个并发兑换无法交错。这对单进程网关成立；多进程或多实例部署需要换成数据库事务，已在 `src/local-files/redemption.ts` 注释中标注。
- nonce 与 Turn authorization 均为内存存储，网关重启即清空。设计只要求「节点重启不能清除网关上的消费记录」，该性质成立；网关自身重启的持久化留待生产实现。
- `nlink > 1` 采取更严的默认拒绝（而非「列为高风险」），因此 Desktop 上被硬链接过的普通文件也读不到。这是有意选择：只核对最终路径名与 inode 类型无法判断同一 inode 是否仍链在敏感目录。
- 归档整体读入内存（上限 64 MiB）。流式解析可降低内存占用，但会让条目级策略检查复杂化，原型阶段选择简单可审计的实现。
- 压缩炸弹检测同时用「声明膨胀比」与「流式字节上限」。前者可被伪造的中央目录绕过，后者不可，因此后者是真正的保证。

## 验证

### UI 打包未能验证（外部阻断，非本任务）

审批卡的类型检查、单元测试（含 `app-render.boundary.node.test.ts` 架构守护）与 style contract 全部通过，但 **vite 打包无法验证**：`ui` 构建目前在 `packages/evolution-core/dist/completion-ledger.js` 处失败，该文件 `import` 了 `node:fs` 的 `readFileSync`，无法打进浏览器 bundle。该包与本任务无关（由 evolution 相关任务引入），失败信息中不含任何 `local-file-approval` 文件。

因此审批卡的浏览器运行时行为尚未经真实打包验证。等 `ui` 构建恢复后应补一次 `pnpm --filter openbot-control-ui build`。

- `pnpm vitest run src/local-files/ src/node-host/local-files/ src/gateway/local-files/ src/agents/tools/local-file-tool.test.ts src/gateway/node-command-policy.local-files.test.ts`
- `pnpm tsgo`：本任务文件零错误
- `npx oxlint --type-aware`：干净；`npx oxfmt`：干净
- 既有失败（与本任务无关、未修改相关文件）：`src/gateway/gateway-misc.test.ts` 的「returns 404 for missing static asset paths」（control-UI 静态资源服务）
