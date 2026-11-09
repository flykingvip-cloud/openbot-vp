# 独立专家3：旧执行器剥离与退役验收

结论：不通过整体退役门禁。已有局部旧实现删除，但不能删除 legacy runner、cron、followup 或扩展整目录。基于 HEAD 89b963ff7 及当前未提交商业门禁迁移的源码检查；未进行真实模型/线上实测。

## P1 阻塞

1. 正常入口虽已进入新 execution，底层实际循环仍由旧目录持有：src/agent-runtime/execution/runner/command-candidate.ts:103 调 runCliAgent，:237 调 runEmbeddedPiAgent；src/agents/pi-embedded-runner/run.ts:265 是实际实现。它们不是无消费者遗留。应将其作为受控执行后端保留，先迁清状态/授权/取消责任，再逐组件搬迁，禁止整目录删除。
2. 定时/恢复入口仍有独立编排消费者：src/cron/isolated-agent/run.ts:1205 调 CLI、:1256 调 embedded；src/auto-reply/reply/followup-runner.ts:504 调 embedded。原意分别是隔离定时运行和队列续跑，不能以路径不同认定冗余，也不能宣称唯一主链已覆盖所有入口。需要证明每条入口经同等授权、任务绑定、预算、旧回调拒绝和交付回执；cron/followup 与个人/协作真实异步序列通过后才退旧调度主体。
3. 配置仍可加载可执行模块：src/gateway/hooks-mapping.ts:171-173 加载并执行 transform，:364 importFileModule；src/gateway/server-http.ts:556 是真实消费者。src/hooks/loader.ts:152-190 解析/注册 legacy handler；src/gateway/server-startup.ts:133 加载。路径包含检查不等于控制权限制。必须盘点有效配置和实际加载/调用，区分纯映射/观测与持有计划、恢复或子运行控制的脚本。当前不能证明不存在隐藏第二执行器。
4. Lobster/OpenProse 仍有明确编排语义：extensions/lobster/src/lobster-tool.ts:72 spawn、:196-205 resume token、:232 execute；extensions/open-prose/skills/prose/SKILL.md:9 VM 说明、:13 sessions_spawn 映射、:252 session 触发子会话。这是文件内容证据，非本审查执行指令。只能保留为显式受控子工作流或迁移用户资产后退役，不能当作普通原子能力直接批准。有效启用/生产消费者未知。

## P2 待核实

BOOT.md 的启动意图仍存在：src/gateway/boot.ts:138 runBootOnce、:174 agentCommand。它是启动适配，需来源/身份/任务绑定审计，不能直接删除。task-orchestration/dispatch.ts:352-354 仍调用 invokeReadonlySurface；必须按只读取数能力审查，不因 loop/orchestration 名称删除。

## 去留清单

- 已删除、保持退役：src/agents/execution-stall-continue-loop.ts、src/auto-reply/reply/untrusted-context.ts 当前均不存在；命令 delivery 旧文件也已迁走。需持续静态门禁防复活。
- 保留受控适配：Pi/CLI 后端、ACP 后端、cron 触发、队列恢复、BOOT 启动；原意必须保留，统一的是权威准入和状态更新，不是把所有触发器合成一个函数。
- 补齐后退役：旧入口中的编排/结算业务主体；带业务控制的 hook/transform；Lobster/OpenProse 若无法满足核心任务身份/授权/取消契约，则先停用新接入、迁移资产，再清理。
- 不得直接清理：仍有消费者或持久化恢复令牌的实现；凭据 exec 与媒体原子 CLI 并非当然第二执行器。

## 实测清理门禁

同一候选 SHA 分别验证个人机器人、协作小组：任务创建→异步等待→查询不建任务→限制修订→暂停/取消→旧回调拒绝→恢复→成果验收→真实渠道回执。跨进程重启后重复回调不得双执行/双投递。记录 task/attempt/message/job 身份及权限、预算，不输出敏感正文。扩展另需有效配置ID、代码哈希、实际消费者、恢复资产清单。源码门禁通过不能替代上述实测。

每项删除前创建不可变归档 tag/清单并确认祖先包含；配置和资产迁移有版本及回退步骤；禁止双路同时发动作。回退只恢复适配注册，不运行两套权威状态机。现有 extension-disposition.md 仍明确生产配置未知，不能把该文档当已完成退役证据。
