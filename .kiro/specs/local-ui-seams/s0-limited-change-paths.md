# S0 后续切片有限修改路径

- 盘点 SHA：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`
- 本清单只列出方案第 7 节 S1–S4 为完成其放行条件所必需的路径。S0 本身不改这些文件的运行行为。
- 不得借「重构」批量搬文件、新增中央控制器、第二执行环、配置脚本、代理私聊或 `contracts/events.ts`。
- 合并、部署、DIGEST、切 LIVE、改 1+3 门禁／CI 不在本方案授权内，也不列入本路径。
- S5 的退役与同版本真实验收另等授权；本清单不预支删除路径。

## S1：个体交互可用和终局保障

允许审查并在后续切片修改的路径（紧扣「前置执行准备、商业排队、锁和模型超时对普通回应的影响」「交互资源等待上限及可见状态」「空输出／一般失败／持久化失败的可见结果」）：

- `src/auto-reply/reply/get-reply-run.ts`（交互与 `runReplyAgent` 的顺序、准备失败时的可见回执、终局持久化）
- `src/agent-runtime/wiring/reply-turn.ts`、`interaction-turn.ts`、`interaction-turn.runtime.ts`、`interaction-candidate.ts`、`interaction-effects.ts`
- `src/agent-runtime/command/governed-interaction.ts`、`authorized-interaction.ts`、`prepared-interaction.ts`、`route-interaction.ts`、`interpret-interaction.ts`、`interaction-sources.ts`
- `src/agent-runtime/model/interaction-completion.ts`、`interaction-output-contract.ts`、`authorized-session.ts`、`admission-lease.ts`、`command-admission-session.ts`、`command-commercial-gate.ts`
- `src/gateway/billing/agent-run-governance.ts`、`authorize-commercial-run.ts`、`agent-run-queue.ts`（记录并有界化交互等待，**不**绕过授权或凭空新增并发）
- 终局可见性：`src/agent-runtime/delivery/dispatch/complete-reply.ts`、`presentation/empty-reply.ts`、`src/gateway/server-methods/chat.ts` 中与个体回合错误／回执相关的部分（含 `broadcastChatError` 的耐久性缺口，只补有据回执，不新造总线）
- 必要的配套测试：上述文件的既有 `*.test.ts`，以及为方案 S1「先复现」用例新增的失败注入测试

明确不在 S1 扩大：群队列与提及顺序（S2）、执行阶段提取（S3）、质量返工闭环（S4）、知识库、CI。

## S2：协作交互与执行解耦

- `src/gateway/server-methods/chat.ts`：将 `understandGroupInteraction` 移出整轮 `groupDiscussionQueue` 等待；把 `deliverChatSendMentions` 从理解／准入之前移走或改为只贡献参与者信息。保留组状态变更／工作项认领的既有串行和锁。
- `src/gateway/collaboration-learning/group-interaction-understanding.ts`（继续走 `runGatewayUnderstanding`，不写入个人看板）
- `src/gateway/collaboration-learning/discuss-to-task-chat-hook.ts` 及正式建板消费点（已要求理解先于正式准入；本步补齐提及与理解的顺序，不恢复关键词回退）
- 提及投递：`src/gateway/server-methods/chat.ts` 内 `deliverChatSendMentions`、`src/organization/mention-delivery.ts` 及其 `interAgentBus.deliverMention` 实现。个人 1:1 steward 通讯用途可保留，但不得在拒准入／澄清前独立开跑群业务执行。
- 澄清目标及负责人关联所必需的既有协作 state／binding 文件（只在缺字段阻塞映射时扩原契约，不塞进个人任务板）。

本步不新建自动确认模式，不启用默认关闭开关，不改变需要阶段验收的用户要求。

## S3：执行职责与反馈收口

- `src/agent-runtime/execution/runner/controlled-execution.ts`、`execution-lifecycle.ts`、`execution-scope.ts`
- `src/agent-runtime/execution/runner/admitted-turn.ts`、`admitted-turn-attempt.ts`、`admitted-turn-host.ts`、`admitted-turn-recovery.ts`、`admitted-turn-state.ts`
- 既有工具／恢复／异步等待消费者：`embedded-attempt*.ts`、`cli-run.ts`、`task-continuation.ts`、`src/agent-runtime/state/repository/async-wait-*.ts`、`state/mutations/claim-queued-execution.ts`
- 绑定与阻塞：`src/agent-runtime/policy/task-binding.ts`、`blocker.ts`、`src/agent-runtime/state/mutations/execution-binding.ts`、`task-completion.ts`
- 场景适配仅保持 `assertControlledExecutionStages`：`src/commands/agent.ts`、`src/cron/isolated-agent/run.ts`、`src/auto-reply/reply/followup-runner.ts`

不得额外包一层重复模型规划，不得把所有场景改写成同一个 `runAdmittedTurn` 入口。

## S4：交付代理与返工闭环

- `src/agent-runtime/delivery/acceptance/criteria.ts`、`validation.ts`、`settlement.ts`、`index.ts`
- `src/agent-runtime/delivery/dispatch/prepare-visible.ts`、`confirm-pending.ts`、`complete-reply.ts`
- `src/agent-runtime/wiring/task-acceptance.ts`、`delivery-confirm.ts`
- `src/agent-runtime/contracts/quality.ts`、`delivery.ts`（只在缺字段时扩展，不把「列了质量字段」当验收实现）
- 预览／编辑／下载对齐 artifact/version/hash 所必需的既有成果路径（仅当 S4 测试要求对齐时触达，不顺手改知识库入库）

验收失败沿原工作有界返工；仅投递失败只重投。草稿无自动保存知识库。

## 各切片共同允许但不扩张的范围

- 为映射缺口**最小**扩展既有 `src/agent-runtime/contracts/*` 字段。禁止新建 `contracts/events.ts`、Event Bus、每代理 inbox。
- 为上述路径增加失败注入测试。
- 更新本目录 S0 清册中被后续切片改变的「当前事实」记录。

## 明确排除

- `/workspace/repos/openbot-vp`、`/workspace/openbot-vp-r5-diagnosis-wire` 等既有 checkout，以及用户机器上的 Codex worktree
- 功能分支混入、静默 rebase
- `deploy/`、releases 账本、DIGEST、LIVE、1+3 门禁、GitHub CI 配置
- hooks / Lobster / OpenProse 批量删除（方案 S5 另有条件）
- 三个机器人、三个进程、三套调度器、自然语言互相委派
