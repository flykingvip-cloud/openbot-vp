# 变更说明

基线：`github/main` `470bf68e82f3e48cbb22a621bff131a27a3d9c54`。  
未部署。线上 build 仍是 `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`。

## 从提示词挪到运行时的判断

- `pptx` → `cyber-ppt` 不再只靠技能正文提醒。frontmatter `alias-of` 在进入工具循环前收成唯一主技能。
- 契约里的 `forbidden-final-engines` 会拒绝 `exec` / `write` / `edit` / `process` 参数中的对应记号。
- `required-validators` 未拿到匹配回执时，不能把「完成」说给用户。模型文本和工具元数据里的 `qa_passed` 不算通过。
- 失败可否重试由 `classifyExecutionFailure` 决定。权限、审批拒绝、越界、契约违反、目标不清都不可重试，也不可换工具扩权。

## 唯一决定源

- 工具可见性：原工具策略管线。
- 主技能和禁止引擎：`src/agents/execution-preflight/`。
- 执行审批：`requiresExecApproval`，没有改。
- 资源范围：原工作区授权，没有复制一套。
- 长程资格：原 `qualifyTurn`。preflight 只映射意图，不新建分类器。
- 进度账本：原 `createCronLedgerSession`。preflight 不写账本。
- 瞬时 HTTP 重试的执行点：仍是 `runAgentTurnWithFallback`，但要先通过失败分类。

## 删除或降级

- 没有删除影子路由器。它继续编译期关闭，不参与选择。
- 没有打开 ConversationTask 的检测、资格、激活。
- 没有第二套代理、第二套长程循环、第二套授权总线。
- 技能正文里没有写进契约字段的「必须 / 禁止」仍然只是提示。没有把整份 SKILL.md 变成解释器。

## 仍然只是观察

- `OPENBOT_EXECUTION_ROUTER_OBSERVATION` 默认关。线上未设置。
- ConversationTask shadow / activation 默认关。线上未设置。
- 入站工具天花板默认关。线上未设置。retrieve 不会自动变成只读工具集。
- 进度账本线上已启用，但只观察带目标和验收条的定时任务，不执行。
- 焦点切换门在 `chat.send` 里运行，失败放行。它不是新的执行器。

## 还要部署后才能证实

- 新事件是否出现在运行中的 gateway 日志。
- 线上默认技能上限 150 / 30000 是否与当前源码一致。本次只证实线上配置没有覆盖。
- 一次真实任务是否在缺少受信任回执时停止宣称完成。单元测试覆盖了这个分支，线上没有跑。
