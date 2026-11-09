# T9 已接受成果到投递层的最小补链设计

状态：方向大体可保留，整段实施仍未核准。本文只修订设计，不实现生产代码。

受测生产源码仍是 `9fab5de35bfaf7dcfaab6ba15a70121c09a445d9`。审查中继测试更名在 `fc36ea82f0cb6a6e7ee154d03ca0a2e8c290801b`。T9 仍未通过。

已确认、本文不推翻：

- `acceptedArtifactVersion` 在接受时写入，生产代码没有非测试读取者。
- `acceptBoardItemSubmission` 接受后清空审查/执行中继。
- `accepted` 停止后续执行派发。这条规则正确，不删除。
- 缺的是另一条职责：已接受成果进入投递层，不回到执行器。

## 1. 现状映射表

| 职责 | 符号 | 文件 | 读写的状态 |
| --- | --- | --- | --- |
| 工作项接受 | `acceptBoardItemSubmission` | `src/gateway/collaboration-dispatch/claim-contract.ts` | 写 `status=accepted`、`acceptedSubmissionId`、`acceptedArtifactVersion`、`acceptedBy`、`acceptanceReason`。清空 `pendingEventRelay`。不写投递回执，不改协作任务完成态。 |
| 接受前的链接校验 | `verifyLinkedTeamDeliverableForAuthority` | `src/gateway/collaboration-learning/verify-linked-team-deliverable.ts` | 读 `linkedDeliverableId`、`linkedDeliverableVersion`、`linkedContentSha256`，对照团队存储。不投递。 |
| 工作项持久化 | `mutateBoardClaimLog` | `src/agent-runtime/state/collaboration/round-txn.ts` | 锁内读改写 board claim 日志。接受行在这里落盘。 |
| 审查/退回派发 | `triggerPostSubmissionEventAdvance`、`recoverPendingBoardEventRelays` | `src/gateway/collaboration-learning/post-submission-event-advance.ts` | 读写 `pendingEventRelay`。`status===accepted` 时返回 `accepted_no_further_exec_schedule`，不派发。`roundDispatcher` 是审查回合，不是成果回执。 |
| 成员成果入库 | `finalizeMemberRunTeamDeliverable`、`submitTeamDeliverable`、`readTeamDeliverable` | `src/gateway/collaboration-learning/chat-deliverable-team-submit.ts`、`team-deliverable-submit.ts` | 评审前写入团队存储。回执字段是 `deliverableId`、`version`、`contentSha256`、`locator`。这是存储回执，不是接受后的渠道回执。接受路径不调用它们。 |
| 个体回合待投递 | `prepareVisibleDelivery`、`confirmPendingTurnDeliveryWithPorts` | `src/agent-runtime/delivery/dispatch/prepare-visible.ts`、`confirm-pending.ts`；登记在 `src/task-outcome/pending-delivery.ts` | 按 `runId` / `deliveryId` / 会话任务绑定。确认路径可以关闭会话任务。不读 `acceptedArtifactVersion`。 |
| 排队回复发送 | `deliverQueuedReply` | `src/agent-runtime/delivery/dispatch/queued-reply.ts` | 发送已有 `ReplyPayload`。依赖当次排队上下文，不是接受落盘后的可恢复意图。 |
| 渠道写前队列 | `enqueueDelivery`、`deliverOutboundPayloads`、`recoverPendingDeliveries`、`ackDelivery`、`failDelivery`、`confirmedDeliveryMessageIds` | `src/infra/outbound/delivery-queue.ts`、`src/infra/outbound/deliver.ts`、`src/shared/delivery-receipt.ts` | `deliverOutboundPayloads` 在未传 `skipQueue` 时自己调用 `enqueueDelivery`，成功后 `ackDelivery`。恢复路径必须传 `skipQueue: true`。`ackDelivery` 把 `{id}.json` 改名为 `{id}.delivered` 再删除；`loadPendingDeliveries` 会清掉残留的 `.delivered`，这只表示不要重放，不是给补链的送达证明。没有可信 `messageId` 时，恢复把条目移到 `failed/` 并写 `delivery_unknown`，不自动再发。 |
| 个体等待恢复 | `delivery_only` 分支 | `src/agent-runtime/state/repository/async-wait-job-recovery.ts` | 只重投已绑定载荷，不重跑业务。没有接到 board 接受字段。 |
| 自进不代替终局 | `selfAdvanceDoesNotBypassHumanRequiredOutbound`、条件 `outbound_final_human_required` | `src/gateway/collaboration-dispatch/self-advance.ts` | 明确不代替 outbound/final。不发送已接受成果。 |

