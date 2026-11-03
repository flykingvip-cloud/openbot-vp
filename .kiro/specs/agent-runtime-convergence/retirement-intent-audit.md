# 已删三兼容壳：设计意图回溯审计

只读审计；未编辑。不是仅凭零引用判冗余，而是复核原设计、迁移和退役diff。退役提交 `105f901bc7b10d9caaca404ccc175e2378c655c7`。

## 历史证据范围

当前主历史的 untrusted/payload 首次出现于 parentless recovery snapshot `dd6c85cae086d90c519ff1be7ad08e20d4644bba`。其提交明确引用 original tip `9a8e91d19e893fc5d963103538cdbd35f315ac30`；该对象本地可读取，故继续沿原tip历史回溯，不能把snapshot误写成设计引入。

`git log --follow --diff-filter=A <original-tip> -- <path>` 得到两文件引入 `15e145a6c74faf63aef392de8fc831fb1277629c`（#826）。该提交主题为 owner decision card；不能仅依大提交主题推断每个辅助函数职责，以下同时依据文件内容和调用方。

## 1. untrusted-context.ts

- 引入：`15e145a6c...`，内容是16行纯格式器 appendUntrustedContext：外源字符串换行规范化、过滤空项、添加“不视为指令或命令”的不可信元数据头，追加用户正文。
- 原消费：original snapshot `get-reply-run.ts:176` 导入，`:1320` 追加 UntrustedContext；负责信任表达，不是流程控制，也不是废弃功能。
- 迁移：`de88944e210f96c7704b82f84344434d53f88fdb`。`git diff old:new` 证明函数体一致，仅normalize依赖转shared/text，文件mode调整；新增runtime测试覆盖换行、空项、不去重语义。get-reply-run转直引runtime。
- 退役前：旧文件只剩2行reexport；退役只删壳。权威能力仍在 `src/agent-runtime/context/untrusted.ts`。
- 判断：可证明不删除原不可信格式功能。不是“函数无价值”，而是内部路径迁移后接口壳无消费者。

## 2. agent-runner-payloads.ts

- 引入：`15e145a6c...`，225行候选回复准备：heartbeat/silent处理、指令规范化、媒体路径、reply threading、messaging tool文本/媒体去重、已发block去重及跨目标回复抑制边界。
- 原消费：snapshot `agent-runner.ts:49` import、`:611` buildReplyPayloads。它是交付候选准备，不是任务验收成功或transport确认。
- 迁移：`5907080c399ee80957c00e8a28c82b1861794a17`。old/new文件diff只有import归属/顺序、注释与mode，无函数体变更；agent-runner直引runtime/delivery/index。
- 退役前：旧模块只剩buildReplyPayloads reexport，测试仍旧import。`105f901bc` 同时把 `agent-runner-payloads.test.ts` 转为runtime公开接口，删除2行壳，不删用例。
- 判断：原媒体失败降级、去重与线程处理保留。不能因名叫payload就把此职责扔到任务验收器，现目标归属presentation合理。

## 3. execution-stall-continue-loop.ts

- 引入：`fc03711b5c89f8cecd04e6d00ffa9c1dcf3db154`，single-chain-tool-protocol-p0。提交正文明确目的：每轮开始及隐藏triggerTurn返回后检查protocol_violation，违约后不得继续模型调用，抽取循环以便直接测试调用次数。
- 原能力：有界continueBudget；取消/超时检查；协议边界前后检查；按类型选择continue prompt；send失败break；onContinued计数。不是多余第二执行器，而是原执行器有限恢复组件。
- 原消费：attempt调用；loop.test与attempt.test覆盖协议隔离。后续e40b8fb16包含task_board_continue/stall/stop/resume变更，迁移基于最新实现（含recoverable-tool-failure），不是还原最初81行版本。
- 迁移：`ac0f448e135d970d03cc5b6964126ee910533375`。old/new diff只两条相对import变化，函数逻辑相同；attempt直引runtime/execution/index，新增runtime定向用例。
- 退役：`105f901bc` 迁移原loop.test和attempt.test两处import至公开execution入口，删6行兼容导出，不删循环、协议校验或原测试。
- 判断：原设计意图完整保留；只能删路径壳，不能把剩余runtime循环当重复主控删除。

## 外部API与消费者证据

全repo（含hidden）检索及package.json exports、tsdown显式入口、src/plugin-sdk、scripts/architecture无三旧路径公开声明/动态加载。退役diff显示仍有的测试消费者同时迁移。当前生产消费者在 get-reply-run、agent-runner、attempt 分别直接使用runtime实现。

结论是“未发现公开SDK契约，仓内消费者已迁移”，不是“证明外部私有代码绝不会深导入”。如部署使用用户自写内部深导入需运维另查；没有公共exports证据，不必为无法证明的外部内部路径永久留壳，但发布迁移记录应明确内部路径变更。

## 总结与门禁

三项删除是完成迁移后的兼容入口退役，不是删除原业务功能。已有git diff证据支持逻辑保留；仍须由owner以相关回归和架构检查证明当前组合可用，本审计未重跑测试。

建议tasks/退役清单登记每个引入commit、原意图、迁移commit、新权威位置、消费者迁移、外部API判定和测试证据，避免以后只以rg零引用删除。Lobster/hooks/OpenProse的设计意图、运行消费者和资产未审完，不能沿用“三纯壳安全”结论。

— runtime-extension-audit
