# 通用完成路径身份绑定审计

只读基线 `fb772cbd981976918a82dffdadbb72fcada66b46`。Contributor runtime-mainline-audit。未修改或运行产品；以下将源码确定事实与待复现实机影响分开。

## 已证代码缺口 P1：完成入口丢失目标身份

`src/conversation-task/session-task-board.ts:999` 的recordCheckedTaskCompletion输入只有sessionFile/closed。它在锁内读**当时current**，调用finishCurrentTask({board,deliverableChecked:true})，未传taskId、executionAttempt、deliverableVersion。

`finishCurrentTask`(:1113)虽有三项可选保护，但taskId只有非空才比较、attempt/version仅双方非空才比较。由record入口调用时均跳过。因此锁只防数据竞争，不防语义上把A结果用于关闭B。

确定反例（单元级，可直接复现）：A执行后focus切换B，调用recordCheckedTaskCompletion({sessionFile,closed:true})代表A迟到结果。当前实现会将B.unfinished=false并checked=true。没有任何参数可让入口拒绝A。现有C4测试直接调用finishCurrentTask传taskId，不能覆盖此适配入口遗漏。

### 生产消费者1：ConversationTask reply completion

`src/conversation-task/reply-completion.ts:202` 输入带requester/conversation/sourceMessageId/text。:235在CTR store中匹配旧task，:246左右对其goal做reply alignment；:269 await flush observations、:273 await ledger completion后，:283/:286只传sessionFile和closed给session board。

因此CTR task可正确绑定A，但**没有将该身份映射至会话current**。await期间focus可成为B；两域taskId不一定同值，不能直接把CTR id塞进board参数。须捕获入站时board task身份/attempt或明确域映射，完成前锁内校验。

### 生产消费者2：complex task shaping

`src/task-orchestration/complex-task-loop.ts:241`在aligned且sessionFile时调用相同无身份record入口。alignment针对当前input的acceptance/draft，不核对盘上current身份。此函数本身同步，但被agent-runner在模型完成后的后处理调用；模型运行期已发生focus切换的场景仍需拦截。

### 严重性边界

这不是新迁移引入，是原入口缺少保护。代码可确定无身份入口会关闭当时current；是否特定线上开关/事件已触发需真实测试。不能仅据静态审计宣称所有生产任务会误关，也不能因此删CTR或complex治理。

## 另一个已证边界：主转录通知 raw append

recordCheckedTaskCompletion在状态提交后，使用fs.appendFileSync(file, JSON.stringify({message})+LF)写taskCompletionNotice(:1040附近)，未走SessionManager.appendMessage、无parentId。与Gateway AGENTS要求存在明确不一致。是否该行被当前history特殊扫描消费，以及是否破坏Pi叶链需要单独复现。修复不能仅删通知，应迁SessionManager或由原对话投递/记录端口承接，保留notice消费者。

## 最小回归测试建议

1. **adapter错任务**：seed A → capture A task/attempt → 插入B → 调record(A完成)；期望B不变、无完成通知；当前输入缺identity，需先失败测试标明API缺口。
2. **同任务旧attempt**：task同ID、attempt由1变2、artifact版本变化，旧结果不得关闭；缺身份时不能默认全通过。
3. **CTR异步交错**：真实observe入口，用deferred ledger Promise；匹配A后切board到B，再resolve；只关闭合法CTR A，session B仍unfinished，无错误notice。
4. **complex调用绑定**：input A已通过alignment，盘上B；不能因same session关闭B。门禁准入必须启用，否则测试只覆盖no-op。
5. **合法完成**：身份/版本正确时锁内完成一次，notice和pending列表原样；重复完成不重复追加/交付。
6. **取消后迟到**：A墓碑、B新current，A结果不能关B；暂停也不能被checked-result解除。
7. **SessionManager完整性**：构造真实转录有parent链，完成通知后读取history/buildSessionContext，确认既有消息与notice可见且叶链不被raw行影响。

## 建议补齐边界

扩展record入口为显式expected session task identity并返回拒绝原因；调用方从执行启动/入站时捕获，不能在完成时重读current伪装绑定。未能映射则fail closed，不自动关current。业务验收、CTR close、会话板close、交付notice作为不同事实保持；主转录写入经受控记录端口。修复应独立bugfix checkpoint，先红后绿，不混称搬目录等价。