`acceptedArtifactVersion` 的生产写入点只有 `acceptBoardItemSubmission` 内部那一次赋值。测试文件里的读取不能算消费者。

## 2. 交付对象判定

接受一个工作项，不等于完成整个组终稿。

**成员成果。** 一个 board item 在 `submitted_for_review` 上带着 `submissionId`、`artifactVersion`，以及 `linkedDeliverableId`、`linkedDeliverableVersion`、`linkedContentSha256`。接受成功后，这三项冻结为 `acceptedSubmissionId` 与 `acceptedArtifactVersion`，链接字段仍留在同一行。正文在团队存储里，用 `readTeamDeliverable` 按 id 读出，再用已保存的 version 和 sha256 核对。这是该工作项的已接受成员成果，不是组终稿。

**组终稿。缺口。** 没有符号把多个已接受成员成果收成一份组终稿，也没有符号在接受时把 `Deliverable.status` 推进到 `approved` 或 `published`。`packages/collaboration-core/src/types/deliverable.ts` 里的 `published` 和 `finalDeciderMemberId` 没有被接受路径写入。`claim-contract.ts` 里的 `status: "published"` 是 `publishBoardItem` 的工作项发布，发生在认领之前。`acceptBoardItemSubmission` 不把协作任务标成完成。因此不存在组终稿集成机制。不得用一份成员成果冒充组终稿对外发送。

现有集成条件，只覆盖工作项接受：

- 状态必须是 `submitted_for_review`，且 `claimBoardActionAllowed(..., "accept")`。
- `expectedSubmissionId` 与当前 `submissionId` 一致。
- `artifactVersion`、交付物 id、version、sha256 齐全，并且 `verifyLinkedTeamDeliverableForAuthority` 通过。
- 验收条款被勾选，接受理由不是口头「完成」。
- 单群无人值守车道另有 `guardUnattendedAccept`。普通接受不按 claimant 比较 actor。

这些条件成立，只说明该工作项被接受。它们不构成组终稿投递条件。

## 3. 最小补链设计

触发点仍停在执行派发之外。`triggerPostSubmissionEventAdvance` 对 `accepted` 返回 `accepted_no_further_exec_schedule`。这条停派发保持不变。补链不调用它，也不把投递塞进 `roundDispatcher`。

分层仍然是：policy 判断资格，state 记录与 `accepted` 分开的投递意图，delivery 只发送和记回执。不调用 `submitTeamDeliverable`，不启动成员执行，不调用 `confirmPendingTurnDeliveryWithPorts`。

固定版本引用仍是 `acceptedArtifactVersion` 加上 `linkedDeliverableId`、`linkedDeliverableVersion`、`linkedContentSha256`。`scope=group_final` 一律不可投递。没有显式 `target` 也不投递。成员成果补链即使以后落地，也不关闭组终稿这一格。

### 3.1 唯一入队者，以及发送前的关联门闩

现有事实：`deliverOutboundPayloads` 在 `skipQueue` 未置位时自己调用 `enqueueDelivery`，成功后再 `ackDelivery`。`recoverPendingDeliveries` 只扫描 `delivery-queue/*.json`（`loadPendingDeliveries`），调用 `opts.deliver` 时传入 `skipQueue: true`。`ackDelivery`、`failDelivery`、`moveToFailed` 都只按 `{id}.json` 找文件。`ackDelivery` 把 `{id}.json` 改名为 `{id}.delivered` 再删除；`.json` 已经不在时它只清理 `.delivered`，不会去找别的后缀。

