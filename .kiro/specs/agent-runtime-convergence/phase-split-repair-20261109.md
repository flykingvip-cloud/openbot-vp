# 阶段拆分缺陷修复验收

- 开始/结束 HEAD：e7e9184e2c95ef2da28db5b40a60322178d0e283；origin/main=b20db5861958748d2fa759ec618c61a2e283c88c，新鲜 fetch 后祖先门禁通过。结果针对该 HEAD 加现场 WIP，不是干净提交。
- 取消：embedded-attempt-prompt 的取消回调直接读 abortSignal.reason，移除跨模块不可见局部函数引用，保留原原因与超时分类。
- 清理：preflight 进入恢复 Skill 环境和 cwd 的 try/finally，读取失败不再泄漏环境。
- 类型：新 embedded-attempt-state.ts 明确 134 个字段类型；原各阶段 Record<string, any>、\_\_d:any 和相关 lint-disable 删除，临时返回值通过局部 const 推断；sessionManager 缺失在使用阶段显式拒绝。没有增加运行器或改变阶段顺序。状态仍由顺序阶段逐步初始化，构造处的单一类型断言是迁移边界，未宣称已经具备编译期完整 typestate 证明。
- 新增生产入口测试：bootstrap 失败恢复 cwd/Skill 环境且不取锁；已取消 user/timeout 信号保留 AbortError cause，不调用 provider，锁与环境只释放一次。保留既有任务停止及上下文配对测试。新增测试在修复后建立并验证，本轮没有将它描述为修前实跑红测；修前源码和 tsgo 已明确证实原缺陷。
- 联合命令：OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/agents/pi-embedded-runner/run/attempt.context-assemble-pairing.runner.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/pi-embedded-runner/run.overflow-compaction.test.ts src/agents/pi-embedded-runner/run.overflow-compaction.loop.test.ts src/agents/pi-embedded-runner/usage-reporting.test.ts src/agent-runtime/execution/runner/controlled-execution.test.ts src/agent-runtime/execution/runner/admitted-turn.test.ts src/agent-runtime/execution/runner/command-lifecycle.test.ts src/agent-runtime/delivery/dispatch/confirm-pending.test.ts src/agent-runtime/state/repository/async-wait-recovery.production-path.test.ts src/gateway/collaboration-dispatch/legacy-production-executor.g8.test.ts src/agents/system-prompt.public-boundary.test.ts：12 files / 128 PASS。
- pnpm tsgo：PASS；11 修改文件 typed oxlint：0 errors/0 warnings；git diff --check：PASS。
- pnpm build：PASS；INEFFECTIVE_DYNAMIC_IMPORT 警告出现 217 次，另有 UI chunk 大小警告；不称警告全部清零或相对基线无变化。未重启任何 Gateway，构建不代表生产生效。
- 架构门禁：仍有他队 metadata-completion.test.ts 私有模型导入 1 项；未修改该 WIP。
- 归属：本任务 owner=codex-runtime-manager 已登记本次 session。attribution 仍有既有路径冲突和测试路径的他队 lander，未擅自修改共享 lander，也未提交。
- 真实模型/真实渠道/协作真实模型/PPT 实物仍 GAP；未推送、未提交、未合并、未部署、未真实外发。

— codex-runtime-manager
