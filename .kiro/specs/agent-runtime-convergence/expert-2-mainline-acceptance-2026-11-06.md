# 专家2：执行主链独立验收

结论：局部契约通过，个人与协作小组的端到端闭环暂不通过最终验收。未发现本次商业门禁迁移引入新的执行循环；不能据此宣称所有入口已统一。

## P1：命令渠道投递缺少终局回执接入
- src/agent-runtime/delivery/dispatch/command-result.ts:183 调用 deliverOutboundPayloads 却不接收其结果；:201 仅返回 payloads/meta。best-effort 错误只记录日志，未形成此命令结果中的可靠实际投递状态。
- src/commands/agent.ts:561、:1016 在投递前设 agentOutcomeSuccess=true；:1028 的 catch 仅在 success 未定义时登记失败。注意现有 outcome 将执行成功与投递区分，所以不宜简单改成投递失败等于执行失败；应保留执行结果并独立绑定实际投递回执。
- 验收要求：同一任务/attempt 的渠道拒绝、best-effort 部分失败、重投、静默无需投递均产生可查询事实，不能把已生成文本当成已投递。

## P1：跨重启等待与最终交付未成立
- src/agents/bash-process-registry.ts:75–76 的 runningSessions/finishedSessions 为内存 Map。当前本机后台子进程和旧回调 fencing 测试不能证明网关重启后的作业重认领与主动交付。
- 任务登记 tasks.md:423、:524 明确保留跨重启与最终个人/协作/渠道联合验收。
- 验收要求：实际异步作业运行中重启宿主，恢复后仅当前任务/attempt 能认领；暂停/取消/修订后旧结果不得唤醒；有效结果最终主动交付并有回执。

## P1：协作闭环证据不足
- src/agent-runtime/command/scenarios/collaboration-entry.ts:12–63 负责路由/组身份识别，本身并非组任务编排验收。该文件三项测试通过不能替代组计划、成员执行、汇总验收与投递的完整序列。
- 应对个人与协作分别跑同一版本真实模型/异步工具/渠道闭环，明确共享底座与组级任务权威，不能用个人任务板测试替代组级完成证明。

## 已验证基础
- command/route-interaction.ts:27–38 仅 execution_request 进入准入，reply/clarify 直接回应，修订和控制返回绑定提案。
- 定向测试命令：OPENBOT_TEST_PROFILE=low pnpm test src/agent-runtime/command/execution-admission.test.ts src/agent-runtime/command/scenarios/collaboration-entry.test.ts src/agent-runtime/command/route-interaction.test.ts src/agent-runtime/state/mutations/resume-current.test.ts src/agent-runtime/delivery/dispatch/complete-reply.test.ts
- 实际结果：5文件/37项通过，13.01秒；均为组件与模拟端口测试，未调用真实模型，未部署，未做重启试验。

## 退役前的必要实测矩阵
个人/协作各自覆盖：普通聊天不建任务；明确任务准入；活动任务期间查询与修订；异步等待后恢复；暂停/取消拒旧回调；重启恢复；成果验收失败返工；渠道投递失败与重投；最后主动交付且任务身份不串。任何一项未证，不应清理其对应旧能力实现。