只靠「先入队、再写 `queueId`、然后才调用恢复」挡不住并发。`enqueueDelivery` 一旦写出 `.json`，另一次 `recoverPendingDeliveries` 就能读到并发送。所以补链的队列文件在关联落盘之前不得使用 `.json`。

单一所有者不变：补链 state 是唯一入队者，不调用 `deliverOutboundPayloads`。唯一发送、ack 和把回执写回意图的仍是 `recoverPendingDeliveries`，并且必须 `skipQueue: true`。

幂等键必须包含租户和规范化目标，不能只含原始 `target` 字符串。键是 `tenantId + groupId + taskId + itemId + acceptedSubmissionId + acceptedArtifactVersion + normalizedTarget`。`normalizedTarget` 是 `channel`、`accountId`，以及 `resolveOutboundTarget` 返回的 `to`。并发唯一用独占创建，不用先查再写：对 `delivery-queue/bridge-{keyHash}.bridge-staged` 做 `open(..., "wx")`。`EEXIST` 就读已有文件并沿用它的 `id`。POSIX 的 `rename` 会覆盖目标，不能拿来当独占创建。

发送门闩，不靠调用顺序：

- 独占创建出来的是 `.bridge-staged`，不是 `.json`。`loadPendingDeliveries` 不扫描这个后缀，所以恢复工人看不到它。
- 意图先落盘：`queueId`、幂等键、冻结版本和 hash、规范化目标、请求 actor、租户。然后才允许把该文件改名为 `{id}.json`。
- 改名后的 `.json` 带 `bridgeMarker: true` 和 `associationReady: true`。`recoverPendingDeliveries` 对带 `bridgeMarker` 的条目增加判断：`associationReady !== true` 则跳过，不发送，也不 `failDelivery`。普通没有 `bridgeMarker` 的条目保持今天的路径。
- 同一判断里重新做第 3.2 节的 outbound 授权。未通过则不发送。

这不是新调度器。发送仍只有现有的 `recoverPendingDeliveries`。`.bridge-staged` 只是现有队列目录里的一个恢复循环看不见的名字。

不采用把所有队列项改名为 `.inflight`。原因见第 3.4 节。补链条目在变成 `.json` 之后，认领用已有的 `withDirectoryLock`（`src/agent-runtime/state/repository/durable-json.ts`），锁茎是队列 `id`。持锁后若 `bridgeSendStarted` 已为真而意图还没有 `receiptMessageIds`，不再发送，意图改为 `unknown`。否则先把 `bridgeSendStarted: true` 写回 `{id}.json`，再 `deliverOutboundPayloads({ skipQueue: true })`。这个锁只加在 `bridgeMarker` 条目上，不加给普通渠道队列。

### 3.2 独立的投递请求，不把接受绑成外发

接受成果和批准外发是两件决定。没有 `target` 就不发送。传入 `target` 也不自动允许发送。

推荐的请求是一条独立命令，实施时再挂到现有协作请求旁边，名字拟为 `collaboration.task.requestAcceptedArtifactDelivery`。本轮不添加这个方法。它复用今天接受命令已经用的身份和 ACL 边界，但是另一个命令：

- 身份：`resolveTrustedWriteContext`（`src/gateway/server-methods/collaboration-learning.ts`）里的 `resolveDeliveryAclActor`。actor 来自 Gateway `client`，不来自请求正文。
- 群范围：`resolveHandlerTrustedTeamContext` → `authorizeTeamGroupResourceAccess`（`src/gateway/collaboration-learning/team-resource-auth.ts`），action 为 `write`。不信任单独传来的 tenantId。

它不调用 `acceptBoardItemSubmission`，也不修改接受行。请求可以发生在接受之后。请求记录单独落盘，先于任何入队。接受事务保持今天的样子，不承诺发送。

明确不用的入口：

- 不扩展 `send`（`sendHandlers`）。它调用 `deliverOutboundPayloads`，自己会入队，也不走 `resolveTrustedWriteContext`。
- 不让 `collaboration.task.acceptSubmission` 默认带上外发权。那个方法只做接受。

