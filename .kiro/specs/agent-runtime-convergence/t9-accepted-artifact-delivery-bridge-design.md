# T9 已接受成果到投递层的最小补链设计

状态：待核准。本文只描述设计，不实现生产代码。

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
| 渠道写前队列 | `enqueueDelivery`、`deliverOutboundPayloads`、`recoverPendingDeliveries`、`failDelivery` | `src/infra/outbound/delivery-queue.ts`、`src/infra/outbound/deliver.ts` | 持久化 `channel`、`to`、`payloads`、`retryCount`、`lastError`。成功后 ack。Gateway 启动时 `src/gateway/server.impl.ts` 已调用 `recoverPendingDeliveries`。队列本身不携带 `acceptedArtifactVersion`。 |
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

触发点仍停在执行派发之外。`triggerPostSubmissionEventAdvance` 对 `accepted` 的停派发保持不变，补链不调用它，也不把投递塞进 `roundDispatcher`。

分层：

- **policy** 只判断资格，不写盘、不发送。拟议纯函数读取已落盘的工作项、调用方给出的 `scope` 和 `target`。`scope=member_artifact`，且 `status=accepted`、`acceptedArtifactVersion` 与链接三元组齐全、`target` 显式存在时，资格为可投递。`scope=group_final` 一律不可投递，原因是组终稿集成缺失。没有 `target` 也不可投递。没有默认渠道，没有默认开启的开关。
- **state** 记录受控投递意图，与 board 的 `accepted` 分开。意图键是 `groupId + taskId + itemId + acceptedSubmissionId + acceptedArtifactVersion + target`。字段至少包括链接三元组、`queueId`、状态 `requested | sending | delivered | failed | unknown`。写入走已有的 `withDirectoryLock` / durable JSON，不新做调度器。同一键再次提交返回已有意图，不追加第二次成功。
- **delivery** 只发送和记回执。发送前用 `readTeamDeliverable` 读出正文，核对 version 与 `linkedContentSha256`。核对通过后，把这份固定正文交给已有的 `enqueueDelivery`，再由已有的 `deliverOutboundPayloads` 发送。回执写在意图状态和队列 ack 上。不调用 `submitTeamDeliverable`，不启动成员执行，不调用 `confirmPendingTurnDeliveryWithPorts`（那条确认可以关闭会话任务）。

固定版本引用就是接受行上的 `acceptedArtifactVersion` 加上链接三元组。重试读这组字段，不重新生成版本。

为了让「接受已落盘、意图尚未建立」可恢复，调用方提供的 `scope=member_artifact` 和 `target` 必须写进同一次接受追加，而不是只留在接受函数返回后的内存回调里。拟议字段名 `deliveryRequest`，挂在已接受的 board 行上，内容只有 scope、target、请求时间。它不是回执。没有这个请求，恢复扫描不发明目标，也不发送。

进程内，接受落盘后可以立刻调用一次「按请求建立意图并入队」。崩溃后的同一职责由已有 Gateway 启动路径承担：与 `server.impl.ts` 里现有的 `recoverPendingDeliveries` 相邻调用一次扫描，不新增定时器，不新增模型环。扫描只处理带 `deliveryRequest` 且意图缺失或仍为 `requested` / `failed` / `unknown` 的已接受项。

## 4. 失败与恢复

接受状态和投递状态分开。工作项可以一直是 `accepted`，同时意图是 `failed` 或 `unknown`。查询投递结果读意图记录和队列的 `lastError`，不把 board 状态改回未接受，也不把它改成已送达。

失败和 unknown 都可查：`failed` 来自 `failDelivery` 或正文 sha 不符；`unknown` 来自发送已开始但没有 ack。两种都不写成 `delivered`。

重试使用同一 `acceptedArtifactVersion`、同一链接三元组和同一 `target`。已经有 `queueId` 时，重试走该队列项的现有恢复，不再 `enqueueDelivery` 一次新的 id。没有 `queueId` 时才按意图键入队一次。重试不调用成员执行，不调用 `submitTeamDeliverable`。

接受落盘之后、意图建立之前：恢复扫描看到持久化的 `deliveryRequest`，补写意图再入队。这条路径不依赖接受函数返回之后的那一次内存回调。若请求本身没有写进接受行，扫描找不到目标，保持不发送；这不是可恢复的投递，也不许用组成员或频道配置猜一个目标。

重复通知或重启：意图已是 `delivered` 则不再入队、不再记第二次成功。board 上第二次 `acceptBoardItemSubmission` 维持今天的失败，不重复关闭。

## 5. 拟议测试矩阵

尚未实施。将来的消费者测试只桩模型和 `deliverOutboundPayloads` 的外边界，不手写一个已送达状态。

| 断言 | 拟议观察 |
| --- | --- |
| 未接受成果不投递 | `submitted_for_review` 且没有 `deliveryRequest` 时，扫描不调用 `enqueueDelivery`。`acceptedArtifactVersion` 仍为空。 |
| 成员接受不提前关闭组任务 | `acceptBoardItemSubmission` 之后工作项为 `accepted`，协作任务完成态不变。不调用 `confirmPendingTurnDeliveryWithPorts`。`scope=group_final` 的请求被 policy 拒绝，不入队。 |
| 首次失败后重试成功，版本与正文一致 | 第一次 `deliverOutboundPayloads` 失败，意图为 `failed` 或 `unknown`，board 仍为 `accepted`。重试发送的正文 sha256 等于 `linkedContentSha256`，version 等于 `linkedDeliverableVersion`。成功后意图为 `delivered`。成员执行次数不增加。 |
| 重复通知和重启不重跑业务、不重复结算 | 第二次恢复看到同一意图键且状态已是 `delivered` 时，`enqueueDelivery` 次数不增加，不第二次把意图写成 `delivered`。接受不能再成功一次。 |

## 6. 非目标

- 不删除 `accepted` 的 `accepted_no_further_exec_schedule`。
- 不把 `pendingEventRelay` 或 `roundDispatcher` 当成送达回执。
- 不新增调度器，不新增模型执行环。
- 本轮不接真实渠道、不重启生产、不跑真实模型、不渲染实物 PPT。
- 不把每个已接受工作项默认当成组终稿外发。
- 不实现本文。核准前不改生产行为。
- 不清理 619 条 `INEFFECTIVE_DYNAMIC_IMPORT`。
- 不开始 D0–D5。

## 7. 开放问题

留给核准人，本文不代为扩大范围：

1. 成员成果的 `target` 由哪一个现有调用方传入。本文只要求它在接受追加时落盘，不从群配置猜渠道。
2. 恢复扫描挂在 `server.impl.ts` 现有 `recoverPendingDeliveries` 旁边，是否就是核准的宿主。不另起定时器。
3. 组终稿集成仍是缺口。是否另开设计，不在这条成员成果补链里顺带定义。
4. 第一次实现是否只做到意图和队列桩，真实 `deliverOutboundPayloads` 仍保持 GAP。本文倾向如此，直到单独授权真实渠道。