现有符号里，没有「这个可信 actor 可以把这份已接受成员成果发到这个规范化目标」的授权能力。盘点如下，都不能假装成授权：

| 符号 | 实际作用 | 为什么不是这条授权 |
| --- | --- | --- |
| `resolveOutboundTarget` | 解析渠道和 `to`，并可读插件的 `resolveAllowFrom` | 目标形状和渠道 allowFrom，不绑定本次 actor 与已接受成果 |
| `operator.write` | Gateway 方法作用域 | 连接权限，不是这份成果的外发决定 |
| `checkTaskActionBoundary` | 暂停、取消、替换时拒绝工具 | 任务边界，不是 outbound |
| `authorizeTeamGroupResourceAccess` | 群读/写 ACL | 能写群资源，不等于能外发这份成果 |

因此后来要加的是一条窄的 policy 能力，拟名 `evaluateAcceptedArtifactOutboundAuthorization`。输入是可信 actor、tenant、groupId、规范化目标、冻结的 version 和 hash。输出是 allow 或 deny 加原因。调用方不得写入一个 `granted` 布尔来代替它。这个函数还不存在。在它落地之前，独立请求可以记为 `authorization_pending`，但不得把 `.bridge-staged` 改名为 `.json`，也不得发送。

恢复时重新调用这同一个函数，不读取上次的布尔。deny 则 `moveToFailed`，意图 `blocked`，原因 `outbound_authorization_revoked`。不发送。工作项保持 `accepted`。

### 3.3 请求先落盘，再推进

投递请求是自己的 durable 记录，不写进接受行。字段包括 scope（只允许 `member_artifact`）、规范化目标、请求 actor、tenant、冻结的 `acceptedSubmissionId` / `acceptedArtifactVersion` / 链接三元组、以及授权状态。`scope=group_final` 拒绝写入可发送状态。没有目标也不写入可发送状态。

顺序是：请求记录落盘 → 窄授权 allow → 独占创建 `.bridge-staged` → 意图写下 `queueId` → 授权复检通过后才改名为 `.json`。任何一步没完成，恢复工人都不能发送。接受函数返回后的内存回调不在这条链上。

### 3.4 不引入 `.inflight`，避免改掉全渠道语义

`ackDelivery` 只 rename `{id}.json`。`failDelivery` 只读 `{id}.json`。`moveToFailed` 只把 `{id}.json` 挪到 `delivery-queue/failed/{id}.json`。若改名为 `.inflight`，这三处都会 `ENOENT`。`ackDelivery` 在 `ENOENT` 时还会去删 `.delivered`，看起来像清理成功，实际上文件在别处。所以本设计不增加 `.inflight`，也不改普通队列项的后缀。

带 `bridgeMarker` 的条目在可发送之后仍然是 `{id}.json`，因此现有 ack、失败计数和失败归档不用改查找路径。崩溃隔离用两个现有目录看不见或拒绝发送的位置：

- `.bridge-staged`：关联或授权未完成。`loadPendingDeliveries` 不读它，普通发送碰不到。同一轮 `recoverPendingDeliveries` 开头可以列出这个后缀，把已有 `id` 补进意图，但在关联落盘且授权复检通过之前不改名为 `.json`。
- `delivery-queue/failed/`：`moveToFailed` 之后。发送扫描不读这个子目录。`unknown`、回执写失败、授权撤销都停在这里，而不是删掉文件。

普通没有 `bridgeMarker` 的 `{id}.json` 不进入上述判断，不加大锁，ack 和失败路径与今天相同。

## 3.5 M1 合同（本切片实现；不发送）

M1 只落请求和关联。存储用已有的 `withDirectoryLock` 和 `writeJsonDurable`，目录由调用方传入，不在 `delivery-queue/` 里写 `{id}.json`。因此 `loadPendingDeliveries` 扫不到这些文件。M2 才可以把已关联且授权通过的记录改名进那条队列。现有队列表达不了「暂存但不可发送」：它的待发送集合就是顶层 `*.json`。M1 不新做队列，也不把暂存文件放进那个目录。

1. **幂等身份在改名之后还在。** 键材料是固定字段数组的 `JSON.stringify`，不用换行拼接，避免字段里的分隔符拼成另一个身份。同一键的锁内先读意图。只有 `ENOENT` 表示缺失。意图损坏、权限或 IO 错误必须拒绝，不得覆盖原文件、不得重置阶段。阶段已是 `staged`、`associated`、`delivered`、`unknown`、`blocked` 或 `failed_retryable` 时返回原记录。M1 不把改名后的阶段写成 `queued`。改名函数在源文件和目标文件都不存在时返回失败，不把 `queueId: null` 记成已入队。半写仍只修暂存正文，不重写一份坏掉的意图。
2. **`bridgeSendStarted` 不同时表示「正在发」和「永不可重试」。** 这是 M2 的发送合同。M1 不提供写入投递结果的接口，因此不能把 `delivered` 或 `unknown` 改成 `failed_retryable`，也不能靠调用参数把 `unknown` 变成可重试。字段仍留着：`externalEffect` 为 `none` 时以后才可以重试；为 `unknown` 时隔离且不可重试。M1 提交保持 `bridgeSendStarted: false`。
3. **窄授权没有真实依据就不是授权。** `evaluateMemberArtifactDeliveryEligibility` 在身份完整时只返回 `authorization_pending` / `outbound_auth_unwired`。它不读取 `granted`。依据仍然缺：`resolveOutboundTarget`、`operator.write`、`checkTaskActionBoundary`、`authorizeTeamGroupResourceAccess` 都不是「这份已接受成果可以外发」。M2 接上真正的 `evaluateAcceptedArtifactOutboundAuthorization` 之前，关联可以落盘，但不得改成可发送的队列 `.json`。

## 4. 失败与恢复

接受状态和投递状态分开。工作项可以一直是 `accepted`，同时意图是 `queued`、`failed`、`unknown` 或 `blocked`。查询投递读意图，不把 board 改成已送达，也不因为队列文件不见了就改成已送达。

四类发送结果分开，不能把 `unknown` 扫出来再自动重发：

| 类 | 现有机制 | 意图状态 | 是否再发 |
| --- | --- | --- | --- |
| 未发出，或可重试失败 | `recoverPendingDeliveries` 在抛出且不是 `isPermanentDeliveryError` 时 `failDelivery`，`retryCount` 增加，`.json` 仍留在队列。下次按 `isEntryEligibleForRecoveryRetry` 和 `computeBackoffMs` 退避。 | `failed`，`retryable=true` | 同一 `queueId`、同一版本、同一 target。不新入队。 |
| 已发出且有可信回执 | `confirmedDeliveryMessageIds` 要求每条都有非空 `messageId`，且不是 `"unknown"`。先把这些 id 写入意图。写入成功才 `ackDelivery`。写入失败则停止 ack，意图改为 `unknown`，并 `moveToFailed`。不得先删队列文件再靠恢复去推断成功。 | `delivered` 仅当 `receiptMessageIds` 已落盘 | 不再发送，不再第二次写成成功。 |
| 发送效果不明 | 恢复里已有两条：无可信 `messageId` 时 `lastError=delivery_unknown: transport acknowledgement missing` 并 `moveToFailed`；部分 payload 已有回执时 `partial_delivery: held for reconciliation` 并 `moveToFailed`。两条都明确不再重放整批。 | `unknown` | 不入新队，不调用 `deliverOutboundPayloads`。留作待查。渠道没有幂等或对账能力时，不准把 `unknown` 扫回可重试。 |
| 版本或 hash 不符 | 入队前 `readTeamDeliverable` 的 version、`contentSha256` 必须等于冻结的链接。不符。 | `blocked`，原因 `content_hash_mismatch` | 不入队。不准改去发送存储里较新的正文。 |

队列项消失不是送达。`ackDelivery` 先把 `{id}.json` 改名为 `{id}.delivered`，再删除标记。`loadPendingDeliveries` 删除残留 `.delivered` 只是为了不再重放。补链看不到 `receiptMessageIds` 时，不得把「文件没了」推成 `delivered`，也不得立刻 `enqueueDelivery` 一条新的。意图停在 `unknown`。

两个崩溃窗：

- **A。暂存文件已创建，意图还没写下 `queueId`。** 磁盘上是 `bridge-{keyHash}.bridge-staged`，不是 `.json`。并发的 `recoverPendingDeliveries` 扫不到它，发送次数为 0。恢复用同一幂等键独占创建，得到 `EEXIST` 后沿用原 `id`，把 `queueId` 写进意图。在关联落盘且授权复检通过之前，不改名为 `.json`。
- **B。外发已成功，队列已经 ack 并清理，意图还没标成 `delivered`。** 若回执写入失败，本设计根本不调用 `ackDelivery`，所以不应走到「文件已删、回执没有」。若仍然出现文件消失且没有 `receiptMessageIds`，意图改为 `unknown`，不新建队列项，不重发。只有已经落盘的那组 `messageId` 才能收成 `delivered`。

接受已落盘、独立请求尚未写成：不发送。请求不在接受行上。没有请求就没有目标，也没有 outbound 授权，扫描不发明它们。

重复通知或重启：意图已是 `delivered` 则不再入队。第二次 `acceptBoardItemSubmission` 维持今天的失败，不重复关闭组任务。

## 5. 拟议测试矩阵

尚未实施。将来的测试只桩渠道发送的最外层返回值（可信 `messageId`、失败、或没有 `messageId`）。`enqueueDelivery`、`recoverPendingDeliveries`、`ackDelivery`、`failDelivery` 和意图写入走真实逻辑。不得替换整个 `deliverOutboundPayloads` 再声称队列闭环已测到。不得手写一个已送达的意图来跳过队列。

| 断言 | 拟议观察 |
| --- | --- |
| 未接受成果不投递 | 没有独立请求记录时，不创建 `.bridge-staged`。`acceptedArtifactVersion` 仍为空。授权仍是 `authorization_pending` 时，文件不得变成 `.json`。 |
| 成员接受不提前关闭组任务 | 接受后工作项为 `accepted`，协作任务完成态不变。不调用 `confirmPendingTurnDeliveryWithPorts`。`scope=group_final` 被拒绝。组终稿格保持打开。 |
| 首次可重试失败后再成功，版本与正文一致 | 第一次发送抛出可重试错误。意图为 `failed` 且 `retryable=true`，board 仍为 `accepted`。退避后的下一次仍是同一个 `queueId`。发出的正文 sha256 等于 `linkedContentSha256`。成功时 `receiptMessageIds` 来自 `confirmedDeliveryMessageIds`，之后才 ack。成员执行次数不增加。 |
| 重复通知和重启不重跑业务、不重复结算 | 已是 `delivered` 时再跑恢复，`enqueueDelivery` 不增加，`receiptMessageIds` 不追加第二组。接受不能再成功一次。 |

## 5.1 崩溃窗与双发测试计划

同样尚未实施。

| 场景 | 必须看到 |
| --- | --- |
| 双入队 | 补链入队之后，若有代码路径调用不带 `skipQueue` 的 `deliverOutboundPayloads`，测试失败。同一意图键只存在一个 `{id}.json`。`recoverPendingDeliveries` 的调用参数包含 `skipQueue: true`。 |
| 关联尚未可见 | `.bridge-staged` 还在、意图尚无 `queueId` 时，并发跑 `recoverPendingDeliveries`。`deliverOutboundPayloads` 不被调用。恢复后仍只有这一条暂存文件。 |
| 独占创建 | 两个并发请求用同一租户和同一规范化目标。只有一个 `bridge-{keyHash}.bridge-staged`。另一个得到 `EEXIST` 并沿用同一 `id`。不得先查再写。 |
| 唯一认领 | 文件已是带 `bridgeMarker` 的 `.json`。两次重叠的 `recoverPendingDeliveries` 只进入一次 `deliverOutboundPayloads`。`bridgeSendStarted` 已真且没有回执时，第二次不发送，意图为 `unknown`。 |
| 窗 A | 暂存文件已在，意图没有 `queueId`，然后中断。恢复写下原来的 `queueId`。在改名为 `.json` 之前发送次数为 0。 |
| 窗 B | 渠道已返回可信 `messageId`，但回执写入失败。`ackDelivery` 不被调用，`.json` 不被删。意图为 `unknown`。不得新建队列项。 |
| 回执失败不清理 | 上一条里 `moveToFailed` 之后文件在 `failed/`，发送扫描不再捡起它。若 `moveToFailed` 也失败，`.json` 上有 `bridgeHold: "unknown"`，判断式跳过发送。 |
| 普通队列不受影响 | 没有 `bridgeMarker` 的 `{id}.json` 仍由现有 `ackDelivery` 从 `{id}.json` 改名。补链逻辑不改它的后缀，也不给它加 `withDirectoryLock`。 |
| 文件消失 | 删掉 `{id}.json` 且没有 `receiptMessageIds`。意图不得变成 `delivered`，不得出现新的队列文件。 |
| 恢复时权限撤销 | 请求曾经 allow。恢复时 `evaluateAcceptedArtifactOutboundAuthorization` 改为 deny。`moveToFailed` 发生，意图为 `blocked`，原因 `outbound_authorization_revoked`。`deliverOutboundPayloads` 不被调用。board 仍是 `accepted`。不得用上次写下的布尔放行。 |
| unknown 不盲重发 | 发送返回值没有通过 `confirmedDeliveryMessageIds`。意图为 `unknown`，条目在 `failed/`，`lastError` 含 `delivery_unknown`。再次扫描不入队、不再调用发送。部分回执走 `partial_delivery`，同样不再发整批。 |
| hash 不符 | 存储正文 sha 与 `linkedContentSha256` 不同。意图为 `blocked`，原因 `content_hash_mismatch`。不入队，不发送较新正文。 |

## 6. 非目标

- 不删除 `accepted` 的 `accepted_no_further_exec_schedule`。
- 不把 `pendingEventRelay` 或 `roundDispatcher` 当成送达回执。
- 不新增调度器，不新增模型执行环。
- 不把队列文件消失当成 `delivered`，也不为消失的项立刻新建一条再发。
- 不把 `unknown` 扫回来自动重发。
- 本轮不接真实渠道、不重启生产、不跑真实模型、不渲染实物 PPT。
- 不把每个已接受工作项默认当成组终稿外发。
- 不改 `acceptBoardItemSubmission` 的事务，不把投递请求写进接受行。
- 不引入 `.inflight`，也不改变没有 `bridgeMarker` 的渠道队列。
- 不实现本文。核准前不改生产行为。
- 不清理 619 条 `INEFFECTIVE_DYNAMIC_IMPORT`。
- 不开始 D0–D5。

## 7. 已决定与仍待核准

已决定，本文照此写死：

1. 投递请求是独立命令，复用 `resolveTrustedWriteContext` 和 `authorizeTeamGroupResourceAccess`。不扩展 `send`，也不让 `acceptSubmission` 默认带外发权。请求单独落盘，接受行不改。窄授权函数 `evaluateAcceptedArtifactOutboundAuthorization` 还不存在，不能用 `granted` 布尔代替。
2. 启动恢复复用 `recoverPendingDeliveries`。发送可见性靠 `.bridge-staged` 与 `associationReady`，不靠调用顺序。幂等键含租户和规范化目标，独占创建。
3. 组终稿集成仍是单独缺口。成员成果补链完成也不关闭 T9 的这一格。
4. 测试只能桩渠道最外层回执。队列、恢复和意图回执走真实逻辑。不得换掉整个 `deliverOutboundPayloads` 来声称闭环。真实渠道仍是 GAP。

整段实施仍未核准。上面四条写进设计之后，才可以再审一最小实现切片。本轮不写该切片。
